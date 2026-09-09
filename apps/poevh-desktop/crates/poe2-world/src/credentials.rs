//! Application-owned generic Windows credentials. Never enumerate the user's vault.
use anyhow::{bail, ensure, Result};
use zeroize::Zeroizing;

// No Debug/Serialize: secret values must not reach logs or API snapshots.
pub struct Credentials {
    pub email: Zeroizing<String>,
    pub password: Zeroizing<String>,
}

impl Credentials {
    pub fn new(email: String, password: String) -> Result<Self> {
        let result = Self {
            email: Zeroizing::new(email),
            password: Zeroizing::new(password),
        };
        ensure!(
            !result.email.is_empty()
                && result.email.len() <= 254
                && result.email.contains('@')
                && !result.email.chars().any(char::is_whitespace)
                && !result.email.chars().any(char::is_control),
            "Invalid email"
        );
        ensure!(
            !result.password.is_empty()
                && result.password.len() <= 1024
                && !result.password.chars().any(char::is_control),
            "Password must be 1..1024 UTF-8 bytes without control characters"
        );
        Ok(result)
    }

    pub fn masked_email(&self) -> String {
        // Domain also masked; keep only enough information to distinguish accounts.
        format!("{}***@***", self.email.chars().next().unwrap_or('*'))
    }
}

pub fn random_key() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| anyhow::anyhow!("OS random generator unavailable"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn target(key: &str) -> Result<String> {
    ensure!(
        key.len() == 64 && key.bytes().all(|c| c.is_ascii_hexdigit()),
        "Invalid credential reference"
    );
    Ok(format!("POE2MultiPilot/Standalone/v1/{key}"))
}

#[cfg(windows)]
pub fn write(key: &str, credentials: &Credentials) -> Result<()> {
    use windows::{core::PWSTR, Win32::Security::Credentials::*};
    let mut name: Vec<u16> = target(key)?.encode_utf16().chain(Some(0)).collect();
    let mut user = Zeroizing::new(
        credentials
            .email
            .encode_utf16()
            .chain(Some(0))
            .collect::<Vec<_>>(),
    );
    let mut blob = Zeroizing::new(credentials.password.as_bytes().to_vec());
    let value = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(name.as_mut_ptr()),
        UserName: PWSTR(user.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    unsafe { CredWriteW(&value, 0) }.map_err(|_| anyhow::anyhow!("Windows credential write failed"))
}

#[cfg(windows)]
pub fn read(key: &str) -> Result<Option<Credentials>> {
    use windows::{
        core::PCWSTR,
        Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*},
    };
    let name: Vec<u16> = target(key)?.encode_utf16().chain(Some(0)).collect();
    let mut ptr = std::ptr::null_mut();
    if let Err(error) =
        unsafe { CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None, &mut ptr) }
    {
        if error.code() == ERROR_NOT_FOUND.to_hresult() {
            return Ok(None);
        }
        bail!("Windows credential read failed");
    }
    struct Allocation(*mut CREDENTIALW);
    impl Drop for Allocation {
        fn drop(&mut self) {
            unsafe {
                use zeroize::Zeroize;
                let value = &mut *self.0;
                if value.CredentialBlobSize > 0 && !value.CredentialBlob.is_null() {
                    std::slice::from_raw_parts_mut(
                        value.CredentialBlob,
                        value.CredentialBlobSize as usize,
                    )
                    .zeroize();
                }
                CredFree(self.0.cast());
            }
        }
    }
    ensure!(
        !ptr.is_null(),
        "Windows returned an empty credential allocation"
    );
    let allocation = Allocation(ptr);
    let value = unsafe { &*allocation.0 };
    ensure!(
        value.CredentialBlobSize > 0
            && value.CredentialBlobSize <= 1024
            && !value.CredentialBlob.is_null()
            && !value.UserName.is_null(),
        "Invalid stored credential"
    );
    let password = unsafe {
        std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize)
    };
    let password = std::str::from_utf8(password)
        .map_err(|_| anyhow::anyhow!("Invalid stored credential encoding"))?
        .to_owned();
    let email = unsafe { value.UserName.to_string() }
        .map_err(|_| anyhow::anyhow!("Invalid stored username"))?;
    Credentials::new(email, password).map(Some)
}

#[cfg(windows)]
pub fn delete(key: &str) -> Result<()> {
    use windows::{
        core::PCWSTR,
        Win32::{Foundation::ERROR_NOT_FOUND, Security::Credentials::*},
    };
    let name: Vec<u16> = target(key)?.encode_utf16().chain(Some(0)).collect();
    match unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
        Err(_) => {
            bail!("Windows credential deletion failed");
        }
    }
}

#[cfg(not(windows))]
pub fn write(_: &str, _: &Credentials) -> Result<()> {
    bail!("Windows Credential Manager required")
}
#[cfg(not(windows))]
pub fn read(_: &str) -> Result<Option<Credentials>> {
    bail!("Windows Credential Manager required")
}
#[cfg(not(windows))]
pub fn delete(_: &str) -> Result<()> {
    bail!("Windows Credential Manager required")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_and_masks_without_exposing_domain() {
        assert_eq!(
            Credentials::new("test@example.invalid".into(), "secret".into())
                .unwrap()
                .masked_email(),
            "t***@***"
        );
        for (email, password) in [
            ("bad", "ok"),
            ("a@b", ""),
            ("a@b", "bad\n"),
            ("a\0@b", "ok"),
        ] {
            assert!(Credentials::new(email.into(), password.into()).is_err());
        }
        assert!(target("../../another-app").is_err());
    }

    #[test]
    #[cfg(windows)]
    fn isolated_windows_vault_roundtrip() {
        let key = random_key().unwrap();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = delete(&self.0);
            }
        }
        let _cleanup = Cleanup(key.clone());
        assert!(read(&key).unwrap().is_none());
        write(
            &key,
            &Credentials::new(
                "fixture@example.invalid".into(),
                "fixture-only-密碼!".into(),
            )
            .unwrap(),
        )
        .unwrap();
        let saved = read(&key).unwrap().unwrap();
        assert_eq!(saved.password.as_str(), "fixture-only-密碼!");
        delete(&key).unwrap();
        assert!(read(&key).unwrap().is_none());
        delete(&key).unwrap();
    }
}
