//! Versioned profile persistence. No PID, credentials, or live process state is saved.
use anyhow::{bail, Context, Result};
use poe2_types::{BotSettings, FollowConfig, MultiClientConfig};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 1024 * 1024;
const CURRENT_VERSION: u32 = 2;

/// Durable feature settings. Session counters and live process state are not
/// part of this structure and therefore cannot accidentally leak into disk.
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct PersistentSettings {
    follow: bool,
    catchup: bool,
    loot: bool,
    combat: bool,
    flask: poe2_types::SmartFlaskConfig,
    pickup: poe2_types::AutoPickupConfig,
    stash: poe2_types::AutoStashConfig,
    party: poe2_types::AutoPartyConfig,
    party_combat: poe2_types::PartyCombatConfig,
    waystones: poe2_types::WaystoneCraftConfig,
    shared_ctrl: poe2_types::SharedControlsConfig,
    timed_actions: Vec<poe2_types::TimedActionItem>,
    mouse_bindings: poe2_types::MouseBindingsConfig,
    controller_mapping: poe2_types::ControllerMappingConfig,
    auto_revive: bool,
    poe_smoother: poe2_types::PoeSmootherConfig,
    waystone_colors: poe2_types::WaystoneColorConfig,
    expedition: poe2_types::ExpeditionConfig,
}

impl Default for PersistentSettings {
    fn default() -> Self {
        Self::from(&BotSettings::default())
    }
}

impl From<&BotSettings> for PersistentSettings {
    fn from(settings: &BotSettings) -> Self {
        Self {
            follow: settings.follow,
            catchup: settings.catchup,
            loot: settings.loot,
            combat: settings.combat,
            flask: settings.flask.clone(),
            pickup: settings.pickup.clone(),
            stash: settings.stash.clone(),
            party: settings.party.clone(),
            party_combat: settings.party_combat.clone(),
            waystones: settings.waystones.clone(),
            shared_ctrl: settings.shared_ctrl.clone(),
            timed_actions: settings.timed_actions.clone(),
            mouse_bindings: settings.mouse_bindings.clone(),
            controller_mapping: settings.controller_mapping.clone(),
            auto_revive: settings.auto_revive,
            poe_smoother: settings.poe_smoother.clone(),
            waystone_colors: settings.waystone_colors.clone(),
            expedition: settings.expedition.clone(),
        }
    }
}

impl PersistentSettings {
    fn apply_to(&self, settings: &mut BotSettings) {
        settings.follow = self.follow;
        settings.catchup = self.catchup;
        settings.loot = self.loot;
        settings.combat = self.combat;
        settings.flask = self.flask.clone();
        settings.pickup = self.pickup.clone();
        settings.stash = self.stash.clone();
        settings.party = self.party.clone();
        settings.party_combat = self.party_combat.clone();
        settings.waystones = self.waystones.clone();
        settings.shared_ctrl = self.shared_ctrl.clone();
        settings.timed_actions = self.timed_actions.clone();
        settings.mouse_bindings = self.mouse_bindings.clone();
        settings.controller_mapping = self.controller_mapping.clone();
        settings.auto_revive = self.auto_revive;
        settings.poe_smoother = self.poe_smoother.clone();
        settings.waystone_colors = self.waystone_colors.clone();
        settings.expedition = self.expedition.clone();
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct Document {
    version: u32,
    config: MultiClientConfig,
    /// Global input preference kept next to the instance profiles.
    /// Optional for backwards compatibility with existing profile files.
    #[serde(default)]
    kbm_bridge: Option<bool>,
    /// Optional for schema v1; all new saves populate this field.
    #[serde(default)]
    settings: Option<PersistentSettings>,
    #[serde(default)]
    follow_config: Option<FollowConfig>,
}

pub struct ProfileStore {
    path: PathBuf,
}

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn default_path() -> Result<PathBuf> {
        let root = std::env::var_os("LOCALAPPDATA").context("LOCALAPPDATA is unavailable")?;
        Ok(PathBuf::from(root)
            .join("POE2MultiPilot")
            .join("profiles.json"))
    }

    pub fn load(&self) -> Result<Option<MultiClientConfig>> {
        let Some(document) = self.read_validated_document()? else {
            return Ok(None);
        };
        Ok(Some(document.config))
    }

    pub fn load_kbm_bridge(&self) -> Result<Option<bool>> {
        let Some(document) = self.read_validated_document()? else {
            return Ok(None);
        };
        Ok(document.kbm_bridge)
    }

    /// Load durable feature settings into the supplied runtime values. Session
    /// counters and live process bindings are intentionally untouched.
    pub fn load_runtime_settings(
        &self,
        settings: &mut BotSettings,
        follow: &mut FollowConfig,
    ) -> Result<()> {
        let Some(document) = self.read_validated_document()? else {
            return Ok(());
        };
        if let Some(stored) = document.settings {
            stored.apply_to(settings);
        }
        if let Some(stored) = document.follow_config {
            *follow = stored;
        }
        if let Some(kbm_bridge) = document.kbm_bridge {
            settings.kbm_bridge = kbm_bridge;
        }
        Ok(())
    }

    pub fn save_kbm_bridge(&self, enabled: bool) -> Result<()> {
        let config = self.load()?.unwrap_or_default();
        self.save_internal(&config, Some(enabled))
    }

    pub fn save(&self, config: &MultiClientConfig) -> Result<()> {
        config
            .validate()
            .map_err(|e| anyhow::anyhow!("Invalid profiles: {e:?}"))?;
        self.save_internal(config, None)
    }

    /// Persist feature settings while preserving the account/profile section.
    pub fn save_runtime_settings(
        &self,
        config: &MultiClientConfig,
        settings: &BotSettings,
        follow: &FollowConfig,
    ) -> Result<()> {
        config
            .validate()
            .map_err(|e| anyhow::anyhow!("Invalid profiles: {e:?}"))?;
        self.save_internal_with_settings(
            config,
            Some(settings.kbm_bridge),
            Some(PersistentSettings::from(settings)),
            Some(follow.clone()),
        )
    }

    fn read_document(&self) -> Result<Option<Document>> {
        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e).context("Open profile file"),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_BYTES {
            bail!("Profile file exceeds 1 MiB");
        }
        serde_json::from_slice(&bytes).context("Invalid profile file; original preserved")
    }

