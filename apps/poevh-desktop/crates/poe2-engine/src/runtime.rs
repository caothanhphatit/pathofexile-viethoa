//! BotRuntime: shared mutable state + event ring-buffer.
//!
//! This struct is the single source of truth shared between
//! the tick-loop thread and the HTTP overlay server.

use crate::engine::FollowEngine;
use poe2_types::*;
use poe2_world::{MockWorldAdapter, WorldAdapter};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

const EVENT_RING_SIZE: usize = 30;

// ─── Runtime ─────────────────────────────────────────────────────────────────

pub type PreLaunchHook = std::sync::Arc<dyn Fn(u32, bool) -> Result<(), String> + Send + Sync>;

pub struct BotRuntime {
    login_states: std::collections::BTreeMap<u32, String>,
    launching_instances: std::collections::HashSet<u32>,
    profile_store: Option<crate::profile_store::ProfileStore>,
    instances: crate::instances::InstanceRegistry,
    pub adapter: Box<dyn WorldAdapter>,
    pub last_state: WorldState,
    events: VecDeque<BotEvent>,
    pending_pad_commands: Vec<PadCommand>,
    pre_launch_hook: Option<PreLaunchHook>,
    /// Persistent account profiles and process-lifetime runtime records. The
    /// legacy `multi_client.clients` vector remains as a compatibility view
    /// for existing command handlers and profile storage.
    runtime_config: RuntimeConfig,
}

impl BotRuntime {
    pub fn new(adapter: Box<dyn WorldAdapter>) -> Self {
        let last_state = adapter.snapshot();
        let runtime_accounts = last_state.settings.multi_client.split_runtime().accounts;
        Self {
            login_states: Default::default(),
            launching_instances: Default::default(),
            profile_store: None,
            instances: Default::default(),
            adapter,
            last_state,
            events: VecDeque::with_capacity(EVENT_RING_SIZE + 1),
            pending_pad_commands: Vec::new(),
            pre_launch_hook: None,
            runtime_config: RuntimeConfig {
                accounts: runtime_accounts,
                instances: Vec::new(),
            },
        }
    }

    pub fn set_pre_launch_hook<F>(&mut self, hook: F)
    where
        F: Fn(u32, bool) -> Result<(), String> + Send + Sync + 'static,
    {
        self.pre_launch_hook = Some(std::sync::Arc::new(hook));
    }

    pub fn pre_launch_hook(&self) -> Option<PreLaunchHook> {
        self.pre_launch_hook.clone()
    }

    pub fn instance_needs_virtual_controllers(&self, id: u32) -> bool {
        self.last_state
            .settings
            .multi_client
            .requires_virtual_controllers(id)
    }

    pub fn main_bound_pid(&self) -> Option<u32> {
        self.instances
            .binding(self.last_state.settings.multi_client.main_instance_id)
            .map(|identity| identity.pid)
    }

    pub fn sync_memory_target_to_main(&mut self) {
        let pid = self.main_bound_pid();
        self.adapter.set_target_process(pid);
    }

    /// Lightweight UI probe used by the native event loop. Avoid constructing
    /// a complete API snapshot just to decide whether one overlay is enabled.
    pub fn expedition_overlay_enabled(&self) -> bool {
        self.last_state.settings.expedition.enabled
    }

    pub fn set_memory_reader_status(&mut self, status: MemoryReaderStatus) {
        self.last_state.memory_reader = status;
        self.last_state.running = false;
        self.adapter.apply_state(self.last_state.clone());
    }

    /// Convenience: create with a given adapter (alias for new).
    pub fn with_adapter(adapter: Box<dyn WorldAdapter>) -> Self {
        Self::new(adapter)
    }

    /// Default runtime with mock world.
    pub fn default_mock() -> Self {
        Self::new(Box::new(MockWorldAdapter::new()))
    }

    /// Load once before workers start. Fail closed on corrupt/future profile files.
    pub fn enable_profile_store(
        &mut self,
        store: crate::profile_store::ProfileStore,
    ) -> anyhow::Result<()> {
        let mut config = store
            .load()?
            .unwrap_or_else(|| self.last_state.settings.multi_client.clone());
        // Restore all durable feature settings before reconciling credentials.
        // Runtime/process state remains freshly initialized for this session.
        store.load_runtime_settings(&mut self.last_state.settings, &mut self.last_state.config)?;
        // Raw leader input mirroring was never implemented. Keep these legacy
        // fields fail-closed so persisted UI state cannot imply otherwise.
        self.last_state.settings.shared_ctrl.sync_dodge = false;
        self.last_state.settings.shared_ctrl.share_attack_dir = false;
        self.last_state.config.mirror_attack_dir = false;
        for profile in &mut config.clients {
            // Old auto_login=true flags never represented an implemented feature.
            if let Some(key) = &profile.credential_ref {
                match poe2_world::credentials::read(key)? {
                    Some(credentials) => {
                        profile.has_credentials = true;
                        profile.email_masked = credentials.masked_email();
                        profile.auto_login = false;
                    }
                    None => {
                        profile.credential_ref = None;
                        profile.has_credentials = false;
                        profile.email_masked.clear();
                        profile.auto_login = false;
                    }
                }
            } else {
                profile.has_credentials = false;
                profile.email_masked.clear();
                profile.auto_login = false;
            }
        }
        // Persist the complete durable state on startup as well. This upgrades
        // legacy v1 files to schema v2 and ensures every setting is represented
        // even before the user changes a control in the UI.
        store.save_runtime_settings(&config, &self.last_state.settings, &self.last_state.config)?;
        self.last_state.settings.multi_client = config;
        self.runtime_config.accounts = self
            .last_state
            .settings
            .multi_client
            .split_runtime()
            .accounts;
        self.runtime_config.instances.clear();
        self.adapter.apply_state(self.last_state.clone());
        self.profile_store = Some(store);
        Ok(())
    }

