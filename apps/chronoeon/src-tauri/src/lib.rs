mod ai_stream;
mod device;
mod ai_credentials;
use ai_credentials::{ai_provider_credentials, save_ai_provider_credentials, delete_ai_provider_credentials};
mod network;
use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sha2::{Digest, Sha256};
use tauri::Manager;

pub mod attachments;
pub mod sync;
pub mod update;
use sync::{sync_backend_fetch, sync_backend_publish, sync_storage_usage};

const MAX_ATTACHMENT_BYTES: u64 = 16 * 1024 * 1024;
/// Single-file text import limit; mirrors the front end's 20 MB guard.
const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileRevision {
    path: String,
    content: String,
    revision: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AtomicWriteOptions {
    expected_revision: Option<String>,
    backup_path: Option<String>,
}

const MAX_AI_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_AI_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
/// Inline photo budget per message; base64 of a compressed webp stays well below.
const MAX_AI_INLINE_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_AI_INLINE_IMAGES: usize = 4;

/// Text stays small; a content-part array may carry inline images, so it is
/// bounded by part count and by the size of every `image_url` payload.
fn ai_content_is_valid(content: &serde_json::Value) -> bool {
    if let Some(text) = content.as_str() {
        return text.len() <= MAX_AI_TEXT_BYTES;
    }
    let Some(parts) = content.as_array() else { return false };
    if parts.is_empty() || parts.len() > MAX_AI_INLINE_IMAGES + 8 {
        return false;
    }
    let mut images = 0usize;
    for part in parts {
        match part.get("type").and_then(serde_json::Value::as_str) {
            Some("text") => match part.get("text").and_then(serde_json::Value::as_str) {
                Some(text) if text.len() <= MAX_AI_TEXT_BYTES => {}
                _ => return false,
            },
            Some("image_url") => {
                let url = part.pointer("/image_url/url").and_then(serde_json::Value::as_str);
                match url {
                    Some(url) if url.starts_with("data:image/") && url.len() <= MAX_AI_INLINE_IMAGE_BYTES => {}
                    _ => return false,
                }
                images += 1;
            }
            _ => return false,
        }
    }
    images <= MAX_AI_INLINE_IMAGES
}

#[derive(Deserialize, Serialize, Clone)]
struct AiChatMessage {
    role: String,
    /// Either plain text or OpenAI-style content parts (text + inline images).
    content: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatRequest {
    base_url: String,
    model: String,
    messages: Vec<AiChatMessage>,
    response_schema: Option<serde_json::Value>,
    tools: Option<serde_json::Value>,
    tool_choice: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    timeout_ms: Option<u64>,
    provider_id: Option<String>,
    credentials: Option<ai_credentials::Credentials>,
    disable_reasoning: Option<bool>,
    stream: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiModelListRequest {
    base_url: String,
    provider_id: Option<String>,
    credentials: Option<ai_credentials::Credentials>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct AiModel {
    id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiChatResponse {
    content: String,
    tool_calls: Option<serde_json::Value>,
    reasoning_content: Option<String>,
    model: Option<String>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    schema_fallback: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AiCustomHeader {
    name: String,
    value: String,
}

fn normalize_ai_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("AI endpoint is empty".into());
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| "AI endpoint is not a valid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("AI endpoint must use HTTP or HTTPS".into());
    }
    if parsed.host_str().is_none() || parsed.username() != "" || parsed.password().is_some() {
        return Err("AI endpoint must have a host and no embedded credentials".into());
    }
    Ok(trimmed.to_string())
}

fn normalize_ai_custom_headers(headers: Vec<AiCustomHeader>) -> Result<Vec<AiCustomHeader>, String> {
    if headers.len() > 10 {
        return Err("AI custom headers exceed the 10-item limit".into());
    }
    let mut seen: Vec<String> = Vec::new();
    let mut normalized = Vec::with_capacity(headers.len());
    for mut header in headers {
        header.name = header.name.trim().to_string();
        header.value = header.value.trim().to_string();
        if header.name.is_empty() || header.value.is_empty() { continue; }
        reqwest::header::HeaderName::from_bytes(header.name.as_bytes())
            .map_err(|_| format!("Invalid AI custom header name: {}", header.name))?;
        reqwest::header::HeaderValue::from_str(&header.value)
            .map_err(|_| format!("Invalid AI custom header value: {}", header.name))?;
        if header.name.len() > 128 || header.value.len() > 2048
            || matches!(header.name.to_ascii_lowercase().as_str(), "host" | "content-length" | "connection") {
            return Err(format!("Invalid AI custom header: {}", header.name));
        }
        let key = header.name.to_ascii_lowercase();
        if seen.contains(&key) {
            return Err(format!("Duplicate AI custom header: {}", header.name));
        }
        seen.push(key);
        normalized.push(header);
    }
    Ok(normalized)
}

fn canonical_directory(path: &str) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Cannot open workspace: {error}"))?;
    if !canonical.is_dir() {
        return Err("The selected workspace is not a directory".into());
    }
    Ok(canonical)
}

fn validate_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if candidate.components().any(|component| matches!(component, std::path::Component::ParentDir)) {
        return Err("Parent-directory path segments are not allowed".into());
    }
    Ok(candidate)
}

fn sha256_revision(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

fn current_file_content(path: &Path) -> Result<(String, bool), String> {
    let safe = validate_path(&path.to_string_lossy())?;
    match fs::read_to_string(&safe) {
        Ok(content) => Ok((content, true)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((String::new(), false)),
        Err(error) => Err(format!("Could not read {}: {error}", safe.display())),
    }
}

fn atomic_temp_path(target: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("chronoeon");
    target.with_file_name(format!(".{name}.chronoeon-{stamp}-{}.tmp", std::process::id()))
}

#[cfg(not(windows))]
fn replace_file_atomic(temporary: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temporary, target).map_err(|error| format!("Could not finish atomic write: {error}"))
}

#[cfg(windows)]
fn replace_file_atomic(temporary: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let destination: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(format!("Could not finish atomic write: {}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn write_text_atomic(
    path: String,
    content: String,
    options: Option<AtomicWriteOptions>,
) -> Result<FileRevision, String> {
    let target = validate_path(&path)?;
    let options = options.unwrap_or_default();
    let (current, exists) = current_file_content(&target)?;
    let actual_revision = sha256_revision(&current);
    if let Some(expected) = options.expected_revision.as_deref() {
        if expected != actual_revision {
            return Err(format!("FILE_REVISION_CONFLICT|{actual_revision}"));
        }
    }
    if let Some(backup) = options.backup_path {
        let backup_path = validate_path(&backup)?;
        if exists {
            if let Some(parent) = backup_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&target, &backup_path).map_err(|error| format!("Could not create backup: {error}"))?;
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    // Keep temporary files beside their destination so they use the same
    // ordinary folder permission. Failed writes are cleaned up internally.
    let temporary = atomic_temp_path(&target);
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Could not create atomic temporary file: {error}"))?;
        file.write_all(content.as_bytes()).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    // Close the read→transform→write race immediately before replacement.
    // The final rename/MoveFileEx is atomic on the host platform.
    let (latest, _) = match current_file_content(&target) {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    let latest_revision = sha256_revision(&latest);
    if latest_revision != actual_revision {
        let _ = fs::remove_file(&temporary);
        return Err(format!("FILE_REVISION_CONFLICT|{latest_revision}"));
    }
    if let Err(error) = replace_file_atomic(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(FileRevision {
        path: target.to_string_lossy().into_owned(),
        revision: sha256_revision(&content),
        content,
    })
}

/// Read one user-picked text file (CSV import). The path comes from the
/// native dialog; parent-directory segments are still rejected.
#[tauri::command]
fn read_text_file(path: String) -> Result<FileRevision, String> {
    let safe = validate_path(&path)?;
    let metadata = fs::metadata(&safe)
        .map_err(|error| format!("Could not read {}: {error}", safe.display()))?;
    if metadata.len() > MAX_TEXT_BYTES {
        return Err("File is larger than the 20 MB limit".into());
    }
    let content = fs::read_to_string(&safe)
        .map_err(|error| format!("Could not read {}: {error}", safe.display()))?;
    let revision = sha256_revision(&content);
    Ok(FileRevision {
        path: safe.to_string_lossy().into_owned(),
        content,
        revision,
    })
}

/// Attachments are addressed by vault-relative paths only. This mirrors the
/// shared TypeScript guard so a compromised or buggy front end still cannot
/// read or write outside the folder the user actually connected.
fn safe_relative_path(relative: &str) -> Result<PathBuf, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() {
        return Err("Attachment path is empty".into());
    }
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err("Attachment paths must be relative to the vault".into());
    }
    let mut chars = trimmed.chars();
    if let (Some(first), Some(second)) = (chars.next(), chars.next()) {
        if first.is_ascii_alphabetic() && second == ':' {
            return Err("Attachment paths must be relative to the vault".into());
        }
    }
    let mut result = PathBuf::new();
    for segment in trimmed.replace('\\', "/").split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err("Attachment paths may not leave the vault".into());
        }
        if segment.chars().any(|character| character.is_control()) {
            return Err("Attachment path contains control characters".into());
        }
        result.push(segment);
    }
    if result.as_os_str().is_empty() {
        return Err("Attachment path is empty".into());
    }
    Ok(result)
}

/// Resolve `root/relative` and prove the result really stays under `root`, so a
/// symlink inside the vault cannot be used to reach the rest of the disk.
fn attachment_target(root: &str, relative: &str) -> Result<(PathBuf, PathBuf), String> {
    let vault = canonical_directory(root)?;
    let target = vault.join(safe_relative_path(relative)?);
    if let Some(parent) = target.parent() {
        if let Ok(existing) = fs::canonicalize(parent) {
            if !existing.starts_with(&vault) {
                return Err("Attachment paths may not leave the vault".into());
            }
        }
    }
    Ok((vault, target))
}



/// Generic binary export writer (xlsx and other file formats). The path is
/// user-chosen via a save dialog; it is validated against parent-directory
/// segments and written atomically.
#[tauri::command]
fn write_file_bytes(path: String, data_base64: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let target = validate_path(&path)?;
    let bytes = STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|error| format!("Could not decode file data: {error}"))?;
    write_bytes_atomic(&target, &bytes)
}

/// Seed-time attachment copier: reads a vault-relative attachment and writes
/// it atomically into the app-owned local attachments folder. The destination
/// must stay under `<appLocalDataDir>/attachments` (least privilege), the
/// source must stay inside the vault. Returns the byte count, or `None` when
/// the source does not exist.
#[tauri::command]
fn copy_attachment_source(
    app: tauri::AppHandle,
    root: String,
    relative_path: String,
    destination: String,
) -> Result<Option<u64>, String> {
    let (_, source) = attachment_target(&root, &relative_path)?;
    if !source.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(&source).map_err(|error| format!("Could not read attachment: {error}"))?;
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err("Attachment is larger than the 16 MB limit".into());
    }
    let attachments_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("attachments");
    fs::create_dir_all(&attachments_root)
        .map_err(|error| format!("Could not prepare the attachments folder: {error}"))?;
    let allowed = fs::canonicalize(&attachments_root)
        .map_err(|error| format!("Could not prepare the attachments folder: {error}"))?;
    let target = PathBuf::from(&destination);
    let target_parent = target
        .parent()
        .ok_or_else(|| "Attachment destination has no parent folder".to_string())?;
    let canonical_parent = fs::canonicalize(target_parent).unwrap_or_else(|_| target_parent.to_path_buf());
    if !canonical_parent.starts_with(&allowed) {
        return Err("Attachment destination must stay inside the local attachments folder".into());
    }

    let bytes = fs::read(&source).map_err(|error| format!("Could not read attachment: {error}"))?;
    let temporary = atomic_temp_path(&target);
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Could not create attachment temporary file: {error}"))?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = replace_file_atomic(&temporary, &target) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(Some(bytes.len() as u64))
}

/// The app-owned local attachments root: `<appLocalDataDir>/attachments`.
fn local_attachments_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("attachments");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not prepare the attachments folder: {error}"))?;
    fs::canonicalize(&root)
        .map_err(|error| format!("Could not prepare the attachments folder: {error}"))
}

/// Atomic byte write beside the destination, mirroring the text path.
fn write_bytes_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create folder for {}: {error}", target.display()))?;
    }
    let temporary = atomic_temp_path(target);
    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Could not create temporary file: {error}"))?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = replace_file_atomic(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

