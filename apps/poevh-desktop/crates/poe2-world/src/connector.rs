//! POE2 Client Connector & Log Watcher.
//!
//! Detects running POE2 client flavors (Standalone, Steam, Epic Games),
//! resolves active installation & log directories, and parses live zone/party events.

use anyhow::Result;
use poe2_types::{ClientFlavor, ClientStatus};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
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
    log_file_offset: u64,
    last_process_poll: Option<Instant>,
    last_log_poll: Option<Instant>,
    suppress_event_logs: bool,
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
            log_file_offset: 0,
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
        };
        // If log_path not yet set from process, check static candidate paths
        if let Some(lp) = find_client_log("") {
            conn.status.log_path = lp.to_string_lossy().to_string();
            // Never read a potentially multi-gigabyte historical Client.txt
            // from byte zero during construction. The watcher performs one
            // bounded tail scan explicitly after startup.
            conn.log_file_offset = fs::metadata(&lp).map(|meta| meta.len()).unwrap_or(0);
        }
        conn.poll_client();
        conn
    }

    /// Read the trailing portion of Client.txt on startup so the active zone
    /// is known immediately without waiting for a new area transition.
    pub fn initial_scan_last_zone(&mut self) {
        if self.status.log_path.is_empty() {
            if let Some(p) = find_client_log(&self.status.exe_path) {
                self.status.log_path = p.to_string_lossy().to_string();
            }
        }
        if self.status.log_path.is_empty() {
            return;
        }

        let path = Path::new(&self.status.log_path);
        if let Ok(mut file) = File::open(path) {
            if let Ok(meta) = file.metadata() {
                let file_len = meta.len();
                let scan_bytes = 256 * 1024_u64; // scan last 256KB
                let start_offset = file_len.saturating_sub(scan_bytes);
                if file.seek(SeekFrom::Start(start_offset)).is_ok() {
                    let mut buffer = Vec::new();
                    if file.read_to_end(&mut buffer).is_ok() {
                        let text = String::from_utf8_lossy(&buffer);
                        self.suppress_event_logs = true;
                        for line in text.lines() {
                            self.parse_log_line(line);
                        }
                        self.suppress_event_logs = false;
                        if !self.status.current_area.is_empty() {
                            info!(
                                area = %self.status.current_area,
                                "Client.txt startup tail initialized to latest known zone"
                            );
                        }
                    }
                }
                self.log_file_offset = file_len;
            }
        }
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
            if let Ok(Some((pid, flavor, exe_path))) = detect_poe2_process() {
                let is_new = !self.status.connected || self.status.pid != pid;
                if is_new {
                    info!(pid, flavor = %flavor, path = %exe_path, "🎯 POE2 Client detected & connected");
                    self.status.connected = true;
                    self.status.pid = pid;
                    self.status.flavor = flavor;
                    self.status.exe_path = exe_path.clone();

                    // Resolve log path
                    let log_path = find_client_log(&exe_path);
                    if let Some(ref lp) = log_path {
                        info!(path = %lp.display(), "📜 POE2 Client.txt log watcher attached");
                        self.status.log_path = lp.to_string_lossy().to_string();
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
                self.status.log_path = lp.to_string_lossy().to_string();
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
        if self.status.log_path.is_empty() {
            return;
        }

        let path = Path::new(&self.status.log_path);
        if !path.exists() {
            return;
        }

        let Ok(meta) = fs::metadata(path) else {
            return;
        };
        let file_len = meta.len();
        if file_len < self.log_file_offset {
            // Log truncated / rotated
            self.log_file_offset = 0;
        } else if file_len == self.log_file_offset {
            return;
        }
        if let Ok(mut file) = File::open(path) {
            let start = self
                .log_file_offset
                .max(file_len.saturating_sub(1024 * 1024));
            if file.seek(SeekFrom::Start(start)).is_ok() {
                let unread = file_len.saturating_sub(start);
                let mut buffer = Vec::with_capacity(unread as usize);
                if file.take(unread).read_to_end(&mut buffer).is_ok() {
                    self.log_file_offset = file_len;
                    let text = String::from_utf8_lossy(&buffer);
                    for line in text.lines() {
                        self.parse_log_line(line);
                    }
                }
            }
        }
    }

    fn parse_log_line(&mut self, line: &str) {
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
            return;
        }

        if let Some(pos) = line.find(" : ") {
            let rest = &line[pos + 3..];
            if rest.ends_with(" has joined the area.") {
                let name = rest.trim_end_matches(" has joined the area.");
                if !self.suppress_event_logs {
                    info!(name, "👥 Party member joined zone");
                }
            }
        }
    }
}

// ─── Windows Process Detection ────────────────────────────────────────────────

#[cfg(windows)]
fn detect_poe2_process() -> Result<Option<(u32, ClientFlavor, String)>> {
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
    let mut result = None;

    unsafe {
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                let proc_name = String::from_utf16_lossy(&pe.szExeFile);
                let proc_name_lower = proc_name.trim_end_matches('\0').to_lowercase();

                if targets.iter().any(|&t| proc_name_lower == t) {
                    let pid = pe.th32ProcessID;
                    let (flavor, exe_path) = inspect_process_path(pid, &proc_name_lower);
                    result = Some((pid, flavor, exe_path));
                    break;
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
            log_file_offset: 0,
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
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
            log_file_offset: 0,
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
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
            log_file_offset: 0,
            last_process_poll: None,
            last_log_poll: None,
            suppress_event_logs: false,
        };
        conn.parse_log_line(
            "2026/09/02 12:00:00 123456 abc [INFO Client 4356] : You have entered Ashen Yard.",
        );
        assert_eq!(conn.status.current_area, "Ashen Yard");
    }
}