    fn persist_runtime_settings(&self, state: &WorldState) {
        if let Some(store) = &self.profile_store {
            if let Err(error) = store.save_runtime_settings(
                &state.settings.multi_client,
                &state.settings,
                &state.config,
            ) {
                tracing::warn!(%error, "Failed to persist runtime settings");
            }
        }
    }

    fn commit_profiles(&mut self, config: MultiClientConfig) -> Result<(), InstanceUpdateError> {
        config.validate()?;
        if let Some(store) = &self.profile_store {
            store.save(&config).map_err(|e| {
                InstanceUpdateError::Unavailable(format!("Profiles not saved: {e:#}"))
            })?;
        }
        // Commit in memory only after the durable write succeeds.
        self.last_state.settings.multi_client = config;
        self.runtime_config.accounts = self
            .last_state
            .settings
            .multi_client
            .split_runtime()
            .accounts;
        self.adapter.apply_state(self.last_state.clone());
        Ok(())
    }

    pub fn update_instance_inventory(&mut self, processes: Result<Vec<GameProcess>, String>) {
        self.instances.update(processes, std::time::Instant::now());
        self.cleanup_exited_runtime_instances();
    }

    /// Create a process-lifetime instance for a persistent account profile.
    /// IDs intentionally equal account IDs during the migration so all
    /// existing controller, login and binding APIs remain compatible.
    pub fn ensure_runtime_instance(
        &mut self,
        account_profile_id: u32,
        _is_main: Option<bool>,
        black_screen: Option<bool>,
        bg_fps: Option<u32>,
    ) -> Result<u32, InstanceUpdateError> {
        let account = self
            .runtime_config
            .accounts
            .iter()
            .find(|a| a.id == account_profile_id)
            .cloned()
            .ok_or(InstanceUpdateError::NotFound)?;
        if !account.enabled {
            return Err(InstanceUpdateError::Conflict("Account profile is disabled"));
        }
        if self
            .runtime_config
            .instances
            .iter()
            .any(|instance| instance.account_profile_id == Some(account_profile_id))
        {
            return Err(InstanceUpdateError::Conflict(
                "This account already has a running instance",
            ));
        }
        let id = account_profile_id;
        let instance = RuntimeInstance {
            id,
            account_profile_id: Some(account_profile_id),
            // Main ownership is persistent profile state. A launch request may
            // not silently replace the saved leader process.
            is_main: id == self.last_state.settings.multi_client.main_instance_id,
            black_screen: black_screen.unwrap_or(
                account.enabled && id != self.last_state.settings.multi_client.main_instance_id,
            ),
            bg_fps: bg_fps.unwrap_or(
                if id == self.last_state.settings.multi_client.main_instance_id {
                    60
                } else {
                    15
                },
            ),
        };
        if instance.is_main {
            for current in &mut self.runtime_config.instances {
                current.is_main = false;
            }
        }
        self.runtime_config.instances.push(instance);
        Ok(id)
    }

    fn cleanup_exited_runtime_instances(&mut self) {
        if self.instances.scan_error.is_some() {
            return;
        }
        let gone: Vec<u32> = self
            .runtime_config
            .instances
            .iter()
            .filter(|instance| {
                self.instances
                    .binding(instance.id)
                    .map(|identity| {
                        !self
                            .instances
                            .processes
                            .iter()
                            .any(|process| process.identity == *identity)
                    })
                    .unwrap_or(false)
            })
            .map(|instance| instance.id)
            .collect();
        for id in gone {
            self.runtime_config
                .instances
                .retain(|instance| instance.id != id);
            self.instances.unbind(id);
            self.launching_instances.remove(&id);
        }
    }

    pub fn runtime_instances(&self) -> Vec<InstanceStatus> {
        let statuses = self
            .instances
            .statuses(&self.last_state.settings.multi_client);
        self.runtime_config
            .instances
            .iter()
            .filter_map(|runtime| {
                let mut status = statuses
                    .iter()
                    .find(|s| s.instance_id == runtime.id)?
                    .clone();
                status.account_profile_id = runtime.account_profile_id;
                status.is_main = runtime.is_main;
                status.black_screen = runtime.black_screen;
                status.bg_fps = runtime.bg_fps;
                if self.launching_instances.contains(&runtime.id) && status.process.is_none() {
                    status.status = "launching".into();
                }
                Some(status)
            })
            .collect()
    }

    pub fn account_profiles(&self) -> Vec<AccountProfile> {
        self.runtime_config
            .accounts
            .iter()
            .cloned()
            .map(|mut account| {
                account.credential_ref = None;
                account
            })
            .collect()
    }

    pub fn auto_bind_unbound_instances(&mut self) {
        self.instances
            .auto_bind_unbound(&self.last_state.settings.multi_client);
        // Processes started outside the launcher are still represented as
        // runtime instances once their PID has been verified and auto-bound.
        for status in self
            .instances
            .statuses(&self.last_state.settings.multi_client)
        {
            if status.status != "bound"
                || self
                    .runtime_config
                    .instances
                    .iter()
                    .any(|instance| instance.id == status.instance_id)
            {
                continue;
            }
            let main = self.runtime_config.instances.is_empty()
                || status.instance_id == self.last_state.settings.multi_client.main_instance_id;
            self.runtime_config.instances.push(RuntimeInstance {
                id: status.instance_id,
                account_profile_id: Some(status.instance_id),
                is_main: main,
                black_screen: status.black_screen,
                bg_fps: status.bg_fps,
            });
            if main {
                for instance in &mut self.runtime_config.instances {
                    if instance.id != status.instance_id {
                        instance.is_main = false;
                    }
                }
            }
        }
    }

    pub fn instance_statuses(&self) -> Vec<InstanceStatus> {
        self.instances
            .statuses(&self.last_state.settings.multi_client)
    }

    pub fn client_profile(&self, id: u32) -> Option<ClientAccountProfile> {
        self.last_state
            .settings
            .multi_client
            .clients
            .iter()
            .find(|c| c.id == id)
            .cloned()
    }

