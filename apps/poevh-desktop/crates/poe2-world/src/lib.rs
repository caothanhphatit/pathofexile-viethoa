//! World adapter abstraction + mock implementation + client connector.

pub mod connector;
pub mod controllers;
pub mod credentials;
pub mod expedition;
pub mod ggpk_patcher;
pub mod instances;
pub mod launcher;
pub mod login;
pub mod smoother;
pub mod trade;

pub use connector::{
    get_last_logged_zone, is_leveling_overlay_visible, set_leveling_overlay_visible,
    toggle_leveling_overlay_visible, Poe2Connector,
};
pub use expedition::{
    dismiss_session, latest_snapshot as latest_expedition_snapshot,
    publish_error as publish_expedition_error, publish_snapshot as publish_expedition_snapshot,
    reward_price_or_queue, ExpeditionCatalog, ExpeditionRecipe,
};
pub use ggpk_patcher::{
    apply_ggpk_patches, get_patch_status, probe_ggpk_compatibility, restore_all_backups,
    GgpkCompatibilityReport, GgpkPatchOptions, GgpkPatchStatus,
};
pub use launcher::{find_poe2_executable, launch_poe2_client};
pub use smoother::{
    apply_fps_limits, apply_low_spec_policy, apply_process_tuning, apply_window_cloaking,
    backup_config, find_default_config_path, restore_config,
};
pub use trade::{
    check_item_from_clipboard, clear_capture as clear_trade_capture, estimate_item_price,
    latest_capture, list_leagues, parse_poe2_item, publish_capture, publish_capture_error,
    read_clipboard_text, search_market, spawn_hotkey_listener,
};

use poe2_types::*;

// ─── Trait ────────────────────────────────────────────────────────────────────

pub trait WorldAdapter: Send + Sync {
    /// Select the exact game process that owns leader telemetry. Adapters that
    /// do not read a live process may ignore this.
    fn set_target_process(&mut self, _pid: Option<u32>) {}
    fn snapshot(&self) -> WorldState;
    fn move_leader(&mut self, dx: f32, dy: f32);
    fn spawn_loot(&mut self);
    fn spawn_threat(&mut self);
    fn apply_state(&mut self, state: WorldState);
    fn reset(&mut self);
}

// ─── Mock implementation with live connector ──────────────────────────────────

/// Synthetic world provider with live POE2 client detection.
pub struct MockWorldAdapter {
    state: WorldState,
}

impl Default for MockWorldAdapter {
    fn default() -> Self {
        connector::ensure_log_watcher_started();
        let area_hint = get_last_logged_zone();
        let state = WorldState {
            area_name_hint: area_hint,
            memory_reader: MemoryReaderStatus::compatible("mock"),
            ..Default::default()
        };
        Self { state }
    }
}

impl MockWorldAdapter {
    pub fn new() -> Self {
        Self::default()
    }
}

impl WorldAdapter for MockWorldAdapter {
    fn snapshot(&self) -> WorldState {
        let mut s = self.state.clone();
        let area = get_last_logged_zone();
        if !area.is_empty() && area != "Unknown" {
            s.area_name_hint = area.clone();
            s.leader.area = area.clone();
            for f in &mut s.followers {
                f.area = area.clone();
            }
        }

        // A single detected game cannot establish connections for every profile.
        // Keep identity dynamic and report unbound until per-PID attachment exists.
        s.telemetry = s
            .settings
            .multi_client
            .clients
            .iter()
            .map(|instance| ClientTelemetry {
                client_id: instance.id,
                name: instance.label.clone(),
                active: instance.enabled,
                connected: false,
                metrics_available: false,
                cpu_pct: 0.0,
                ram_mb: 0,
                fps: 0,
                render_mode: "Unbound; graphics not applied".into(),
            })
            .collect();
        s
    }

    fn move_leader(&mut self, dx: f32, dy: f32) {
        let s = &mut self.state;
        s.leader.pos.x = (s.leader.pos.x + dx).clamp(80.0, 820.0);
        s.leader.pos.y = (s.leader.pos.y + dy).clamp(70.0, 430.0);
    }

    fn spawn_loot(&mut self) {
        let s = &mut self.state;
        let pos = Vec2::new(s.leader.pos.x + 35.0, s.leader.pos.y + 12.0);
        s.loot.push(WorldItem {
            source_id: s.tick.saturating_add(s.loot.len() as u64 + 1),
            name: "Currency Cache".into(),
            pos,
            value: 12,
            rarity: None,
            identified: None,
            pickup: PickupStatus::default(),
            picked_by: None,
        });
    }

    fn spawn_threat(&mut self) {
        let s = &mut self.state;
        let pos = Vec2::new(s.leader.pos.x + 100.0, s.leader.pos.y - 55.0);
        s.threats.push(Threat {
            pos,
            level: ThreatLevel::Rare,
        });
    }

    fn apply_state(&mut self, state: WorldState) {
        self.state = state;
    }

    fn reset(&mut self) {
        self.state = WorldState::default();
    }
}