    fn read_validated_document(&self) -> Result<Option<Document>> {
        let Some(document) = self.read_document()? else {
            return Ok(None);
        };
        if document.version != 1 && document.version != CURRENT_VERSION {
            bail!(
                "Unsupported profile schema {}; original preserved",
                document.version
            );
        }
        document
            .config
            .validate()
            .map_err(|e| anyhow::anyhow!("Invalid profiles: {e:?}"))?;
        Ok(Some(document))
    }

    fn save_internal(&self, config: &MultiClientConfig, kbm_override: Option<bool>) -> Result<()> {
        self.save_internal_with_settings(config, kbm_override, None, None)
    }

    fn save_internal_with_settings(
        &self,
        config: &MultiClientConfig,
        kbm_override: Option<bool>,
        settings_override: Option<PersistentSettings>,
        follow_override: Option<FollowConfig>,
    ) -> Result<()> {
        let parent = self
            .path
            .parent()
            .context("Profile path requires a parent directory")?;
        fs::create_dir_all(parent)?;
        // OS lock is released on process exit/crash; a leftover lock file is harmless.
        let lock_path = self.path.with_extension("json.lock");
        let lock = OpenOptions::new()
            .write(true)
            .read(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .context("Profile store is busy or locked; no changes saved")?;
        lock.try_lock()
            .context("Another writer holds the profile store; no changes saved")?;
        // Read and merge while holding the OS lock, otherwise two writers can
        // observe the same stale document and silently lose one another's
        // settings.
        let result = (|| -> Result<()> {
            // Never overwrite a corrupt/future-version document. A valid v1
            // file is upgraded atomically the next time a save occurs.
            let old = self.read_validated_document()?;
            let kbm_bridge = kbm_override.or_else(|| old.as_ref().and_then(|d| d.kbm_bridge));
            let settings = settings_override
                .clone()
                .or_else(|| old.as_ref().and_then(|d| d.settings.clone()));
            let follow_config = follow_override
                .clone()
                .or_else(|| old.as_ref().and_then(|d| d.follow_config.clone()));
            self.save_locked(config, kbm_bridge, settings, follow_config, old.is_some())
        })();
        drop(lock);
        result
    }

    fn save_locked(
        &self,
        config: &MultiClientConfig,
        kbm_bridge: Option<bool>,
        settings: Option<PersistentSettings>,
        follow_config: Option<FollowConfig>,
        had_old: bool,
    ) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&Document {
            version: CURRENT_VERSION,
            config: config.clone(),
            kbm_bridge,
            settings,
            follow_config,
        })?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let temp_path = self
            .path
            .with_extension(format!("json.{}.{stamp}.tmp", std::process::id()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .context("Temporary profile file exists or cannot be created; original preserved")?;
        let result = (|| -> Result<()> {
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            if had_old {
                let backup = self.path.with_file_name(format!(
                    "{}.bak",
                    self.path.file_name().unwrap().to_string_lossy()
                ));
                fs::copy(&self.path, backup).context("Back up previous profiles")?;
            }
            fs::rename(&temp_path, &self.path).context("Atomically replace profile file")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp_path);
        }
        result
    }
}