    pub fn begin_instance_launch(
        &mut self,
        id: u32,
    ) -> Result<ClientAccountProfile, InstanceUpdateError> {
        if !self
            .runtime_config
            .instances
            .iter()
            .any(|instance| instance.id == id)
        {
            self.ensure_runtime_instance(id, None, None, None)?;
        }
        let profile = self
            .last_state
            .settings
            .multi_client
            .clients
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or(InstanceUpdateError::NotFound)?;
        if !profile.enabled {
            return Err(InstanceUpdateError::Conflict("Instance is disabled"));
        }
        if self.launching_instances.contains(&id)
            || self
                .instances
                .statuses(&self.last_state.settings.multi_client)
                .iter()
                .any(|s| s.instance_id == id && s.status == "bound")
        {
            return Err(InstanceUpdateError::Conflict(
                "Instance is already bound or launching",
            ));
        }
        self.launching_instances.insert(id);
        Ok(profile)
    }

    pub fn finish_instance_launch(&mut self, id: u32) {
        self.launching_instances.remove(&id);
        if self.instances.binding(id).is_none() {
            self.runtime_config
                .instances
                .retain(|instance| instance.id != id);
        }
    }

    pub fn login_profile(&self, id: u32) -> Result<ClientAccountProfile, InstanceUpdateError> {
        let profile = self
            .last_state
            .settings
            .multi_client
            .clients
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or(InstanceUpdateError::NotFound)?;
        if profile.flavor != ClientFlavor::Standalone {
            return Err(InstanceUpdateError::Invalid("Standalone only"));
        }
        if self.profile_store.is_none() {
            return Err(InstanceUpdateError::Unavailable(
                "Persistent profile store is required for credentials".into(),
            ));
        }
        if self.launching_instances.contains(&id) {
            return Err(InstanceUpdateError::Conflict(
                "Instance operation is in progress",
            ));
        }
        Ok(profile)
    }

    pub fn save_login_calibration(
        &mut self,
        id: u32,
        calibration: Option<LoginCalibration>,
    ) -> Result<(), InstanceUpdateError> {
        self.login_profile(id)?;
        if calibration.as_ref().is_some_and(|c| !c.valid()) {
            return Err(InstanceUpdateError::Invalid(
                "Invalid calibration geometry or version",
            ));
        }
        let mut config = self.last_state.settings.multi_client.clone();
        config
            .clients
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(InstanceUpdateError::NotFound)?
            .login_calibration = calibration;
        self.commit_profiles(config)
    }

