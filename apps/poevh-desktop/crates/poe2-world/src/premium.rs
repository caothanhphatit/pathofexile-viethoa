//! Premium licence client for the web account's app key.
//!
//! Flow (server contract in the monorepo `README.md`, "Premium"):
//! 1. The user pastes the key from `/premium` on the website.
//! 2. The app sends `key + device_id + device_label` to `POST /api/premium/verify`.
//!    The first device to use a key is bound to it; other devices get
//!    `device_mismatch` until the user (30-day cooldown) or an admin releases it.
//! 3. The answer is a licence token `base64url(JSON).base64url(Ed25519 sig)`.
//!    The app checks the signature with the server's public key, keeps the token
//!    on disk and treats premium as active until the token's `exp`.
//! 4. A background worker calls verify again well before `exp` (tokens last at
//!    most 7 days), so a revoked key or ended plan stops within that window.
//!
//! The public key is pinned at build time through `POEVH_PREMIUM_PUBLIC_KEY`
//! (PEM, SPKI). Without it the key is fetched once from
//! `GET /api/premium/public-key` over HTTPS and remembered (trust on first use).

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use parking_lot::Mutex;
use poe2_types::{PremiumState, PremiumStatus};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tracing::{info, warn};
use zeroize::Zeroizing;

/// Production API; override at runtime with `POEVH_PREMIUM_API` for local testing.
pub const DEFAULT_API_BASE: &str = "https://poeviethoa.net";
const EMBEDDED_PUBLIC_KEY_PEM: Option<&str> = option_env!("POEVH_PREMIUM_PUBLIC_KEY");
const STORE_VERSION: u32 = 1;
const KEY_ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// Refresh when the token has less than this left.
const REFRESH_BEFORE_EXPIRY: Duration = Duration::from_secs(24 * 60 * 60);
/// Refresh at least this often while a key is stored, so a revoked key is
/// noticed even when the token still has days left.
const REFRESH_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);
/// Wait between attempts after a network failure.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(5 * 60);
const WORKER_TICK: Duration = Duration::from_secs(30);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
const OFFER_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
/// Ed25519 SubjectPublicKeyInfo DER prefix (RFC 8410) ahead of the 32 raw key bytes.
const SPKI_ED25519_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

// ─── Errors ──────────────────────────────────────────────────────────────────

/// A verify failure with the server's error code (or a local one), so the UI
/// can explain it without parsing messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PremiumError {
    /// `bad_key`, `unknown_key`, `premium_expired`, `device_mismatch`,
    /// `signing_unavailable`, `rate_limited`, `network`, `bad_token`, `server`.
    pub code: String,
    pub message: String,
}

impl PremiumError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    /// Codes that mean the key itself is unusable (as opposed to a transient failure).
    pub fn is_rejection(&self) -> bool {
        matches!(
            self.code.as_str(),
            "bad_key" | "unknown_key" | "premium_expired" | "device_mismatch"
        )
    }
}

impl std::fmt::Display for PremiumError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for PremiumError {}

// ─── Key normalisation ───────────────────────────────────────────────────────

/// Accepts what users paste (any case, spaces, missing dashes, `O`/`I`/`L`
/// look-alikes) and returns the canonical `PVH-XXXXX-XXXXX-XXXXX-XXXXX`, mirroring
/// the server's `normalizePremiumKey`.
pub fn normalize_key(input: &str) -> Option<String> {
    let compact: Vec<u8> = input
        .bytes()
        .filter(u8::is_ascii_alphanumeric)
        .map(|byte| match byte.to_ascii_uppercase() {
            b'O' => b'0',
            b'I' | b'L' => b'1',
            other => other,
        })
        .collect();
    let body = compact.strip_prefix(b"PVH").unwrap_or(&compact);
    if body.len() != 20 || body.iter().any(|byte| !KEY_ALPHABET.contains(byte)) {
        return None;
    }
    let groups: Vec<&str> = body
        .chunks(5)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or(""))
        .collect();
    Some(format!("PVH-{}", groups.join("-")))
}

fn key_prefix(key: &str) -> String {
    key.chars().take(9).collect()
}

// ─── Licence tokens ──────────────────────────────────────────────────────────

