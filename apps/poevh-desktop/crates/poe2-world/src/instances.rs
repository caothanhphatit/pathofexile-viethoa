//! OS-only discovery and window operations. No injection, hooks, or game memory writes.
use anyhow::{bail, Result};
use poe2_types::{GameProcess, ProcessIdentity};

pub fn discover_game_processes() -> Result<Vec<GameProcess>> {
    #[cfg(windows)]
    {
        native::discover()
    }
    #[cfg(not(windows))]
    {
        bail!("Process discovery requires Windows")
    }
}

pub fn inspect_game_process(pid: u32) -> Result<GameProcess> {
    #[cfg(windows)]
    {
        native::inspect(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        bail!("Process discovery requires Windows")
    }
}

pub fn operate_window(identity: &ProcessIdentity, action: &str) -> Result<()> {
    if !matches!(
        action,
        "focus" | "minimize" | "restore" | "cloak" | "uncloak"
    ) {
        bail!("Unsupported window action");
    }
    #[cfg(windows)]
    {
        native::operate(identity, action)
    }
    #[cfg(not(windows))]
    {
        let _ = identity;
        bail!("Window operations require Windows")
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use poe2_types::{ClientFlavor, ProcessWindow};
    use windows::{
        core::{BOOL, PWSTR},
        Win32::{
            Foundation::{CloseHandle, FILETIME, HANDLE, HWND, LPARAM},
            System::{
                Diagnostics::ToolHelp::{
                    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                    TH32CS_SNAPPROCESS,
                },
                ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
                Threading::{
                    GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
            UI::WindowsAndMessaging::{
                BringWindowToTop, EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
                IsWindowVisible, SetForegroundWindow, ShowWindowAsync, SW_MINIMIZE, SW_RESTORE,
            },
        },
    };

    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn ticks(time: FILETIME) -> u64 {
        ((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64
    }
    fn supported_name(name: &str) -> bool {
        let lower = name.trim_end_matches('\0').to_lowercase();
        if !lower.ends_with(".exe") {
            return false;
        }
        if lower.contains("poevh") || lower.contains("poe2-bot") || lower.contains("overlay") {
            return false;
        }
        lower.contains("pathofexile")
            || lower.contains("poe2")
            || lower == "poe.exe"
            || [
                "pathofexile.exe",
                "pathofexile_x64.exe",
                "pathofexilesteam.exe",
                "pathofexileepic.exe",
                "pathofexile2.exe",
                "pathofexile2_x64.exe",
                "pathofexile2steam.exe",
            ]
            .iter()
            .any(|candidate| lower == *candidate)
    }

    unsafe extern "system" fn collect_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut title = [0u16; 1024];
            let length = GetWindowTextW(hwnd, &mut title);
            if length == 0 {
                return BOOL(1);
            }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let windows = &mut *(parameter.0 as *mut Vec<(u32, ProcessWindow)>);
            windows.push((
                pid,
                ProcessWindow {
                    handle: (hwnd.0 as usize).to_string(),
                    title: String::from_utf16_lossy(&title[..length as usize]),
                    minimized: IsIconic(hwnd).as_bool(),
                },
            ));
            BOOL(1)
        }
    }

    fn windows() -> Result<Vec<(u32, ProcessWindow)>> {
        let mut result = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect_window), LPARAM(&mut result as *mut _ as isize));
        }
        Ok(result)
    }

    fn inspect_handle(pid: u32, handle: HANDLE) -> Result<GameProcess> {
        unsafe {
            let mut exit_code = 0;
            GetExitCodeProcess(handle, &mut exit_code)?;
            if exit_code != 259 {
                bail!("Process has exited");
            }
            let mut buffer = vec![0u16; 32768];
            let mut length = buffer.len() as u32;
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )?;
            let path = String::from_utf16_lossy(&buffer[..length as usize]);
            let name = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if !supported_name(name) {
                bail!("Not a supported game executable name");
            }
            let mut created = FILETIME::default();
            let mut exited = FILETIME::default();
            let mut kernel = FILETIME::default();
            let mut user = FILETIME::default();
            GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user)?;
            let mut memory = PROCESS_MEMORY_COUNTERS {
                cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                ..Default::default()
            };
            let size = memory.cb;
            let working_set_bytes = GetProcessMemoryInfo(handle, &mut memory, size)
                .ok()
                .map(|_| memory.WorkingSetSize as u64);
            let lower = path.to_lowercase();
            let flavor = if name.to_lowercase().contains("steam") || lower.contains("steamapps") {
                ClientFlavor::Steam
            } else if name.to_lowercase().contains("epic") || lower.contains("epic games") {
                ClientFlavor::EpicGames
            } else {
                ClientFlavor::Standalone
            };
            Ok(GameProcess {
                identity: ProcessIdentity {
                    pid,
                    started_at: format!("{:016x}", ticks(created)),
                    exe_path: path,
                },
                flavor,
                window: None,
                working_set_bytes,
                cpu_percent: None,
                cpu_ticks: ticks(kernel).saturating_add(ticks(user)),
            })
        }
    }

    pub fn inspect(pid: u32) -> Result<GameProcess> {
        let handle =
            OwnedHandle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)? });
        let mut process = inspect_handle(pid, handle.0)?;
        process.window = windows()?
            .into_iter()
            .find(|(p, _)| *p == pid)
            .map(|(_, window)| window);
        Ok(process)
    }

    pub fn discover() -> Result<Vec<GameProcess>> {
        let snapshot = OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? });
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let visible_windows = windows()?;
        let mut processes = Vec::new();
        unsafe {
            if Process32FirstW(snapshot.0, &mut entry).is_ok() {
                loop {
                    let raw_name = String::from_utf16_lossy(&entry.szExeFile);
                    let clean_name = raw_name.trim_end_matches('\0');
                    if supported_name(clean_name) {
                        match OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION,
                            false,
                            entry.th32ProcessID,
                        ) {
                            Ok(handle) => {
                                let guard = OwnedHandle(handle);
                                match inspect_handle(entry.th32ProcessID, guard.0) {
                                    Ok(mut process) => {
                                        process.window = visible_windows
                                            .iter()
                                            .find(|(pid, _)| *pid == entry.th32ProcessID)
                                            .map(|(_, w)| w.clone());
                                        processes.push(process);
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            pid = entry.th32ProcessID,
                                            name = clean_name,
                                            "Game process found but inspection failed: {e}"
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    pid = entry.th32ProcessID,
                                    name = clean_name,
                                    "Game process found but OpenProcess failed (run POEVH as Administrator?): {e}"
                                );
                            }
                        }
                    }
                    if Process32NextW(snapshot.0, &mut entry).is_err() {
                        break;
                    }
                }
            }
        }
        // Bind Client 1/2/3 by process start time, not PID. Windows PIDs are
        // recycled and do not represent launch order.
        processes.sort_by_key(|process| {
            u64::from_str_radix(&process.identity.started_at, 16).unwrap_or(u64::MAX)
        });
        Ok(processes)
    }

    pub fn operate(identity: &ProcessIdentity, action: &str) -> Result<()> {
        // Keep the process handle open throughout validation and window operation.
        let handle = OwnedHandle(unsafe {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, identity.pid)?
        });
        if inspect_handle(identity.pid, handle.0)?.identity != *identity {
            bail!("Process identity changed; bind again");
        }
        let window = windows()?
            .into_iter()
            .find(|(pid, _)| *pid == identity.pid)
            .map(|(_, w)| w)
            .ok_or_else(|| anyhow::anyhow!("No visible window belongs to this process"))?;
        let hwnd = HWND(window.handle.parse::<usize>()? as *mut std::ffi::c_void);
        unsafe {
            let mut window_pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
            if window_pid != identity.pid {
                bail!("Window owner changed");
            }
            if action == "cloak" || action == "uncloak" {
                let _ = crate::smoother::apply_window_cloaking(hwnd.0 as usize, action == "cloak");
            } else {
                let mode = if action == "minimize" {
                    SW_MINIMIZE
                } else {
                    SW_RESTORE
                };
                let _ = ShowWindowAsync(hwnd, mode);
                if action == "focus" {
                    let _ = BringWindowToTop(hwnd);
                    let _ = SetForegroundWindow(hwnd);
                }
            }
        }
        Ok(())
    }
}
