//! POE2 Client Connector & Log Watcher.
//!
//! Detects running POE2 client flavors (Standalone, Steam, Epic Games),
//! resolves active installation & log directories, and parses live zone/party events.

use anyhow::Result;
use poe2_types::{ClientFlavor, ClientStatus};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tracing::{info, warn};

#[cfg(windows)]
use windows::Win32::{
    Foundation::CloseHandle,
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        ProcessStatus::GetProcessImageFileNameW,
        Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    },
};

static LAST_LOGGED_ZONE: parking_lot::RwLock<String> = parking_lot::RwLock::new(String::new());
static LEVELING_OVERLAY_VISIBLE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static LOG_WATCHER_INITIALIZED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static PARTY_INVITES: parking_lot::Mutex<VecDeque<PartyInviteEvent>> =
    parking_lot::Mutex::new(VecDeque::new());
static PARTY_RECOVERY_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CLIENT_LOCATIONS: LazyLock<parking_lot::RwLock<HashMap<u32, ClientLocation>>> =
    LazyLock::new(|| parking_lot::RwLock::new(HashMap::new()));
#[derive(Debug, Default)]
struct VerifiedPartyRoster {
    started_at: Option<String>,
    members: HashSet<String>,
}

static VERIFIED_PARTY_MEMBERS: LazyLock<parking_lot::RwLock<HashMap<u32, VerifiedPartyRoster>>> =
    LazyLock::new(|| parking_lot::RwLock::new(HashMap::new()));

#[derive(Debug, Clone)]
pub struct PartyInviteEvent {
    pub pid: u32,
    pub security_code: u64,
    pub inviter: Option<String>,
    pub is_active: bool,
    pub observed_at: std::time::Instant,
}

impl PartialEq for PartyInviteEvent {
    fn eq(&self, other: &Self) -> bool {
        self.pid == other.pid
            && self.security_code == other.security_code
            && self.inviter == other.inviter
            && self.is_active == other.is_active
    }
}
impl Eq for PartyInviteEvent {}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClientLocation {
    pub area: String,
    pub instance_id: Option<u64>,
    pub started_at: Option<String>,
    pub observed_at: Option<std::time::Instant>,
    pub is_historical: bool,
}

/// Ensure the background Client.txt log watcher is running continuously.
pub fn ensure_log_watcher_started() {
    if LOG_WATCHER_INITIALIZED
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_ok()
    {
        std::thread::Builder::new()
            .name("poe2-client-log-watcher".into())
            .spawn(|| {
                let mut conn = Poe2Connector::new();
                conn.initial_scan_last_zone();

                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    conn.poll_client();
                }
            })
            .ok();
    }
}

/// Get the most recent zone name parsed from Client.txt (Zero-RAM read).
pub fn get_last_logged_zone() -> String {
    ensure_log_watcher_started();
    LAST_LOGGED_ZONE.read().clone()
}

/// Drain account-level party invitation state changes observed in Client.txt.
/// A non-zero code means an active invitation; zero clears that invitation.
pub fn take_party_invites() -> Vec<PartyInviteEvent> {
    ensure_log_watcher_started();
    PARTY_INVITES.lock().drain(..).collect()
}

/// Request a one-shot regroup for every bound follower. The party worker
/// consumes revisions, so repeated hotkey presses cannot enqueue stale pad
/// commands tied to old fixed controller slots.
pub fn request_party_recovery() -> u64 {
    PARTY_RECOVERY_REVISION.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1
}

pub fn party_recovery_revision() -> u64 {
    PARTY_RECOVERY_REVISION.load(std::sync::atomic::Ordering::Acquire)
}

pub fn get_client_location(pid: u32) -> ClientLocation {
    ensure_log_watcher_started();
    CLIENT_LOCATIONS
        .read()
        .get(&pid)
        .cloned()
        .unwrap_or_default()
}

/// Query location for a client process. If started_at is provided, verifies that
/// the location belongs to that process generation and is NOT historical startup data.
pub fn get_client_location_verified(pid: u32, started_at: Option<&str>) -> Option<ClientLocation> {
    ensure_log_watcher_started();
    let locations = CLIENT_LOCATIONS.read();
    let loc = locations.get(&pid)?;
    if loc.is_historical {
        return None;
    }
    if let Some(expected) = started_at {
        if loc.started_at.as_deref() != Some(expected) {
            return None;
        }
    }
    loc.observed_at?;
    Some(loc.clone())
}