/// Signed payload of a licence token (`v: 1`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LicencePayload {
    pub v: u32,
    /// Account id.
    pub sub: String,
    /// Key id; also the salt of `dev`.
    pub kid: String,
    /// `sha256("poevh-device:{kid}:{device_id}")` as hex.
    pub dev: String,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub premium_until: Option<String>,
    pub iat: u64,
    /// Unix seconds; the token is invalid from this moment on.
    pub exp: u64,
}

fn b64url_decode(value: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(value))
        .map_err(|_| anyhow!("Invalid base64url"))
}

/// Parses an Ed25519 public key from SPKI PEM (what `/api/premium/public-key` returns).
pub fn parse_public_key_pem(pem: &str) -> Result<VerifyingKey> {
    let body: String = pem
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("-----"))
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(body)
        .context("Public key PEM is not valid base64")?;
    let raw = der
        .strip_prefix(&SPKI_ED25519_PREFIX)
        .filter(|raw| raw.len() == 32)
        .context("Public key is not an Ed25519 SubjectPublicKeyInfo")?;
    let bytes: [u8; 32] = raw.try_into().expect("length checked above");
    VerifyingKey::from_bytes(&bytes).context("Invalid Ed25519 public key")
}

/// Hash the server stores for a device, salted by the key id.
pub fn device_hash(key_id: &str, device_id: &str) -> String {
    hex(&Sha256::digest(
        format!("poevh-device:{key_id}:{device_id}").as_bytes(),
    ))
}

/// Checks a licence token: signature, structure, expiry and that it was issued
/// for this device. Returns the payload on success.
pub fn verify_token(
    token: &str,
    public_key: &VerifyingKey,
    device_id: &str,
    now_secs: u64,
) -> Result<LicencePayload, PremiumError> {
    let bad = |message: &str| PremiumError::new("bad_token", message);
    let mut parts = token.split('.');
    let (Some(body), Some(signature), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(bad("Licence token is malformed"));
    };
    let signature = b64url_decode(signature)
        .ok()
        .and_then(|bytes| Signature::from_slice(&bytes).ok())
        .ok_or_else(|| bad("Licence signature is malformed"))?;
    public_key
        .verify(body.as_bytes(), &signature)
        .map_err(|_| bad("Licence signature does not match the server key"))?;
    let payload: LicencePayload = b64url_decode(body)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .ok_or_else(|| bad("Licence payload is malformed"))?;
    if payload.v != 1 {
        return Err(bad("Licence version is not supported"));
    }
    if payload.exp <= now_secs {
        return Err(PremiumError::new(
            "token_expired",
            "Licence token has expired",
        ));
    }
    if payload.dev != device_hash(&payload.kid, device_id) {
        return Err(bad("Licence was issued for another device"));
    }
    Ok(payload)
}

// ─── Device identity ─────────────────────────────────────────────────────────

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A stable id for this Windows install: the machine GUID, hashed so the raw
/// GUID never leaves the computer. `None` when the registry is unreadable.
#[cfg(windows)]
fn machine_device_id() -> Option<String> {
    use windows::{
        core::PCWSTR,
        Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
    };
    let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography\0"
        .encode_utf16()
        .collect();
    let value: Vec<u16> = "MachineGuid\0".encode_utf16().collect();
    let mut buffer = [0u16; 128];
    let mut size = (buffer.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if status.is_err() {
        return None;
    }
    let chars = (size as usize / 2).min(buffer.len());
    let guid = String::from_utf16_lossy(&buffer[..chars]);
    let guid = guid.trim_end_matches('\0').trim();
    if guid.len() < 8 {
        return None;
    }
    Some(hex(&Sha256::digest(
        format!("poevh-device-id-v1:{}", guid.to_ascii_lowercase()).as_bytes(),
    )))
}

#[cfg(not(windows))]
fn machine_device_id() -> Option<String> {
    None
}

fn device_label() -> String {
    let name = std::env::var("COMPUTERNAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Windows PC".to_string());
    name.chars()
        .filter(|ch| !ch.is_control())
        .take(80)
        .collect()
}

pub fn api_base() -> String {
    std::env::var("POEVH_PREMIUM_API")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .unwrap_or_else(|| DEFAULT_API_BASE.to_string())
}

// ─── Storage ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoredPremium {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    token: Option<String>,
    /// Server public key remembered on first use when none is embedded.
    #[serde(default)]
    public_key_pem: Option<String>,
    #[serde(default)]
    last_verified_at: Option<u64>,
}

