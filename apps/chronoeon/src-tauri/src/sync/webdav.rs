use super::{BackendHead, EncodedObject, PublishResult, SyncBackend, TransportConfig, INDEX_NAME, MAX_OBJECT_BYTES};
use reqwest::{blocking::{Client, RequestBuilder, Response}, header::{ETAG, IF_MATCH, IF_NONE_MATCH}, Method, Url};
use std::{collections::HashSet, io::Read, sync::{Mutex, OnceLock}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

pub struct WebDAVBackend { client: Client, base: Url, username: String, password: String, collections: HashSet<String>, lock_token: Option<String>, locked_at: Instant }
impl WebDAVBackend {
    pub fn new(config: &TransportConfig) -> Result<Self, String> {
        let address = config.webdav_url.as_deref().unwrap_or("").trim();
        let mut base = Url::parse(address).map_err(|_| "SYNC_INVALID_REMOTE")?;
        let loopback = matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (base.scheme() != "https" && !(base.scheme() == "http" && loopback)) || !base.username().is_empty() || base.password().is_some() {
            return Err("SYNC_HTTPS_REQUIRED".into());
        }
        if base.query().is_some() || base.fragment().is_some() { return Err("SYNC_INVALID_REMOTE".into()); }
        base.set_path(&format!("{}/", base.path().trim_end_matches('/')));
        crate::network::ensure_tls_ready()?;
        let client = Client::builder().connect_timeout(Duration::from_secs(12)).timeout(Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::none()).build().map_err(|error| error.without_url().to_string())?;
        Ok(Self { client, base, username: config.webdav_username.clone().unwrap_or_default(), password: config.webdav_password.clone().unwrap_or_default(), collections: HashSet::new(), lock_token: None, locked_at: Instant::now() })
    }
    fn plain_request(&self, method: Method, path: &str) -> Result<RequestBuilder, String> {
        let url = self.base.join(path).map_err(|_| "SYNC_INVALID_REMOTE")?;
        let request = self.client.request(method, url);
        Ok(if self.username.is_empty() { request } else { request.basic_auth(&self.username, Some(&self.password)) })
    }
    fn request(&self, method: Method, path: &str) -> Result<RequestBuilder, String> {
        let request = self.plain_request(method, path)?;
        Ok(match &self.lock_token { Some(token) => request.header("If", format!("({token})")), None => request })
    }
    fn acquire_lock(&mut self) -> Result<bool, String> {
        self.collection("")?;
        let method = Method::from_bytes(b"LOCK").map_err(|error| error.to_string())?;
        let response = Self::send(self.plain_request(method, "")?.header("Depth", "infinity").header("Timeout", "Second-600")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body("<d:lockinfo xmlns:d=\"DAV:\"><d:lockscope><d:exclusive/></d:lockscope><d:locktype><d:write/></d:locktype><d:owner>ChronoEon sync</d:owner></d:lockinfo>"))?;
        if matches!(response.status().as_u16(),405|501) { return Ok(false); }
        if matches!(response.status().as_u16(),423|409|412) { return Err("SYNC_REMOTE_BUSY".into()); }
        if !response.status().is_success() { return Err(format!("SYNC_WEBDAV_LOCK: HTTP {}",response.status().as_u16())); }
        let token = response.headers().get("Lock-Token").and_then(|value|value.to_str().ok()).ok_or("SYNC_WEBDAV_LOCK_INVALID")?.to_string();
        if !token.starts_with('<') || !token.ends_with('>') { return Err("SYNC_WEBDAV_LOCK_INVALID".into()); }
        self.lock_token = Some(token); self.locked_at = Instant::now();
        if let Some(timeout) = response.headers().get("Timeout").and_then(|value|value.to_str().ok()) {
            // Avoid an unbounded server lock that could strand every other
            // device after a crash. Class-1 CAS sync remains usable below.
            if timeout.eq_ignore_ascii_case("infinite") {
                self.release_lock()?; return Ok(false);
            }
            if timeout.strip_prefix("Second-").and_then(|value|value.parse::<u64>().ok()).is_some_and(|seconds|seconds<180) {
                return Err("SYNC_WEBDAV_LOCK_TOO_SHORT".into());
            }
        }
        // Some servers advertise LOCK but fail to protect descendants. Refuse
        // unsafe cleanup rather than trusting the advertised DAV class alone.
        let probe = format!(".chronoeon-lock-probe-{}",SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error|error.to_string())?.as_nanos());
        let response = Self::send(self.plain_request(Method::PUT,&probe)?.header(IF_NONE_MATCH,"*").body("probe"))?;
        if !matches!(response.status().as_u16(),412|423) {
            let _ = Self::send(self.request(Method::DELETE,&probe)?);
            return Err("SYNC_WEBDAV_LOCK_UNSAFE".into());
        }
        Ok(true)
    }
    fn refresh_lock(&mut self) -> Result<(),String> {
        if self.lock_token.is_none() || self.locked_at.elapsed() < Duration::from_secs(60) { return Ok(()); }
        let method = Method::from_bytes(b"LOCK").map_err(|error|error.to_string())?;
        let response = Self::send(self.request(method,"")?.header("Timeout","Second-600"))?;
        if !response.status().is_success() { return Err("SYNC_WEBDAV_LOCK_LOST".into()); }
        self.locked_at = Instant::now(); Ok(())
    }
    fn release_lock(&mut self) -> Result<(),String> {
        let Some(token) = self.lock_token.take() else { return Ok(()); };
        let method = Method::from_bytes(b"UNLOCK").map_err(|error|error.to_string())?;
        let response = Self::send(self.plain_request(method,"")?.header("Lock-Token",token).timeout(Duration::from_secs(5)))?;
        if response.status().is_success() || matches!(response.status().as_u16(),404|409|412) { Ok(()) }
        else { Err("SYNC_WEBDAV_UNLOCK".into()) }
    }
    fn publish_objects(&mut self, expected: Option<&str>, manifest: &[u8], objects: &[EncodedObject], deletes: &[String], locked: bool) -> Result<PublishResult,String> {
        for object in objects {
            self.refresh_lock()?;
            self.parents(&object.path)?;
            let response = Self::send(self.request(Method::PUT, &object.path)?.header(IF_NONE_MATCH,"*").header("Content-Type","application/octet-stream").body(object.bytes.clone()))?;
            if response.status().as_u16() == 412 { super::validate_object(&object.path, &self.read_object(&object.path)?, &object.hash)?; }
            else if !response.status().is_success() { return Err(format!("SYNC_WEBDAV_PUT: HTTP {}", response.status().as_u16())); }
        }
        self.refresh_lock()?;
        let request = self.request(Method::PUT, INDEX_NAME)?.header("Content-Type","application/json").body(manifest.to_vec());
        let request = match expected { Some(tag) => request.header(IF_MATCH,tag), None => request.header(IF_NONE_MATCH,"*") };
        let response = Self::send(request)?;
        if matches!(response.status().as_u16(),409 | 412) { return Ok(PublishResult { conflict: true }); }
        if !response.status().is_success() { return Err(format!("SYNC_WEBDAV_PUT: HTTP {}", response.status().as_u16())); }
        for path in deletes {
            // Unique log/snapshot paths are never reintroduced after their
            // frontier is acknowledged. Shared SHA paths CAN be restored, so
            // physical photo cleanup needs a server-enforced collection lock.
            // Class-1 servers retain those immutable blobs as recovery history.
            if super::image_hash(path).is_some() && !locked { continue; }
            self.refresh_lock()?;
            let response = Self::send(self.request(Method::DELETE, path)?)?;
            if !response.status().is_success() && response.status().as_u16() != 404 { return Err(format!("SYNC_WEBDAV_GC: HTTP {}", response.status().as_u16())); }
        }
        Ok(PublishResult { conflict: false })
    }
    fn send(request: RequestBuilder) -> Result<Response, String> { request.send().map_err(|error| format!("SYNC_NETWORK: {}", error.without_url())) }
    fn read(response: Response) -> Result<Vec<u8>, String> {
        if response.content_length().is_some_and(|bytes| bytes > MAX_OBJECT_BYTES as u64) { return Err("SYNC_OBJECT_TOO_LARGE".into()); }
        let mut bytes = Vec::new(); response.take(MAX_OBJECT_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        if bytes.len() > MAX_OBJECT_BYTES { return Err("SYNC_OBJECT_TOO_LARGE".into()); } Ok(bytes)
    }
    fn collection(&mut self, relative: &str) -> Result<(), String> {
        if self.collections.contains(relative) { return Ok(()); }
        let method = Method::from_bytes(b"MKCOL").map_err(|error| error.to_string())?;
        let response = Self::send(self.request(method, relative)?)?;
        match response.status().as_u16() {
            201 | 204 | 405 => { self.collections.insert(relative.to_string()); Ok(()) },
            status => Err(format!("SYNC_WEBDAV_MKCOL: HTTP {status}")),
        }
    }
    fn parents(&mut self, path: &str) -> Result<(), String> {
        self.collection("")?;
        let mut parent = String::new();
        let parts: Vec<_> = path.split('/').collect();
        for part in &parts[..parts.len()-1] {
            parent.push_str(part); parent.push('/'); self.collection(&parent)?;
        } Ok(())
    }
    fn strong_etag(response: &Response) -> Result<String, String> {
        let tag = response.headers().get(ETAG).and_then(|value| value.to_str().ok()).ok_or("SYNC_WEBDAV_CAS_REQUIRED")?;
        if tag.starts_with("W/") || !tag.starts_with('"') || !tag.ends_with('"') { return Err("SYNC_WEBDAV_CAS_REQUIRED".into()); }
        Ok(tag.into())
    }
    /// Fail closed on servers that merely advertise ETags but ignore conditional
    /// writes. The probe is unique, empty of user data, and immediately removed.
    fn verify_cas(&mut self) -> Result<(), String> {
        static VERIFIED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
        let verified = VERIFIED.get_or_init(|| Mutex::new(HashSet::new()));
        if verified.lock().map_err(|_| "SYNC_LOCK")?.contains(self.base.as_str()) { return Ok(()); }
        self.collection("")?;
        let path = format!(".chronoeon-cas-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos());
        let response = Self::send(self.request(Method::PUT, &path)?.header(IF_NONE_MATCH, "*").body("probe"))?;
        if !response.status().is_success() { return Err(format!("SYNC_WEBDAV_PROBE: HTTP {}", response.status().as_u16())); }
        let check: Result<(), String> = (|| {
            let read = Self::send(self.request(Method::GET, &path)?)?; Self::strong_etag(&read)?;
            let duplicate = Self::send(self.request(Method::PUT, &path)?.header(IF_NONE_MATCH,"*").body("probe"))?;
            let stale = Self::send(self.request(Method::PUT, &path)?.header(IF_MATCH,"\"chronoeon-never-matches\"").body("probe"))?;
            if duplicate.status().as_u16() != 412 || stale.status().as_u16() != 412 { return Err("SYNC_WEBDAV_CAS_REQUIRED".into()); }
            Ok(())
        })();
        let cleanup = Self::send(self.request(Method::DELETE, &path)?)?;
        if !cleanup.status().is_success() && cleanup.status().as_u16() != 404 { return Err("SYNC_WEBDAV_PROBE_CLEANUP".into()); }
        check?;
        verified.lock().map_err(|_| "SYNC_LOCK")?.insert(self.base.to_string()); Ok(())
    }
}
impl SyncBackend for WebDAVBackend {
    fn fetch_index(&mut self) -> Result<BackendHead, String> {
        let response = Self::send(self.request(Method::GET, INDEX_NAME)?)?;
        if response.status().as_u16() == 404 { return Ok(BackendHead { head: None, bytes: None }); }
        if !response.status().is_success() { return Err(format!("SYNC_WEBDAV_GET: HTTP {}", response.status().as_u16())); }
        let etag = Self::strong_etag(&response)?;
        self.collections.insert(String::new());
        Ok(BackendHead { head: Some(etag), bytes: Some(Self::read(response)?) })
    }
    fn read_object(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let response = Self::send(self.request(Method::GET, path)?)?;
        if !response.status().is_success() { return Err(format!("SYNC_WEBDAV_GET: HTTP {}", response.status().as_u16())); }
        Self::read(response)
    }
    fn publish(&mut self, expected: Option<&str>, manifest: &[u8], objects: &[EncodedObject], deletes: &[String]) -> Result<PublishResult, String> {
        self.verify_cas()?;
        let locked = self.acquire_lock()?;
        let result = self.publish_objects(expected,manifest,objects,deletes,locked);
        let unlock = self.release_lock();
        match result { Err(error) => Err(error), Ok(value) => { unlock?; Ok(value) } }
    }
}

impl Drop for WebDAVBackend {
    fn drop(&mut self) { let _ = self.release_lock(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, io::{BufRead,BufReader,Write}, net::TcpListener, sync::{Arc,atomic::{AtomicBool,Ordering}}, thread};
    struct Server { url: String, stop: Arc<AtomicBool>, thread: Option<thread::JoinHandle<()>> }
    impl Server {
        fn new(ignore_conditions: bool) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap(); let address = listener.local_addr().unwrap(); listener.set_nonblocking(true).unwrap();
            let stop = Arc::new(AtomicBool::new(false)); let shutdown = stop.clone();
            let thread = thread::spawn(move || {
                let mut objects: BTreeMap<String,Vec<u8>> = BTreeMap::new();
                while !shutdown.load(Ordering::Relaxed) {
                    let Ok((mut stream,_)) = listener.accept() else { thread::sleep(Duration::from_millis(2)); continue; };
                    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                    let mut reader = BufReader::new(stream.try_clone().unwrap()); let mut line = String::new(); reader.read_line(&mut line).unwrap();
                    let request: Vec<_> = line.split_whitespace().map(str::to_string).collect(); if request.len()<2 { continue; }
                    let (method,path) = (&request[0],&request[1]); let mut headers = BTreeMap::new();
                    loop { line.clear(); reader.read_line(&mut line).unwrap(); if line == "\r\n" || line.is_empty() { break; }
                        if let Some((key,value))=line.split_once(':') { headers.insert(key.to_lowercase(),value.trim().to_string()); }
                    }
                    let length=headers.get("content-length").and_then(|value|value.parse::<usize>().ok()).unwrap_or(0);
                    let mut body=vec![0;length]; reader.read_exact(&mut body).unwrap();
                    let current=objects.get(path); let etag=current.map(|bytes|format!("\"{}\"",crate::attachments::hash(bytes)));
                    let stale=!ignore_conditions && ((headers.get("if-none-match").is_some() && current.is_some())
                        || headers.get("if-match").is_some_and(|value|Some(value)!=etag.as_ref()));
                    let (status,body)=match method.as_str() {
                        "MKCOL" => (201,vec![]),
                        "GET" => current.map(|bytes|(200,bytes.clone())).unwrap_or((404,vec![])),
                        "PUT" if stale => (412,vec![]),
                        "PUT" => { objects.insert(path.clone(),body); (201,vec![]) },
                        "DELETE" => { objects.remove(path); (204,vec![]) },
                        _ => (405,vec![]),
                    };
                    let etag=objects.get(path).map(|bytes|format!("ETag: \"{}\"\r\n",crate::attachments::hash(bytes))).unwrap_or_default();
                    let response=format!("HTTP/1.1 {status} Status\r\n{etag}Content-Length: {}\r\nConnection: close\r\n\r\n",body.len());
                    stream.write_all(response.as_bytes()).unwrap(); stream.write_all(&body).unwrap();
                }
            });
            Self { url: format!("http://{address}/sync/"), stop, thread: Some(thread) }
        }
    }
    impl Drop for Server { fn drop(&mut self) { self.stop.store(true,Ordering::Relaxed); self.thread.take().unwrap().join().unwrap(); } }
    #[test]
    fn webdav_uses_etag_cas_and_refuses_stale_publications() {
        let server=Server::new(false); let config=TransportConfig { mode:"webdav".into(),webdav_url:Some(server.url.clone()),..Default::default() };
        let mut a=WebDAVBackend::new(&config).unwrap(); let mut b=WebDAVBackend::new(&config).unwrap();
        assert!(!a.publish(None,b"one",&[],&[]).unwrap().conflict);
        let old=b.fetch_index().unwrap().head;
        assert!(!a.publish(old.as_deref(),b"two",&[],&[]).unwrap().conflict);
        assert!(b.publish(old.as_deref(),b"stale",&[],&[]).unwrap().conflict);
        assert_eq!(b.fetch_index().unwrap().bytes.unwrap(),b"two");
    }
    #[test]
    fn refuses_servers_that_ignore_conditional_writes() {
        let server=Server::new(true); let config=TransportConfig { mode:"webdav".into(),webdav_url:Some(server.url.clone()),..Default::default() };
        let mut backend=WebDAVBackend::new(&config).unwrap();
        assert_eq!(backend.publish(None,b"user data",&[],&[]).err().unwrap(),"SYNC_WEBDAV_CAS_REQUIRED");
        assert!(backend.fetch_index().unwrap().bytes.is_none());
    }
    #[test]
    fn class_one_servers_keep_shared_photo_bytes_during_cleanup() {
        let server=Server::new(false);
        let config=TransportConfig { mode:"webdav".into(),webdav_url:Some(server.url.clone()),..Default::default() };
        let mut backend=WebDAVBackend::new(&config).unwrap();
        let mut png=std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(12,12).write_to(&mut png,image::ImageFormat::Png).unwrap();
        let photo=crate::attachments::compress(png.get_ref(),Some("screenshot.png")).unwrap();
        let hash=crate::attachments::hash(&photo.bytes);
        let path=format!("attachments/{hash}.webp");
        let object=EncodedObject {path:path.clone(),hash,bytes:photo.bytes.clone()};
        assert!(!backend.publish(None,b"one",&[object],&[]).unwrap().conflict);
        let head=backend.fetch_index().unwrap().head;
        assert!(!backend.publish(head.as_deref(),b"two",&[],&[path.clone()]).unwrap().conflict);
        assert_eq!(backend.read_object(&path).unwrap(),photo.bytes);
    }

}