/// Read only the immutable, validated WebP named by its content hash.
#[tauri::command]
fn read_attachment_local(app: tauri::AppHandle, sha256: String) -> Result<String, String> {
    let bytes = attachments::read(&local_attachments_root(&app)?, &sha256)?;
    Ok(format!("data:image/webp;base64,{}", BASE64.encode(bytes)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentPrune {
    files: usize,
    bytes: u64,
}

/// Delete content-addressed photos that no live or seven-day-history state
/// references. Only canonical 64-hex `.webp` names are considered, symlinks and
/// young files are skipped, and the caller can first run with `delete = false`
/// to get a count for confirmation.
fn prune_unreferenced_attachments_at(
    root: &Path,
    referenced: &HashSet<String>,
    minimum_age_ms: u64,
    delete: bool,
) -> Result<AttachmentPrune, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock is before the Unix epoch: {error}"))?
        .as_millis() as u64;
    let mut result = AttachmentPrune { files: 0, bytes: 0 };
    let entries = fs::read_dir(root)
        .map_err(|error| format!("Could not read the attachments folder: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read an attachment: {error}"))?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(hash) = name.strip_suffix(".webp") else { continue };
        if !attachments::valid_hash(hash) || referenced.contains(hash) {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let modified = metadata
            .modified()
            .map_err(|error| error.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Attachment timestamp is before the Unix epoch: {error}"))?
            .as_millis() as u64;
        if now.saturating_sub(modified) < minimum_age_ms {
            continue;
        }
        result.files += 1;
        result.bytes += metadata.len();
        if delete {
            fs::remove_file(entry.path())
                .map_err(|error| format!("Could not delete an unused photo: {error}"))?;
        }
    }
    Ok(result)
}

#[tauri::command]
fn prune_unreferenced_attachments(
    app: tauri::AppHandle,
    referenced: Vec<String>,
    older_than_ms: u64,
    delete: bool,
) -> Result<AttachmentPrune, String> {
    let hashes: HashSet<String> = referenced.into_iter().collect();
    prune_unreferenced_attachments_at(
        &local_attachments_root(&app)?,
        &hashes,
        older_than_ms,
        delete,
    )
}

/// Export one local attachment into the chosen export folder at a validated
/// relative path. Both ends are contained: the source must stay inside the
/// local attachments folder and the destination inside the export root.
#[tauri::command]
fn copy_attachment_export(
    app: tauri::AppHandle,
    source_local_path: String,
    export_root: String,
    relative_path: String,
) -> Result<u64, String> {
    let allowed = local_attachments_root(&app)?;
    let source = PathBuf::from(&source_local_path);
    let canonical_source = fs::canonicalize(&source)
        .map_err(|error| format!("Could not read local attachment: {error}"))?;
    if !canonical_source.starts_with(&allowed) {
        return Err("Source must stay inside the local attachments folder".into());
    }
    let bytes = fs::read(&canonical_source)
        .map_err(|error| format!("Could not read local attachment: {error}"))?;
    let export = canonical_directory(&export_root)?;
    let target = export.join(safe_relative_path(&relative_path)?);
    if let Some(parent) = target.parent() {
        if let Ok(existing) = fs::canonicalize(parent) {
            if !existing.starts_with(&export) {
                return Err("Export paths may not leave the export folder".into());
            }
        }
    }
    write_bytes_atomic(&target, &bytes)?;
    Ok(bytes.len() as u64)
}

use attachments::CompressedAttachment;

/// CPU-heavy decoding/compression must not block Tauri's UI thread.
#[tauri::command]
async fn compress_photo(
    app: tauri::AppHandle,
    source_local_path: String,
    file_name_hint: Option<String>,
) -> Result<CompressedAttachment, String> {
    let root = local_attachments_root(&app)?;
    let mut source = PathBuf::from(&source_local_path);
    if source.is_relative() {
        let reference = source_local_path.replace('\\', "/");
        let relative = reference.strip_prefix("attachments/").ok_or("Invalid photo import source")?;
        source = root.join(safe_relative_path(relative)?);
    }
    tauri::async_runtime::spawn_blocking(move || {
        if fs::metadata(&source).map_err(|_| "PHOTO_SOURCE_MISSING")?.len() > 32 * 1024 * 1024 { return Err("PHOTO_INPUT_TOO_LARGE".into()); }
        let bytes = fs::read(&source).map_err(|_| "PHOTO_SOURCE_MISSING")?;
        attachments::store(&root, attachments::compress(&bytes, file_name_hint.as_deref())?)
    }).await.map_err(|error| error.to_string())?
}

fn decode_photo_data(data_base64: &str) -> Result<Vec<u8>, String> {
    if data_base64.len() > 44 * 1024 * 1024 { return Err("PHOTO_INPUT_TOO_LARGE".into()); }
    BASE64.decode(data_base64.as_bytes()).map_err(|_| "PHOTO_INVALID_DATA".into())
}

#[tauri::command]
async fn compress_photo_data(
    app: tauri::AppHandle,
    data_base64: String,
    file_name_hint: Option<String>,
) -> Result<CompressedAttachment, String> {
    let root = local_attachments_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode_photo_data(&data_base64)?;
        attachments::store(&root, attachments::compress(&bytes, file_name_hint.as_deref())?)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn inspect_attachments(app: tauri::AppHandle, hashes: Vec<String>) -> Result<Vec<CompressedAttachment>, String> {
    let root = local_attachments_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = Vec::new();
        for sha256 in hashes {
            if !attachments::valid_hash(&sha256) { return Err("SYNC_INVALID_ATTACHMENT".into()); }
            // Missing files retain their metadata/reference. The sync panel can
            // report them and transport will refuse to publish missing bytes.
            if let Ok(bytes) = attachments::read(&root, &sha256) {
                let (width,height) = attachments::validate(&bytes, &sha256)?;
                result.push(CompressedAttachment { sha256, width,height,bytes:bytes.len(),mime:"image/webp" });
            }
        }
        Ok(result)
    }).await.map_err(|error| error.to_string())?
}

async fn send_ai_request(
    client: &reqwest::Client,
    endpoint: &str,
    request: &AiChatRequest,
    headers: &reqwest::header::HeaderMap,
    include_schema: bool,
) -> Result<reqwest::Response, String> {
    let mut body = serde_json::json!({
        "model": request.model.trim(),
        "messages": request.messages,
        "stream": request.stream.unwrap_or(false),
        "temperature": request.temperature.unwrap_or(0.1).clamp(0.0, 2.0),
        "max_tokens": request.max_tokens.unwrap_or(1600).clamp(128, 8192),
    });
    if request.stream.unwrap_or(false) { body["stream_options"] = serde_json::json!({"include_usage": true}); }
    if include_schema {
        if let Some(schema) = request.response_schema.clone() {
            body["response_format"] = serde_json::json!({
                "type": "json_schema",
                "json_schema": { "name": "chronoeon_entries", "strict": true, "schema": schema }
            });
        }
    }
    if let Some(tools) = request.tools.clone() {
        body["tools"] = tools;
        body["tool_choice"] = serde_json::json!(request.tool_choice.clone().unwrap_or_else(|| "auto".into()));
    }
    if request.disable_reasoning.unwrap_or(false) {
        body["chat_template_kwargs"] = serde_json::json!({ "enable_thinking": false });
    }
    let builder = client
        .post(endpoint)
        .headers(headers.clone())
        .json(&body);
    builder.send().await.map_err(network::ai_request_error)
}

#[tauri::command]
async fn ai_chat_completion(app: tauri::AppHandle, request: AiChatRequest, on_progress: tauri::ipc::Channel<serde_json::Value>) -> Result<AiChatResponse, String> {
    let base = normalize_ai_base_url(&request.base_url)?;
    if request.model.trim().is_empty() {
        return Err("AI model is empty".into());
    }
    if request.messages.is_empty()
        || request.messages.len() > 32
        || request.messages.iter().any(|message| {
            !matches!(message.role.as_str(), "system" | "user" | "assistant" | "tool")
                || !ai_content_is_valid(&message.content)
                || (message.role == "tool" && message.tool_call_id.as_deref().unwrap_or_default().is_empty())
        })
    {
        return Err("AI messages are invalid or too large".into());
    }
    let endpoint = format!("{base}/chat/completions");
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(45_000).clamp(2_000, 180_000));
    network::ensure_tls_ready()?;
    let builder = reqwest::Client::builder().connect_timeout(timeout.min(Duration::from_secs(15)));
    let builder = if request.stream.unwrap_or(false) { builder.read_timeout(timeout) } else { builder.timeout(timeout) };
    let client = builder.build()
        .map_err(|error| format!("Could not create AI client: {error}"))?;
    let headers = ai_credentials::resolve(app, request.provider_id.as_deref(), request.credentials.clone()).await?;
    let wants_schema = request.response_schema.is_some();
    let mut schema_fallback = false;
    let mut response = send_ai_request(&client, &endpoint, &request, &headers, wants_schema).await?;
    if wants_schema && matches!(response.status().as_u16(), 400 | 404 | 415 | 422) {
        schema_fallback = true;
        response = send_ai_request(&client, &endpoint, &request, &headers, false).await?;
    }
    let status = response.status();
    let streaming = status.is_success() && response.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok()).is_some_and(|value| value.contains("text/event-stream"));
    let payload: serde_json::Value = if streaming {
        ai_stream::read_with_progress(response, Some(on_progress)).await?
    } else {
        let bytes = response.bytes().await.map_err(|error| format!("Could not read AI response: {error}"))?;
        if bytes.len() > MAX_AI_RESPONSE_BYTES { return Err("AI response exceeded the 2 MB safety limit".into()); }
        if !status.is_success() {
            let safe: String = String::from_utf8_lossy(&bytes).chars().take(600).collect();
            return Err(format!("AI endpoint returned {status}: {safe}"));
        }
        serde_json::from_slice(&bytes).map_err(|error| format!("AI endpoint returned invalid JSON: {error}"))?
    };
    let message = payload.pointer("/choices/0/message").cloned().unwrap_or_default();
    let tool_calls = message.get("tool_calls").filter(|value| value.as_array().is_some_and(|items| !items.is_empty())).cloned();
    let direct_content = message.get("content")
        .and_then(serde_json::Value::as_str)
        .or_else(|| payload.pointer("/choices/0/text").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let reasoning = message.get("reasoning_content")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // Hidden reasoning is never a final answer.
    let content = direct_content.unwrap_or("").to_string();
    if content.is_empty() && tool_calls.is_none() {
        return Err(if reasoning.is_some() { "AI endpoint returned an empty message (reasoning only)" } else { "AI endpoint returned an empty message" }.into());
    }
    Ok(AiChatResponse {
        content,
        tool_calls,
        reasoning_content: reasoning.map(str::to_string),
        model: payload.get("model").and_then(serde_json::Value::as_str).map(str::to_string),
        prompt_tokens: payload.pointer("/usage/prompt_tokens").and_then(serde_json::Value::as_u64),
        completion_tokens: payload.pointer("/usage/completion_tokens").and_then(serde_json::Value::as_u64),
        schema_fallback,
    })
}

#[tauri::command]
async fn ai_list_models(app: tauri::AppHandle, request: AiModelListRequest) -> Result<Vec<AiModel>, String> {
    let base = normalize_ai_base_url(&request.base_url)?;
    let endpoint = format!("{base}/models");
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(8_000).clamp(2_000, 30_000));
    let headers = ai_credentials::resolve(app.clone(), request.provider_id.as_deref(), request.credentials).await?;
    #[cfg(target_os = "android")]
    {
        let headers = headers.iter().map(|(name, value)| Ok((name.to_string(), value.to_str().map_err(|_| "Invalid AI header")?.to_string())))
            .collect::<Result<std::collections::HashMap<String, String>, String>>()?;
        let payload = device::ai_models(app, endpoint, headers, timeout.as_millis() as u64).await?;
        let items = payload.get("models").and_then(serde_json::Value::as_array).ok_or("AI endpoint returned no model list")?;
        return Ok(items.iter().filter_map(|item| item.get("id").and_then(serde_json::Value::as_str).map(|id| AiModel { id: id.to_string() })).collect());
    }
    #[cfg(not(target_os = "android"))]
    {
    network::ensure_tls_ready()?;
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("Could not create AI client: {error}"))?;
    let builder = client
        .get(endpoint)
        .headers(headers);
    let response = builder.send().await.map_err(network::ai_request_error)?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| format!("Could not read AI response: {error}"))?;
    if bytes.len() > MAX_AI_RESPONSE_BYTES {
        return Err("AI response exceeded the 2 MB safety limit".into());
    }
    if !status.is_success() {
        let detail = String::from_utf8_lossy(&bytes);
        let safe: String = detail.chars().take(600).collect();
        return Err(format!("AI endpoint returned {status}: {safe}"));
    }
    let payload: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("AI endpoint returned invalid JSON: {error}"))?;
    let items = payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .or_else(|| payload.get("models").and_then(serde_json::Value::as_array))
        .ok_or_else(|| "AI endpoint returned no model list".to_string())?;
    let models = items
        .iter()
        .filter_map(|item| {
            item.as_str().map(str::to_string).or_else(|| {
                item.get("id")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| item.get("name").and_then(serde_json::Value::as_str))
                    .map(str::to_string)
            })
        })
        .filter(|id| !id.trim().is_empty())
        .map(|id| AiModel { id })
        .collect();
    Ok(models)
    }
}

