use crate::ClientFlavor;
use serde::{Deserialize, Serialize};

/// The creation-time token prevents PID reuse from silently retargeting an instance.
/// A hex string avoids loss of FILETIME precision in JavaScript.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub started_at: String,
    pub exe_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessWindow {
    pub handle: String,
    pub title: String,
    pub minimized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameProcess {
    pub identity: ProcessIdentity,
    pub flavor: ClientFlavor,
    pub window: Option<ProcessWindow>,
    pub working_set_bytes: Option<u64>,
    pub cpu_percent: Option<f32>,
    #[serde(skip)]
    pub cpu_ticks: u64,
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceStatus {
    pub instance_id: u32,
    /// Persistent account profile that owns this runtime instance.  Kept
    /// optional so older clients can still deserialize snapshots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_profile_id: Option<u32>,
    #[serde(default)]
    pub is_main: bool,
    #[serde(default)]
    pub black_screen: bool,
    #[serde(default)]
    pub bg_fps: u32,
    #[serde(default = "default_true")]
    pub automation_enabled: bool,
    pub status: String,
    pub binding: Option<ProcessIdentity>,
    pub process: Option<GameProcess>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PhysicalControllerInfo {
    /// Stable XInput slot for the lifetime of the current connection (1-4).
    pub slot: u32,
    pub name: String,
    pub connection: String,
    pub battery: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VirtualControllerInfo {
    /// Stable POEVH target name used by the follower/input engine (P1, P2, ...).
    pub target: String,
    /// One-based XInput slot shown by the game as Xbox Controller #1..#4.
    pub xinput_slot: u32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ControllerInventory {
    #[serde(default)]
    pub physical: Vec<PhysicalControllerInfo>,
    #[serde(default)]
    pub virtual_count: usize,
    /// Exact mapping reported by ViGEm/XInput for controllers owned by POEVH.
    #[serde(default)]
    pub virtual_controllers: Vec<VirtualControllerInfo>,
    pub scan_error: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct InstanceServicesSnapshot {
    #[serde(default)]
    pub login_states: std::collections::BTreeMap<u32, String>,
    pub profiles_persistent: bool,
    pub profile_path: Option<String>,
    pub scan_error: Option<String>,
    pub processes: Vec<GameProcess>,
    pub instances: Vec<InstanceStatus>,
    /// Dynamic process records. Unlike `instances`, this list contains only
    /// processes created/bound during the current app session.
    #[serde(default)]
    pub runtime_instances: Vec<InstanceStatus>,
    #[serde(default)]
    pub account_profiles: Vec<crate::AccountProfile>,
    pub per_process_graphics: bool,
    pub graphics_reason: String,
    #[serde(default)]
    pub controllers: ControllerInventory,
}