/// Bind or update process started_at for a given PID.
pub fn associate_client_identity(pid: u32, started_at: &str) {
    ensure_log_watcher_started();
    let generation_changed = {
        let mut locations = CLIENT_LOCATIONS.write();
        let entry = locations.entry(pid).or_default();
        if entry.started_at.as_deref() != Some(started_at) {
            entry.area.clear();
            entry.instance_id = None;
            entry.started_at = Some(started_at.to_string());
            entry.observed_at = None;
            entry.is_historical = false;
            true
        } else {
            false
        }
    };
    if generation_changed {
        VERIFIED_PARTY_MEMBERS.write().remove(&pid);
    }
}

/// Invalidate location when process exits or unbinds
pub fn invalidate_client_location(pid: u32) {
    let mut locations = CLIENT_LOCATIONS.write();
    locations.remove(&pid);
    VERIFIED_PARTY_MEMBERS.write().remove(&pid);
}

pub fn strip_guild_tag(name: &str) -> &str {
    let trimmed = name.trim();
    if let Some(rest) = trimmed.strip_prefix('<') {
        if let Some(close_idx) = rest.find('>') {
            return rest[close_idx + 1..].trim();
        }
    }
    trimmed
}

/// Record a player name as verified in the roster of one client process.
pub fn record_verified_party_member_for_client(pid: u32, name: &str) {
    let generation = CLIENT_LOCATIONS
        .read()
        .get(&pid)
        .and_then(|location| location.started_at.clone());
    let mut members = VERIFIED_PARTY_MEMBERS.write();
    let roster = members.entry(pid).or_default();
    if roster.started_at != generation {
        roster.started_at = generation;
        roster.members.clear();
    }
    let raw = name.trim().to_lowercase();
    let stripped = strip_guild_tag(name).to_lowercase();
    roster.members.insert(raw);
    roster.members.insert(stripped);
}

/// Remove a player name from one client process' verified party roster.
pub fn remove_verified_party_member_for_client(pid: u32, name: &str) {
    let mut members = VERIFIED_PARTY_MEMBERS.write();
    let Some(roster) = members.get_mut(&pid) else {
        return;
    };
    let raw = name.trim().to_lowercase();
    let stripped = strip_guild_tag(name).to_lowercase();
    roster.members.remove(&raw);
    roster.members.remove(&stripped);
}

/// Check whether a player name was verified by the exact PID and process
/// generation currently being evaluated.
pub fn is_verified_party_member_for_client(pid: u32, started_at: &str, name: &str) -> bool {
    let members = VERIFIED_PARTY_MEMBERS.read();
    let Some(roster) = members.get(&pid) else {
        return false;
    };
    if roster.started_at.as_deref() != Some(started_at) {
        return false;
    }
    let raw = name.trim().to_lowercase();
    let stripped = strip_guild_tag(name).to_lowercase();
    roster.members.contains(&raw) || roster.members.contains(&stripped)
}

/// Legacy account-level helpers retained for callers that do not have a PID.
/// Production party verification uses the scoped functions above.
pub fn record_verified_party_member(name: &str) {
    record_verified_party_member_for_client(0, name);
}

pub fn remove_verified_party_member(name: &str) {
    remove_verified_party_member_for_client(0, name);
}

pub fn is_verified_party_member(name: &str) -> bool {
    let members = VERIFIED_PARTY_MEMBERS.read();
    let raw = name.trim().to_lowercase();
    let stripped = strip_guild_tag(name).to_lowercase();
    members
        .values()
        .any(|roster| roster.members.contains(&raw) || roster.members.contains(&stripped))
}

/// Clear one client's roster after a process-local disband/leave event.
pub fn clear_verified_party_member(pid: u32) {
    VERIFIED_PARTY_MEMBERS.write().remove(&pid);
}

/// Clear verified party members (e.g. on party disband or new session)
pub fn clear_verified_party_members() {
    VERIFIED_PARTY_MEMBERS.write().clear();
}

