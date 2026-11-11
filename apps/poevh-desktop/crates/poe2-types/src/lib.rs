//! Core domain types for the POE2 party-follow bot.
//!
//! Clean-room implementation of a generic party-follow decision model.
//! No game process, memory, or input API is referenced here.

use serde::{Deserialize, Serialize};
mod instances;
pub use instances::*;
mod login;
pub use login::*;
pub mod trade;
pub use trade::*;
pub mod expedition;
pub use expedition::*;
pub mod premium;
pub mod profiles;
pub use premium::*;
pub use profiles::*;

// ─── Geometry ────────────────────────────────────────────────────────────────

/// 2-D world position (game units).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub fn distance_to(self, other: Self) -> f32 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }

    /// Move `self` toward `target` by at most `step` units.
    pub fn move_toward(self, target: Self, step: f32) -> Self {
        let dx = target.x - self.x;
        let dy = target.y - self.y;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist <= step || dist == 0.0 {
            return target;
        }
        let ratio = step / dist;
        Self {
            x: self.x + dx * ratio,
            y: self.y + dy * ratio,
        }
    }
}

// ─── Actors ──────────────────────────────────────────────────────────────────

/// A player character in the world (leader or follower).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    pub name: String,
    pub pos: Vec2,
    pub hp: u8,   // 0-100
    pub mana: u8, // 0-100
    pub area: String,
    pub action: FollowerAction,
    /// Short-lived steering waypoint produced by the live navigation layer.
    /// It is intentionally absent in mock/saved data and never persisted as a
    /// route: a fresh memory snapshot must validate it against current terrain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub navigation_target: Option<Vec2>,
}

impl Actor {
    pub fn new(name: impl Into<String>, x: f32, y: f32) -> Self {
        Self {
            name: name.into(),
            pos: Vec2::new(x, y),
            hp: 100,
            mana: 100,
            area: "Ashen Yard".into(),
            action: FollowerAction::Hold,
            navigation_target: None,
        }
    }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/// Decision the engine makes for a follower each tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail")]
pub enum FollowerAction {
    Hold,
    FollowRoute,
    SprintCatchUp,
    WarpToMain,
    RunToLoot {
        item_id: u64,
        item: String,
        target: Vec2,
    },
    AutoLoot {
        item_id: u64,
        item: String,
        button: String,
    },
    ManualControl,
    ReviveLeader,
}

impl std::fmt::Display for FollowerAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Hold => write!(f, "HOLD"),
            Self::FollowRoute => write!(f, "FOLLOW_ROUTE"),
            Self::SprintCatchUp => write!(f, "SPRINT_CATCH_UP"),
            Self::WarpToMain => write!(f, "WARP_TO_MAIN"),
            Self::RunToLoot { item, .. } => write!(f, "RUN_TO_LOOT({item})"),
            Self::AutoLoot { item, .. } => write!(f, "AUTO_LOOT({item})"),
            Self::ManualControl => write!(f, "MANUAL"),
            Self::ReviveLeader => write!(f, "REVIVE_LEADER"),
        }
    }
}

// ─── World items / threats ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldItem {
    /// Stable std::map entity id for the lifetime of the current area.
    #[serde(default)]
    pub source_id: u64,
    pub name: String,
    pub pos: Vec2,
    pub value: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rarity: Option<ItemRarity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identified: Option<bool>,
    #[serde(default)]
    pub pickup: PickupStatus,
    /// Compatibility view for existing UI consumers. Set only after a pickup
    /// is confirmed, never when an input is merely requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picked_by: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemRarity {
    Normal,
    Magic,
    Rare,
    Unique,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PickupStatus {
    Available {
        attempts: u8,
    },
    Pending {
        actor: String,
        attempts: u8,
        requested_tick: u64,
        input_sent: bool,
    },
    Failed {
        attempts: u8,
        retry_after_tick: u64,
        reason: String,
    },
}

impl Default for PickupStatus {
    fn default() -> Self {
        Self::Available { attempts: 0 }
    }
}

impl PickupStatus {
    pub fn attempts(&self) -> u8 {
        match self {
            Self::Available { attempts }
            | Self::Pending { attempts, .. }
            | Self::Failed { attempts, .. } => *attempts,
        }
    }