    pub fn save_credentials(
        &mut self,
        id: u32,
        credentials: &poe2_world::credentials::Credentials,
    ) -> Result<(), InstanceUpdateError> {
        let previous = self.login_profile(id)?;
        if previous.credential_ref.is_some() {
            return Err(InstanceUpdateError::Conflict(
                "Delete saved credentials before replacing them",
            ));
        }
        let key = poe2_world::credentials::random_key()
            .map_err(|e| InstanceUpdateError::Unavailable(e.to_string()))?;
        poe2_world::credentials::write(&key, credentials)
            .map_err(|e| InstanceUpdateError::Unavailable(e.to_string()))?;
        let mut config = self.last_state.settings.multi_client.clone();
        let profile = config
            .clients
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(InstanceUpdateError::NotFound)?;
        profile.credential_ref = Some(key.clone());
        profile.has_credentials = true;
        profile.email_masked = credentials.masked_email();
        // Standalone auto-login is intentionally disabled until the input path is
        // revalidated against the current game build. Credentials may still be
        // stored securely for a future opt-in, but they can never arm automation.
        profile.auto_login = false;
        if let Err(error) = self.commit_profiles(config) {
            // Only the new randomly named credential belongs to this transaction.
            if poe2_world::credentials::delete(&key).is_err() {
                return Err(InstanceUpdateError::Unavailable("Profile save and vault rollback failed; remove the orphan POE2MultiPilot credential in Windows Credential Manager".into()));
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn clear_credentials(&mut self, id: u32) -> Result<(), InstanceUpdateError> {
        let previous = self.login_profile(id)?;
        if let Some(key) = &previous.credential_ref {
            poe2_world::credentials::delete(key)
                .map_err(|e| InstanceUpdateError::Unavailable(e.to_string()))?;
        }
        let mut config = self.last_state.settings.multi_client.clone();
        let profile = config
            .clients
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(InstanceUpdateError::NotFound)?;
        profile.credential_ref = None;
        profile.has_credentials = false;
        profile.email_masked.clear();
        profile.auto_login = false;
        // On disk failure, the old reference is harmless: the vault record is gone;
        // the next startup reconciles it. Keep in-memory truth even on that failure.
        let result = self.commit_profiles(config.clone());
        if result.is_err() {
            self.last_state.settings.multi_client = config;
            self.adapter.apply_state(self.last_state.clone());
        }
        result
    }

    pub fn reserve_login(&mut self, id: u32) -> Result<ClientAccountProfile, InstanceUpdateError> {
        let profile = self.login_profile(id)?;
        if !profile.enabled || !profile.has_credentials || profile.credential_ref.is_none() {
            return Err(InstanceUpdateError::Conflict(
                "Enable this profile and save credentials first",
            ));
        }
        self.launching_instances.insert(id);
        self.cmd_run(false);
        self.cmd_toggle("kbm", false);
        self.pending_pad_commands.clear();
        self.set_login_status(id, "waiting_for_login_screen");
        Ok(profile)
    }

    pub fn set_login_status(&mut self, id: u32, status: &str) {
        self.login_states.insert(id, status.to_owned());
    }

    pub fn cmd_bind_instance(
        &mut self,
        id: u32,
        identity: ProcessIdentity,
    ) -> Result<(), InstanceUpdateError> {
        self.instances
            .bind(&self.last_state.settings.multi_client, id, identity)?;
        self.sync_memory_target_to_main();
        Ok(())
    }

    pub fn cmd_unbind_instance(&mut self, id: u32) -> Result<(), InstanceUpdateError> {
        if !self
            .last_state
            .settings
            .multi_client
            .clients
            .iter()
            .any(|c| c.id == id)
        {
            return Err(InstanceUpdateError::NotFound);
        }
        self.instances.unbind(id);
        self.sync_memory_target_to_main();
        self.runtime_config
            .instances
            .retain(|instance| instance.id != id);
        Ok(())
    }

    pub fn bound_identity(&self, id: u32) -> Result<ProcessIdentity, InstanceUpdateError> {
        let profile = self
            .last_state
            .settings
            .multi_client
            .clients
            .iter()
            .find(|c| c.id == id)
            .ok_or(InstanceUpdateError::NotFound)?;
        if !profile.enabled {
            return Err(InstanceUpdateError::Conflict("Instance is disabled"));
        }
        self.instances
            .binding(id)
            .cloned()
            .ok_or(InstanceUpdateError::Conflict("Bind a process first"))
    }

    pub fn cmd_add_instance(&mut self) -> Result<u32, InstanceUpdateError> {
        let mut config = self.last_state.settings.multi_client.clone();
        let largest = config.clients.iter().map(|c| c.id).max().unwrap_or(0);
        let id = config.next_instance_id.max(
            largest
                .checked_add(1)
                .ok_or(InstanceUpdateError::Invalid("Instance ID limit reached"))?,
        );
        config.next_instance_id = id
            .checked_add(1)
            .ok_or(InstanceUpdateError::Invalid("Instance ID limit reached"))?;
        let mut profile = MultiClientConfig::default().clients.remove(0);
        profile.id = id;
        profile.label = format!("Instance {id}");
        profile.auto_login = false;
        if let Some(exe) = poe2_world::launcher::find_poe2_executable() {
            profile.flavor = poe2_types::ClientFlavor::Standalone;
            profile.exe_path = exe.display().to_string();
        }
        config.clients.push(profile);
        self.commit_profiles(config)?;
        Ok(id)
    }

    pub fn cmd_remove_instance(&mut self, id: u32) -> Result<(), InstanceUpdateError> {
        if self.launching_instances.contains(&id) {
            return Err(InstanceUpdateError::Conflict(
                "Instance launch is in progress",
            ));
        }
        let mut config = self.last_state.settings.multi_client.clone();
        if config.main_instance_id == id {
            return Err(InstanceUpdateError::Conflict(
                "Select another main instance before removing this profile",
            ));
        }
        let position = config
            .clients
            .iter()
            .position(|c| c.id == id)
            .ok_or(InstanceUpdateError::NotFound)?;
        if config.clients[position].credential_ref.is_some() {
            return Err(InstanceUpdateError::Conflict(
                "Delete saved credentials before removing this profile",
            ));
        }
        config.clients.remove(position);
        self.commit_profiles(config)?;
        self.instances.unbind(id); // Never terminate the game when deleting a profile.
        self.runtime_config
            .instances
            .retain(|instance| instance.id != id);
        self.login_states.remove(&id);
        Ok(())
    }

    pub fn cmd_set_main_instance(&mut self, id: u32) -> Result<(), InstanceUpdateError> {
        let mut config = self.last_state.settings.multi_client.clone();
        let profile = config
            .clients
            .iter()
            .find(|c| c.id == id)
            .ok_or(InstanceUpdateError::NotFound)?;
        if !profile.enabled {
            return Err(InstanceUpdateError::Conflict(
                "Main instance must be enabled",
            ));
        }
        config.main_instance_id = id;
        for current in &mut config.clients {
            current.input_mode = Some(if current.id == id {
                ClientInputMode::SingleWasd
            } else {
                ClientInputMode::DualController
            });
        }
        self.commit_profiles(config)?;
        for instance in &mut self.runtime_config.instances {
            instance.is_main = instance.id == id;
        }
        self.sync_memory_target_to_main();
        Ok(())
    }

    fn push_events(&mut self, new_events: Vec<BotEvent>) {
        for ev in new_events {
            self.events.push_front(ev);
        }
        while self.events.len() > EVENT_RING_SIZE {
            self.events.pop_back();
        }
    }

    /// Advance one tick (called by the tick-loop thread).
    pub fn advance(&mut self) {
        let mut state = self.adapter.snapshot();
        state.focus_slot = self.last_state.focus_slot;
        let events = FollowEngine::step(&mut state);
        self.adapter.apply_state(state.clone());
        self.last_state = state;
        self.push_events(events);
    }

    /// Advance and return a snapshot for tests and explicit callers. The main
    /// loop uses `advance` to avoid cloning the full state only to discard it.
    pub fn step(&mut self) -> WorldState {
        self.advance();
        self.last_state.clone()
    }

    pub fn set_focus_slot(&mut self, slot: u8) {
        self.last_state.focus_slot = slot;
    }

    /// Push a manual event (e.g. from an API command).
    pub fn push_event(&mut self, actor: &str, action: &str, detail: &str, important: bool) {
        // Event publication must never trigger a second memory scan. The
        // runtime already owns the authoritative completed tick.
        let tick = self.last_state.tick;
        self.events
            .push_front(BotEvent::new(tick, actor, action, detail, important));
        while self.events.len() > EVENT_RING_SIZE {
            self.events.pop_back();
        }
    }

    /// Acknowledge the controller boundary for one pickup request. The engine
    /// never treats a decision as success: only this acknowledgement arms
    /// memory-disappearance confirmation in the live adapter.
    pub fn record_pickup_input(
        &mut self,
        item_id: u64,
        actor: &str,
        item_name: &str,
        result: Result<(), String>,
    ) {
        let tick = self.last_state.tick;
        let Some(item) = self
            .last_state
            .loot
            .iter_mut()
            .find(|item| item.source_id == item_id)
        else {
            tracing::warn!(
                item_id,
                actor,
                item = item_name,
                "loot.input acknowledgement arrived after item left state"
            );
            return;
        };
        let PickupStatus::Pending {
            actor: pending_actor,
            attempts,
            requested_tick,
            ..
        } = &item.pickup
        else {
            tracing::warn!(item_id, actor, item = item_name, state = ?item.pickup, "loot.input acknowledgement ignored for non-pending item");
            return;
        };
        let attempts = *attempts;
        let requested_tick = *requested_tick;
        let pending_actor = pending_actor.clone();
        match result {
            Ok(()) => {
                item.pickup = PickupStatus::Pending {
                    actor: pending_actor,
                    attempts,
                    requested_tick,
                    input_sent: true,
                };
                tracing::info!(
                    tick,
                    item_id,
                    actor,
                    item = item_name,
                    attempts,
                    "loot.input acknowledged; waiting for memory confirmation"
                );
                self.push_event(actor, "PICKUP_INPUT_SENT", item_name, false);
            }
            Err(reason) => {
                item.pickup = PickupStatus::Failed {
                    attempts,
                    retry_after_tick: tick.saturating_add(3),
                    reason: reason.clone(),
                };
                tracing::warn!(tick, item_id, actor, item = item_name, attempts, %reason, "loot.input failed; bounded retry scheduled");
                self.push_event(
                    actor,
                    "PICKUP_INPUT_FAILED",
                    &format!("{item_name}: {reason}"),
                    true,
                );
            }
        }
        self.adapter.apply_state(self.last_state.clone());
    }

    // ── Command handlers ──────────────────────────────────────────────────────

    pub fn cmd_run(&mut self, value: bool) {
        if value && poe2_world::login::is_active() {
            return;
        }
        if value && self.last_state.memory_reader.state != "compatible" {
            let detail = self.last_state.memory_reader.message.clone();
            self.push_event("SYSTEM", "MEMORY_READER_BLOCKED", &detail, true);
            return;
        }
        let mut state = self.adapter.snapshot();
        state.running = value;
        self.adapter.apply_state(state.clone());
        self.last_state = state;
        let label = if value { "START_RUN" } else { "PAUSE_RUN" };
        self.push_event("SYSTEM", label, "api command", false);
    }

    pub fn cmd_move(&mut self, dx: f32, dy: f32) {
        self.adapter.move_leader(dx, dy);
        self.push_event("MAIN", "ROUTE_STEP", "api command", false);
    }

    pub fn cmd_toggle(&mut self, key: &str, value: bool) {
        if key == "kbm" && value && poe2_world::login::is_active() {
            return;
        }
        let mut state = self.adapter.snapshot();
        match key {
            // General
            "follow" => state.settings.follow = value,
            "catchup" => state.settings.catchup = value,
            "loot" => {
                state.settings.loot = value;
                state.settings.pickup.enabled = value;
            }
            "combat" => state.settings.combat = value,
            "kbm" => state.settings.kbm_bridge = value,

            // Smart Follow
            "follow_prioritize" => state.config.prioritize_catchup = value,
            "follow_classic_roll" => state.config.classic_roll_sprint = value,
            "follow_mirror_attack" => state.config.mirror_attack_dir = false,
            "auto_revive" => state.settings.auto_revive = value,

            // Auto Flasks
            "flask_life" => state.settings.flask.life_enabled = value,
            "flask_mana" => state.settings.flask.mana_enabled = value,
            "flask_avoid_waste" => state.settings.flask.avoid_waste_recovery = value,
            "flask_recoverable" => state.settings.flask.use_recoverable_life = value,
            "flask_low_life" => state.settings.flask.low_life_build = value,
            "flask_ignore_res" => state.settings.flask.ignore_reserved_mana = value,
            "flask_no_mana" => state.settings.flask.build_no_mana = value,

            // Auto Pickup
            "pickup_autorun" => state.settings.pickup.auto_run_to_loot = value,
            "pickup_vacuum" => state.settings.pickup.vacuum_pickup = value,
            "pickup_curr_top" => state.settings.pickup.currency_top_tier = value,
            "pickup_curr_high" => state.settings.pickup.currency_high_tier = value,
            "pickup_curr_reg" => state.settings.pickup.currency_regular = value,
            "pickup_shards" => state.settings.pickup.currency_shards = value,
            "pickup_gold" => state.settings.pickup.gold = value,
            "pickup_waystones" => state.settings.pickup.waystones = value,
            "pickup_gems" => state.settings.pickup.gems = value,
            "pickup_uniques" => state.settings.pickup.uniques = value,
            "pickup_only_allocated" => state.settings.pickup.only_allocated_to_bot = value,
            "pickup_bases" => state.settings.pickup.exceptional_bases = value,
            "pickup_pause_sprint" => state.settings.pickup.pause_on_sprint = value,

            // Stash
            "stash_enabled" => state.settings.stash.enabled = value,

            // Auto Party
            "party_enabled" => state.settings.party.enabled = value,

            // Party Combat
            "party_combat_enabled" => state.settings.party_combat.enabled = value,

            // Waystones Crafting
            "waystones_id" => state.settings.waystones.auto_id = value,
            "waystones_alch" => state.settings.waystones.auto_alch = value,
            "waystones_exalt" => state.settings.waystones.finish_exalted = value,
            "waystones_stash" => state.settings.waystones.auto_stash_maps = value,

            // Shared Controls
            "sync_dodge" => state.settings.shared_ctrl.sync_dodge = false,
            "share_attack_dir" => state.settings.shared_ctrl.share_attack_dir = false,
            "approach_delay" => state.settings.shared_ctrl.approach_delay = value,

            // Timed Actions
            "timed_1" => {
                if let Some(a) = state.settings.timed_actions.get_mut(0) {
                    a.enabled = value;
                }
            }
            "timed_2" => {
                if let Some(a) = state.settings.timed_actions.get_mut(1) {
                    a.enabled = value;
                }
            }
            // Graphics preferences are updated by instance ID only (no INI writes).

            // Multi-Client Manager
            "client_couch_pair" => state.settings.multi_client.auto_pair_couch = value,
            "client_single_folder" => state.settings.multi_client.use_single_folder = value,
            "client1_enabled" | "client2_enabled" | "client3_enabled" => {
                // Compatibility for old enable toggles: ID, never vector position.
                let id = match key {
                    "client1_enabled" => 1,
                    "client2_enabled" => 2,
                    _ => 3,
                };
                if let Some(c) = state
                    .settings
                    .multi_client
                    .clients
                    .iter_mut()
                    .find(|c| c.id == id)
                {
                    c.enabled = value;
                }
            }

            // Mouse & Key Mappings
            "mouse_right_as_a" => state.settings.mouse_bindings.right_click_as_a = value,
            "mouse_right_broadcast" => state.settings.mouse_bindings.right_click_broadcast = value,
            "mouse_key_a_as_right" => state.settings.mouse_bindings.key_a_as_right_click = value,

            _ => return,
        }
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        let label = format!(
            "{}_{}",
            key.to_uppercase(),
            if value { "ON" } else { "OFF" }
        );
        self.push_event("SYSTEM", &label, "api command", false);
    }

    pub fn cmd_set_mouse_action(&mut self, button: &str, action: &str) {
        let mut state = self.adapter.snapshot();
        match button {
            "mouse_4" => state.settings.mouse_bindings.mouse_4_action = action.to_owned(),
            "mouse_5" => state.settings.mouse_bindings.mouse_5_action = action.to_owned(),
            "middle" => state.settings.mouse_bindings.middle_click_action = action.to_owned(),
            _ => return,
        }
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "SYSTEM",
            "SET_MOUSE_ACTION",
            &format!("{button} -> {action}"),
            false,
        );
    }

    pub fn cmd_set_controller_key(&mut self, button: &str, key: &str) {
        let mut state = self.adapter.snapshot();
        let key_trimmed = key.trim();
        // If assigning a non-empty key, clear any other button that had this key to avoid duplicate hotkeys
        if !key_trimmed.is_empty() {
            let cm = &mut state.settings.controller_mapping;
            let clear_if_match = |field: &mut String, btn_name: &str| {
                if btn_name != button && field.eq_ignore_ascii_case(key_trimmed) {
                    field.clear();
                }
            };
            clear_if_match(&mut cm.move_up, "move_up");
            clear_if_match(&mut cm.move_down, "move_down");
            clear_if_match(&mut cm.move_left, "move_left");
            clear_if_match(&mut cm.move_right, "move_right");
            clear_if_match(&mut cm.button_a, "button_a");
            clear_if_match(&mut cm.button_b, "button_b");
            clear_if_match(&mut cm.button_x, "button_x");
            clear_if_match(&mut cm.button_y, "button_y");
            clear_if_match(&mut cm.button_lb, "button_lb");
            clear_if_match(&mut cm.button_rb, "button_rb");
            clear_if_match(&mut cm.button_lt, "button_lt");
            clear_if_match(&mut cm.button_rt, "button_rt");
            clear_if_match(&mut cm.dpad_left, "dpad_left");
            clear_if_match(&mut cm.dpad_right, "dpad_right");
            clear_if_match(&mut cm.dpad_up, "dpad_up");
            clear_if_match(&mut cm.dpad_down, "dpad_down");
            clear_if_match(&mut cm.button_start, "button_start");
            clear_if_match(&mut cm.button_back, "button_back");
        }

        match button {
            "move_up" => state.settings.controller_mapping.move_up = key.to_owned(),
            "move_down" => state.settings.controller_mapping.move_down = key.to_owned(),
            "move_left" => state.settings.controller_mapping.move_left = key.to_owned(),
            "move_right" => state.settings.controller_mapping.move_right = key.to_owned(),
            "button_a" => state.settings.controller_mapping.button_a = key.to_owned(),
            "button_b" => state.settings.controller_mapping.button_b = key.to_owned(),
            "button_x" => state.settings.controller_mapping.button_x = key.to_owned(),
            "button_y" => state.settings.controller_mapping.button_y = key.to_owned(),
            "button_lb" => state.settings.controller_mapping.button_lb = key.to_owned(),
            "button_rb" => state.settings.controller_mapping.button_rb = key.to_owned(),
            "button_lt" => state.settings.controller_mapping.button_lt = key.to_owned(),
            "button_rt" => state.settings.controller_mapping.button_rt = key.to_owned(),
            "dpad_left" => state.settings.controller_mapping.dpad_left = key.to_owned(),
            "dpad_right" => state.settings.controller_mapping.dpad_right = key.to_owned(),
            "dpad_up" => state.settings.controller_mapping.dpad_up = key.to_owned(),
            "dpad_down" => state.settings.controller_mapping.dpad_down = key.to_owned(),
            "button_start" => state.settings.controller_mapping.button_start = key.to_owned(),
            "button_back" => state.settings.controller_mapping.button_back = key.to_owned(),
            _ => return,
        }
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "SYSTEM",
            "SET_CONTROLLER_KEY",
            &format!("{button} -> {key}"),
            false,
        );
    }

    pub fn cmd_update_poe_smoother(&mut self, config: poe2_types::PoeSmootherConfig) {
        let mut state = self.adapter.snapshot();
        state.settings.poe_smoother = config;
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "SYSTEM",
            "UPDATE_POE_SMOOTHER",
            "Updated PoeSmoother 2 config",
            false,
        );
    }