/// Check whether the Leveling HUD overlay window is visible.
pub fn is_leveling_overlay_visible() -> bool {
    LEVELING_OVERLAY_VISIBLE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Set whether the Leveling HUD overlay window is visible.
pub fn set_leveling_overlay_visible(visible: bool) {
    LEVELING_OVERLAY_VISIBLE.store(visible, std::sync::atomic::Ordering::Relaxed);
}

/// Toggle the Leveling HUD overlay window visibility and return the new state.
pub fn toggle_leveling_overlay_visible() -> bool {
    let prev = LEVELING_OVERLAY_VISIBLE.fetch_xor(true, std::sync::atomic::Ordering::Relaxed);
    !prev
}

pub struct Poe2Connector {
    pub status: ClientStatus,
    /// Read offset per tracked Client.txt. `status.log_path` names the
    /// primary file; its offset lives in this map like every other one.
    log_file_offsets: HashMap<PathBuf, u64>,
    last_process_poll: Option<Instant>,
    last_log_poll: Option<Instant>,
    suppress_event_logs: bool,
    is_historical_scan: bool,
}

impl Default for Poe2Connector {
    fn default() -> Self {
        Self::new()
    }
}

impl Poe2Connector {
    pub fn new() -> Self {
        let status = ClientStatus {
            vigem_connected: true,
            p1_pad_active: true,
            p2_pad_active: true,
            ..Default::default()
        };
        let mut conn = Self {
            status,
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: false,
        };
        // If log_path not yet set from process, check static candidate paths
        if let Some(lp) = find_client_log("") {
            conn.status.log_path = lp.to_string_lossy().to_string();
            // Never read a potentially multi-gigabyte historical Client.txt
            // from byte zero during construction. The watcher performs one
            // bounded tail scan explicitly after startup.
            let end = fs::metadata(&lp).map(|meta| meta.len()).unwrap_or(0);
            conn.log_file_offsets.insert(lp, end);
        }
        conn.poll_client();
        conn
    }

    /// Read the trailing portion of Client.txt on startup so the active zone
    /// is known immediately without waiting for a new area transition.
    pub fn initial_scan_last_zone(&mut self) {
        if self.status.log_path.is_empty() {
            if let Some(p) = find_client_log(&self.status.exe_path) {
                self.track_log_path(p, true);
            }
        }
        let paths = self.log_file_offsets.keys().cloned().collect::<Vec<_>>();
        for path in paths {
            self.initial_scan_log_path(&path);
        }
        if !self.status.current_area.is_empty() {
            info!(
                area = %self.status.current_area,
                "Client.txt startup tail initialized to latest known zone"
            );
        }
    }

    fn track_log_path(&mut self, path: PathBuf, start_at_end: bool) {
        self.log_file_offsets
            .entry(path.clone())
            .or_insert_with(|| {
                if start_at_end {
                    fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0)
                } else {
                    0
                }
            });
        if self.status.log_path.is_empty() {
            self.status.log_path = path.to_string_lossy().to_string();
        }
    }

    fn initial_scan_log_path(&mut self, path: &Path) {
        let Ok(mut file) = File::open(path) else {
            return;
        };
        let Ok(meta) = file.metadata() else {
            return;
        };
        let file_len = meta.len();
        let scan_bytes = 256 * 1024_u64;
        let start_offset = file_len.saturating_sub(scan_bytes);
        if file.seek(SeekFrom::Start(start_offset)).is_ok() {
            let mut buffer = Vec::new();
            if file.read_to_end(&mut buffer).is_ok() {
                let text = String::from_utf8_lossy(&buffer);
                self.is_historical_scan = true;
                self.suppress_event_logs = true;
                for line in text.lines() {
                    self.parse_log_line(line);
                }
                self.suppress_event_logs = false;
                self.is_historical_scan = false;
            }
        }
        self.log_file_offsets.insert(path.to_path_buf(), file_len);
    }

    /// Poll process and scan log updates.
    pub fn poll_client(&mut self) {
        let now = Instant::now();
        let process_due = self
            .last_process_poll
            .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(2));
        #[cfg(windows)]
        if process_due {
            self.last_process_poll = Some(now);
            if let Ok(processes) = detect_poe2_processes() {
                if processes.is_empty() {
                    if self.status.connected {
                        warn!("⚠️ POE2 Client disconnected (process closed)");
                        self.status.connected = false;
                        self.status.pid = 0;
                    }
                } else {
                    for (_, _, exe_path) in &processes {
                        if let Some(log_path) = find_client_log(exe_path) {
                            let is_new_path = !self.log_file_offsets.contains_key(&log_path);
                            self.track_log_path(log_path.clone(), true);
                            if is_new_path {
                                info!(path = %log_path.display(), "📜 POE2 Client.txt log watcher attached");
                            }
                        }
                    }

                    if let Some((pid, flavor, exe_path)) = processes
                        .iter()
                        .find(|(pid, _, _)| *pid == self.status.pid)
                        .or_else(|| processes.first())
                        .cloned()
                    {
                        let is_new = !self.status.connected || self.status.pid != pid;
                        if is_new {
                            info!(pid, flavor = %flavor, path = %exe_path, "🎯 POE2 Client detected & connected");
                        }
                        self.status.connected = true;
                        self.status.pid = pid;
                        self.status.flavor = flavor;
                        self.status.exe_path = exe_path;
                    }
                }
            } else if self.status.connected {
                warn!("⚠️ POE2 Client disconnected (process closed)");
                self.status.connected = false;
                self.status.pid = 0;
            }
        }

        // Ensure fallback log_path is set if process detection wasn't needed or available
        if self.status.log_path.is_empty() {
            if let Some(lp) = find_client_log(&self.status.exe_path) {
                self.track_log_path(lp, true);
            }
        }

        // Log tailing remains responsive without opening the same unchanged
        // file on every engine/UI tick.
        let log_due = self
            .last_log_poll
            .is_none_or(|last| now.duration_since(last) >= Duration::from_millis(500));
        if log_due {
            self.last_log_poll = Some(now);
            self.read_log_updates();
        }
    }

    fn read_log_updates(&mut self) {
        if self.log_file_offsets.is_empty() && !self.status.log_path.is_empty() {
            self.track_log_path(PathBuf::from(&self.status.log_path), false);
        }
        if self.log_file_offsets.is_empty() {
            return;
        }

        let paths = self.log_file_offsets.keys().cloned().collect::<Vec<_>>();
        for path in paths {
            self.read_log_path(&path);
        }
    }

    fn read_log_path(&mut self, path: &Path) {
        if !path.exists() {
            return;
        }

        let Ok(meta) = fs::metadata(path) else {
            return;
        };
        let file_len = meta.len();
        let offset = self.log_file_offsets.get(path).copied().unwrap_or(0);
        if file_len < offset {
            // Log truncated / rotated
            self.log_file_offsets.insert(path.to_path_buf(), 0);
        } else if file_len == offset {
            return;
        }
        let offset = self.log_file_offsets.get(path).copied().unwrap_or(0);
        if let Ok(mut file) = File::open(path) {
            let start = offset.max(file_len.saturating_sub(1024 * 1024));
            if file.seek(SeekFrom::Start(start)).is_ok() {
                let unread = file_len.saturating_sub(start);
                let mut buffer = Vec::with_capacity(unread as usize);
                if file.take(unread).read_to_end(&mut buffer).is_ok() {
                    if let Some(last_nl) = buffer.iter().rposition(|&b| b == b'\n') {
                        let valid_bytes = &buffer[..=last_nl];
                        let next_offset = start + (last_nl as u64) + 1;
                        self.log_file_offsets
                            .insert(path.to_path_buf(), next_offset);
                        let text = String::from_utf8_lossy(valid_bytes);
                        for line in text.lines() {
                            self.parse_log_line(line);
                        }
                    } else if unread > 64 * 1024 {
                        self.log_file_offsets.insert(path.to_path_buf(), file_len);
                    }
                }
            }
        }
    }

    fn parse_log_line(&mut self, line: &str) {
        let line_pid = parse_client_pid(line);
        if !self.suppress_event_logs {
            if let Some(event) = parse_party_invite_event(line) {
                let mut invitations = PARTY_INVITES.lock();
                if invitations.len() >= 64 {
                    invitations.pop_front();
                    warn!("party invitation event queue full; discarded oldest event");
                }
                let active = event.is_active;
                let pid = event.pid;
                invitations.push_back(event);
                info!(
                    pid,
                    active, "party invitation state changed for game client"
                );
            }
        }

        if let Some((pid, instance_id)) = parse_client_instance(line) {
            let mut locations = CLIENT_LOCATIONS.write();
            let loc = locations.entry(pid).or_default();
            loc.instance_id = Some(instance_id);
            loc.is_historical = self.is_historical_scan;
            if !self.is_historical_scan {
                loc.observed_at = Some(Instant::now());
            }
        }

        // 1. PoE 2 Loading Screen: e.g. "[INFO Client 17932] [LOADING SCREEN] (Cemetery of the Eternals) Duration = 3.08363 seconds"
        if let Some(pos) = line.find("[LOADING SCREEN] (") {
            let rest = &line[pos + "[LOADING SCREEN] (".len()..];
            if let Some(end) = rest.find(')') {
                let area = rest[..end].trim();
                if !area.is_empty() {
                    if !self.suppress_event_logs {
                        info!(
                            area,
                            "📍 Zone transition detected from PoE2 [LOADING SCREEN]"
                        );
                    }
                    self.status.current_area = area.to_string();
                    *LAST_LOGGED_ZONE.write() = area.to_string();
                    if let Some(pid) = line_pid {
                        let mut locations = CLIENT_LOCATIONS.write();
                        let loc = locations.entry(pid).or_default();
                        loc.area = area.to_string();
                        loc.is_historical = self.is_historical_scan;
                        if !self.is_historical_scan {
                            loc.observed_at = Some(Instant::now());
                        }
                    }
                    return;
                }
            }
        }

        // 2. PoE 2 Scene Source: e.g. "[INFO Client 17932] [SCENE] Set Source [Cemetery of the Eternals]"
        if let Some(pos) = line.find("[SCENE] Set Source [") {
            let rest = &line[pos + "[SCENE] Set Source [".len()..];
            if let Some(end) = rest.find(']') {
                let area = rest[..end].trim();
                let area_lower = area.to_ascii_lowercase();
                if !area.is_empty()
                    && area != "(null)"
                    && area != "(unknown)"
                    && area_lower != "interlude"
                    && !area_lower.starts_with("act ")
                {
                    if !self.suppress_event_logs {
                        info!(area, "📍 Zone transition detected from PoE2 [SCENE]");
                    }
                    self.status.current_area = area.to_string();
                    *LAST_LOGGED_ZONE.write() = area.to_string();
                    if let Some(pid) = line_pid {
                        let mut locations = CLIENT_LOCATIONS.write();
                        let location = locations.entry(pid).or_default();
                        location.area = area.to_string();
                        location.is_historical = self.is_historical_scan;
                        if !self.is_historical_scan {
                            location.observed_at = Some(Instant::now());
                        }
                    }
                    return;
                }
            }
        }

        // 3. Traditional PoE1 / PoE2 log pattern: e.g. " : You have entered Ashen Yard."
        if let Some(pos) = line.find(" : You have entered ") {
            let area = line[pos + " : You have entered ".len()..].trim_end_matches('.');
            if !self.suppress_event_logs {
                info!(area, "📍 Zone transition detected from Client.txt");
            }
            self.status.current_area = area.to_string();
            *LAST_LOGGED_ZONE.write() = area.to_string();
            if let Some(pid) = line_pid {
                let mut locations = CLIENT_LOCATIONS.write();
                let location = locations.entry(pid).or_default();
                location.area = area.to_string();
                location.is_historical = self.is_historical_scan;
                if !self.is_historical_scan {
                    location.observed_at = Some(Instant::now());
                }
            }
            return;
        }

        if let Some(pos) = line.find(" : ") {
            let rest = &line[pos + 3..];
            if rest.ends_with(" has joined the area.") {
                let name = rest.trim_end_matches(" has joined the area.");
                if !self.suppress_event_logs {
                    info!(name, "👥 Party member joined zone");
                }
            } else if rest.ends_with(" has joined the party.") {
                let name = rest.trim_end_matches(" has joined the party.");
                if !self.is_historical_scan {
                    if let Some(pid) = line_pid {
                        record_verified_party_member_for_client(pid, name);
                    }
                }
                if !self.suppress_event_logs {
                    info!(name, "👥 Party member joined party");
                }
            } else if rest.ends_with(" has left the party.") {
                let name = rest.trim_end_matches(" has left the party.");
                if !self.is_historical_scan {
                    if let Some(pid) = line_pid {
                        remove_verified_party_member_for_client(pid, name);
                    }
                }
                if !self.suppress_event_logs {
                    info!(name, "👥 Party member left party");
                }
            } else if rest.ends_with(" has been kicked from the party.") {
                let name = rest.trim_end_matches(" has been kicked from the party.");
                if !self.is_historical_scan {
                    if let Some(pid) = line_pid {
                        remove_verified_party_member_for_client(pid, name);
                    }
                }
                if !self.suppress_event_logs {
                    info!(name, "👥 Party member kicked from party");
                }
            } else if rest.ends_with("You have left the party.")
                || rest.ends_with("The party has been disbanded.")
                || rest.ends_with("You have been kicked from the party.")
            {
                if !self.is_historical_scan {
                    if let Some(pid) = line_pid {
                        clear_verified_party_member(pid);
                    }
                }
                if !self.suppress_event_logs {
                    info!("👥 Party left/disbanded; cleared verified party roster");
                }
            }
        }
    }
}

