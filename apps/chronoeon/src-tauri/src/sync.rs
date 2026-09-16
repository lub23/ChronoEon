//! Backend-neutral transport for immutable Zstandard JSONL logs and logical
//! snapshots. This module has NO SQLite paths, database copies, or data merges.
mod git;
mod webdav;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::{BTreeMap, BTreeSet}, fs, io::{Cursor, Read}, path::{Path, PathBuf}};
use tauri::Manager;
use crate::attachments;

const INDEX_NAME: &str = "index.json";
const MAX_OBJECT_BYTES: usize = 64 * 1024 * 1024;
const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_INDEX_BYTES: usize = 8 * 1024 * 1024;
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransportConfig {
    mode: String, git_remote: Option<String>, git_token: Option<String>,
    webdav_url: Option<String>, webdav_username: Option<String>, webdav_password: Option<String>,
}
struct BackendHead { head: Option<String>, bytes: Option<Vec<u8>> }
struct EncodedObject { path: String, hash: String, bytes: Vec<u8> }
#[derive(Serialize)]
pub struct PublishResult { conflict: bool }
/// Only transport methods: conflict resolution belongs to the shared SyncEngine.
trait SyncBackend {
    fn fetch_index(&mut self) -> Result<BackendHead, String>;
    fn read_object(&mut self, path: &str) -> Result<Vec<u8>, String>;
    fn publish(&mut self, expected: Option<&str>, manifest: &[u8], objects: &[EncodedObject], deletes: &[String]) -> Result<PublishResult, String>;
}
#[derive(Serialize, Deserialize)]
pub struct Document { path: String, hash: String, content: String }
#[derive(Serialize)]
pub struct FetchResult { head: Option<String>, index: Option<Value>, documents: Vec<Document> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Publication { expected_head: Option<String>, index: Value, documents: Vec<Document>, delete_paths: Vec<String> }
#[derive(Clone)]
struct ObjectRef { path: String, hash: String }
fn valid_hash(hash: &str) -> bool { hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) }
fn valid_document_path(path: &str) -> bool {
    let allowed = path.starts_with("sync/") || path.starts_with("snapshot/snapshot-");
    allowed && path.ends_with(".jsonl.zst") && !path.contains("..") && path.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"/.-".contains(&byte))
        && path.split('/').all(|part| !part.is_empty()) && path.len() < 240
}
fn image_hash(path: &str) -> Option<&str> { path.strip_prefix("attachments/")?.strip_suffix(".webp").filter(|hash| valid_hash(hash)) }
fn refs(index: &Value) -> Result<Vec<ObjectRef>, String> {
    if index.get("version").and_then(Value::as_u64) != Some(1) || index.get("datasetId").and_then(Value::as_str).is_none() { return Err("SYNC_UNSUPPORTED_FORMAT".into()); }
    let mut result = Vec::new(); let mut paths = BTreeSet::new();
    let batches = index.get("batches").and_then(Value::as_array).ok_or("SYNC_INVALID_INDEX")?;
    let snapshot = index.get("snapshot").filter(|value| !value.is_null());
    for value in snapshot.into_iter().chain(batches.iter()) {
        let path = value.get("path").and_then(Value::as_str).ok_or("SYNC_INVALID_INDEX")?;
        let hash = value.get("hash").and_then(Value::as_str).ok_or("SYNC_INVALID_INDEX")?;
        if !valid_document_path(path) || !valid_hash(hash) || !paths.insert(path.to_string()) { return Err("SYNC_INVALID_INDEX".into()); }
        result.push(ObjectRef { path: path.into(), hash: hash.into() });
    }
    Ok(result)
}
fn image_hashes(index: &Value) -> Result<Vec<String>, String> {
    index.get("attachments").and_then(Value::as_array).ok_or("SYNC_INVALID_INDEX")?.iter().map(|value| {
        let hash = value.as_str().ok_or("SYNC_INVALID_INDEX")?;
        if !valid_hash(hash) { return Err("SYNC_INVALID_INDEX".into()); } Ok(hash.to_string())
    }).collect()
}
fn decode_document(bytes: &[u8], expected_hash: &str) -> Result<String, String> {
    if bytes.len() > MAX_OBJECT_BYTES { return Err("SYNC_OBJECT_TOO_LARGE".into()); }
    let mut decoder = zstd::stream::read::Decoder::new(Cursor::new(bytes)).map_err(|error| format!("SYNC_ZSTD: {error}"))?;
    decoder.window_log_max(26).map_err(|error| error.to_string())?;
    let mut data = Vec::new(); decoder.take(MAX_DOCUMENT_BYTES + 1).read_to_end(&mut data).map_err(|error| error.to_string())?;
    if data.len() as u64 > MAX_DOCUMENT_BYTES { return Err("SYNC_OBJECT_TOO_LARGE".into()); }
    if attachments::hash(&data) != expected_hash { return Err("SYNC_CHECKSUM_FAILED".into()); }
    String::from_utf8(data).map_err(|_| "SYNC_INVALID_UTF8".into())
}
fn encode_document(path: &str, content: &str, hash: &str) -> Result<EncodedObject, String> {
    if !valid_document_path(path) || !valid_hash(hash) { return Err("SYNC_INVALID_OBJECT".into()); }
    if content.len() as u64 > MAX_DOCUMENT_BYTES { return Err("SYNC_OBJECT_TOO_LARGE".into()); }
    if attachments::hash(content.as_bytes()) != hash { return Err("SYNC_CHECKSUM_FAILED".into()); }
    let bytes = zstd::stream::encode_all(content.as_bytes(), 3).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_OBJECT_BYTES { return Err("SYNC_OBJECT_TOO_LARGE".into()); }
    Ok(EncodedObject { path: path.into(), hash: hash.into(), bytes })
}
fn validate_object(path: &str, bytes: &[u8], hash: &str) -> Result<(), String> {
    if let Some(image) = image_hash(path) {
        if image != hash { return Err("SYNC_CHECKSUM_FAILED".into()); }
        attachments::validate(bytes, image)?;
    } else if valid_document_path(path) { decode_document(bytes, hash)?; }
    else { return Err("SYNC_INVALID_OBJECT".into()); }
    Ok(())
}
fn backend(config: &TransportConfig, root: &Path) -> Result<Box<dyn SyncBackend>, String> {
    match config.mode.as_str() {
        "git" => Ok(Box::new(git::GitBackend::new(&root.join("git"), config)?)),
        "webdav" => Ok(Box::new(webdav::WebDAVBackend::new(config)?)),
        _ => Err("SYNC_UNSUPPORTED_BACKEND".into()),
    }
}
fn cache_root(app: &tauri::AppHandle, config: &TransportConfig) -> Result<PathBuf, String> {
    let name = format!("{}:{}", config.mode, if config.mode == "git" { config.git_remote.as_deref() } else { config.webdav_url.as_deref() }.unwrap_or(""));
    let root = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("sync-engine").join(attachments::hash(name.as_bytes()));
    fs::create_dir_all(&root).map_err(|error| error.to_string())?; Ok(root)
}
fn redact(mut error: String, config: &TransportConfig) -> String {
    for secret in [&config.git_token, &config.webdav_password].into_iter().flatten() {
        if !secret.is_empty() { error = error.replace(secret, "[redacted]"); }
    }
    error
}
pub fn fetch_files(config: &TransportConfig, root: &Path, images: &Path, known: &BTreeMap<String,String>) -> Result<FetchResult, String> {
    fs::create_dir_all(images).map_err(|error| error.to_string())?;
    let work = || {
    let mut backend = backend(&config, &root)?;
    let remote = backend.fetch_index()?;
    let Some(bytes) = remote.bytes else { return Ok(FetchResult { head: remote.head, index: None, documents: vec![] }); };
    if bytes.len() > MAX_INDEX_BYTES { return Err("SYNC_INDEX_TOO_LARGE".into()); }
    let index: Value = serde_json::from_slice(&bytes).map_err(|_| "SYNC_INVALID_INDEX")?;
    let mut documents = Vec::new();
    for object in refs(&index)? {
        if known.get(&object.path) == Some(&object.hash) { continue; }
        let bytes = backend.read_object(&object.path)?;
        documents.push(Document { content: decode_document(&bytes, &object.hash)?, path: object.path, hash: object.hash });
    }
    for hash in image_hashes(&index)? {
        let path = images.join(format!("{hash}.webp"));
        if attachments::read(images, &hash).is_ok() { continue; }
        let bytes = backend.read_object(&format!("attachments/{hash}.webp"))?;
        attachments::validate(&bytes, &hash)?; super::write_bytes_atomic(&path, &bytes)?;
    }
    Ok(FetchResult { head: remote.head, index: Some(index), documents })
    };
    work().map_err(|error| redact(error, config))
}