/// The administrative names around one coordinate pair.
#[derive(serde::Serialize)]
struct ReverseGeocode {
    province: String,
    city: String,
    locality: String,
    country: String,
}

/// Reverse-geocode a single coordinate pair through a keyless public endpoint.
/// Only the coordinates and the interface language leave the machine; the
/// result is a short place label the entry composer can store. The webview
/// cannot reach the internet itself under the app's CSP, so this rides the
/// same Rust HTTP path as AI and sync.
#[tauri::command]
async fn reverse_geocode(latitude: f64, longitude: f64, language: String) -> Result<ReverseGeocode, String> {
    if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
        return Err("Coordinates are out of range".into());
    }
    // BigDataCloud treats the bare "zh" as Traditional Chinese in some regions.
    let locality_language = if language.starts_with("zh") { "zh-Hans" } else { "en" };
    let endpoint = format!(
        "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={latitude}&longitude={longitude}&localityLanguage={locality_language}"
    );
    network::ensure_tls_ready()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(8_000))
        .build()
        .map_err(|error| format!("Could not create the geocoder client: {error}"))?;
    let response = client
        .get(endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Location lookup failed: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the location response: {error}"))?;
    if bytes.len() > 128 * 1024 {
        return Err("Location response exceeded the safety limit".into());
    }
    if !status.is_success() {
        return Err(format!("Location lookup returned {status}"));
    }
    let payload: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Location lookup returned invalid JSON: {error}"))?;
    let field = |key: &str| {
        payload
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    Ok(ReverseGeocode {
        province: field("principalSubdivision"),
        city: field("city"),
        locality: field("locality"),
        country: field("countryName"),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Real SQLite through the official plugin. Migrations run JS-side
        // (PRAGMA user_version guard) so the DDL stays a single TS-owned file.
        .plugin(tauri_plugin_sql::Builder::default().build());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(device::init());

    #[cfg(desktop)]
    // A second launch simply raises the existing window.
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|app| {
            // The SQL plugin creates the database file, but not its parent
            // directory. On a fresh profile that makes imports appear broken
            // because the SQLite store never boots.
            let local_data = app.path().app_local_data_dir()?;
            fs::create_dir_all(local_data)
                .map_err(|error| format!("Could not prepare the local data folder: {error}"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_atomic,
            write_file_bytes,
            copy_attachment_source,
            read_attachment_local,
            prune_unreferenced_attachments,
            copy_attachment_export,
            compress_photo,
            compress_photo_data,
            inspect_attachments,
            ai_provider_credentials,
            save_ai_provider_credentials,
            delete_ai_provider_credentials,
            ai_chat_completion,
            ai_list_models,
            device::device_location,
            device::device_reverse_geocode,
            device::background_command,
            reverse_geocode,
            sync_backend_fetch,
            sync_backend_publish,
            sync_storage_usage,
            update::app_update_check,
            update::app_update_download,
            update::app_update_install,
            update::app_update_open_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running ChronoEon");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_photo_data_accepts_base64_and_rejects_invalid_or_oversized_input() {
        assert_eq!(decode_photo_data("AA==").unwrap(), vec![0]);
        assert_eq!(decode_photo_data("not base64").unwrap_err(), "PHOTO_INVALID_DATA");
        assert_eq!(decode_photo_data(&"A".repeat(44 * 1024 * 1024 + 1)).unwrap_err(), "PHOTO_INPUT_TOO_LARGE");
    }

    #[test]
    fn accepts_text_and_bounded_inline_images() {
        assert!(ai_content_is_valid(&serde_json::json!("tomorrow 14:00 meeting")));
        assert!(ai_content_is_valid(&serde_json::json!("饮食备注".repeat(10_000))));
        assert!(ai_content_is_valid(&serde_json::json!([
            { "type": "text", "text": "parse this receipt" },
            { "type": "image_url", "image_url": { "url": "data:image/webp;base64,AAAA" } }
        ])));
    }

    #[test]
    fn rejects_unbounded_or_remote_content_parts() {
        // Remote URLs would make the app fetch an unvetted resource.
        assert!(!ai_content_is_valid(&serde_json::json!([
            { "type": "image_url", "image_url": { "url": "https://example.invalid/photo.png" } }
        ])));
        // More inline photos than the composer allows.
        let many: Vec<serde_json::Value> = (0..5)
            .map(|_| serde_json::json!({ "type": "image_url", "image_url": { "url": "data:image/webp;base64,AAAA" } }))
            .collect();
        assert!(!ai_content_is_valid(&serde_json::Value::Array(many)));
        assert!(!ai_content_is_valid(&serde_json::json!([{ "type": "audio", "audio": {} }])));
        assert!(!ai_content_is_valid(&serde_json::json!("x".repeat(super::MAX_AI_TEXT_BYTES + 1))));
    }

    #[test]
    fn calculates_stable_sha256_revisions() {
        assert_eq!(sha256_revision(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_revision("ChronoEon"), "d59fb6571fd29fb3c07c87637c8a80c9574f321f4bb8334afa31f3f341c70a19");
    }

    #[test]
    fn refuses_attachment_paths_that_leave_the_vault() {
        assert!(safe_relative_path("ChronoEon/attachments/a.png").is_ok());
        assert!(safe_relative_path("ChronoEon\\attachments\\.\\a.png").is_ok());
        assert!(safe_relative_path("../secret").is_err());
        assert!(safe_relative_path("/etc/passwd").is_err());
        assert!(safe_relative_path("C:\\Users\\me\\a.png").is_err());
        assert!(safe_relative_path("   ").is_err());
    }


    #[test]
    fn validates_ai_endpoint_without_accepting_embedded_credentials() {
        assert_eq!(normalize_ai_base_url("http://127.0.0.1:8080/v1/").unwrap(), "http://127.0.0.1:8080/v1");
        assert!(normalize_ai_base_url("file:///tmp/model").is_err());
        assert!(normalize_ai_base_url("https://user:secret@example.com/v1").is_err());
    }

    #[test]
    fn normalizes_local_ai_headers() {
        let headers = normalize_ai_custom_headers(vec![
            AiCustomHeader { name: " X-Tenant ".into(), value: " home ".into() },
            AiCustomHeader { name: "".into(), value: "empty".into() },
        ]).unwrap();
        assert_eq!(headers, vec![AiCustomHeader { name: "X-Tenant".into(), value: "home".into() }]);
        assert!(normalize_ai_custom_headers(vec![
            AiCustomHeader { name: "X-Tenant".into(), value: "one".into() },
            AiCustomHeader { name: "x-tenant".into(), value: "two".into() },
        ]).is_err());
        assert!(normalize_ai_custom_headers(vec![AiCustomHeader { name: "Host".into(), value: "example.test".into() }]).is_err());
        assert!(normalize_ai_custom_headers(vec![AiCustomHeader { name: "X-Bad".into(), value: "line\nbreak".into() }]).is_err());
    }

    #[test]
    fn prunes_only_old_unreferenced_canonical_photos() {
        let root = std::env::temp_dir().join(format!(
            "chronoeon-prune-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let referenced = "a".repeat(64);
        let orphan_old = "b".repeat(64);
        let orphan_new = "c".repeat(64);
        for hash in [&referenced, &orphan_old] {
            fs::write(root.join(format!("{hash}.webp")), b"old").unwrap();
        }
        fs::write(root.join(format!("{orphan_new}.webp")), b"new").unwrap();
        fs::write(root.join("not-a-hash.webp"), b"skip").unwrap();
        fs::write(root.join("notes.txt"), b"skip").unwrap();
        let old = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
        for hash in [&referenced, &orphan_old] {
            fs::File::options()
                .write(true)
                .open(root.join(format!("{hash}.webp")))
                .unwrap()
                .set_modified(old)
                .unwrap();
        }
        let hashes = HashSet::from([referenced.clone()]);
        let day = 24 * 60 * 60 * 1000;

        let preview = prune_unreferenced_attachments_at(&root, &hashes, day, false).unwrap();
        assert_eq!(preview.files, 1);
        assert_eq!(preview.bytes, 3);
        assert!(root.join(format!("{orphan_old}.webp")).exists());

        let removed = prune_unreferenced_attachments_at(&root, &hashes, day, true).unwrap();
        assert_eq!(removed.files, 1);
        assert!(!root.join(format!("{orphan_old}.webp")).exists());
        assert!(root.join(format!("{referenced}.webp")).exists());
        assert!(root.join(format!("{orphan_new}.webp")).exists());
        assert!(root.join("not-a-hash.webp").exists());
        assert!(root.join("notes.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

}