fn parse_party_invite_event(line: &str) -> Option<PartyInviteEvent> {
    const CODE_MARKER: &str = "InstanceClientSetSelfPartyInvitationSecurityCode = ";
    if let Some(code_pos) = line.find(CODE_MARKER) {
        let pid = parse_client_pid(line).unwrap_or(0);
        let code_start = code_pos + CODE_MARKER.len();
        if let Some(code_str) = line[code_start..].split_whitespace().next() {
            if let Ok(security_code) = code_str.parse::<u64>() {
                return Some(PartyInviteEvent {
                    pid,
                    security_code,
                    inviter: None,
                    is_active: security_code != 0,
                    observed_at: Instant::now(),
                });
            }
        }
    }

    if let Some(pos) = line.find(" : ") {
        let rest = &line[pos + 3..];
        let pid = parse_client_pid(line).unwrap_or(0);

        if rest.ends_with(" has invited you to join their party.") {
            let inviter = rest
                .trim_end_matches(" has invited you to join their party.")
                .trim();
            let clean_inviter = strip_guild_tag(inviter);
            if !clean_inviter.is_empty() {
                return Some(PartyInviteEvent {
                    pid,
                    security_code: 1,
                    inviter: Some(clean_inviter.to_string()),
                    is_active: true,
                    observed_at: Instant::now(),
                });
            }
        } else if rest.ends_with(" has invited you to join the party.") {
            let inviter = rest
                .trim_end_matches(" has invited you to join the party.")
                .trim();
            let clean_inviter = strip_guild_tag(inviter);
            if !clean_inviter.is_empty() {
                return Some(PartyInviteEvent {
                    pid,
                    security_code: 1,
                    inviter: Some(clean_inviter.to_string()),
                    is_active: true,
                    observed_at: Instant::now(),
                });
            }
        } else if let Some(after) = rest.strip_prefix("You have been invited to join a party by ") {
            let inviter = after.trim_end_matches('.').trim();
            let clean_inviter = strip_guild_tag(inviter);
            if !clean_inviter.is_empty() {
                return Some(PartyInviteEvent {
                    pid,
                    security_code: 1,
                    inviter: Some(clean_inviter.to_string()),
                    is_active: true,
                    observed_at: Instant::now(),
                });
            }
        } else if rest.ends_with(" has cancelled the party invitation.")
            || rest.starts_with("Party invitation cancelled")
        {
            return Some(PartyInviteEvent {
                pid,
                security_code: 0,
                inviter: None,
                is_active: false,
                observed_at: Instant::now(),
            });
        }
    }

    None
}