pub fn default_store_path() -> Result<PathBuf> {
    let root = std::env::var_os("LOCALAPPDATA").context("LOCALAPPDATA is unavailable")?;
    Ok(PathBuf::from(root)
        .join("POE2MultiPilot")
        .join("premium.json"))
}

fn load_store(path: &Path) -> StoredPremium {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
            warn!(%error, "premium store is unreadable; starting over");
            StoredPremium::default()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => StoredPremium::default(),
        Err(error) => {
            warn!(%error, "premium store could not be read");
            StoredPremium::default()
        }
    }
}

fn save_store(path: &Path, store: &StoredPremium) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut store = store.clone();
    store.version = STORE_VERSION;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&store)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ─── Time ────────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// `YYYY-MM-DDTHH:MM:SSZ` for a Unix timestamp (proleptic Gregorian).
pub fn iso8601(secs: u64) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

struct Runtime {
    path: PathBuf,
    store: StoredPremium,
    public_key: Option<VerifyingKey>,
    last_error: Option<PremiumError>,
    verifying: bool,
    /// Set after a successful verify so the worker's interval starts from it.
    last_attempt: Option<u64>,
}

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();

fn runtime() -> &'static Mutex<Runtime> {
    RUNTIME.get_or_init(|| {
        let path = default_store_path().unwrap_or_else(|error| {
            warn!(%error, "premium store path unavailable; licence will not persist");
            std::env::temp_dir().join("poevh-premium.json")
        });
        Mutex::new(Runtime::load(path))
    })
}

impl Runtime {
    fn load(path: PathBuf) -> Self {
        let mut store = load_store(&path);
        let mut changed = false;
        if store.device_id.is_none() {
            store.device_id = machine_device_id().or_else(|| {
                warn!("machine id unavailable; using a random device id for premium");
                super::credentials::random_key().ok()
            });
            changed = store.device_id.is_some();
        }
        let public_key = EMBEDDED_PUBLIC_KEY_PEM
            .or(store.public_key_pem.as_deref())
            .and_then(|pem| match parse_public_key_pem(pem) {
                Ok(key) => Some(key),
                Err(error) => {
                    warn!(%error, "stored premium public key is unusable");
                    None
                }
            });
        if changed {
            if let Err(error) = save_store(&path, &store) {
                warn!(%error, "premium store could not be written");
            }
        }
        Self {
            path,
            store,
            public_key,
            last_error: None,
            verifying: false,
            last_attempt: None,
        }
    }

    fn device_id(&self) -> &str {
        self.store.device_id.as_deref().unwrap_or("")
    }

    fn save(&self) {
        if let Err(error) = save_store(&self.path, &self.store) {
            warn!(%error, "premium store could not be written");
        }
    }

    /// The locally valid payload, if the stored token still checks out.
    fn current_payload(&self, now: u64) -> Option<LicencePayload> {
        let token = self.store.token.as_deref()?;
        let key = self.public_key.as_ref()?;
        verify_token(token, key, self.device_id(), now).ok()
    }

    fn status(&self, now: u64) -> PremiumStatus {
        let payload = self.current_payload(now);
        let state = if self.store.key.is_none() {
            PremiumState::NoKey
        } else if payload.is_some() {
            PremiumState::Active
        } else if self
            .last_error
            .as_ref()
            .is_some_and(PremiumError::is_rejection)
        {
            PremiumState::Rejected
        } else {
            PremiumState::Expired
        };
        PremiumStatus {
            state,
            active: payload.is_some() || dev_unlocked(),
            unlocked_for_dev: dev_unlocked(),
            key_prefix: self.store.key.as_deref().map(key_prefix),
            plan: payload.as_ref().and_then(|value| value.plan.clone()),
            premium_until: payload
                .as_ref()
                .and_then(|value| value.premium_until.clone()),
            token_expires_at: payload.as_ref().map(|value| iso8601(value.exp)),
            last_verified_at: self.store.last_verified_at.map(iso8601),
            last_error_code: self.last_error.as_ref().map(|error| error.code.clone()),
            last_error: self.last_error.as_ref().map(|error| error.message.clone()),
            device_label: device_label(),
            verifying: self.verifying,
        }
    }
}

