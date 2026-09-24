//! Release lookup, download and hand-off to the system installer.
//!
//! The app never installs anything by itself: it asks GitHub for the newest
//! published release, downloads the asset that matches this platform, and then
//! hands the file to the operating system (Android's package installer, or the
//! desktop's own handler). System certificate verification stays in place.
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const RELEASES_URL: &str = "https://api.github.com/repos/lub23/ChronoEon/releases?per_page=10";
const USER_AGENT: &str = "ChronoEon-Updater";
/** Generous ceiling for one release asset; an APK is around 32 MB. */
const MAX_DOWNLOAD_BYTES: usize = 260 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    pub version: String,
    /** Empty when this platform has no installable asset in the release. */
    pub url: String,
    pub size: u64,
    pub name: String,
    /** The release page, used when there is nothing to install directly. */
    pub page_url: String,
}

/** `v0.1.5` and `0.1.5` are the same version; anything unparsable is ignored. */
fn version_parts(value: &str) -> Option<Vec<u64>> {
    let trimmed = value.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }
    trimmed.split('.').map(|part| part.trim().parse::<u64>().ok()).collect()
}

fn is_newer(candidate: &str, current: &str) -> bool {
    match (version_parts(candidate), version_parts(current)) {
        (Some(left), Some(right)) => {
            for index in 0..left.len().max(right.len()) {
                let a = left.get(index).copied().unwrap_or(0);
                let b = right.get(index).copied().unwrap_or(0);
                if a != b {
                    return a > b;
                }
            }
            false
        }
        _ => false,
    }
}

fn asset_rank(name: &str) -> Option<u8> {
    let lower = name.to_ascii_lowercase();
    // A platform only ever installs its own package type: an APK offered to a
    // desktop build falls back to the release page instead.
    if cfg!(target_os = "android") {
        return if lower.ends_with(".apk") { Some(if lower.contains("arm64") { 0 } else { 1 }) } else { None };
    }
    if cfg!(target_os = "windows") {
        if lower.ends_with(".msi") {
            return Some(0);
        }
        if lower.ends_with(".exe") {
            return Some(1);
        }
    }
    if cfg!(target_os = "macos") && (lower.ends_with(".dmg") || lower.ends_with(".app.tar.gz")) {
        return Some(0);
    }
    if cfg!(all(unix, not(target_os = "macos"))) && (lower.ends_with(".appimage") || lower.ends_with(".deb")) {
        return Some(0);
    }
    None
}

fn pick_asset(release: &serde_json::Value) -> Option<AppUpdate> {
    let version = release.get("tag_name").and_then(serde_json::Value::as_str)?.to_string();
    let page_url = release.get("html_url").and_then(serde_json::Value::as_str).unwrap_or_default().to_string();
    let assets = release.get("assets")?.as_array()?;
    let mut best: Option<(u8, AppUpdate)> = None;
    for asset in assets {
        let name = asset.get("name").and_then(serde_json::Value::as_str).unwrap_or_default();
        let url = asset.get("browser_download_url").and_then(serde_json::Value::as_str).unwrap_or_default();
        if url.is_empty() || !url.starts_with("https://") {
            continue;
        }
        let Some(rank) = asset_rank(name) else { continue };
        let candidate = AppUpdate {
            version: version.clone(),
            url: url.to_string(),
            size: asset.get("size").and_then(serde_json::Value::as_u64).unwrap_or(0),
            name: name.to_string(),
            page_url: page_url.clone(),
        };
        if best.as_ref().map(|(rank_now, _)| rank < *rank_now).unwrap_or(true) {
            best = Some((rank, candidate));
        }
    }
    Some(match best {
        Some((_, update)) => update,
        None if page_url.starts_with("https://github.com/") => AppUpdate {
            version,
            url: String::new(),
            size: 0,
            name: String::new(),
            page_url,
        },
        None => return None,
    })
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    crate::network::ensure_tls_ready()?;
    reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("Could not create the update client: {error}"))
}

/** The newest published release that is actually newer than `current`. */
#[tauri::command]
pub async fn app_update_check(current: String) -> Result<Option<AppUpdate>, String> {
    let response = client(Duration::from_secs(20))?
        .get(RELEASES_URL)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Could not reach the release index: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Release index returned {}", response.status()));
    }
    let releases: serde_json::Value = response.json().await.map_err(|error| format!("Release index is not readable: {error}"))?;
    let Some(items) = releases.as_array() else { return Ok(None) };
    let mut newest: Option<AppUpdate> = None;
    for release in items {
        if release.get("draft").and_then(serde_json::Value::as_bool).unwrap_or(false)
            || release.get("prerelease").and_then(serde_json::Value::as_bool).unwrap_or(false)
        {
            continue;
        }
        let Some(candidate) = pick_asset(release) else { continue };
        if !is_newer(&candidate.version, &current) {
            continue;
        }
        let newer = newest.as_ref().map(|known| is_newer(&candidate.version, &known.version)).unwrap_or(true);
        if newer {
            newest = Some(candidate);
        }
    }
    Ok(newest)
}

