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
}
