use super::{BackendHead, EncodedObject, PublishResult, SyncBackend, TransportConfig, INDEX_NAME};
use git2::{Cred, Direction, FetchOptions, Index, IndexEntry, IndexTime, ObjectType, Oid, PushOptions, RemoteCallbacks, Repository, Signature};
use std::{fs, path::Path, sync::{Arc, Mutex}};
#[cfg(not(target_os = "windows"))]
const CACERT_PEM: &[u8] = include_bytes!("../../certs/cacert.pem");
#[cfg(not(target_os = "windows"))]
const GITEE_CHAIN: &[u8] = include_bytes!("../../certs/gitee-chain.pem");
#[cfg(not(target_os = "windows"))]
use std::sync::OnceLock;
#[cfg(target_os = "android")]
use foreign_types::ForeignType;

pub struct GitBackend { repo: Repository, remote: String, token: String, username: String, branch: String, head: Option<Oid> }
impl GitBackend {
    pub fn new(cache: &Path, config: &TransportConfig) -> Result<Self, String> {
        let remote = config.git_remote.as_deref().unwrap_or("").trim().to_string();
        if remote.is_empty() { return Err("SYNC_REMOTE_REQUIRED".into()); }
        if remote.contains("://") {
            let url = reqwest::Url::parse(&remote).map_err(|_| "SYNC_INVALID_REMOTE")?;
            if url.scheme() != "https" || url.password().is_some() { return Err("SYNC_HTTPS_REQUIRED".into()); }
        }
        fs::create_dir_all(cache).map_err(|error| error.to_string())?;
        configure_network(cache)?;
        let repo = if cache.join("HEAD").is_file() { Repository::open_bare(cache) } else { Repository::init_bare(cache) }.map_err(|error| error.to_string())?;
        // An auxiliary Git setting only; business conflicts never reach Git merge.
        repo.config().and_then(|mut config| config.set_bool("rerere.enabled", true)).map_err(|error| error.to_string())?;
        let username = credential_usernames(&remote).first().cloned().unwrap_or_else(|| "oauth2".into());
        Ok(Self { repo, remote, token: config.git_token.clone().unwrap_or_default(), username, branch: "refs/heads/main".into(), head: None })
    }
    fn callbacks(&self) -> RemoteCallbacks<'static> {
        let token = self.token.trim().to_string();
        let username = self.username.clone();
        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, username_from_url, allowed| {
            if token.is_empty() { return Cred::default(); }
            if allowed.is_user_pass_plaintext() {
                return Cred::userpass_plaintext(username_from_url.unwrap_or(&username), &token);
            }
            if allowed.is_username() {
                return Cred::username(username_from_url.unwrap_or(&username));
            }
            Err(git2::Error::from_str("SYNC_UNSUPPORTED_CREDENTIAL_PROMPT"))
        });
        callbacks
    }
    fn fetch_head(&mut self) -> Result<(), String> {
        let mut usernames = credential_usernames(&self.remote);
        let mut last_error: Option<String> = None;
        let mut token_name_resolved = false;
        let mut index = 0;
        while index < usernames.len() {
            let username = usernames[index].clone();
            self.username = username;
            match self.fetch_head_once() {
                Ok(()) => return Ok(()),
                Err(error) if is_auth_http_error(&error) => {
                    last_error = Some(error);
                    if !token_name_resolved {
                        token_name_resolved = true;
                        if let Some(name) = token_username(&self.remote, self.token.trim()) {
                            if !usernames.contains(&name) { usernames.insert(index + 1, name); }
                        }
                    }
                },
                Err(error) => return Err(error),
            }
            index += 1;
        }
        Err(last_error.unwrap_or_else(|| "SYNC_FETCH_FAILED".into()))
    }
    fn fetch_head_once(&mut self) -> Result<(), String> {
        let mut remote = self.repo.remote_anonymous(&self.connection_url()).map_err(|error| error.to_string())?;
        remote.connect_auth(Direction::Fetch, Some(self.callbacks()), None).map_err(transport_error)?;
        let branch = match remote.default_branch() {
            Ok(value) => value.as_str().ok_or("SYNC_INVALID_BRANCH")?.to_string(),
            Err(error) if matches!(error.code(), git2::ErrorCode::NotFound | git2::ErrorCode::UnbornBranch) => {
                remote.disconnect().map_err(|error| error.to_string())?;
                // A local bare repository can still have an unborn master HEAD
                // after our first push creates main. Fetch a wildcard safely:
                // git2::Remote::list() has a null/zero-length slice bug on an
                // empty remote, so do not call that wrapper here.
                let mut options = FetchOptions::new(); options.remote_callbacks(self.callbacks());
                options.prune(git2::FetchPrune::On);
                remote.fetch(&["+refs/heads/*:refs/remotes/chronoeon/*"], Some(&mut options), None).map_err(transport_error)?;
                self.head = self.repo.refname_to_id("refs/remotes/chronoeon/main").ok();
                self.branch = "refs/heads/main".into();
                return Ok(());
            },
            Err(error) => return Err(transport_error(error)),
        };
        if !branch.starts_with("refs/heads/") || !git2::Reference::is_valid_name(&branch) { return Err("SYNC_INVALID_BRANCH".into()); }
        remote.disconnect().map_err(|error| error.to_string())?;
        self.branch = branch;
        let mut options = FetchOptions::new(); options.remote_callbacks(self.callbacks());
        remote.fetch(&[format!("+{}:refs/remotes/chronoeon/default", self.branch)], Some(&mut options), None).map_err(transport_error)?;
        self.head = Some(self.repo.refname_to_id("refs/remotes/chronoeon/default").map_err(|error| error.to_string())?);
        Ok(())
    }
    fn connection_url(&self) -> String {
        let Ok(mut url) = reqwest::Url::parse(&self.remote) else { return self.remote.clone(); };
        if url.scheme() == "https" && !self.token.trim().is_empty() && url.username().is_empty() {
            // Supplying the username in the URL lets libgit2 request the token
            // directly on hosts that do not perform a separate username probe.
            let _ = url.set_username(&self.username);
        }
        url.as_str().to_string()
    }
    fn read_blob(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        let Some(head) = self.head else { return Ok(None); };
        let tree = self.repo.find_commit(head).and_then(|commit| commit.tree()).map_err(|error| error.to_string())?;
        let entry = match tree.get_path(Path::new(path)) {
            Ok(entry) => entry, Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None), Err(error) => return Err(error.to_string()),
        };
        if entry.kind() != Some(ObjectType::Blob) || entry.filemode() != 0o100644 { return Err("SYNC_INVALID_OBJECT".into()); }
        let blob = self.repo.find_blob(entry.id()).map_err(|error| error.to_string())?;
        if blob.size() > super::MAX_OBJECT_BYTES { return Err("SYNC_OBJECT_TOO_LARGE".into()); }
        Ok(Some(blob.content().to_vec()))
    }
}
impl SyncBackend for GitBackend {
    fn fetch_index(&mut self) -> Result<BackendHead, String> {
        self.fetch_head()?;
        let bytes = self.read_blob(INDEX_NAME)?;
        if bytes.is_none() {
            if let Some(head) = self.head {
                let tree = self.repo.find_commit(head).and_then(|commit| commit.tree()).map_err(|error| error.to_string())?;
                // A fresh Gitee repo may contain its generated README/license.
                // A legacy DB-sync repo is NOT imported, reset or overwritten.
                if tree.iter().any(|entry| !matches!(entry.name(), Some("README.md" | "README.en.md" | "LICENSE" | ".gitignore"))) {
                    return Err("SYNC_USE_EMPTY_REMOTE".into());
                }
            }
        }
        Ok(BackendHead { head: self.head.map(|id| id.to_string()), bytes })
    }
    fn read_object(&mut self, path: &str) -> Result<Vec<u8>, String> {
        self.read_blob(path)?.ok_or_else(|| "SYNC_INCOMPLETE_REMOTE".into())
    }
    fn publish(&mut self, expected: Option<&str>, manifest: &[u8], objects: &[EncodedObject], deletes: &[String]) -> Result<PublishResult, String> {
        let current = self.fetch_index()?;
        if current.head.as_deref() != expected { return Ok(PublishResult { conflict: true }); }
        let mut index = Index::new().map_err(|error| error.to_string())?;
        let parent = self.head.map(|head| self.repo.find_commit(head)).transpose().map_err(|error| error.to_string())?;
        if let Some(parent) = &parent { index.read_tree(&parent.tree().map_err(|error| error.to_string())?).map_err(|error| error.to_string())?; }
        for object in objects {
            if let Some(existing) = self.read_blob(&object.path)? {
                super::validate_object(&object.path, &existing, &object.hash)?;
            } else { add_blob(&self.repo, &mut index, &object.path, &object.bytes)?; }
        }
        for path in deletes { let _ = index.remove_path(Path::new(path)); }
        add_blob(&self.repo, &mut index, INDEX_NAME, manifest)?;
        let tree_id = index.write_tree_to(&self.repo).map_err(|error| error.to_string())?;
        let tree = self.repo.find_tree(tree_id).map_err(|error| error.to_string())?;
        let signature = Signature::now("ChronoEon", "sync@chronoeon.local").map_err(|error| error.to_string())?;
        let parents = parent.iter().collect::<Vec<_>>();
        let oid = self.repo.commit(None, &signature, &signature, "Sync changes", &tree, &parents).map_err(|error| error.to_string())?;
        self.repo.reference("refs/heads/chronoeon-upload", oid, true, "sync publication").map_err(|error| error.to_string())?;
        let rejected = Arc::new(Mutex::new(None::<String>)); let status = rejected.clone();
        let mut callbacks = self.callbacks();
        callbacks.push_update_reference(move |_reference, message| { if let Some(message) = message { *status.lock().unwrap() = Some(message.to_string()); } Ok(()) });
        let mut options = PushOptions::new(); options.remote_callbacks(callbacks);
        let mut remote = self.repo.remote_anonymous(&self.connection_url()).map_err(|error| error.to_string())?;
        // No '+', rebase, reset or text merge. A stale parent is retried by the engine.
        if let Err(error) = remote.push(&[format!("refs/heads/chronoeon-upload:{}", self.branch)], Some(&mut options)) {
            if error.code() == git2::ErrorCode::NotFastForward { return Ok(PublishResult { conflict: true }); }
            return Err(format!("SYNC_PUSH: {error}"));
        }
        if rejected.lock().unwrap().is_some() { return Ok(PublishResult { conflict: true }); }
        Ok(PublishResult { conflict: false })
    }
}
fn credential_usernames(remote: &str) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(url) = reqwest::Url::parse(remote) {
        if url.scheme() == "https" && !url.username().is_empty() {
            names.push(url.username().to_string());
        } else if url.scheme() == "https" {
            if let Some(owner) = url.path_segments().and_then(|mut segments| segments.next()) {
                names.push(owner.to_string());
            }
        }
    }
    for name in ["oauth2", "git"] {
        if !names.iter().any(|existing| existing == name) { names.push(name.into()); }
    }
    names
}
fn identity_url(remote: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(remote).ok()?;
    if url.scheme() != "https" { return None; }
    match url.host_str()?.to_ascii_lowercase().as_str() {
        "gitee.com" => Some(reqwest::Url::parse("https://gitee.com/api/v5/user").ok()?),
        "github.com" => Some(reqwest::Url::parse("https://api.github.com/user").ok()?),
        _ => None,
    }
}
fn token_username(remote: &str, token: &str) -> Option<String> {
    if token.is_empty() { return None; }
    let endpoint = identity_url(remote)?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("ChronoEon/0.1")
        .timeout(std::time::Duration::from_secs(8))
        .build().ok()?;
    let request = if endpoint.host_str()? == "gitee.com" {
        let token_url = reqwest::Url::parse_with_params(endpoint.as_str(), &[("access_token", token)]).ok()?;
        client.get(token_url)
    } else {
        client.get(endpoint)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
    };
    let value = request.send().ok()?.error_for_status().ok()?.json::<serde_json::Value>().ok()?;
    value.get("login")?.as_str().map(str::to_string)
}
fn is_auth_http_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    ["unexpected http status code: 401", "unexpected http status code: 403"].iter()
        .any(|needle| normalized.contains(needle))
}
fn transport_error(error: git2::Error) -> String {
    let message = error.to_string();
    if message.contains("unexpected http status code: 403") {
        format!("SYNC_FORBIDDEN: {message}")
    } else if message.contains("unexpected http status code: 401") {
        format!("SYNC_UNAUTHORIZED: {message}")
    } else if message.starts_with("SYNC_FETCH: ") {
        message
    } else {
        format!("SYNC_FETCH: {message}")
    }
}
fn add_blob(repo: &Repository, index: &mut Index, path: &str, bytes: &[u8]) -> Result<(), String> {
    let id = repo.blob(bytes).map_err(|error| error.to_string())?;
    let entry = IndexEntry { ctime: IndexTime::new(0,0), mtime: IndexTime::new(0,0), dev: 0, ino: 0, mode: 0o100644,
        uid: 0, gid: 0, file_size: bytes.len() as u32, id, flags: 0, flags_extended: 0, path: path.as_bytes().to_vec() };
    index.add(&entry).map_err(|error| error.to_string())
}
fn configure_network(cache: &Path) -> Result<(), String> {
    unsafe { git2::opts::set_server_connect_timeout_in_milliseconds(12_000) }.map_err(|error| error.to_string())?;
    unsafe { git2::opts::set_server_timeout_in_milliseconds(90_000) }.map_err(|error| error.to_string())?;
    install_ca_roots(cache)
}