    pub fn can_attempt(&self, tick: u64, max_attempts: u8) -> bool {
        match self {
            Self::Available { attempts } => *attempts < max_attempts,
            Self::Failed {
                attempts,
                retry_after_tick,
                ..
            } => *attempts < max_attempts && tick >= *retry_after_tick,
            Self::Pending { .. } => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Threat {
    pub pos: Vec2,
    pub level: ThreatLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThreatLevel {
    Magic,
    Rare,
    Unique,
}

// ─── MultiPilot Lite Configurations ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFlaskConfig {
    pub life_enabled: bool,
    pub life_hp_pct: u8,
    pub life_cooldown_ms: u64,
    pub avoid_waste_recovery: bool,
    pub use_recoverable_life: bool,
    pub low_life_build: bool,
    pub mana_enabled: bool,
    pub mana_mp_pct: u8,
    pub mana_cooldown_ms: u64,
    pub ignore_reserved_mana: bool,
    pub build_no_mana: bool,
}

impl Default for SmartFlaskConfig {
    fn default() -> Self {
        Self {
            life_enabled: true,
            life_hp_pct: 70,
            life_cooldown_ms: 200,
            avoid_waste_recovery: true,
            use_recoverable_life: true,
            low_life_build: false,
            mana_enabled: true,
            mana_mp_pct: 45,
            mana_cooldown_ms: 800,
            ignore_reserved_mana: true,
            build_no_mana: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoPickupConfig {
    pub enabled: bool,
    pub button: String, // "A"
    pub auto_run_to_loot: bool,
    pub vacuum_pickup: bool,
    pub pickup_radius: f32,
    pub currency_tier: u8, // 1 = Top (Divine/Mirror), 2 = High+ (Chaos+), 3 = All Currency, 0 = Off
    pub only_allocated_to_bot: bool, // Chỉ nhặt đồ được chia của Bot
    pub currency_top_tier: bool, // Divine, Mirror, Perfect Jewellers
    pub currency_high_tier: bool, // Chaos, Exalted, Regal, Vaal, Prism
    pub currency_regular: bool, // Alchemy, Chance, Alteration, Artificer
    pub currency_shards: bool, // All Shards & Fragments
    pub gold: bool,        // Gold Piles
    pub waystones: bool,   // Waystones (Maps T1-T16)
    pub gems: bool,        // Skill & Support Gems
    pub uniques: bool,     // Unique items
    pub exceptional_bases: bool, // Exceptional item bases
    pub pause_on_sprint: bool, // Pause loot during sprint catch-up
}

impl Default for AutoPickupConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            button: "A".into(),
            auto_run_to_loot: true,
            vacuum_pickup: false,
            pickup_radius: 22.0,
            currency_tier: 3, // 3 = Mặc định nhặt full toàn bộ Currency
            only_allocated_to_bot: false,
            currency_top_tier: true,
            currency_high_tier: true,
            currency_regular: true,
            currency_shards: true,
            gold: true,
            waystones: true,
            gems: true,
            uniques: true,
            exceptional_bases: false,
            pause_on_sprint: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrencyTrackerSession {
    /// Millisecond accumulator used to keep session time correct when the
    /// configurable engine tick is not exactly 200 ms.
    #[serde(default)]
    pub session_elapsed_ms: u64,
    pub session_seconds: u64,
    pub total_div_estimate: f32,
    pub div_per_hour: f32,
    pub div_count: u32,
    pub exalt_count: u32,
    pub chaos_count: u32,
    pub gold_count: u32,
    pub items_picked: u32,
}

impl Default for CurrencyTrackerSession {
    fn default() -> Self {
        Self {
            session_elapsed_ms: 0,
            session_seconds: 0,
            total_div_estimate: 0.0,
            div_per_hour: 0.0,
            div_count: 0,
            exalt_count: 0,
            chaos_count: 0,
            gold_count: 0,
            items_picked: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoStashConfig {
    pub enabled: bool,
    pub tab_name: String,
    pub hotkey: String,
}

impl Default for AutoStashConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            tab_name: "G1".into(),
            hotkey: "F9".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoPartyConfig {
    pub enabled: bool,
    pub p1_name: String,
    pub run_cancel_key: String, // "F8"
}

impl Default for AutoPartyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            p1_name: "".into(),
            run_cancel_key: "F8".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartyCombatConfig {
    pub enabled: bool,
    pub mode: String,            // "Mapping"
    pub p2_role: String,         // "Companion DPS", "Support", "Defence"
    pub engage_distance: String, // "Normal"
    pub combo_tempo: String,     // "Natural"
}

impl Default for PartyCombatConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: "Mapping".into(),
            p2_role: "Companion DPS".into(),
            engage_distance: "Normal".into(),
            combo_tempo: "Natural".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaystoneCraftConfig {
    /// Master switch for the crafting routine. Older settings files predate
    /// this field, so it defaults to off rather than silently enabling input.
    #[serde(default)]
    pub enabled: bool,
    pub auto_id: bool,         // Auto ID with Scroll
    pub auto_alch: bool,       // Auto Alchemy white/magic
    pub finish_exalted: bool,  // Exalted to 6 mods
    pub auto_stash_maps: bool, // Auto stash processed maps
}

impl Default for WaystoneCraftConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_id: true,
            auto_alch: true,
            finish_exalted: false,
            auto_stash_maps: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedControlsConfig {
    pub sync_dodge: bool,
    pub share_attack_dir: bool,
    pub approach_delay: bool,
    pub approach_time_ms: u64,
}

impl Default for SharedControlsConfig {
    fn default() -> Self {
        Self {
            sync_dodge: false, // Follower chạy bộ bám đuôi gọn gàng, chỉ Leader tự do lăn né
            share_attack_dir: false,
            approach_delay: false,
            approach_time_ms: 250,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimedActionItem {
    pub id: String,
    pub input_button: String,  // "D-pad Up", "Y", "RB"
    pub target_player: String, // "Both", "P2", "P1"
    pub cooldown_ms: u64,
    pub only_in_combat: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientSmootherConfig {
    pub enabled: bool,
    pub black_screen: bool,
    pub background_fps_limit: u32,
    pub no_particles_fog: bool,
    pub mute_monster_skills: bool,
    pub camera_zoom_enabled: bool,
    pub camera_zoom_scale: f32,
}

impl Default for ClientSmootherConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            black_screen: false,
            background_fps_limit: 15,
            no_particles_fog: true,
            mute_monster_skills: true,
            camera_zoom_enabled: false,
            camera_zoom_scale: 1.35,
        }
    }
}

fn default_zoom_scale() -> f32 {
    1.35
}
fn default_bg_fps() -> u32 {
    15
}
fn default_fg_fps() -> u32 {
    60
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoeSmootherConfig {
    #[serde(default = "default_true_field")]
    pub enabled: bool,
    // Core Options
    #[serde(default)]
    pub disable_sounds: bool,
    #[serde(default)]
    pub soft_mtx: bool,
    #[serde(default = "default_true_field")]
    pub important_things: bool,
    #[serde(default = "default_true_field")]
    pub remove_shadows: bool,
    #[serde(default)]
    pub remove_darkness: bool,
    #[serde(default)]
    pub better_lights: bool,
    #[serde(default = "default_true_field")]
    pub remove_soft_particles: bool,
    #[serde(default)]
    pub silent_skills: bool,
    #[serde(default)]
    pub silent_monsters: bool,
    #[serde(default = "default_true_field")]
    pub maps_revealed: bool,
    #[serde(default = "default_true_field")]
    pub atlas_revealed: bool,
    #[serde(default = "default_true_field")]
    pub standard_colors: bool,
    #[serde(default)]
    pub zero_effects: bool,
    #[serde(default)]
    pub zero_particles: bool,
    #[serde(default = "default_true_field")]
    pub performance_mode: bool,

    // Advanced Presets
    #[serde(default)]
    pub full_remove_mtx: bool,
    #[serde(default = "default_true_field")]
    pub high_performance: bool,
    #[serde(default)]
    pub remove_players: bool,
    #[serde(default)]
    pub remove_monsters: bool,
    #[serde(default = "default_true_field")]
    pub clean_terrain: bool,
    #[serde(default)]
    pub zero_materials: bool,
    #[serde(default)]
    pub black_screen: bool,

    // Camera Zoom
    #[serde(default = "default_true_field")]
    pub zoom_enabled: bool,
    #[serde(default = "default_zoom_scale")]
    pub zoom_scale: f32,

    // Game path for patching
    #[serde(default)]
    pub game_path: String,
    #[serde(default)]
    pub patch_rain: bool,
    #[serde(default)]
    pub patch_clouds: bool,

    // Framerates
    #[serde(default = "default_bg_fps")]
    pub background_fps: u32,
    #[serde(default = "default_fg_fps")]
    pub foreground_fps: u32,
}

impl Default for PoeSmootherConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            disable_sounds: false,
            soft_mtx: false,
            important_things: true,
            remove_shadows: true,
            remove_darkness: false,
            better_lights: false,
            remove_soft_particles: true,
            silent_skills: false,
            silent_monsters: false,
            maps_revealed: true,
            atlas_revealed: true,
            standard_colors: true,
            zero_effects: false,
            zero_particles: false,
            performance_mode: true,
            full_remove_mtx: false,
            high_performance: true,
            remove_players: false,
            remove_monsters: false,
            clean_terrain: true,
            zero_materials: false,
            black_screen: false,
            zoom_enabled: true,
            zoom_scale: 1.35,
            game_path: "".into(),
            patch_rain: false,
            patch_clouds: false,
            background_fps: 15,
            foreground_fps: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaystoneModItem {
    pub id: String,
    pub name: String,
    pub category: String, // "DEADLY", "WARNING", "REWARD"
    pub color: String,
    pub block_run: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaystoneColorConfig {
    #[serde(default = "default_true_field")]
    pub enabled: bool,
    #[serde(default = "default_true_field")]
    pub block_deadly_mods: bool,
    #[serde(default = "default_waystone_mods")]
    pub mods: Vec<WaystoneModItem>,
}

pub fn default_waystone_mods() -> Vec<WaystoneModItem> {
    vec![
        WaystoneModItem {
            id: "reflect_dmg".into(),
            name: "Phản Đòn Sát Thương (Reflect Damage)".into(),
            category: "DEADLY".into(),
            color: "#ef4444".into(),
            block_run: true,
            enabled: true,
        },
        WaystoneModItem {
            id: "no_regen".into(),
            name: "Không Thể Hồi Máu / Mana (Cannot Regenerate)".into(),
            category: "DEADLY".into(),
            color: "#ef4444".into(),
            block_run: true,
            enabled: true,
        },
        WaystoneModItem {
            id: "minus_max_res".into(),
            name: "-% Kháng Tối Đa (-% Maximum Resistances)".into(),
            category: "DEADLY".into(),
            color: "#ef4444".into(),
            block_run: true,
            enabled: true,
        },
        WaystoneModItem {
            id: "cannot_leech".into(),
            name: "Không Thể Hút Máu / Mana (Cannot Leech)".into(),
            category: "DEADLY".into(),
            color: "#ef4444".into(),
            block_run: true,
            enabled: true,
        },
        WaystoneModItem {
            id: "temp_chains".into(),
            name: "Dính Lời Nguyền Xiềng Xích (Temporal Chains on Hit)".into(),
            category: "WARNING".into(),
            color: "#eab308".into(),
            block_run: false,
            enabled: true,
        },
        WaystoneModItem {
            id: "extra_ele_dmg".into(),
            name: "Quái Tăng % Sát Thương Nguyên Tố (Extra Elemental Dmg)".into(),
            category: "WARNING".into(),
            color: "#eab308".into(),
            block_run: false,
            enabled: true,
        },
        WaystoneModItem {
            id: "item_quantity".into(),
            name: "+% Tăng Số Lượng Đồ Rơi (Increased Item Quantity)".into(),
            category: "REWARD".into(),
            color: "#10b981".into(),
            block_run: false,
            enabled: true,
        },
        WaystoneModItem {
            id: "item_rarity".into(),
            name: "+% Tăng Độ Hiếm Đồ Rơi (Increased Item Rarity)".into(),
            category: "REWARD".into(),
            color: "#06b6d4".into(),
            block_run: false,
            enabled: true,
        },
        WaystoneModItem {
            id: "pack_size".into(),
            name: "+% Tăng Mật Độ Quái Vật (Increased Pack Size)".into(),
            category: "REWARD".into(),
            color: "#10b981".into(),
            block_run: false,
            enabled: true,
        },
        WaystoneModItem {
            id: "waystone_drop".into(),
            name: "Tăng Tỷ Lệ Rơi Waystone Cấp Cao (Extra Waystone Drops)".into(),
            category: "REWARD".into(),
            color: "#10b981".into(),
            block_run: false,
            enabled: true,
        },
    ]
}

impl Default for WaystoneColorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            block_deadly_mods: true,
            mods: default_waystone_mods(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClientInputMode {
    #[default]
    SingleWasd,
    DualController,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientAccountProfile {
    /// Stable instance/profile ID, independent of platform and vector position.
    pub id: u32,
    pub label: String,
    #[serde(default)]
    pub flavor: ClientFlavor,
    /// Explicit executable for this profile. Empty means manual launch.
    #[serde(default)]
    pub exe_path: String,
    pub email_masked: String,
    pub has_credentials: bool,
    /// Opaque Windows vault reference; removed from API snapshots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_calibration: Option<LoginCalibration>,
    pub auto_login: bool,
    pub char1_name: String,
    pub char1_role: String, // "Main DPS", "Aurabot", "Cursebot"
    pub char2_name: String, // Couch Co-op partner
    pub char2_role: String, // "Support Healer", "Culler", "Looter"
    /// Explicit account/input topology. Missing legacy values are resolved as
    /// WASD for the main profile and dual-controller for every other profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_mode: Option<ClientInputMode>,
    /// Desired graphics only; no per-process renderer is implemented.
    pub black_screen: bool,
    pub bg_fps: u32,
    pub enabled: bool,
}

/// Names shipped by the migration/default profile are role labels, not
/// character identities read from the game. They must not activate identity
/// guards or party automation until a real character name is observed/configured.
pub fn is_placeholder_character_name(name: &str) -> bool {
    [
        "leader",
        "aurabot",
        "culler",
        "looter1",
        "cursebot",
        "looter2",
        "character 1",
        "character 2",
    ]
    .iter()
    .any(|placeholder| name.trim().eq_ignore_ascii_case(placeholder))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiClientConfig {
    #[serde(default = "default_main_instance")]
    pub main_instance_id: u32,
    #[serde(default = "default_next_instance")]
    pub next_instance_id: u32,
    pub standalone_exe: String,
    pub use_single_folder: bool,
    pub layout_mode: String, // "main_fullscreen", "split_side_by_side", "grid_3"
    pub auto_pair_couch: bool, // Tự ghép đôi 2 char mỗi client
    pub clients: Vec<ClientAccountProfile>,
}

impl Default for MultiClientConfig {
    fn default() -> Self {
        Self {
            main_instance_id: 1,
            next_instance_id: 4,
            standalone_exe:
                "C:\\Program Files\\Grinding Gear Games\\Path of Exile 2\\PathOfExile.exe".into(),
            use_single_folder: true,
            layout_mode: "main_fullscreen".into(),
            auto_pair_couch: true,
            clients: vec![
                ClientAccountProfile {
                    id: 1,
                    label: "Instance 1 (Leader)".into(),
                    flavor: ClientFlavor::Unknown,
                    exe_path: String::new(),
                    email_masked: "".into(),
                    has_credentials: false,
                    credential_ref: None,
                    login_calibration: None,
                    auto_login: false,
                    char1_name: "Leader".into(),
                    char1_role: "Main DPS".into(),
                    char2_name: "Aurabot".into(),
                    char2_role: "Aurabot Buff".into(),
                    input_mode: Some(ClientInputMode::SingleWasd),
                    black_screen: false,
                    bg_fps: 60,
                    enabled: true,
                },
                ClientAccountProfile {
                    id: 2,
                    label: "Instance 2 (Party)".into(),
                    flavor: ClientFlavor::Unknown,
                    exe_path: String::new(),
                    email_masked: "".into(),
                    has_credentials: false,
                    credential_ref: None,
                    login_calibration: None,
                    auto_login: false,
                    char1_name: "Culler".into(),
                    char1_role: "Culler / Shock".into(),
                    char2_name: "Looter1".into(),
                    char2_role: "Auto Looter".into(),
                    input_mode: Some(ClientInputMode::DualController),
                    black_screen: true,
                    bg_fps: 15,
                    enabled: true,
                },
                ClientAccountProfile {
                    id: 3,
                    label: "Instance 3 (Party)".into(),
                    flavor: ClientFlavor::Unknown,
                    exe_path: String::new(),
                    email_masked: "".into(),
                    has_credentials: false,
                    credential_ref: None,
                    login_calibration: None,
                    auto_login: false,
                    char1_name: "Cursebot".into(),
                    char1_role: "Cursebot Debuff".into(),
                    char2_name: "Looter2".into(),
                    char2_role: "Auto Looter".into(),
                    input_mode: Some(ClientInputMode::DualController),
                    black_screen: true,
                    bg_fps: 15,
                    enabled: true,
                },
            ],
        }
    }
}

/// Whitelisted, atomic profile edit. Never accepts credentials or process commands.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstancePatch {
    pub label: Option<String>,
    pub flavor: Option<ClientFlavor>,
    pub exe_path: Option<String>,
    pub enabled: Option<bool>,
    pub black_screen: Option<bool>,
    pub bg_fps: Option<u32>,
    pub auto_login: Option<bool>,
    pub input_mode: Option<ClientInputMode>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum InstanceUpdateError {
    NotFound,
    Invalid(&'static str),
    Conflict(&'static str),
    Unsupported(&'static str),
    Unavailable(String),
}

fn default_main_instance() -> u32 {
    1
}
fn default_next_instance() -> u32 {
    4
}

impl MultiClientConfig {
    pub fn input_mode_for(&self, id: u32) -> Option<ClientInputMode> {
        self.clients
            .iter()
            .find(|profile| profile.id == id)
            .map(|profile| {
                profile
                    .input_mode
                    .unwrap_or(if id == self.main_instance_id {
                        ClientInputMode::SingleWasd
                    } else {
                        ClientInputMode::DualController
                    })
            })
    }

    pub fn requires_virtual_controllers(&self, id: u32) -> bool {
        self.input_mode_for(id) == Some(ClientInputMode::DualController)
    }

    pub fn validate(&self) -> Result<(), InstanceUpdateError> {
        use InstanceUpdateError::Invalid;
        if self.clients.is_empty() || self.clients.len() > 16 {
            return Err(Invalid("Between 1 and 16 instance profiles are required"));
        }
        let mut ids = std::collections::HashSet::new();
        for client in &self.clients {
            if client
                .login_calibration
                .as_ref()
                .is_some_and(|c| !c.valid())
            {
                return Err(Invalid("Invalid login calibration"));
            }
            if client.id == 0 || !ids.insert(client.id) {
                return Err(Invalid("Instance IDs must be unique and nonzero"));
            }
            let mut copy = self.clone();
            copy.update_instance(
                client.id,
                InstancePatch {
                    label: Some(client.label.clone()),
                    exe_path: Some(client.exe_path.clone()),
                    bg_fps: Some(client.bg_fps),
                    ..Default::default()
                },
            )?;
        }
        if !ids.contains(&self.main_instance_id) {
            return Err(Invalid("Main instance must reference an existing profile"));
        }
        Ok(())
    }

    pub fn update_instance(
        &mut self,
        id: u32,
        patch: InstancePatch,
    ) -> Result<(), InstanceUpdateError> {
        use InstanceUpdateError::{Conflict, Invalid, NotFound};
        // Reject ambiguous IDs rather than mutating an arbitrary profile.
        match self.clients.iter().filter(|c| c.id == id).count() {
            0 => return Err(NotFound),
            1 => {}
            _ => return Err(Invalid("Duplicate instance ID")),
        }
        if patch.label.is_none()
            && patch.flavor.is_none()
            && patch.exe_path.is_none()
            && patch.enabled.is_none()
            && patch.black_screen.is_none()
            && patch.bg_fps.is_none()
            && patch.auto_login.is_none()
            && patch.input_mode.is_none()
        {
            return Err(Invalid("Empty instance patch"));
        }
        if patch.label.as_ref().is_some_and(|s| {
            s.trim().is_empty() || s.len() > 160 || s.chars().any(char::is_control)
        }) {
            return Err(Invalid(
                "Label must be nonempty, at most 160 bytes, without control characters",
            ));
        }
        if patch
            .exe_path
            .as_ref()
            .is_some_and(|s| s.len() > 4096 || s.chars().any(char::is_control) || s.contains('"'))
        {
            return Err(Invalid(
                "Use an executable path without quotes or control characters",
            ));
        }
        if patch.bg_fps.is_some_and(|fps| !(5..=240).contains(&fps)) {
            return Err(Invalid(
                "Background FPS preference must be between 5 and 240",
            ));
        }
        if patch.input_mode == Some(ClientInputMode::DualController) && id == self.main_instance_id
        {
            return Err(Conflict(
                "Choose another single-account WASD client as main before converting this client",
            ));
        }
        if patch.input_mode == Some(ClientInputMode::SingleWasd) {
            self.main_instance_id = id;
            for profile in &mut self.clients {
                profile.input_mode = Some(if profile.id == id {
                    ClientInputMode::SingleWasd
                } else {
                    ClientInputMode::DualController
                });
            }
        }
        let instance = self
            .clients
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or(NotFound)?;
        if let Some(v) = patch.label {
            instance.label = v.trim().into();
        }
        if let Some(v) = patch.flavor {
            instance.flavor = v;
        }
        if let Some(v) = patch.exe_path {
            instance.exe_path = v.trim().into();
        }
        if let Some(v) = patch.enabled {
            instance.enabled = v;
        }
        if let Some(v) = patch.black_screen {
            instance.black_screen = v;
        }
        if let Some(v) = patch.bg_fps {
            instance.bg_fps = v;
        }
        if let Some(v) = patch.auto_login {
            instance.auto_login = v;
        }
        if let Some(v) = patch.input_mode {
            instance.input_mode = Some(v);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseBindingsConfig {
    pub right_click_as_a: bool,
    pub right_click_broadcast: bool,
    pub key_a_as_right_click: bool,
    pub mouse_4_action: String,
    pub mouse_5_action: String,
    pub middle_click_action: String,
}

impl Default for MouseBindingsConfig {
    fn default() -> Self {
        Self {
            right_click_as_a: true,
            right_click_broadcast: false,
            key_a_as_right_click: false,
            mouse_4_action: "TOGGLE_BOT".into(),
            mouse_5_action: "REGROUP".into(),
            middle_click_action: "AUTO_STASH".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControllerMappingConfig {
    pub move_up: String,      // "W"
    pub move_down: String,    // "S"
    pub move_left: String,    // "A"
    pub move_right: String,   // "D"
    pub button_a: String,     // "Space"
    pub button_b: String,     // "R"
    pub button_x: String,     // "Q"
    pub button_y: String,     // "E"
    pub button_lb: String,    // "Shift"
    pub button_rb: String,    // "F"
    pub button_lt: String,    // "C"
    pub button_rt: String,    // "V"
    pub dpad_left: String,    // "1"
    pub dpad_right: String,   // "2"
    pub dpad_up: String,      // "3"
    pub dpad_down: String,    // "4"
    pub button_start: String, // "Escape"
    pub button_back: String,  // "Tab"
}

impl Default for ControllerMappingConfig {
    fn default() -> Self {
        Self {
            move_up: "W".into(),
            move_down: "S".into(),
            move_left: "A".into(),
            move_right: "D".into(),
            button_a: "Space".into(),
            button_b: "R".into(),
            button_x: "Q".into(),
            button_y: "E".into(),
            button_lb: "Shift".into(),
            button_rb: "F".into(),
            button_lt: "C".into(),
            button_rt: "V".into(),
            dpad_left: "1".into(),
            dpad_right: "2".into(),
            dpad_up: "3".into(),
            dpad_down: "4".into(),
            button_start: "Escape".into(),
            button_back: "Tab".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotSettings {
    pub follow: bool,
    pub catchup: bool,
    pub loot: bool,
    pub combat: bool,
    pub flask: SmartFlaskConfig,
    pub pickup: AutoPickupConfig,
    pub tracker: CurrencyTrackerSession,
    pub stash: AutoStashConfig,
    pub party: AutoPartyConfig,
    pub party_combat: PartyCombatConfig,
    pub waystones: WaystoneCraftConfig,
    pub shared_ctrl: SharedControlsConfig,
    pub timed_actions: Vec<TimedActionItem>,
    pub multi_client: MultiClientConfig,
    pub kbm_bridge: bool,
    #[serde(default)]
    pub mouse_bindings: MouseBindingsConfig,
    #[serde(default)]
    pub controller_mapping: ControllerMappingConfig,
    #[serde(default = "default_true_field")]
    pub auto_revive: bool,
    #[serde(default)]
    pub poe_smoother: PoeSmootherConfig,
    #[serde(default)]
    pub waystone_colors: WaystoneColorConfig,
    #[serde(default)]
    pub expedition: ExpeditionConfig,
}

fn default_true_field() -> bool {
    true
}

impl Default for BotSettings {
    fn default() -> Self {
        Self {
            follow: true,
            catchup: true,
            loot: true,
            combat: false,
            auto_revive: true,
            flask: SmartFlaskConfig::default(),
            pickup: AutoPickupConfig::default(),
            tracker: CurrencyTrackerSession::default(),
            stash: AutoStashConfig::default(),
            party: AutoPartyConfig::default(),
            party_combat: PartyCombatConfig::default(),
            waystones: WaystoneCraftConfig::default(),
            shared_ctrl: SharedControlsConfig::default(),
            timed_actions: vec![
                TimedActionItem {
                    id: "buff_1".into(),
                    input_button: "D-pad Up".into(),
                    target_player: "Both".into(),
                    cooldown_ms: 6250,
                    only_in_combat: true,
                    enabled: false,
                },
                TimedActionItem {
                    id: "buff_2".into(),
                    input_button: "Y".into(),
                    target_player: "P2".into(),
                    cooldown_ms: 12000,
                    only_in_combat: true,
                    enabled: false,
                },
            ],
            multi_client: MultiClientConfig::default(),
            kbm_bridge: true,
            mouse_bindings: MouseBindingsConfig::default(),
            controller_mapping: ControllerMappingConfig::default(),
            poe_smoother: PoeSmootherConfig::default(),
            waystone_colors: WaystoneColorConfig::default(),
            expedition: ExpeditionConfig::default(),
        }
    }
}

// ─── Follow config ────────────────────────────────────────────────────────────

/// Tunable thresholds for the follow decision engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowConfig {
    /// Below this distance the follower holds position (e.g. 9.0).
    pub stop_distance: f32,
    /// Above this distance the follower sprints (e.g. 39.0).
    pub catch_up_distance: f32,
    /// Above this distance (or different area) the follower warps.
    pub warp_distance: f32,
    /// Prioritize sprint movement over loot when far behind.
    pub prioritize_catchup: bool,
    /// Classic roll [A] + hold sprint.
    pub classic_roll_sprint: bool,
    /// Mirror attack direction of Player 1 during combat.
    pub mirror_attack_dir: bool,
    /// Speed multiplier during catch-up.
    pub sprint_multiplier: f32,
    /// Base movement step per tick (game units).
    pub base_speed: f32,
    /// Tick interval in milliseconds.
    pub tick_ms: u64,
}

impl Default for FollowConfig {
    fn default() -> Self {
        Self {
            stop_distance: 9.0,
            catch_up_distance: 39.0,
            warp_distance: 110.0,
            prioritize_catchup: true,
            classic_roll_sprint: true,
            mirror_attack_dir: false,
            sprint_multiplier: 1.8,
            base_speed: 8.5,
            tick_ms: 200,
        }
    }
}

// ─── Client Info & Connection ──────────────────────────────────────────────

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientFlavor {
    Standalone,
    Steam,
    EpicGames,
    #[default]
    Unknown,
}

impl std::fmt::Display for ClientFlavor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Standalone => write!(f, "Standalone"),
            Self::Steam => write!(f, "Steam"),
            Self::EpicGames => write!(f, "Epic Games"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientStatus {
    pub connected: bool,
    pub pid: u32,
    pub flavor: ClientFlavor,
    pub exe_path: String,
    pub log_path: String,
    pub current_area: String,
    pub coop_mode: bool,
    pub p1_name: String,
    pub p2_name: String,
    pub p1_pad_active: bool,
    pub p2_pad_active: bool,
    pub vigem_connected: bool,
}

impl Default for ClientStatus {
    fn default() -> Self {
        Self {
            connected: false,
            pid: 0,
            flavor: ClientFlavor::Unknown,
            exe_path: String::new(),
            log_path: String::new(),
            current_area: "Unknown".into(),
            coop_mode: true,
            p1_name: "P1 (Leader)".into(),
            p2_name: "P2 (Follower)".into(),
            p1_pad_active: false,
            p2_pad_active: false,
            vigem_connected: false,
        }
    }
}

/// Compatibility state of the read-only game-memory adapter. Process
/// discovery and memory compatibility are deliberately separate: a PID alone
/// does not prove that the current game build still matches the reader schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemoryReaderStatus {
    pub state: String,
    pub build_key: String,
    pub message: String,
}

impl Default for MemoryReaderStatus {
    fn default() -> Self {
        Self {
            state: "waiting_for_game".into(),
            build_key: String::new(),
            message: "Chưa có game để xác minh memory reader".into(),
        }
    }
}

impl MemoryReaderStatus {
    pub fn compatible(build_key: impl Into<String>) -> Self {
        Self {
            state: "compatible".into(),
            build_key: build_key.into(),
            message: "Memory reader đã vượt qua AOB compatibility check".into(),
        }
    }

    pub fn unsupported(build_key: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            state: "unsupported_build".into(),
            build_key: build_key.into(),
            message: message.into(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            state: "unavailable".into(),
            build_key: String::new(),
            message: message.into(),
        }
    }

    pub fn transient(build_key: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            state: "transient".into(),
            build_key: build_key.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientTelemetry {
    pub client_id: u32,
    pub name: String,
    pub active: bool,
    pub connected: bool,
    #[serde(default)]
    pub metrics_available: bool,
    pub cpu_pct: f32,
    pub ram_mb: u32,
    pub fps: u32,
    pub render_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PadCommand {
    pub target: String,
    pub button: String,
    pub dx: f32,
    pub dy: f32,
}

// ─── World state ─────────────────────────────────────────────────────────────

/// Full snapshot of the simulated world at one point in time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldState {
    pub tick: u64,
    pub running: bool,
    pub leader: Actor,
    pub followers: Vec<Actor>,
    pub loot: Vec<WorldItem>,
    pub threats: Vec<Threat>,
    pub loot_paused: bool,
    pub settings: BotSettings,
    pub config: FollowConfig,
    /// Current area name (from memory adapter or mock).
    #[serde(default)]
    pub area_name_hint: String,
    #[serde(default)]
    pub client: ClientStatus,
    #[serde(default)]
    pub memory_reader: MemoryReaderStatus,
    #[serde(default)]
    pub telemetry: Vec<ClientTelemetry>,
    #[serde(default)]
    pub focus_slot: u8,
    /// Ephemeral automation gates owned by the runtime. Profile `enabled`
    /// controls whether a process may bind; this map controls whether the
    /// already-bound instance may produce decisions/input during this session.
    #[serde(default)]
    pub instance_automation: std::collections::BTreeMap<u32, bool>,
}

impl Default for WorldState {
    fn default() -> Self {
        Self {
            tick: 0,
            running: false,
            focus_slot: 0,
            instance_automation: std::collections::BTreeMap::new(),
            leader: Actor::new("Leader", 450.0, 255.0),
            followers: vec![
                Actor::new("Culler", 380.0, 260.0),
                Actor::new("Looter1", 330.0, 285.0),
                Actor::new("Cursebot", 285.0, 230.0),
                Actor::new("Looter2", 250.0, 210.0),
            ],
            loot: vec![
                WorldItem {
                    source_id: 1,
                    name: "Exalted Shard".into(),
                    pos: Vec2::new(515.0, 255.0),
                    value: 18,
                    rarity: None,
                    identified: None,
                    pickup: PickupStatus::default(),
                    picked_by: None,
                },
                WorldItem {
                    source_id: 2,
                    name: "Rare Relic".into(),
                    pos: Vec2::new(405.0, 360.0),
                    value: 7,
                    rarity: None,
                    identified: None,
                    pickup: PickupStatus::default(),
                    picked_by: None,
                },
            ],
            threats: vec![
                Threat {
                    pos: Vec2::new(610.0, 180.0),
                    level: ThreatLevel::Rare,
                },
                Threat {
                    pos: Vec2::new(250.0, 390.0),
                    level: ThreatLevel::Magic,
                },
            ],
            loot_paused: false,
            settings: BotSettings::default(),
            config: FollowConfig::default(),
            area_name_hint: String::new(),
            client: ClientStatus::default(),
            memory_reader: MemoryReaderStatus::default(),
            telemetry: Vec::new(),
        }
    }
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotEvent {
    pub tick: u64,
    pub actor: String,
    pub action: String,
    pub detail: String,
    pub important: bool,
}

impl BotEvent {
    pub fn new(
        tick: u64,
        actor: impl Into<String>,
        action: impl Into<String>,
        detail: impl Into<String>,
        important: bool,
    ) -> Self {
        Self {
            tick,
            actor: actor.into(),
            action: action.into(),
            detail: detail.into(),
            important,
        }
    }
}
