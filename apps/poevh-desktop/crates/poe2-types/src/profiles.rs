//! Persistent account profiles and ephemeral runtime instances.
//!
//! The legacy configuration called both of these things "clients".  These
//! types make the boundary explicit without forcing callers to migrate all at
//! once: [`MultiClientConfig::split_runtime`] and
//! [`MultiClientConfig::from_runtime`] provide a lossless adapter.

use crate::{
    ClientAccountProfile, ClientFlavor, ClientInputMode, LoginCalibration, MultiClientConfig,
};
use serde::{Deserialize, Serialize};

/// Settings that survive a game process exiting.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccountProfile {
    pub id: u32,
    pub label: String,
    #[serde(default)]
    pub flavor: ClientFlavor,
    #[serde(default)]
    pub exe_path: String,
    #[serde(default)]
    pub email_masked: String,
    #[serde(default)]
    pub has_credentials: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_calibration: Option<LoginCalibration>,
    #[serde(default)]
    pub auto_login: bool,
    #[serde(default)]
    pub char1_name: String,
    #[serde(default)]
    pub char1_role: String,
    #[serde(default)]
    pub char2_name: String,
    #[serde(default)]
    pub char2_role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_mode: Option<ClientInputMode>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// One currently running PoE process. This must never be persisted as a
/// credential or PID registry; it is rebuilt from process discovery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeInstance {
    pub id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_profile_id: Option<u32>,
    #[serde(default)]
    pub is_main: bool,
    #[serde(default)]
    pub black_screen: bool,
    #[serde(default = "default_background_fps")]
    pub bg_fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuntimeConfig {
    pub accounts: Vec<AccountProfile>,
    #[serde(default)]
    pub instances: Vec<RuntimeInstance>,
}

const fn default_true() -> bool {
    true
}
const fn default_background_fps() -> u32 {
    60
}

impl From<&ClientAccountProfile> for AccountProfile {
    fn from(value: &ClientAccountProfile) -> Self {
        Self {
            id: value.id,
            label: value.label.clone(),
            flavor: value.flavor,
            exe_path: value.exe_path.clone(),
            email_masked: value.email_masked.clone(),
            has_credentials: value.has_credentials,
            credential_ref: value.credential_ref.clone(),
            login_calibration: value.login_calibration.clone(),
            auto_login: value.auto_login,
            char1_name: value.char1_name.clone(),
            char1_role: value.char1_role.clone(),
            char2_name: value.char2_name.clone(),
            char2_role: value.char2_role.clone(),
            input_mode: value.input_mode,
            enabled: value.enabled,
        }
    }
}

impl AccountProfile {
    pub fn into_legacy(self, runtime: &RuntimeInstance) -> ClientAccountProfile {
        ClientAccountProfile {
            id: self.id,
            label: self.label,
            flavor: self.flavor,
            exe_path: self.exe_path,
            email_masked: self.email_masked,
            has_credentials: self.has_credentials,
            credential_ref: self.credential_ref,
            login_calibration: self.login_calibration,
            auto_login: self.auto_login,
            char1_name: self.char1_name,
            char1_role: self.char1_role,
            char2_name: self.char2_name,
            char2_role: self.char2_role,
            input_mode: self.input_mode,
            black_screen: runtime.black_screen,
            bg_fps: runtime.bg_fps,
            enabled: self.enabled,
        }
    }
}

impl MultiClientConfig {
    /// Convert the legacy fixed-client vector into persistent accounts plus
    /// runtime instances. No data is discarded; graphics preferences move to
    /// the runtime record and `main_instance_id` becomes `is_main`.
    pub fn split_runtime(&self) -> RuntimeConfig {
        let accounts = self.clients.iter().map(AccountProfile::from).collect();
        let instances = self
            .clients
            .iter()
            .map(|client| RuntimeInstance {
                id: client.id,
                account_profile_id: Some(client.id),
                is_main: client.id == self.main_instance_id,
                black_screen: client.black_screen,
                bg_fps: client.bg_fps,
            })
            .collect();
        RuntimeConfig {
            accounts,
            instances,
        }
    }

    /// Rebuild a legacy config for old engine/UI code. This adapter is useful
    /// during migration and deliberately keeps runtime IDs stable.
    pub fn from_runtime(&self, runtime: &RuntimeConfig) -> Self {
        let mut config = self.clone();
        config.clients = runtime
            .instances
            .iter()
            .filter_map(|instance| {
                let account_id = instance.account_profile_id?;
                let account = runtime.accounts.iter().find(|a| a.id == account_id)?;
                Some(account.clone().into_legacy(instance))
            })
            .collect();
        if let Some(main) = runtime.instances.iter().find(|i| i.is_main) {
            config.main_instance_id = main.id;
        }
        config.next_instance_id = config
            .clients
            .iter()
            .map(|client| client.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        config
    }
}