/// Android has no conventional OpenSSL CA path. Load the checked Mozilla
/// roots plus the Gitee chain as X.509 objects, without bypassing validation.
#[cfg(target_os = "android")]
fn install_ca_roots(_cache: &Path) -> Result<(), String> {
    static INSTALLED: OnceLock<Result<(), String>> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let pem = [CACERT_PEM, b"\n", GITEE_CHAIN].concat();
        let certificates = openssl::x509::X509::stack_from_pem(&pem).map_err(|error| format!("Could not parse the CA roots: {error}"))?;
        if certificates.is_empty() { return Err("The bundled CA root store is empty".into()); }
        let mut seen = std::collections::HashSet::new();
        for certificate in certificates {
            if !seen.insert(certificate.to_der().map_err(|error|error.to_string())?) { continue; }
            let code = unsafe { libgit2_sys::git_libgit2_opts(libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as std::os::raw::c_int,certificate.as_ptr()) };
            if code < 0 { return Err("Could not add a bundled CA root to libgit2".into()); }
        }
        Ok(())
    }).clone()
}

/// Preserve the Windows Schannel correction: use the OS trust store, not a PEM path.
#[cfg(target_os = "windows")]
fn install_ca_roots(_cache: &Path) -> Result<(), String> { Ok(()) }

