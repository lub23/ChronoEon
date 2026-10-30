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

#[cfg(target_os = "android")]
pub async fn ai_models(app: AppHandle, endpoint: String, headers: std::collections::HashMap<String, String>, timeout_ms: u64) -> Result<Value, String> {
    call(app, "aiModels", serde_json::json!({ "endpoint": endpoint, "headers": headers, "timeoutMs": timeout_ms })).await
}

#[cfg(target_os = "android")]
pub async fn ai_completion(app: AppHandle, endpoint: &str, headers: &std::collections::HashMap<String, String>, timeout_ms: u64,
    body: Value, progress: tauri::ipc::Channel<Value>) -> Result<Value, String> {
    let completion = std::sync::Arc::new(std::sync::Mutex::new(Ok(crate::ai_stream::Completion::default())));
    let state = completion.clone();
    let events = tauri::ipc::Channel::<Value>::new(move |event| {
        let event: Value = match event {
            tauri::ipc::InvokeResponseBody::Json(text) => serde_json::from_str(&text)?,
            _ => return Ok(()),
        };
        let mut state = state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Ok(value) = state.as_mut() {
            let result = event["data"].as_str().ok_or("Invalid AI stream event".to_string())
                .and_then(|data| value.push(data)).and_then(|_| progress.send(value.progress()).map_err(|_| "AI stream consumer disconnected".to_string()));
            if let Err(error) = result { *state = Err(error); }
        }
        Ok(())
    });
    let mut result = call(app, "aiCompletion", serde_json::json!({"endpoint":endpoint,"headers":headers,"timeoutMs":timeout_ms,"body":body.to_string(),"onEvent":events})).await?;
    if result["streaming"].as_bool() == Some(true) {
        let state = std::mem::replace(&mut *completion.lock().map_err(|_| "AI stream state poisoned")?, Ok(crate::ai_stream::Completion::default()));
        result["payload"] = state?.finish()?;
    }
    Ok(result)
}

#[cfg(target_os = "android")]
pub async fn credentials(app: AppHandle, action: &str, id: &str, value: Option<String>) -> Result<Value, String> {
    call(app, "credentials", serde_json::json!({ "action": action, "id": id, "value": value })).await
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
