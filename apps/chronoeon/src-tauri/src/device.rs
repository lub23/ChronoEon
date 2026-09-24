//! Android-only device services. The JNI plugin uses AndroidX location;
//! geocoding and timing stay off the UI thread.
use serde_json::Value;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "android")]
use tauri::plugin::{PluginHandle, TauriPlugin};

#[cfg(target_os = "android")]
struct Device(PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("device")
        .setup(|app, api| {
            app.manage(Device(api.register_android_plugin("app.chronoeon.desktop", "DevicePlugin")?));
            Ok(())
        })
        .build()
}

async fn call(app: AppHandle, command: &'static str, payload: Value) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            app.state::<Device>().0.run_mobile_plugin(command, payload).map_err(|error| error.to_string())
        }).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, command, payload);
        Err("Native device service requires Android".into())
    }
}

#[tauri::command]
pub async fn device_location(app: AppHandle, timeout_ms: u64) -> Result<Value, String> {
    call(app, "locate", serde_json::json!({ "timeoutMs": timeout_ms.clamp(1000, 30000) })).await
}

#[tauri::command]
pub async fn device_reverse_geocode(app: AppHandle, latitude: f64, longitude: f64, language: String) -> Result<Value, String> {
    if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
        return Err("Coordinates are out of range".into());
    }
    call(app, "reverseGeocode", serde_json::json!({ "latitude": latitude, "longitude": longitude, "language": language })).await
}

/** Hand a downloaded APK to the system package installer for this app. */
#[cfg(target_os = "android")]
pub async fn install_update(app: AppHandle, path: String) -> Result<(), String> {
    call(app, "installApk", serde_json::json!({ "path": path })).await.map(|_| ())
}

#[cfg(not(target_os = "android"))]
#[allow(dead_code)] // Desktop installs go through the OS handler in `update`.
pub async fn install_update(_app: AppHandle, _path: String) -> Result<(), String> {
    Err("Native update install requires Android".into())
}

#[tauri::command]
pub async fn background_command(app: AppHandle, action: String, language: Option<String>, reminders_enabled: Option<bool>, keys: Option<Vec<String>>) -> Result<Value, String> {
    if !["sync", "timerSync", "timerSnapshot", "consumeReminders", "ackReminders", "status", "alarmSettings", "batterySettings"].contains(&action.as_str()) {
        return Err("Unknown background timing command".into());
    }
    let database = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("chronoeon.db");
    call(app, "background", serde_json::json!({ "action": action, "database": database, "language": language.unwrap_or_else(|| "en".into()), "remindersEnabled": reminders_enabled.unwrap_or(false), "keys": keys.unwrap_or_default() })).await
}