fn parse_client_pid(line: &str) -> Option<u32> {
    // Real PoE2 log prefixes are `[INFO Client 1234]`,
    // `[DEBUG Client 1234]`, etc. The severity is variable, so anchor on the
    // space-delimited Client field and require the closing bracket.
    const CLIENT_MARKER: &str = " Client ";
    let marker = line.find(CLIENT_MARKER)?;
    let open = line[..marker].rfind('[')?;
    let level = line[open + 1..marker].trim();
    if !matches!(level, "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR") {
        return None;
    }
    let start = marker + CLIENT_MARKER.len();
    let end = line[start..].find(']')? + start;
    let value = line[start..end].trim();
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

fn parse_client_instance(line: &str) -> Option<(u32, u64)> {
    const INSTANCE_MARKER: &str = "Client-Safe Instance ID = ";
    let pid = parse_client_pid(line)?;
    let start = line.find(INSTANCE_MARKER)? + INSTANCE_MARKER.len();
    let instance_id = line[start..].split_whitespace().next()?.parse().ok()?;
    Some((pid, instance_id))
}

// ─── Windows Process Detection ────────────────────────────────────────────────

#[cfg(windows)]
fn detect_poe2_processes() -> Result<Vec<(u32, ClientFlavor, String)>> {
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? };
    let mut pe = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };

    let targets = [
        "pathofexile.exe",
        "pathofexilesteam.exe",
        "pathofexileepic.exe",
        "pathofexile_x64.exe",
        "pathofexile2.exe",
        "pathofexile2steam.exe",
        "client.exe",
    ];
    let mut result = Vec::new();

    unsafe {
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                let proc_name = String::from_utf16_lossy(&pe.szExeFile);
                let proc_name_lower = proc_name.trim_end_matches('\0').to_lowercase();

                if targets.iter().any(|&t| proc_name_lower == t) {
                    let pid = pe.th32ProcessID;
                    let (flavor, exe_path) = inspect_process_path(pid, &proc_name_lower);
                    result.push((pid, flavor, exe_path));
                }

                if Process32NextW(snap, &mut pe).is_err() {
                    break;
                }
            }
        }
        CloseHandle(snap).ok();
    }

    Ok(result)
}