pub fn publish_files(config: &TransportConfig, root: &Path, images: &Path, publication: Publication) -> Result<PublishResult, String> {
    let work = || {
    let active = refs(&publication.index)?;
    let hashes = image_hashes(&publication.index)?;
    let manifest = serde_json::to_vec(&publication.index).map_err(|error| error.to_string())?;
    if manifest.len() > MAX_INDEX_BYTES { return Err("SYNC_INDEX_TOO_LARGE".into()); }
    let mut backend = backend(&config, &root)?;
    let current = backend.fetch_index()?;
    if current.head != publication.expected_head { return Ok(PublishResult { conflict: true }); }
    let existing: Option<Value> = current.bytes.as_ref().map(|bytes| serde_json::from_slice(bytes)).transpose().map_err(|_| "SYNC_INVALID_INDEX")?;
    let existing_images: BTreeSet<String> = existing.as_ref().map(image_hashes).transpose()?.unwrap_or_default().into_iter().collect();
    let mut objects = Vec::new();
    for doc in publication.documents {
        if !active.iter().any(|object| object.path == doc.path && object.hash == doc.hash) { return Err("SYNC_INVALID_PUBLICATION".into()); }
        objects.push(encode_document(&doc.path, &doc.content, &doc.hash)?);
    }
    for hash in hashes {
        if existing_images.contains(&hash) { continue; }
        let bytes = match attachments::read(images, &hash) {
            Ok(bytes) => bytes,
            Err(_) => {
                let bytes = backend.read_object(&format!("attachments/{hash}.webp")).map_err(|_| "SYNC_ATTACHMENT_MISSING")?;
                attachments::validate(&bytes, &hash)?;
                super::write_bytes_atomic(&images.join(format!("{hash}.webp")), &bytes)?;
                bytes
            }
        };
        objects.push(EncodedObject { path: format!("attachments/{hash}.webp"), hash, bytes });
    }
    for path in &publication.delete_paths {
        if (!valid_document_path(path) && image_hash(path).is_none()) || active.iter().any(|object| &object.path == path)
            || image_hash(path).is_some_and(|hash| publication.index["attachments"].as_array().is_some_and(|images| images.iter().any(|image| image.as_str()==Some(hash)))) {
            return Err("SYNC_INVALID_COMPACTION".into());
        }
    }
    backend.publish(publication.expected_head.as_deref(), &manifest, &objects, &publication.delete_paths)
    };
    work().map_err(|error| redact(error, config))
}