/// Loads the stored key and token. Safe to call more than once.
pub fn init() {
    let rt = runtime().lock();
    let status = rt.status(now_secs());
    info!(
        state = ?status.state,
        key = status.key_prefix.as_deref().unwrap_or("-"),
        path = %rt.path.display(),
        "premium licence loaded"
    );
}

pub fn status() -> PremiumStatus {
    runtime().lock().status(now_secs())
}

/// The one check features should use.
/// Developer escape hatch: `POEVH_PREMIUM_UNLOCK=1` unlocks gated features in debug
/// builds only, so the dashboard and tests can be worked on without a licence.
pub fn dev_unlocked() -> bool {
    cfg!(debug_assertions) && std::env::var("POEVH_PREMIUM_UNLOCK").is_ok_and(|value| value == "1")
}

/// The one check features should use: a valid licence for this device, or the
/// debug-only developer unlock.
pub fn is_active() -> bool {
    dev_unlocked() || runtime().lock().current_payload(now_secs()).is_some()
}

/// Where the user buys premium and creates a key.
pub fn premium_page_url() -> String {
    format!("{}/premium", api_base())
}

/// Plans and payment instructions from `GET /api/premium/offer`, cached for ten
/// minutes. Blocking.
pub fn offer() -> Result<serde_json::Value, PremiumError> {
    static CACHE: OnceLock<Mutex<Option<(serde_json::Value, std::time::Instant)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Some((value, fetched)) = cache.lock().as_ref() {
        if fetched.elapsed() < OFFER_CACHE_TTL {
            return Ok(value.clone());
        }
    }
    let base = api_base();
    let response = http_client()?
        .get(format!("{base}/api/premium/offer"))
        .send()
        .map_err(|error| PremiumError::new("network", format!("Cannot reach {base}: {error}")))?;
    let status = response.status();
    let body: ApiEnvelope<serde_json::Value> = response
        .json()
        .map_err(|_| PremiumError::new("server", format!("Unexpected offer answer ({status})")))?;
    match body.data {
        Some(mut data) if body.ok => {
            if let Some(object) = data.as_object_mut() {
                object
                    .entry("page_url")
                    .or_insert_with(|| serde_json::Value::String(premium_page_url()));
            }
            *cache.lock() = Some((data.clone(), std::time::Instant::now()));
            Ok(data)
        }
        _ => Err(PremiumError::new(
            body.code.as_deref().unwrap_or("server"),
            body.error.unwrap_or_else(|| "Offer unavailable".into()),
        )),
    }
}

/// Stores a pasted key after the server accepted it for this device. Blocking.
pub fn activate(key: &str) -> Result<PremiumStatus, PremiumError> {
    let key = Zeroizing::new(
        normalize_key(key).ok_or_else(|| PremiumError::new("bad_key", "Key format is invalid"))?,
    );
    verify_and_store(Some(&key))
}

/// Re-verifies the stored key. Blocking.
pub fn refresh() -> Result<PremiumStatus, PremiumError> {
    verify_and_store(None)
}

/// Forgets the key and token; the device id stays so re-activating on this
/// computer does not count as a device change.
pub fn deactivate() -> PremiumStatus {
    let mut rt = runtime().lock();
    rt.store.key = None;
    rt.store.token = None;
    rt.store.last_verified_at = None;
    rt.last_error = None;
    rt.save();
    rt.status(now_secs())
}

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    #[serde(default)]
    ok: bool,
    data: Option<T>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    code: Option<String>,
}

#[derive(Deserialize)]
struct VerifyData {
    token: String,
}

#[derive(Deserialize)]
struct PublicKeyData {
    #[serde(rename = "publicKeyPem")]
    public_key_pem: String,
}

fn http_client() -> Result<reqwest::blocking::Client, PremiumError> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("POEVH/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| PremiumError::new("network", format!("HTTP client failed: {error}")))
}

fn fetch_public_key(
    client: &reqwest::blocking::Client,
    base: &str,
) -> Result<String, PremiumError> {
    let response = client
        .get(format!("{base}/api/premium/public-key"))
        .send()
        .map_err(|error| PremiumError::new("network", format!("Cannot reach {base}: {error}")))?;
    let status = response.status();
    let body: ApiEnvelope<PublicKeyData> = response.json().map_err(|_| {
        PremiumError::new("server", format!("Unexpected public-key answer ({status})"))
    })?;
    match body.data {
        Some(data) if body.ok => Ok(data.public_key_pem),
        _ => Err(PremiumError::new(
            body.code.as_deref().unwrap_or("server"),
            body.error
                .unwrap_or_else(|| "Public key unavailable".into()),
        )),
    }
}

