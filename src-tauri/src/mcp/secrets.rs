//! Secret storage for MCP server credentials.
//!
//! On Windows secrets live in Credential Manager (per-user, encrypted by the
//! OS) under `Vinnie/mcp/<server>/<key>`. They are read only by the backend
//! when it launches a server or sends a request, and are never returned to
//! the frontend or written to logs.

use crate::error::{AppError, AppResult};

/// Credential Manager limits a credential blob to 2,560 bytes.
pub const MAX_SECRET_BYTES: usize = 2_560;

pub trait SecretStore: Send + Sync {
    fn set(&self, target: &str, value: &str) -> AppResult<()>;
    fn get(&self, target: &str) -> AppResult<Option<String>>;
    fn delete(&self, target: &str) -> AppResult<()>;
}

pub fn target(server_id: &str, key: &str) -> String {
    format!("Vinnie/mcp/{server_id}/{key}")
}

pub fn check_value(value: &str) -> AppResult<()> {
    if value.is_empty() {
        return Err(AppError::validation("A secret can't be empty."));
    }
    if value.len() > MAX_SECRET_BYTES {
        return Err(AppError::validation(format!(
            "Secrets are limited to {MAX_SECRET_BYTES} bytes."
        )));
    }
    if value.contains('\0') {
        return Err(AppError::validation(
            "Secrets can't contain NUL characters.",
        ));
    }
    Ok(())
}

/// In-memory store (tests, and non-Windows builds).
#[cfg(any(test, not(windows)))]
#[derive(Default)]
pub struct MemoryStore {
    map: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

#[cfg(any(test, not(windows)))]
impl SecretStore for MemoryStore {
    fn set(&self, target: &str, value: &str) -> AppResult<()> {
        check_value(value)?;
        self.map
            .lock()
            .map_err(|_| AppError::internal("Secret store lock poisoned."))?
            .insert(target.to_owned(), value.to_owned());
        Ok(())
    }
    fn get(&self, target: &str) -> AppResult<Option<String>> {
        Ok(self
            .map
            .lock()
            .map_err(|_| AppError::internal("Secret store lock poisoned."))?
            .get(target)
            .cloned())
    }
    fn delete(&self, target: &str) -> AppResult<()> {
        self.map
            .lock()
            .map_err(|_| AppError::internal("Secret store lock poisoned."))?
            .remove(target);
        Ok(())
    }
}

#[cfg(windows)]
pub use windows_store::CredentialManagerStore;

#[cfg(windows)]
mod windows_store {
    use std::ptr;

    use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    use super::{check_value, SecretStore};
    use crate::error::{AppError, AppResult};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Windows Credential Manager (generic credentials, current user).
    pub struct CredentialManagerStore;

    impl SecretStore for CredentialManagerStore {
        fn set(&self, target: &str, value: &str) -> AppResult<()> {
            check_value(value)?;
            let mut target_w = wide(target);
            let mut user_w = wide("Vinnie");
            let mut blob = value.as_bytes().to_vec();
            // SAFETY: CREDENTIALW is a plain C struct; every pointer we set
            // points into buffers that outlive the CredWriteW call.
            let ok = unsafe {
                let mut cred: CREDENTIALW = std::mem::zeroed();
                cred.Type = CRED_TYPE_GENERIC;
                cred.TargetName = target_w.as_mut_ptr();
                cred.UserName = user_w.as_mut_ptr();
                cred.CredentialBlobSize = blob.len() as u32;
                cred.CredentialBlob = blob.as_mut_ptr();
                cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
                CredWriteW(&cred, 0)
            };
            if ok == 0 {
                let code = unsafe { GetLastError() };
                return Err(AppError::internal(format!(
                    "Could not save the secret in Windows Credential Manager (error {code})."
                )));
            }
            Ok(())
        }

        fn get(&self, target: &str) -> AppResult<Option<String>> {
            let target_w = wide(target);
            let mut cred: *mut CREDENTIALW = ptr::null_mut();
            // SAFETY: CredReadW allocates `cred`; we free it with CredFree.
            let ok = unsafe { CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred) };
            if ok == 0 {
                let code = unsafe { GetLastError() };
                if code == ERROR_NOT_FOUND {
                    return Ok(None);
                }
                return Err(AppError::internal(format!(
                    "Could not read a secret from Windows Credential Manager (error {code})."
                )));
            }
            // SAFETY: on success `cred` points to a valid CREDENTIALW whose
            // blob has CredentialBlobSize bytes.
            let value = unsafe {
                let c = &*cred;
                let bytes = if c.CredentialBlob.is_null() {
                    &[][..]
                } else {
                    std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize)
                };
                let value = String::from_utf8_lossy(bytes).into_owned();
                CredFree(cred as *const _);
                value
            };
            Ok(Some(value))
        }

        fn delete(&self, target: &str) -> AppResult<()> {
            let target_w = wide(target);
            let ok = unsafe { CredDeleteW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0) };
            if ok == 0 {
                let code = unsafe { GetLastError() };
                if code != ERROR_NOT_FOUND {
                    return Err(AppError::internal(format!(
                        "Could not delete a secret from Windows Credential Manager (error {code})."
                    )));
                }
            }
            Ok(())
        }
    }
}

/// The store used by the app.
pub fn default_store() -> Box<dyn SecretStore> {
    #[cfg(windows)]
    return Box::new(CredentialManagerStore);
    #[cfg(not(windows))]
    return Box::new(MemoryStore::default());
}

/// Replace every occurrence of a secret value with `[redacted]`.
pub fn redact(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_owned();
    for s in secrets.iter().filter(|s| s.len() >= 4) {
        if out.contains(s.as_str()) {
            out = out.replace(s.as_str(), "[redacted]");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trip_and_limits() {
        let store = MemoryStore::default();
        store.set(&target("gh", "env:TOKEN"), "ghp_123").unwrap();
        assert_eq!(
            store.get(&target("gh", "env:TOKEN")).unwrap().as_deref(),
            Some("ghp_123")
        );
        store.delete(&target("gh", "env:TOKEN")).unwrap();
        assert_eq!(store.get(&target("gh", "env:TOKEN")).unwrap(), None);
        assert!(store.set("x", "").is_err());
        assert!(store.set("x", &"a".repeat(MAX_SECRET_BYTES + 1)).is_err());
    }

    #[test]
    fn redacts_secret_values() {
        let secrets = vec!["ghp_supersecret".to_string(), "ab".to_string()];
        assert_eq!(
            redact("auth failed for ghp_supersecret (ab)", &secrets),
            "auth failed for [redacted] (ab)",
            "short values are not redacted (too many false positives)"
        );
    }

    /// Writes to the real Credential Manager under a test-only name.
    #[cfg(windows)]
    #[test]
    fn credential_manager_round_trip() {
        let store = CredentialManagerStore;
        let t = format!("Vinnie/test/{}", uuid::Uuid::new_v4());
        assert_eq!(store.get(&t).unwrap(), None);
        store.set(&t, "s3cret-ünïcode").unwrap();
        assert_eq!(store.get(&t).unwrap().as_deref(), Some("s3cret-ünïcode"));
        store.delete(&t).unwrap();
        assert_eq!(store.get(&t).unwrap(), None);
        store.delete(&t).unwrap(); // deleting twice is fine
    }
}
