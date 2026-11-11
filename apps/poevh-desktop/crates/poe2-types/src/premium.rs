//! Premium licence state shared between the world client, the overlay API and the UI.
//!
//! The web account owns premium; the app only holds a key that the user pasted
//! and the short-lived licence token the server signed for this device. See
//! `README.md` ("Premium") at the monorepo root for the server contract.

use serde::{Deserialize, Serialize};

/// What the app currently knows about its premium licence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PremiumState {
    /// No key stored.
    #[default]
    NoKey,
    /// A key is stored and the last stored licence token is valid.
    Active,
    /// A key is stored but the licence could not be refreshed and the last
    /// token has run out (offline too long, or premium ended).
    Expired,
    /// The server refused the key (unknown, revoked, bound to another device).
    Rejected,
}

/// Snapshot returned by `GET /api/premium/status` and shown on the dashboard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PremiumStatus {
    pub state: PremiumState,
    /// True while the licence token is valid; the only field features should gate on.
    pub active: bool,
    /// First characters of the stored key (`PVH-XXXXX`), enough for the user to
    /// recognise it. Never the full key.
    pub key_prefix: Option<String>,
    pub plan: Option<String>,
    /// ISO-8601 end of the paid period; `None` for lifetime.
    pub premium_until: Option<String>,
    /// ISO-8601 expiry of the stored licence token.
    pub token_expires_at: Option<String>,
    /// ISO-8601 time of the last successful verify call.
    pub last_verified_at: Option<String>,
    /// Server error code from the last failed verify (`unknown_key`,
    /// `device_mismatch`, `premium_expired`, ...) or `network` / `bad_token`.
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
    /// Label sent to the server for this device (the computer name).
    pub device_label: String,
    /// True while a verify request is running.
    pub verifying: bool,
    /// True when `POEVH_PREMIUM_UNLOCK=1` is set on a debug build; `active` is then
    /// true regardless of the licence.
    #[serde(default)]
    pub unlocked_for_dev: bool,
}