fn call_verify(
    client: &reqwest::blocking::Client,
    base: &str,
    key: &str,
    device_id: &str,
    label: &str,
) -> Result<String, PremiumError> {
    let response = client
        .post(format!("{base}/api/premium/verify"))
        .json(&serde_json::json!({
            "key": key,
            "device_id": device_id,
            "device_label": label,
        }))
        .send()
        .map_err(|error| PremiumError::new("network", format!("Cannot reach {base}: {error}")))?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err(PremiumError::new(
            "rate_limited",
            "Too many attempts; wait a minute and try again",
        ));
    }
    let body: ApiEnvelope<VerifyData> = response
        .json()
        .map_err(|_| PremiumError::new("server", format!("Unexpected verify answer ({status})")))?;
    match body.data {
        Some(data) if body.ok => Ok(data.token),
        _ => Err(PremiumError::new(
            body.code.as_deref().unwrap_or("server"),
            body.error
                .unwrap_or_else(|| format!("Verify failed ({status})")),
        )),
    }
}

/// Runs one verify round trip. `new_key` replaces the stored key on success;
/// `None` re-checks the stored one.
fn verify_and_store(new_key: Option<&str>) -> Result<PremiumStatus, PremiumError> {
    let (key, device_id, public_key, pem_is_pinned) = {
        let mut rt = runtime().lock();
        if rt.verifying {
            return Err(PremiumError::new(
                "busy",
                "A verify request is already running",
            ));
        }
        let key = match new_key {
            Some(value) => value.to_string(),
            None => rt
                .store
                .key
                .clone()
                .ok_or_else(|| PremiumError::new("no_key", "No premium key is stored"))?,
        };
        if rt.store.device_id.is_none() {
            return Err(PremiumError::new("bad_device", "No device id is available"));
        }
        rt.verifying = true;
        rt.last_attempt = Some(now_secs());
        (
            Zeroizing::new(key),
            rt.device_id().to_string(),
            rt.public_key,
            EMBEDDED_PUBLIC_KEY_PEM.is_some(),
        )
    };

    let outcome = (|| {
        let client = http_client()?;
        let base = api_base();
        let label = device_label();
        let token = call_verify(&client, &base, &key, &device_id, &label)?;
        let now = now_secs();
        // Signature check with the pinned/remembered key; when the remembered
        // key is missing or no longer matches, fetch the server's current one once.
        let mut fetched_pem = None;
        let verified = match public_key
            .as_ref()
            .map(|pk| verify_token(&token, pk, &device_id, now))
        {
            Some(Ok(payload)) => Ok(payload),
            Some(Err(error)) if pem_is_pinned || error.code != "bad_token" => Err(error),
            _ => {
                let pem = fetch_public_key(&client, &base)?;
                let pk = parse_public_key_pem(&pem)
                    .map_err(|error| PremiumError::new("server", error.to_string()))?;
                let payload = verify_token(&token, &pk, &device_id, now)?;
                fetched_pem = Some((pem, pk));
                Ok(payload)
            }
        }?;
        Ok::<_, PremiumError>((token, verified, fetched_pem, now))
    })();

    let mut rt = runtime().lock();
    rt.verifying = false;
    match outcome {
        Ok((token, payload, fetched_pem, now)) => {
            if let Some((pem, pk)) = fetched_pem {
                rt.store.public_key_pem = Some(pem);
                rt.public_key = Some(pk);
            }
            rt.store.key = Some(key.to_string());
            rt.store.token = Some(token);
            rt.store.last_verified_at = Some(now);
            rt.last_error = None;
            rt.save();
            info!(
                plan = payload.plan.as_deref().unwrap_or("-"),
                until = payload.premium_until.as_deref().unwrap_or("lifetime"),
                token_exp = %iso8601(payload.exp),
                "premium licence verified"
            );
            Ok(rt.status(now))
        }
        Err(error) => {
            warn!(code = %error.code, message = %error.message, "premium verify failed");
            if new_key.is_some() && error.is_rejection() {
                // A pasted key that the server refused is not kept.
                rt.last_error = Some(error.clone());
                return Err(error);
            }
            if error.is_rejection() {
                // The stored key stopped working: drop the token so `active` turns
                // off now instead of at `exp`, but keep the key so the user sees why.
                rt.store.token = None;
                rt.save();
            }
            rt.last_error = Some(error.clone());
            Err(error)
        }
    }
}