#[cfg(windows)]
fn inspect_process_path(pid: u32, proc_name: &str) -> (ClientFlavor, String) {
    let mut exe_path = String::new();
    if let Ok(handle) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        let mut buf = [0u16; 1024];
        let len = unsafe { GetProcessImageFileNameW(handle, &mut buf) };
        if len > 0 {
            exe_path = String::from_utf16_lossy(&buf[..len as usize]);
        }
        unsafe { CloseHandle(handle).ok() };
    }

    let flavor = if proc_name.contains("steam") || exe_path.to_lowercase().contains("steamapps") {
        ClientFlavor::Steam
    } else if proc_name.contains("epic") || exe_path.to_lowercase().contains("epic games") {
        ClientFlavor::EpicGames
    } else {
        ClientFlavor::Standalone
    };

    (flavor, exe_path)
}

fn find_client_log(exe_path: &str) -> Option<PathBuf> {
    // 1. Relative to Exe directory if known
    if !exe_path.is_empty() {
        if let Some(parent) = Path::new(exe_path).parent() {
            let p1 = parent.join("logs").join("Client.txt");
            if p1.exists() {
                return Some(p1);
            }
            let p2 = parent.join("logs").join("LatestClient.txt");
            if p2.exists() {
                return Some(p2);
            }
        }
    }

    // 2. Direct paths on common drives
    let candidates = [
        "D:\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
        "C:\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
        "E:\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
        "C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
        "C:\\Program Files\\Grinding Gear Games\\Path of Exile 2\\logs\\Client.txt",
        "D:\\SteamLibrary\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
        "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
        "C:\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
        "D:\\Steam\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
        "E:\\SteamLibrary\\steamapps\\common\\Path of Exile 2\\logs\\Client.txt",
        "C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt",
    ];

    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_poe2_loading_screen() {
        let mut conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: false,
        };
        conn.parse_log_line(
            "2026/09/04 17:53:46 112773500 4cba6a94 [INFO Client 17932] [LOADING SCREEN] (Cemetery of the Eternals) Duration = 3.08363 seconds",
        );
        assert_eq!(conn.status.current_area, "Cemetery of the Eternals");
    }

    #[test]
    fn test_parse_poe2_scene_source() {
        let mut conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: false,
        };
        conn.parse_log_line(
            "2026/09/04 17:53:44 112770984 7fbd1225 [INFO Client 17932] [SCENE] Set Source [The Grim Tangle]",
        );
        assert_eq!(conn.status.current_area, "The Grim Tangle");

        // Should ignore meta states
        conn.parse_log_line(
            "2026/09/04 17:53:44 112770984 7fbd1225 [INFO Client 17932] [SCENE] Set Source [(null)]",
        );
        assert_eq!(conn.status.current_area, "The Grim Tangle");

        conn.parse_log_line(
            "2026/09/04 17:53:44 112770984 7fbd1225 [INFO Client 17932] [SCENE] Set Source [Interlude]",
        );
        assert_eq!(conn.status.current_area, "The Grim Tangle");
    }

    #[test]
    fn test_parse_poe1_entered() {
        let mut conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: false,
        };
        conn.parse_log_line(
            "2026/09/02 12:00:00 123456 abc [INFO Client 4356] : You have entered Ashen Yard.",
        );
        assert_eq!(conn.status.current_area, "Ashen Yard");
    }

    #[test]
    fn party_invite_parser_keeps_reset_and_exact_pid() {
        assert_eq!(
            parse_party_invite_event(
                "[DEBUG Client 1976] InstanceClientSetSelfPartyInvitationSecurityCode = 0"
            ),
            Some(PartyInviteEvent {
                pid: 1976,
                security_code: 0,
                inviter: None,
                is_active: false,
                observed_at: Instant::now(),
            })
        );
        assert_eq!(
            parse_party_invite_event(
                "[DEBUG Client 1976] InstanceClientSetSelfPartyInvitationSecurityCode = 847221"
            ),
            Some(PartyInviteEvent {
                pid: 1976,
                security_code: 847221,
                inviter: None,
                is_active: true,
                observed_at: Instant::now(),
            })
        );
    }

    #[test]
    fn party_invite_parser_recognizes_real_chat_invitations_and_cancellations() {
        // Active invite from player
        let event = parse_party_invite_event(
            "2026/09/20 12:00:00 123456 abc [INFO Client 4356] : Exil3Master has invited you to join their party.",
        );
        assert_eq!(
            event,
            Some(PartyInviteEvent {
                pid: 4356,
                security_code: 1,
                inviter: Some("Exil3Master".to_string()),
                is_active: true,
                observed_at: Instant::now(),
            })
        );

        // Active invite alternate phrasing
        let event2 = parse_party_invite_event(
            "2026/09/20 12:00:00 123456 abc [INFO Client 4356] : You have been invited to join a party by SwiftSlayer.",
        );
        assert_eq!(
            event2,
            Some(PartyInviteEvent {
                pid: 4356,
                security_code: 1,
                inviter: Some("SwiftSlayer".to_string()),
                is_active: true,
                observed_at: Instant::now(),
            })
        );

        // Cancelled invite
        let cancel = parse_party_invite_event(
            "2026/09/20 12:01:00 123456 abc [INFO Client 4356] : Exil3Master has cancelled the party invitation.",
        );
        assert_eq!(
            cancel,
            Some(PartyInviteEvent {
                pid: 4356,
                security_code: 0,
                inviter: None,
                is_active: false,
                observed_at: Instant::now(),
            })
        );
    }

    #[test]
    fn party_member_verification_tracks_joined_members() {
        clear_verified_party_members();
        assert!(!is_verified_party_member("Alice"));

        let mut conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: false,
        };

        // Member joins without guild tag
        conn.parse_log_line(
            "2026/09/20 12:05:00 123456 abc [INFO Client 17932] : Alice has joined the party.",
        );
        assert!(is_verified_party_member("Alice"));
        assert!(is_verified_party_member("alice")); // case insensitive

        // Member joins with guild tag
        conn.parse_log_line(
            "2026/09/20 12:06:00 123456 abc [INFO Client 17932] : <VIET> Bob has joined the party.",
        );
        assert!(is_verified_party_member("Bob"));
        assert!(is_verified_party_member("<VIET> Bob"));
        assert!(is_verified_party_member("bob"));

        // Historical scan does not pollute live roster
        let mut hist_conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: true,
        };
        hist_conn.parse_log_line(
            "2026/09/20 12:00:00 123456 abc [INFO Client 17932] : Charlie has joined the party.",
        );
        assert!(!is_verified_party_member("Charlie"));

        // Member leaves party
        conn.parse_log_line(
            "2026/09/20 12:07:00 123456 abc [INFO Client 17932] : Alice has left the party.",
        );
        assert!(!is_verified_party_member("Alice"));
        assert!(is_verified_party_member("Bob"));

        // Member with guild tag leaves party
        conn.parse_log_line(
            "2026/09/20 12:08:00 123456 abc [INFO Client 17932] : <VIET> Bob has left the party.",
        );
        assert!(!is_verified_party_member("Bob"));

        // Join again and test party disbanded
        conn.parse_log_line(
            "2026/09/20 12:09:00 123456 abc [INFO Client 17932] : Alice has joined the party.",
        );
        assert!(is_verified_party_member("Alice"));
        conn.parse_log_line(
            "2026/09/20 12:10:00 123456 abc [INFO Client 17932] : The party has been disbanded.",
        );
        assert!(!is_verified_party_member("Alice"));

        clear_verified_party_members();
        assert!(!is_verified_party_member("Alice"));
    }

    #[test]
    fn verified_location_requires_matching_generation_and_live_observation() {
        const PID: u32 = 4_294_000_001;
        invalidate_client_location(PID);
        associate_client_identity(PID, "generation-a");

        assert!(get_client_location_verified(PID, Some("generation-a")).is_none());

        let mut conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
            is_historical_scan: false,
        };
        conn.parse_log_line(&format!(
            "[INFO Client {PID}] Client-Safe Instance ID = 9911"
        ));

        assert_eq!(
            get_client_location_verified(PID, Some("generation-a"))
                .and_then(|location| location.instance_id),
            Some(9911)
        );
        assert!(get_client_location_verified(PID, Some("generation-b")).is_none());

        invalidate_client_location(PID);
    }

    #[test]
    fn client_instance_parser_keeps_pid_and_server_instance_separate() {
        assert_eq!(
            parse_client_instance("[DEBUG Client 1976] Client-Safe Instance ID = 1392222052"),
            Some((1976, 1_392_222_052))
        );
        assert_eq!(parse_client_pid("line without a client"), None);
        assert_eq!(
            parse_client_pid("user text Client 1976] without a structured log prefix"),
            None
        );
    }

    #[test]
    fn log_watcher_reads_multiple_client_logs_without_crossing_pid_state() {
        const PID_ONE: u32 = 4_294_000_101;
        const PID_TWO: u32 = 4_294_000_102;
        let root = std::env::temp_dir().join(format!(
            "poevh-connector-multi-log-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let first = root.join("client-one.txt");
        let second = root.join("client-two.txt");
        fs::write(
            &first,
            format!(
                "[INFO Client {PID_ONE}] [SCENE] Set Source [The Drowned City]\n[INFO Client {PID_ONE}] Client-Safe Instance ID = 101\n"
            ),
        )
        .unwrap();
        fs::write(
            &second,
            format!(
                "[INFO Client {PID_TWO}] [SCENE] Set Source [The Molten Vault]\n[INFO Client {PID_TWO}] Client-Safe Instance ID = 202\n"
            ),
        )
        .unwrap();
        invalidate_client_location(PID_ONE);
        invalidate_client_location(PID_TWO);

        let mut conn = Poe2Connector {
            status: ClientStatus::default(),
            log_file_offsets: HashMap::new(),
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: true,
            is_historical_scan: false,
        };
        conn.track_log_path(first.clone(), false);
        conn.track_log_path(second.clone(), false);
        conn.read_log_updates();

        assert_eq!(get_client_location(PID_ONE).area, "The Drowned City");
        assert_eq!(get_client_location(PID_ONE).instance_id, Some(101));
        assert_eq!(get_client_location(PID_TWO).area, "The Molten Vault");
        assert_eq!(get_client_location(PID_TWO).instance_id, Some(202));

        invalidate_client_location(PID_ONE);
        invalidate_client_location(PID_TWO);
        fs::remove_dir_all(root).unwrap();
    }
}