#[tauri::command]
pub async fn sync_backend_fetch(app: tauri::AppHandle, config: TransportConfig, known: BTreeMap<String,String>) -> Result<FetchResult, String> {
    let root = cache_root(&app, &config)?; let images = super::local_attachments_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || fetch_files(&config, &root, &images, &known)).await.map_err(|error| error.to_string())?
}
#[tauri::command]
pub async fn sync_backend_publish(app: tauri::AppHandle, config: TransportConfig, publication: Publication) -> Result<PublishResult, String> {
    let root = cache_root(&app, &config)?; let images = super::local_attachments_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || publish_files(&config, &root, &images, publication)).await.map_err(|error| error.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_compressed_logs_snapshots_and_bounded_webp_are_transportable() {
        assert!(!valid_document_path("data/chronoeon.db")); assert!(!valid_document_path("sync/../../secret.jsonl.zst"));
        assert!(!valid_document_path("sync/item.json")); assert!(valid_document_path("sync/2026/09/07-001.jsonl.zst"));
        let content = "{\"op\":\"update\",\"data\":{\"note\":\"日记\"}}\n"; let hash = attachments::hash(content.as_bytes());
        let encoded = encode_document("sync/2026/09/07-001.jsonl.zst", content, &hash).unwrap();
        assert_eq!(&encoded.bytes[..4], &[0x28,0xb5,0x2f,0xfd]);
        assert_eq!(decode_document(&encoded.bytes, &hash).unwrap(), content);
        assert!(decode_document(&encoded.bytes, &"0".repeat(64)).is_err());
    }
}