#[cfg(not(any(target_os = "android", target_os = "windows")))]
fn install_ca_roots(cache: &Path) -> Result<(), String> {
    static INSTALLED: OnceLock<Result<(), String>> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        // Private app cache, never a shared predictable /tmp certificate file.
        let ca_file = cache.join("ca-roots.pem");
        crate::write_bytes_atomic(&ca_file, &[CACERT_PEM,b"\n",GITEE_CHAIN].concat())?;
        unsafe { git2::opts::set_ssl_cert_file(&ca_file) }.map_err(|error|format!("Could not install the CA roots: {error}"))
    }).clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    #[test]
    fn token_http_remotes_try_explicit_owner_and_standard_names() {
        assert_eq!(credential_usernames("https://alice@example.test/team/repo.git"), ["alice", "oauth2", "git"]);
        assert_eq!(credential_usernames("https://example.test/org/repo.git"), ["org", "oauth2", "git"]);
        assert_eq!(credential_usernames("D:/local/remote.git"), ["oauth2", "git"]);
        assert_eq!(identity_url("https://gitee.com/org/repo.git").unwrap().as_str(), "https://gitee.com/api/v5/user");
        assert_eq!(identity_url("https://github.com/org/repo.git").unwrap().as_str(), "https://api.github.com/user");
        assert!(identity_url("D:/local/remote.git").is_none());
        assert!(is_auth_http_error("SYNC_FETCH: unexpected HTTP status code: 403"));
        assert!(transport_error(git2::Error::from_str("unexpected http status code: 403")).starts_with("SYNC_FORBIDDEN: "));
    }
    #[test]
    fn git_is_a_cas_object_transport_and_never_merges_database_files() {
        let root = std::env::temp_dir().join(format!("chronoeon-sync-git-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap(); let remote_path = root.join("remote.git"); Repository::init_bare(&remote_path).unwrap().set_head("refs/heads/master").unwrap();
        let config = TransportConfig { mode: "git".into(), git_remote: Some(remote_path.to_string_lossy().into_owned()), ..Default::default() };
        let mut a = GitBackend::new(&root.join("a"), &config).unwrap(); let mut b = GitBackend::new(&root.join("b"), &config).unwrap();
        assert!(a.fetch_index().unwrap().head.is_none());
        let object = super::super::encode_document("sync/2026/09/07-test.jsonl.zst", "{\"op\":\"create\"}\n", &crate::attachments::hash(b"{\"op\":\"create\"}\n")).unwrap();
        assert!(!a.publish(None, b"{\"version\":1}", &[object], &[]).unwrap().conflict);
        let first = b.fetch_index().unwrap(); assert_eq!(first.bytes.unwrap(), b"{\"version\":1}");
        assert!(a.repo.config().unwrap().get_bool("rerere.enabled").unwrap());
        assert!(!b.publish(first.head.as_deref(), b"{\"version\":2}", &[], &[]).unwrap().conflict);
        assert!(a.publish(first.head.as_deref(), b"stale", &[], &[]).unwrap().conflict);
        assert_eq!(a.fetch_index().unwrap().bytes.unwrap(), b"{\"version\":2}");
        assert!(a.read_blob("data/chronoeon.db").unwrap().is_none());
        drop(a); drop(b);
        let resolved = fs::canonicalize(&root).unwrap(); assert!(resolved.starts_with(fs::canonicalize(std::env::temp_dir()).unwrap()));
        fs::remove_dir_all(resolved).unwrap();
    }
}
