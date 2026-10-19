use super::{BackendHead, EncodedObject, PublishResult, SyncBackend, TransportConfig, INDEX_NAME};
use git2::{Cred, Direction, FetchOptions, Index, IndexEntry, IndexTime, ObjectType, Oid, PushOptions, RemoteCallbacks, Repository, Signature};
use fs2::FileExt;
use std::{fs, path::Path, sync::{Arc, Mutex}};
#[cfg(not(target_os = "windows"))]
const CACERT_PEM: &[u8] = include_bytes!("../../certs/cacert.pem");
#[cfg(not(target_os = "windows"))]
const GITEE_CHAIN: &[u8] = include_bytes!("../../certs/gitee-chain.pem");
#[cfg(not(target_os = "windows"))]
use std::sync::OnceLock;
#[cfg(target_os = "android")]
use foreign_types::ForeignType;

pub struct GitBackend { repo: Repository, remote: String, token: String, username: String, branch: String, head: Option<Oid>, _cache_lock: fs::File }
impl GitBackend {
    pub fn new(cache: &Path, config: &TransportConfig) -> Result<Self, String> {
        let remote = config.git_remote.as_deref().unwrap_or("").trim().to_string();
        if remote.is_empty() { return Err("SYNC_REMOTE_REQUIRED".into()); }
        if remote.contains("://") {
            let url = reqwest::Url::parse(&remote).map_err(|_| "SYNC_INVALID_REMOTE")?;
            if url.scheme() != "https" || url.password().is_some() { return Err("SYNC_HTTPS_REQUIRED".into()); }
        }
        fs::create_dir_all(cache).map_err(|error| error.to_string())?;
        // OS lock is released even when Android kills the process. Hold it for
        // the entire repository lifetime, including fetch and publication.
        let cache_lock = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false)
            .open(cache.join("chronoeon-cache.guard")).map_err(|error| error.to_string())?;
        cache_lock.lock_exclusive().map_err(|error| error.to_string())?;
        remove_stale_locks(cache)?;
        configure_network(cache)?;
        let repo = if cache.join("HEAD").is_file() { Repository::open_bare(cache) } else { Repository::init_bare(cache) }.map_err(|error| error.to_string())?;
        // An auxiliary Git setting only; business conflicts never reach Git merge.
        repo.config().and_then(|mut config| config.set_bool("rerere.enabled", true)).map_err(|error| error.to_string())?;
        let username = credential_usernames(&remote).first().cloned().unwrap_or_else(|| "oauth2".into());
        Ok(Self { repo, remote, token: config.git_token.clone().unwrap_or_default(), username, branch: "refs/heads/main".into(), head: None, _cache_lock: cache_lock })
    }
    fn callbacks(&self) -> RemoteCallbacks<'static> {
        let token = self.token.trim().to_string();
        let username = self.username.clone();
        let mut attempted = std::collections::HashSet::new();
        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, username_from_url, allowed| {
            // libgit2 (especially WinHTTP) asks again after rejection. Returning
            // the same credential forever hides the 401 behind a replay error.
            let kind = if token.is_empty() { "default" } else if allowed.is_user_pass_plaintext() { "token" } else { "username" };
            if !attempted.insert(kind) { return Err(git2::Error::new(git2::ErrorCode::Auth, git2::ErrorClass::Http, "SYNC_UNAUTHORIZED")); }
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
        self.with_authentication(Self::fetch_head_once)
    }
    fn with_authentication<T>(&mut self, mut operation: impl FnMut(&mut Self) -> Result<T, String>) -> Result<T, String> {
        let mut usernames = credential_usernames(&self.remote);
        // Reuse a username that already worked earlier in this fetch/publish.
        usernames.retain(|name| name != &self.username);
        usernames.insert(0, self.username.clone());
        let mut last_error: Option<String> = None;
        let mut token_name_resolved = false;
        let mut index = 0;
        while index < usernames.len() {
            let username = usernames[index].clone();
            self.username = username;
            match operation(self) {
                Ok(value) => return Ok(value),
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
    fn push_commit(&mut self) -> Result<PublishResult, String> {
        let rejected = Arc::new(Mutex::new(None::<String>)); let status = rejected.clone();
        let mut callbacks = self.callbacks();
        callbacks.push_update_reference(move |_reference, message| { if let Some(message) = message { *status.lock().unwrap() = Some(message.to_string()); } Ok(()) });
        let mut options = PushOptions::new(); options.remote_callbacks(callbacks);
        let mut remote = self.repo.remote_anonymous(&self.connection_url()).map_err(|error| error.to_string())?;
        // No '+', rebase, reset or text merge. A stale parent is retried by the engine.
        if let Err(error) = remote.push(&[format!("refs/heads/chronoeon-upload:{}", self.branch)], Some(&mut options)) {
            if error.code() == git2::ErrorCode::NotFastForward { return Ok(PublishResult { conflict: true }); }
            let mapped = transport_error(error);
            return Err(if is_auth_http_error(&mapped) { mapped } else { mapped.replacen("SYNC_FETCH:", "SYNC_PUSH:", 1) });
        }
        if rejected.lock().unwrap().is_some() { return Ok(PublishResult { conflict: true }); }
        Ok(PublishResult { conflict: false })
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
        if matches!(url.scheme(), "https" | "http") && !self.token.trim().is_empty() {
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
        if parent.as_ref().is_some_and(|parent| parent.tree_id() == tree_id) {
            return Ok(PublishResult { conflict: false });
        }
        let tree = self.repo.find_tree(tree_id).map_err(|error| error.to_string())?;
        let signature = Signature::now("ChronoEon", "sync@chronoeon.local").map_err(|error| error.to_string())?;
        let parents = parent.iter().collect::<Vec<_>>();
        let oid = self.repo.commit(None, &signature, &signature, "Sync changes", &tree, &parents).map_err(|error| error.to_string())?;
        self.repo.reference("refs/heads/chronoeon-upload", oid, true, "sync publication").map_err(|error| error.to_string())?;
        drop(parents); drop(tree); drop(parent);
        self.with_authentication(Self::push_commit)
    }
}
// This directory is an app-owned disposable mirror, never a user's checkout.
// Only call while holding chronoeon-cache.guard; never follow symlinks.
fn remove_stale_locks(directory: &Path) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() { remove_stale_locks(&entry.path())?; }
        else if kind.is_file() && entry.path().extension().is_some_and(|extension| extension == "lock") {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
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
        .redirect(reqwest::redirect::Policy::none())
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
    ["sync_unauthorized", "sync_forbidden", "unexpected http status code: 401", "unexpected http status code: 403",
        "request failed with status code: 401", "request failed with status code: 403", "too many redirects or authentication replays"].iter()
        .any(|needle| normalized.contains(needle))
}
fn transport_error(error: git2::Error) -> String {
    let message = error.to_string();
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("unexpected http status code: 403") || normalized.contains("request failed with status code: 403") {
        format!("SYNC_FORBIDDEN: {message}")
    } else if error.code() == git2::ErrorCode::Auth || normalized.contains("unexpected http status code: 401") || normalized.contains("request failed with status code: 401") || message.contains("SYNC_UNAUTHORIZED") {
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
        assert!(is_auth_http_error("SYNC_FETCH: too many redirects or authentication replays; class=Http (34)"));
        assert!(is_auth_http_error("SYNC_UNAUTHORIZED: credentials rejected"));
        assert!(is_auth_http_error("SYNC_FETCH: request failed with status code: 403; class=Http (34)"));
        assert!(transport_error(git2::Error::from_str("request failed with status code: 403")).starts_with("SYNC_FORBIDDEN:"));
        assert!(!is_auth_http_error("SYNC_FETCH: failed to resolve address"));
        assert!(transport_error(git2::Error::new(git2::ErrorCode::Auth, git2::ErrorClass::Http, "rejected")).starts_with("SYNC_UNAUTHORIZED:"));
        assert!(transport_error(git2::Error::from_str("unexpected http status code: 403")).starts_with("SYNC_FORBIDDEN: "));
    }
    #[test]
    fn rejected_http_credentials_are_bounded_and_next_username_recovers() {
        use std::{io::{Read, Write}, net::TcpListener, sync::atomic::{AtomicBool, AtomicUsize, Ordering}, time::Duration};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false)); let done = stop.clone();
        let requests = Arc::new(AtomicUsize::new(0)); let count = requests.clone();
        let accept_valid = Arc::new(AtomicBool::new(true)); let valid = accept_valid.clone();
        let server = std::thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                let Ok((mut socket, _)) = listener.accept() else { std::thread::sleep(Duration::from_millis(5)); continue; };
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut input = Vec::new(); let mut chunk = [0; 1024];
                while !input.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let Ok(n) = socket.read(&mut chunk) else { break; }; if n == 0 { break; } input.extend_from_slice(&chunk[..n]);
                }
                count.fetch_add(1, Ordering::SeqCst);
                // oauth2:secret. The first username is deliberately rejected.
                let authorized = valid.load(Ordering::SeqCst) && String::from_utf8_lossy(&input).contains("b2F1dGgyOnNlY3JldA==");
                let response = if authorized {
                    let body = "001e# service=git-upload-pack\n00000000";
                    format!("HTTP/1.1 200 OK\r\nContent-Type: application/x-git-upload-pack-advertisement\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
                } else { "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=git\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into() };
                let _ = socket.write_all(response.as_bytes());
            }
        });
        let root = std::env::temp_dir().join(format!("chronoeon-auth-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let config = TransportConfig { mode: "git".into(), git_remote: Some("https://wrong@example.test/repo.git".into()), git_token: Some("secret".into()), ..Default::default() };
        let mut backend = GitBackend::new(&root, &config).unwrap();
        backend.remote = format!("http://wrong@{address}/repo.git");
        let recovered = backend.fetch_head();
        let recovered_username = backend.username.clone();
        accept_valid.store(false, Ordering::SeqCst);
        let failed = backend.fetch_head();
        stop.store(true, Ordering::SeqCst); server.join().unwrap();
        assert!(recovered.is_ok(), "{recovered:?}");
        assert_eq!(recovered_username, "oauth2");
        assert!(failed.unwrap_err().starts_with("SYNC_UNAUTHORIZED:"));
        assert!(requests.load(Ordering::SeqCst) < 25);
        drop(backend);
        let resolved = fs::canonicalize(&root).unwrap(); assert!(resolved.starts_with(fs::canonicalize(std::env::temp_dir()).unwrap()));
        fs::remove_dir_all(resolved).unwrap();
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
        let unchanged = a.fetch_index().unwrap().head;
        for _ in 0..5 {
            assert!(!a.publish(unchanged.as_deref(), b"{\"version\":2}", &[], &[]).unwrap().conflict);
            assert_eq!(a.fetch_index().unwrap().head, unchanged);
        }
        drop(a); drop(b);
        for path in ["refs/heads/chronoeon-upload.lock", "packed-refs.lock", "config.lock", "refs/remotes/chronoeon/default.lock"] {
            let path = root.join("a").join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"interrupted").unwrap();
        }
        let mut recovered = GitBackend::new(&root.join("a"), &config).unwrap();
        assert!(!root.join("a/refs/heads/chronoeon-upload.lock").exists());
        assert_eq!(recovered.fetch_index().unwrap().head, unchanged);
        assert!(!recovered.publish(unchanged.as_deref(), b"{\"version\":3}", &[], &[]).unwrap().conflict);
        // A second process/connection cannot claim or clean this active cache.
        let guard = fs::OpenOptions::new().read(true).write(true).open(root.join("a/chronoeon-cache.guard")).unwrap();
        assert!(guard.try_lock_exclusive().is_err());
        drop(recovered);
        guard.try_lock_exclusive().unwrap();
        drop(guard);
        let resolved = fs::canonicalize(&root).unwrap(); assert!(resolved.starts_with(fs::canonicalize(std::env::temp_dir()).unwrap()));
        fs::remove_dir_all(resolved).unwrap();
    }
}
