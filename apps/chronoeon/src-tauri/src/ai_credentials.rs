use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use super::{AiCustomHeader, normalize_ai_custom_headers};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    api_key: String,
    headers: Vec<AiCustomHeader>,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err("Invalid AI provider ID".into());
    }
    Ok(())
}

#[cfg(desktop)]
fn entry(id: &str) -> Result<keyring::Entry, String> {
    validate_id(id)?;
    keyring::Entry::new("app.chronoeon.desktop", &format!("ai-provider-{id}"))
        .map_err(|error| format!("Could not open credential store: {error}"))
}

#[tauri::command]
pub async fn ai_provider_credentials(app: AppHandle, provider_id: String) -> Result<Credentials, String> {
    validate_id(&provider_id)?;
    #[cfg(desktop)]
    {
        let _ = app;
        match entry(&provider_id)?.get_password() {
            Ok(value) => serde_json::from_str(&value).map_err(|_| "Invalid stored AI credentials".into()),
            Err(keyring::Error::NoEntry) => Ok(Credentials::default()),
            Err(error) => Err(format!("Could not read credential store: {error}")),
        }
    }
    #[cfg(target_os = "android")]
    {
        let result = super::device::credentials(app, "read", &provider_id, None).await?;
        match result.get("value").and_then(serde_json::Value::as_str) {
            Some(value) => serde_json::from_str(value).map_err(|_| "Invalid stored AI credentials".into()),
            None => Ok(Credentials::default()),
        }
    }
    #[cfg(not(any(desktop, target_os = "android")))]
    { let _ = app; Err("Secure credentials are unavailable on this platform".into()) }
}

#[tauri::command]
pub async fn save_ai_provider_credentials(app: AppHandle, provider_id: String, credentials: Credentials) -> Result<(), String> {
    validate_id(&provider_id)?;
    let credentials = credentials.normalize()?;
    let value = serde_json::to_string(&credentials).map_err(|_| "Could not encode credentials")?;
    #[cfg(desktop)]
    { let _ = app; entry(&provider_id)?.set_password(&value).map_err(|error| format!("Could not save credentials: {error}")) }
    #[cfg(target_os = "android")]
    { super::device::credentials(app, "save", &provider_id, Some(value)).await.map(|_| ()) }
    #[cfg(not(any(desktop, target_os = "android")))]
    { let _ = (app, value); Err("Secure credentials are unavailable on this platform".into()) }
}

#[tauri::command]
pub async fn delete_ai_provider_credentials(app: AppHandle, provider_id: String) -> Result<(), String> {
    validate_id(&provider_id)?;
    #[cfg(desktop)]
    {
        let _ = app;
        match entry(&provider_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Could not delete credentials: {error}")),
        }
    }
    #[cfg(target_os = "android")]
    { super::device::credentials(app, "delete", &provider_id, None).await.map(|_| ()) }
    #[cfg(not(any(desktop, target_os = "android")))]
    { let _ = app; Err("Secure credentials are unavailable on this platform".into()) }
}

impl Credentials {
    fn normalize(mut self) -> Result<Self, String> {
        self.api_key = self.api_key.trim().to_string();
        if self.api_key.len() > 8192 || self.api_key.contains(['\r', '\n', '\0']) { return Err("Invalid API key".into()); }
        self.headers = normalize_ai_custom_headers(self.headers)?;
        Ok(self)
    }

    pub fn request_headers(self) -> Result<reqwest::header::HeaderMap, String> {
        let credentials = self.normalize()?;
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::ACCEPT, reqwest::header::HeaderValue::from_static("application/json"));
        if !credentials.api_key.is_empty() {
            headers.insert(reqwest::header::AUTHORIZATION, format!("Bearer {}", credentials.api_key).parse().map_err(|_| "Invalid API key")?);
        }
        for header in credentials.headers {
            headers.insert(reqwest::header::HeaderName::from_bytes(header.name.as_bytes()).map_err(|_| "Invalid header name")?,
                header.value.parse().map_err(|_| "Invalid header value")?);
        }
        Ok(headers)
    }
}

pub async fn resolve(app: AppHandle, id: Option<&str>, credentials: Option<Credentials>) -> Result<reqwest::header::HeaderMap, String> {
    let credentials = if let Some(value) = credentials { value }
        else if let Some(id) = id { ai_provider_credentials(app, id.into()).await? }
        else { Credentials::default() };
    credentials.request_headers()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_identity_and_transport() {
        assert!(validate_id("../other").is_err());
        assert!(validate_id("profile-123").is_ok());
        let headers = Credentials { api_key: "token".into(), headers: vec![AiCustomHeader { name: "x-tenant".into(), value: "home".into() }] }.request_headers().unwrap();
        assert_eq!(headers["authorization"], "Bearer token");
        assert_eq!(headers["x-tenant"], "home");
        assert!(Credentials { api_key: "bad\nkey".into(), headers: vec![] }.request_headers().is_err());
    }
}
