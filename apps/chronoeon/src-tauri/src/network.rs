//! Android's platform TLS verifier must be hosted by the JVM before HTTPS.
//! Missing initialization is a process-aborting panic in a release build, not
//! a reqwest error. Keep system certificate verification and fail closed.
#[cfg(target_os = "android")]
static TLS_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(any(target_os = "android", test))]
fn require_ready(ready: bool) -> Result<(), String> {
    if ready { Ok(()) } else { Err("Android system TLS verifier is not initialized".into()) }
}

pub fn ensure_tls_ready() -> Result<(), String> {
    #[cfg(target_os = "android")]
    return require_ready(TLS_READY.load(std::sync::atomic::Ordering::Acquire));
    #[cfg(not(target_os = "android"))]
    Ok(())
}

/// Preserve connection/TLS causes without attaching URL queries or request headers.
pub fn ai_request_error(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut message = format!("AI request failed: {error}");
    let mut source = std::error::Error::source(&error);
    for _ in 0..8 {
        let Some(cause) = source else { break };
        message.push_str(&format!(": {cause}"));
        source = cause.source();
    }
    message
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_app_chronoeon_desktop_DevicePlugin_initializeTls<'local>(
    mut unowned: jni::EnvUnowned<'local>,
    _this: jni::objects::JObject<'local>,
    context: jni::objects::JObject<'local>,
) -> jni::sys::jboolean {
    unowned.with_env(|env| -> Result<jni::sys::jboolean, jni::errors::Error> {
        if rustls_platform_verifier::android::init_with_env(env, context).is_err() {
            let _ = env.exception_clear();
            return Ok(jni::sys::JNI_FALSE);
        }
        TLS_READY.store(true, std::sync::atomic::Ordering::Release);
        Ok(jni::sys::JNI_TRUE)
    }).resolve::<jni::errors::LogErrorAndDefault>()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_android_tls_is_an_error_not_a_panic_or_insecure_client() {
        assert!(require_ready(false).is_err());
        assert!(require_ready(true).is_ok());
    }

    #[test]
    fn request_failure_keeps_connection_cause_and_removes_url_queries() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let error = tauri::async_runtime::block_on(async {
            reqwest::Client::builder().no_proxy().build().unwrap()
                .get(format!("http://{address}/?key=private-test-value"))
                .send().await.unwrap_err()
        });
        let cause = std::error::Error::source(&error).unwrap().to_string();
        let message = ai_request_error(error);
        assert!(message.contains(&cause));
        assert!(!message.contains("private-test-value"));
        assert!(!message.contains("http://"));
    }
}