    pub fn cmd_update_waystone_colors(&mut self, config: poe2_types::WaystoneColorConfig) {
        let mut state = self.adapter.snapshot();
        // The current UI only edits the deadly-mod toggle and sends an empty
        // catalog. Preserve the existing catalog instead of erasing it.
        let mut config = config;
        if config.mods.is_empty() {
            config.mods = state.settings.waystone_colors.mods.clone();
        }
        state.settings.waystone_colors = config;
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "SYSTEM",
            "UPDATE_WAYSTONE_COLORS",
            "Updated Waystone color highlights",
            false,
        );
    }

    pub fn cmd_update_expedition(&mut self, config: poe2_types::ExpeditionConfig) {
        let mut state = self.adapter.snapshot();
        state.settings.expedition = config;
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "EXPEDITION",
            "CONFIG_UPDATED",
            "Updated Expedition Radar config",
            false,
        );
    }

    pub fn cmd_set_smoother_zoom(&mut self, scale: f32) {
        let mut state = self.adapter.snapshot();
        state.settings.poe_smoother.zoom_scale = scale.clamp(1.0, 3.0);
        state.settings.poe_smoother.zoom_enabled = true;
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "SYSTEM",
            "SET_SMOOTHER_ZOOM",
            &format!("Camera Zoom: {scale:.2}x"),
            false,
        );
    }

    pub fn cmd_toggle_client_bot(&mut self, id: u32) -> bool {
        let mut state = self.adapter.snapshot();
        let mut new_enabled = true;
        if let Some(c) = state
            .settings
            .multi_client
            .clients
            .iter_mut()
            .find(|c| c.id == id)
        {
            c.enabled = !c.enabled;
            new_enabled = c.enabled;
        }
        let any_enabled = state
            .settings
            .multi_client
            .clients
            .iter()
            .any(|c| c.enabled);
        if !any_enabled {
            state.running = false;
        } else if new_enabled {
            state.running = true;
        }
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
        self.push_event(
            "INSTANCE",
            if new_enabled {
                "BOT_STARTED"
            } else {
                "BOT_PAUSED"
            },
            &format!("Client #{id}"),
            true,
        );
        new_enabled
    }

    pub fn cmd_update_instance(
        &mut self,
        id: u32,
        patch: InstancePatch,
    ) -> Result<(), InstanceUpdateError> {
        if patch.auto_login == Some(true) {
            return Err(InstanceUpdateError::Unavailable(
                "Standalone auto-login đang tạm thời bị vô hiệu hóa".into(),
            ));
        }
        if self.launching_instances.contains(&id) {
            return Err(InstanceUpdateError::Conflict(
                "Instance launch is in progress",
            ));
        }
        let mut config = self.last_state.settings.multi_client.clone();
        let previous = config
            .clients
            .iter()
            .find(|c| c.id == id)
            .cloned()
            .ok_or(InstanceUpdateError::NotFound)?;
        config.update_instance(id, patch)?;
        let current = config
            .clients
            .iter()
            .find(|c| c.id == id)
            .ok_or(InstanceUpdateError::NotFound)?;
        let unbind = !current.enabled
            || current.flavor != previous.flavor
            || !current.exe_path.eq_ignore_ascii_case(&previous.exe_path);
        if previous.credential_ref.is_some()
            && (current.flavor != previous.flavor
                || !current.exe_path.eq_ignore_ascii_case(&previous.exe_path))
        {
            return Err(InstanceUpdateError::Conflict(
                "Delete saved credentials before changing platform or executable",
            ));
        }
        if current.flavor != previous.flavor
            || !current.exe_path.eq_ignore_ascii_case(&previous.exe_path)
        {
            config
                .clients
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or(InstanceUpdateError::NotFound)?
                .login_calibration = None;
        }
        self.commit_profiles(config)?;
        let main_id = self.last_state.settings.multi_client.main_instance_id;
        for instance in &mut self.runtime_config.instances {
            instance.is_main = instance.id == main_id;
        }
        self.sync_memory_target_to_main();
        if let Some(runtime) = self
            .runtime_config
            .instances
            .iter_mut()
            .find(|instance| instance.id == id)
        {
            let profile = &self.last_state.settings.multi_client.clients;
            if let Some(updated) = profile.iter().find(|p| p.id == id) {
                runtime.black_screen = updated.black_screen;
                runtime.bg_fps = updated.bg_fps;
            }
        }
        if unbind {
            self.instances.unbind(id);
        }
        self.push_event(
            "INSTANCE",
            "PROFILE_UPDATED",
            &format!("Instance {id}: profile updated; graphics not applied"),
            false,
        );
        Ok(())
    }

    pub fn cmd_trigger_stash_sweep(&mut self) {
        self.pending_pad_commands.push(PadCommand {
            target: "MACRO".into(),
            button: "STASH_SWEEP".into(),
            dx: 0.0,
            dy: 0.0,
        });
        self.push_event(
            "MACRO",
            "AUTO_STASH",
            "Triggered 60-slot Ctrl+Click inventory sweep to Stash",
            true,
        );
    }

    pub fn cmd_set_param(&mut self, key: &str, value: f32) {
        let mut state = self.adapter.snapshot();
        match key {
            "stop_dist" => state.config.stop_distance = value,
            "sprint_dist" => state.config.catch_up_distance = value,
            "warp_dist" => state.config.warp_distance = value,
            "tick_ms" => state.config.tick_ms = value as u64,
            "pickup_radius" => state.settings.pickup.pickup_radius = value,
            "pickup_currency_tier" => state.settings.pickup.currency_tier = value as u8,
            "life_hp_pct" => state.settings.flask.life_hp_pct = value as u8,
            "mana_mp_pct" => state.settings.flask.mana_mp_pct = value as u8,
            "life_cd_ms" => state.settings.flask.life_cooldown_ms = value as u64,
            "mana_cd_ms" => state.settings.flask.mana_cooldown_ms = value as u64,

            _ => return,
        }
        self.adapter.apply_state(state.clone());
        self.persist_runtime_settings(&state);
        self.last_state = state;
    }

    pub fn cmd_reset_tracker(&mut self) {
        let mut state = self.adapter.snapshot();
        state.settings.tracker = poe2_types::CurrencyTrackerSession::default();
        self.adapter.apply_state(state.clone());
        self.last_state = state;
        self.push_event(
            "TRACKER",
            "SESSION_RESET",
            "Reset currency statistics",
            true,
        );
    }

    pub fn cmd_spawn_loot(&mut self) {
        self.adapter.spawn_loot();
        self.last_state = self.adapter.snapshot();
        self.push_event("WORLD", "LOOT_SPAWNED", "api command", false);
    }

    pub fn cmd_spawn_threat(&mut self) {
        self.adapter.spawn_threat();
        self.last_state = self.adapter.snapshot();
        self.push_event("WORLD", "THREAT_SPAWNED", "api command", false);
    }

    pub fn cmd_reset(&mut self) {
        let profiles = self.last_state.settings.multi_client.clone();
        self.adapter.reset();
        self.last_state = self.adapter.snapshot();
        self.last_state.settings.multi_client = profiles;
        self.adapter.apply_state(self.last_state.clone());
        self.persist_runtime_settings(&self.last_state);
        self.events.clear();
        self.push_event("SYSTEM", "RESET", "api command", false);
    }

    pub fn cmd_join_p2(&mut self) {
        self.pending_pad_commands.push(PadCommand {
            target: "P1".into(),
            button: "JOIN".into(),
            dx: 0.0,
            dy: 0.0,
        });
        self.pending_pad_commands.push(PadCommand {
            target: "P2".into(),
            button: "JOIN".into(),
            dx: 0.0,
            dy: 0.0,
        });
        self.push_event(
            "PARTY",
            "JOIN_COOP",
            "Holding [A]+[START] for 2.5s on all Virtual Pads",
            true,
        );
    }

    pub fn cmd_pulse_pad(&mut self, target: &str, button: &str) {
        self.pending_pad_commands.push(PadCommand {
            target: target.into(),
            button: button.into(),
            dx: 0.0,
            dy: 0.0,
        });
        let detail = format!("Pressed [{button}]");
        self.push_event(target, "BUTTON_PRESS", &detail, false);
    }

    pub fn cmd_test_stick(&mut self, target: &str, dx: f32, dy: f32) {
        self.pending_pad_commands.push(PadCommand {
            target: target.into(),
            button: String::new(),
            dx,
            dy,
        });
        let detail = format!("dx={dx:.1} dy={dy:.1}");
        self.push_event(target, "STICK_DEFLECT", &detail, false);
    }

    pub fn cmd_broadcast_interact_a(&mut self) {
        self.pending_pad_commands.push(PadCommand {
            target: "ALL".into(),
            button: "BROADCAST_A".into(),
            dx: 0.0,
            dy: 0.0,
        });
        self.push_event(
            "ALL",
            "Broadcast (A)",
            "Đồng loạt tương tác / vào portal / hồi sinh cả 6 nhân vật",
            true,
        );
    }

    pub fn cmd_set_focus_slot(&mut self, slot: u8) {
        self.pending_pad_commands.push(PadCommand {
            target: "FOCUS".into(),
            button: slot.to_string(),
            dx: 0.0,
            dy: 0.0,
        });
        self.push_event(
            "KBM",
            "Focus Switch",
            &format!(
                "Chuyển tiêu điểm điều khiển bàn phím sang Char {}",
                slot + 1
            ),
            true,
        );
    }

    pub fn drain_pad_commands(&mut self) -> Vec<PadCommand> {
        std::mem::take(&mut self.pending_pad_commands)
    }

    // ── Snapshot for API ─────────────────────────────────────────────────────

    pub fn to_api_snapshot(&self) -> ApiSnapshot {
        let s = &self.last_state;
        let mut settings = s.settings.clone();
        for profile in &mut settings.multi_client.clients {
            profile.credential_ref = None;
        }
        ApiSnapshot {
            instance_services: InstanceServicesSnapshot {
                login_states: self.login_states.clone(),
                profiles_persistent: self.profile_store.is_some(),
                profile_path: self.profile_store.as_ref().map(|store| store.path().display().to_string()),
                scan_error: self.instances.scan_error.clone(),
                processes: self.instances.processes.clone(),
                instances: self.instances.statuses(&s.settings.multi_client),
                runtime_instances: self.runtime_instances(),
                account_profiles: self.account_profiles(),
                per_process_graphics: true,
                graphics_reason: "Hệ thống Tối ưu Đồ họa (Smoother) đang hoạt động: INI FPS, Màn đen DWM, EcoQoS & Priority.".into(),
                controllers: poe2_world::controllers::inventory(),
            },
            tick: s.tick,
            running: s.running,
            leader: s.leader.clone(),
            followers: s.followers.clone(),
            loot: s.loot.clone(),
            threats: s.threats.clone(),
            loot_paused: s.loot_paused,
            settings,
            config: s.config.clone(),
            area_name_hint: s.area_name_hint.clone(),
            client: s.client.clone(),
            memory_reader: s.memory_reader.clone(),
            telemetry: s.telemetry.clone(),
            focus_slot: s.focus_slot,
            events: self.events.iter().cloned().collect(),
        }
    }
}

// ─── API shape ────────────────────────────────────────────────────────────────

/// JSON shape returned by GET /api/state
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiSnapshot {
    #[serde(default)]
    pub instance_services: InstanceServicesSnapshot,
    pub tick: u64,
    pub running: bool,
    pub leader: Actor,
    pub followers: Vec<Actor>,
    pub loot: Vec<WorldItem>,
    pub threats: Vec<Threat>,
    pub loot_paused: bool,
    pub settings: BotSettings,
    pub config: FollowConfig,
    pub area_name_hint: String,
    pub client: ClientStatus,
    #[serde(default)]
    pub memory_reader: MemoryReaderStatus,
    #[serde(default)]
    pub telemetry: Vec<ClientTelemetry>,
    #[serde(default)]
    pub focus_slot: u8,
    pub events: Vec<BotEvent>,
}