fn trusted_host(host: &str) -> bool {
    matches!(host, "github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com" | "api.github.com")
}

/** Download the asset into the app cache and return the absolute path. */
#[tauri::command]
pub async fn app_update_download(app: AppHandle, url: String, name: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Update link is not a valid URL".to_string())?;
    if parsed.scheme() != "https" || !trusted_host(parsed.host_str().unwrap_or_default()) {
        return Err("Update link does not point at the project's releases".into());
    }
    // The file name comes from the release; keep it a single safe component.
    let safe_name: String = name
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
        .collect();
    if safe_name.is_empty() || !safe_name.contains('.') {
        return Err("Update asset has no usable file name".into());
    }
    let directory = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("updates");
    std::fs::create_dir_all(&directory).map_err(|error| format!("Could not prepare the download folder: {error}"))?;
    let target = directory.join(&safe_name);

    let response = client(Duration::from_secs(900))?
        .get(parsed)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|error| format!("Download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Download returned {}", response.status()));
    }
    if !trusted_host(response.url().host_str().unwrap_or_default()) {
        return Err("Download left the project's release hosts".into());
    }
    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD_BYTES as u64 {
            return Err("Update asset is larger than the allowed size".into());
        }
    }
    let bytes = response.bytes().await.map_err(|error| format!("Download failed: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("Downloaded update has an unexpected size".into());
    }
    if safe_name.to_ascii_lowercase().ends_with(".apk") && bytes[..bytes.len().min(4)] != [0x50, 0x4b, 0x03, 0x04] {
        return Err("Downloaded file is not an Android package".into());
    }
    // Write beside the target and swap, so a torn write never leaves a file
    // that the installer could pick up.
    let staging = directory.join(format!("{safe_name}.part"));
    std::fs::write(&staging, &bytes).map_err(|error| format!("Could not store the update: {error}"))?;
    std::fs::rename(&staging, &target).map_err(|error| format!("Could not store the update: {error}"))?;
    Ok(target.to_string_lossy().to_string())
}

/** Hand the downloaded file to the platform's installer for this app. */
#[tauri::command]
pub async fn app_update_install(app: AppHandle, path: String) -> Result<(), String> {
    let file = std::path::PathBuf::from(&path);
    if !file.is_file() {
        return Err("Downloaded update is missing".into());
    }
    #[cfg(target_os = "android")]
    {
        return crate::device::install_update(app, path).await;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let mut command = if cfg!(target_os = "windows") {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "start", ""]).arg(&file);
            command
        } else if cfg!(target_os = "macos") {
            let mut command = std::process::Command::new("open");
            command.arg(&file);
            command
        } else {
            let mut command = std::process::Command::new("xdg-open");
            command.arg(&file);
            command
        };
        command.spawn().map_err(|error| format!("Could not start the installer: {error}"))?;
        Ok(())
    }
}

/** Fall back to the release page when this platform has no installer asset. */
#[tauri::command]
pub async fn app_update_open_page(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Release link is not a valid URL".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("github.com") {
        return Err("Release link does not point at the project's releases".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", ""]).arg(parsed.as_str())
            .spawn().map_err(|error| format!("Could not open the release page: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(parsed.as_str())
            .spawn().map_err(|error| format!("Could not open the release page: {error}"))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(parsed.as_str())
            .spawn().map_err(|error| format!("Could not open the release page: {error}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    Err("Opening the release page is not supported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::{asset_rank, is_newer, version_parts};

    #[test]
    fn compares_release_versions_numerically() {
        assert!(is_newer("v0.1.10", "0.1.9"));
        assert!(is_newer("0.2.0", "v0.1.9"));
        assert!(!is_newer("v0.1.4", "0.1.4"));
        assert!(!is_newer("0.1.3", "0.1.4"));
        assert!(!is_newer("not-a-version", "0.1.4"));
        assert_eq!(version_parts("v1.2.3"), Some(vec![1, 2, 3]));
    }

    #[test]
    fn prefers_an_asset_this_platform_can_install() {
        if cfg!(target_os = "android") {
            assert_eq!(asset_rank("chronoeon-arm64.apk"), Some(0));
            assert_eq!(asset_rank("chronoeon-x86_64.apk"), Some(1));
            assert_eq!(asset_rank("ChronoEon_0.1.5_x64-setup.exe"), None);
        }
        if cfg!(target_os = "windows") {
            assert_eq!(asset_rank("ChronoEon_0.1.5_x64_en-US.msi"), Some(0));
            assert_eq!(asset_rank("ChronoEon_0.1.5_x64-setup.exe"), Some(1));
            // The Android package never becomes a Windows installer.
            assert_eq!(asset_rank("chronoeon-arm64.apk"), None);
        }
        assert_eq!(asset_rank("notes.txt"), None);
    }
}