/// Keeps the licence fresh: re-verifies before the token expires, on a fixed
/// interval while a key is stored, and retries after network failures.
pub fn spawn_refresh_worker() {
    std::thread::Builder::new()
        .name("premium-refresh".into())
        .spawn(|| loop {
            let due = {
                let rt = runtime().lock();
                let now = now_secs();
                match rt.store.key.as_deref() {
                    None => false,
                    Some(_) if rt.verifying => false,
                    Some(_) => {
                        let since_attempt = rt
                            .last_attempt
                            .map(|at| now.saturating_sub(at))
                            .unwrap_or(u64::MAX);
                        match rt.current_payload(now) {
                            // Rejected keys are retried slowly too: an admin may release the device.
                            None => since_attempt >= RETRY_AFTER_FAILURE.as_secs(),
                            Some(payload) => {
                                let remaining = payload.exp.saturating_sub(now);
                                let since_verified = rt
                                    .store
                                    .last_verified_at
                                    .map(|at| now.saturating_sub(at))
                                    .unwrap_or(u64::MAX);
                                (remaining <= REFRESH_BEFORE_EXPIRY.as_secs()
                                    || since_verified >= REFRESH_INTERVAL.as_secs())
                                    && since_attempt >= RETRY_AFTER_FAILURE.as_secs()
                            }
                        }
                    }
                }
            };
            if due {
                let _ = refresh();
            }
            std::thread::sleep(WORKER_TICK);
        })
        .map(|_| ())
        .unwrap_or_else(|error| warn!(%error, "premium refresh worker could not start"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn test_keys() -> (SigningKey, String) {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let mut der = SPKI_ED25519_PREFIX.to_vec();
        der.extend_from_slice(signing.verifying_key().as_bytes());
        let b64 = base64::engine::general_purpose::STANDARD.encode(der);
        let pem = format!("-----BEGIN PUBLIC KEY-----\n{b64}\n-----END PUBLIC KEY-----\n");
        (signing, pem)
    }

    fn sign(signing: &SigningKey, payload: &serde_json::Value) -> String {
        let body = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string());
        let signature = signing.sign(body.as_bytes());
        let sig = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signature.to_bytes());
        format!("{body}.{sig}")
    }

    fn payload(kid: &str, device_id: &str, exp: u64) -> serde_json::Value {
        serde_json::json!({
            "v": 1, "sub": "usr_1", "kid": kid, "dev": device_hash(kid, device_id),
            "plan": "month", "premium_until": "2026-12-08T00:00:00.000Z",
            "iat": 1_700_000_000, "exp": exp
        })
    }

    #[test]
    fn normalizes_pasted_keys_like_the_server() {
        assert_eq!(
            normalize_key("pvh-abcde-fghjk-mnpqr-stvwx").as_deref(),
            Some("PVH-ABCDE-FGHJK-MNPQR-STVWX")
        );
        assert_eq!(
            normalize_key(" abcdefghjkmnpqrstvwx ").as_deref(),
            Some("PVH-ABCDE-FGHJK-MNPQR-STVWX")
        );
        // Look-alikes map to the Crockford digits.
        assert_eq!(
            normalize_key("PVH-OILO1-FGHJK-MNPQR-STVWX").as_deref(),
            Some("PVH-01101-FGHJK-MNPQR-STVWX")
        );
        assert!(normalize_key("PVH-ABCDE-FGHJK-MNPQR-STVW").is_none());
        assert!(normalize_key("PVH-ABCDE-FGHJK-MNPQR-STVWU").is_none());
        assert!(normalize_key("").is_none());
        assert_eq!(key_prefix("PVH-ABCDE-FGHJK-MNPQR-STVWX"), "PVH-ABCDE");
    }

    #[test]
    fn parses_spki_pem_and_rejects_other_keys() {
        let (signing, pem) = test_keys();
        assert_eq!(parse_public_key_pem(&pem).unwrap(), signing.verifying_key());
        assert!(
            parse_public_key_pem("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----")
                .is_err()
        );
        assert!(parse_public_key_pem("not pem").is_err());
    }

    #[test]
    fn accepts_a_valid_token_for_this_device() {
        let (signing, pem) = test_keys();
        let pk = parse_public_key_pem(&pem).unwrap();
        let token = sign(&signing, &payload("pkey_1", "device-a", 1_700_000_600));
        let verified = verify_token(&token, &pk, "device-a", 1_700_000_000).unwrap();
        assert_eq!(verified.kid, "pkey_1");
        assert_eq!(verified.plan.as_deref(), Some("month"));
        assert_eq!(verified.exp, 1_700_000_600);
    }

    #[test]
    fn rejects_expired_tampered_or_foreign_tokens() {
        let (signing, pem) = test_keys();
        let pk = parse_public_key_pem(&pem).unwrap();
        let token = sign(&signing, &payload("pkey_1", "device-a", 1_700_000_600));

        let expired = verify_token(&token, &pk, "device-a", 1_700_000_600).unwrap_err();
        assert_eq!(expired.code, "token_expired");

        let other_device = verify_token(&token, &pk, "device-b", 1_700_000_000).unwrap_err();
        assert_eq!(other_device.code, "bad_token");

        let (body, sig) = token.split_once('.').unwrap();
        let forged_body = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(payload("pkey_1", "device-a", 1_900_000_000).to_string());
        assert_eq!(
            verify_token(
                &format!("{forged_body}.{sig}"),
                &pk,
                "device-a",
                1_700_000_000
            )
            .unwrap_err()
            .code,
            "bad_token"
        );
        assert_eq!(
            verify_token(body, &pk, "device-a", 1_700_000_000)
                .unwrap_err()
                .code,
            "bad_token"
        );
        assert_eq!(
            verify_token(&format!("{token}.x"), &pk, "device-a", 1_700_000_000)
                .unwrap_err()
                .code,
            "bad_token"
        );

        let other_signer = SigningKey::from_bytes(&[9u8; 32]);
        let foreign = sign(&other_signer, &payload("pkey_1", "device-a", 1_700_000_600));
        assert_eq!(
            verify_token(&foreign, &pk, "device-a", 1_700_000_000)
                .unwrap_err()
                .code,
            "bad_token"
        );
    }

    #[test]
    fn formats_unix_time_as_iso8601() {
        assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn status_reflects_stored_key_and_token() {
        let (signing, pem) = test_keys();
        let dir = std::env::temp_dir().join(format!("poevh-premium-test-{}", std::process::id()));
        let path = dir.join("premium.json");
        let _ = std::fs::remove_dir_all(&dir);

        let mut rt = Runtime::load(path.clone());
        assert!(
            rt.store.device_id.is_some(),
            "a device id is always available"
        );
        assert_eq!(rt.status(1_700_000_000).state, PremiumState::NoKey);

        let device_id = rt.device_id().to_string();
        rt.store.key = Some("PVH-ABCDE-FGHJK-MNPQR-STVWX".into());
        rt.store.public_key_pem = Some(pem.clone());
        rt.public_key = Some(parse_public_key_pem(&pem).unwrap());
        rt.store.token = Some(sign(
            &signing,
            &payload("pkey_1", &device_id, 1_700_000_600),
        ));
        rt.store.last_verified_at = Some(1_700_000_000);
        rt.save();

        let status = rt.status(1_700_000_000);
        assert_eq!(status.state, PremiumState::Active);
        assert!(status.active);
        assert_eq!(status.key_prefix.as_deref(), Some("PVH-ABCDE"));
        assert_eq!(
            status.token_expires_at.as_deref(),
            Some("2023-11-14T22:23:20Z")
        );

        let later = rt.status(1_700_000_601);
        assert_eq!(later.state, PremiumState::Expired);
        assert!(!later.active);

        rt.last_error = Some(PremiumError::new("device_mismatch", "elsewhere"));
        assert_eq!(rt.status(1_700_000_601).state, PremiumState::Rejected);

        // Reloading from disk keeps the key, token and device id.
        let reloaded = Runtime::load(path);
        assert_eq!(reloaded.device_id(), device_id);
        assert_eq!(reloaded.status(1_700_000_000).state, PremiumState::Active);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
