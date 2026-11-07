//! FPS Smoother & Graphics Config Optimizer for Path of Exile 2.
//!
//! Directly manages and writes configuration to `poe2_production_Config.ini`
//! to limit background client framerates and optimize GPU/CPU consumption.

use anyhow::{anyhow, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// Locate standard user PoE2 config file.
pub fn find_default_config_path() -> Option<PathBuf> {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let root = PathBuf::from(profile);
        let candidates = [
            root.join("OneDrive")
                .join("Documents")
                .join("My Games")
                .join("Path of Exile 2")
                .join("poe2_production_Config.ini"),
            root.join("Documents")
                .join("My Games")
                .join("Path of Exile 2")
                .join("poe2_production_Config.ini"),
            root.join("OneDrive")
                .join("Documents")
                .join("My Games")
                .join("Path of Exile 2")
                .join("production_Config.ini"),
            root.join("Documents")
                .join("My Games")
                .join("Path of Exile 2")
                .join("production_Config.ini"),
            root.join("OneDrive")
                .join("Documents")
                .join("My Games")
                .join("Path of Exile")
                .join("production_Config.ini"),
            root.join("Documents")
                .join("My Games")
                .join("Path of Exile")
                .join("production_Config.ini"),
        ];
        for candidate in candidates {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Apply FPS limits to a poe2_production_Config.ini file.
pub fn apply_fps_limits(path: &Path, bg_fps: u32, fg_fps: u32) -> Result<()> {
    if !path.is_file() {
        return Err(anyhow!("Config file not found: {}", path.display()));
    }

    let content = fs::read_to_string(path)?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    let mut found_bg_limit = false;
    let mut found_bg_enable = false;
    let mut found_fg_limit = false;

    for line in &mut lines {
        if line.starts_with("background_framerate_limit=") {
            *line = format!("background_framerate_limit={bg_fps}");
            found_bg_limit = true;
        } else if line.starts_with("background_framerate_limit_enabled=") {
            *line = "background_framerate_limit_enabled=true".into();
            found_bg_enable = true;
        } else if line.starts_with("framerate_limit=") {
            *line = format!("framerate_limit={fg_fps}");
            found_fg_limit = true;
        }
    }

    // If keys were missing, insert under [DISPLAY]
    if !found_bg_limit || !found_bg_enable || !found_fg_limit {
        if let Some(pos) = lines.iter().position(|l| l.trim() == "[DISPLAY]") {
            if !found_bg_enable {
                lines.insert(pos + 1, "background_framerate_limit_enabled=true".into());
            }
            if !found_bg_limit {
                lines.insert(pos + 1, format!("background_framerate_limit={bg_fps}"));
            }
            if !found_fg_limit {
                lines.insert(pos + 1, format!("framerate_limit={fg_fps}"));
            }
        }
    }

    let updated = lines.join("\r\n");
    fs::write(path, updated)?;
    info!(
        bg_fps,
        fg_fps,
        path = %path.display(),
        "Applied background/foreground FPS limits to PoE2 config"
    );
    Ok(())
}

/// Apply extreme low graphics policy for follower clients to minimize resources.
pub fn apply_low_spec_policy(path: &Path) -> Result<()> {
    if !path.is_file() {
        return Err(anyhow!("Config file not found: {}", path.display()));
    }

    let content = fs::read_to_string(path)?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    for line in &mut lines {
        if line.starts_with("shadow_type=") {
            *line = "shadow_type=Off".into();
        } else if line.starts_with("water_detail=") {
            *line = "water_detail=0".into();
        } else if line.starts_with("screenspace_effects=") {
            *line = "screenspace_effects=0".into();
        } else if line.starts_with("global_illumination_detail=") {
            *line = "global_illumination_detail=0".into();
        } else if line.starts_with("texture_quality=") {
            *line = "texture_quality=TextureQualityLow".into();
        } else if line.starts_with("use_dynamic_particle_culling2=") {
            *line = "use_dynamic_particle_culling2=true".into();
        }
    }

    let updated = lines.join("\r\n");
    fs::write(path, updated)?;
    info!(path = %path.display(), "Applied low-spec follower graphics policy");
    Ok(())
}

/// Apply comprehensive PoeSmoother 2 configuration to poe2_production_Config.ini.
pub fn apply_poe_smoother_policy(path: &Path, cfg: &poe2_types::PoeSmootherConfig) -> Result<()> {
    if !path.is_file() {
        return Err(anyhow!("Config file not found: {}", path.display()));
    }

    let content = fs::read_to_string(path)?;
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    let mut desired = vec![
        ("background_framerate_limit", cfg.background_fps.to_string()),
        ("background_framerate_limit_enabled", "true".to_string()),
        ("framerate_limit", cfg.foreground_fps.to_string()),
    ];
    if cfg.remove_shadows {
        desired.push(("shadow_type", "Off".into()));
    }
    if cfg.clean_terrain {
        desired.push(("texture_quality", "TextureQualityLow".into()));
    }
    if cfg.remove_soft_particles || cfg.zero_particles {
        desired.push(("use_dynamic_particle_culling2", "true".into()));
    }
    if cfg.zero_effects || cfg.performance_mode {
        desired.push(("screenspace_effects", "0".into()));
    }
    if cfg.clean_terrain || cfg.high_performance {
        desired.push(("water_detail", "0".into()));
    }
    if cfg.remove_shadows || cfg.high_performance {
        desired.push(("global_illumination_detail", "0".into()));
    }
    if cfg.disable_sounds {
        desired.push(("sound_effects_volume2", "0".into()));
        desired.push(("ambient_sound_volume2", "0".into()));
    }

    let mut missing = desired
        .iter()
        .map(|(key, value)| (*key, value.clone()))
        .collect::<Vec<_>>();

    for line in &mut lines {
        let Some((key, _)) = line.trim().split_once('=') else {
            continue;
        };
        let Some(index) = missing.iter().position(|(wanted, _)| *wanted == key.trim()) else {
            continue;
        };
        let (wanted, value) = missing.remove(index);
        *line = format!("{wanted}={value}");
    }

    // Keys the file does not contain yet are added under the section the game
    // reads them from; a key placed in the wrong section is ignored by the
    // client. Sections that do not exist yet are appended.
    for (key, value) in missing {
        let section = ini_section_for_key(key);
        let header = lines
            .iter()
            .position(|line| line.trim().eq_ignore_ascii_case(section));
        let insert_at = match header {
            Some(index) => index + 1,
            None => {
                if lines.last().is_some_and(|line| !line.trim().is_empty()) {
                    lines.push(String::new());
                }
                lines.push(section.to_string());
                lines.len()
            }
        };
        lines.insert(insert_at, format!("{key}={value}"));
    }

    let updated = lines.join("\r\n");
    fs::write(path, updated)?;
    info!(path = %path.display(), "Applied PoeSmoother 2 policy to config");
    Ok(())
}

/// Backup original config to .bak if it doesn't already exist.
pub fn backup_config(path: &Path) -> Result<PathBuf> {
    let bak = path.with_extension("ini.bak");
    if !bak.exists() && path.is_file() {
        fs::copy(path, &bak)?;
        info!(source = %path.display(), backup = %bak.display(), "Created backup of PoE2 config");
    }
    Ok(bak)
}

/// Restore original config from .bak if present.
pub fn restore_config(path: &Path) -> Result<()> {
    let bak = path.with_extension("ini.bak");
    if bak.is_file() {
        fs::copy(&bak, path)?;
        info!(backup = %bak.display(), target = %path.display(), "Restored PoE2 config from backup");
        Ok(())
    } else {
        Err(anyhow!("No backup file found at {}", bak.display()))
    }
}

/// Section of production_Config.ini that owns a policy key.
fn ini_section_for_key(key: &str) -> &'static str {
    match key {
        "sound_effects_volume2" | "ambient_sound_volume2" => "[AUDIO]",
        _ => "[DISPLAY]",
    }
}

#[cfg(windows)]
pub fn build_power_throttling_state(
    eco_mode: bool,
) -> windows::Win32::System::Threading::PROCESS_POWER_THROTTLING_STATE {
    use windows::Win32::System::Threading::{
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };
    PROCESS_POWER_THROTTLING_STATE {
        Version: 1, // PROCESS_POWER_THROTTLING_CURRENT_VERSION
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: if eco_mode {
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        } else {
            0
        },
    }
}

/// Apply CPU/GPU priority and efficiency mode to a game process.
#[cfg(windows)]
pub fn apply_process_tuning(pid: u32, low_priority: bool, eco_mode: bool) -> Result<()> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, ProcessPowerThrottling, SetPriorityClass, SetProcessInformation,
        BELOW_NORMAL_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_STATE,
        PROCESS_SET_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_SET_INFORMATION, false, pid)
            .map_err(|error| anyhow!("OpenProcess({pid}) failed: {error}"))?;
        let prio = if low_priority {
            BELOW_NORMAL_PRIORITY_CLASS
        } else {
            NORMAL_PRIORITY_CLASS
        };
        let priority_result = SetPriorityClass(handle, prio);

        let mut state = build_power_throttling_state(eco_mode);
        let power_result = SetProcessInformation(
            handle,
            ProcessPowerThrottling,
            &mut state as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
        let close_result = CloseHandle(handle);

        priority_result.map_err(|error| anyhow!("SetPriorityClass({pid}) failed: {error}"))?;
        match power_result {
            Ok(()) => {}
            // Power throttling is only required when EcoQoS was requested.
            // When it is being cleared, an OS that lacks the API is already in
            // the desired state, so priority alone is a complete result.
            Err(error) if !eco_mode => {
                warn!(pid, %error, "power throttling unsupported; priority applied only");
            }
            Err(error) => {
                return Err(anyhow!(
                    "SetProcessInformation({pid}, eco_mode={eco_mode}) failed: {error}"
                ));
            }
        }
        close_result.map_err(|error| anyhow!("CloseHandle({pid}) failed: {error}"))?;

        info!(
            pid,
            low_priority, eco_mode, "Applied process priority & efficiency tuning"
        );
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_process_tuning(_pid: u32, _low_priority: bool, _eco_mode: bool) -> Result<()> {
    Ok(())
}

/// Cloak or uncloak a window to halt or resume DWM presentation.
#[cfg(windows)]
pub fn apply_window_cloaking(hwnd_val: usize, cloaked: bool) -> Result<()> {
    unsafe {
        type DwmSetWindowAttributeFn = unsafe extern "system" fn(
            hwnd: *mut std::ffi::c_void,
            dw_attribute: u32,
            pv_attribute: *const std::ffi::c_void,
            cb_attribute: u32,
        ) -> i32;

        extern "system" {
            fn LoadLibraryA(lpLibFileName: *const u8) -> *mut std::ffi::c_void;
            fn FreeLibrary(hLibModule: *mut std::ffi::c_void) -> i32;
            fn GetProcAddress(
                hModule: *mut std::ffi::c_void,
                lpProcName: *const u8,
            ) -> *mut std::ffi::c_void;
        }

        let module = LoadLibraryA(c"dwmapi.dll".as_ptr().cast());
        if module.is_null() {
            return Err(anyhow!("LoadLibraryA(dwmapi.dll) failed"));
        }
        let proc = GetProcAddress(module, c"DwmSetWindowAttribute".as_ptr().cast());
        if proc.is_null() {
            let _ = FreeLibrary(module);
            return Err(anyhow!("DwmSetWindowAttribute is unavailable"));
        }
        let func: DwmSetWindowAttributeFn = std::mem::transmute(proc);
        let val: u32 = if cloaked { 1 } else { 0 };
        let result = func(
            hwnd_val as *mut std::ffi::c_void,
            13, // DWMWA_CLOAK
            &val as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
        let free_result = FreeLibrary(module);
        if result < 0 {
            return Err(anyhow!(
                "DwmSetWindowAttribute(hwnd={hwnd_val}, cloaked={cloaked}) failed: HRESULT {result:#x}"
            ));
        }
        if free_result == 0 {
            return Err(anyhow!("FreeLibrary(dwmapi.dll) failed"));
        }
        info!(hwnd = hwnd_val, cloaked, "Applied DWM window cloaking");
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_window_cloaking(_hwnd_val: usize, _cloaked: bool) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn test_power_throttling_state_enables_and_disables_cleanly() {
        use windows::Win32::System::Threading::PROCESS_POWER_THROTTLING_EXECUTION_SPEED;

        let enabled_state = build_power_throttling_state(true);
        assert_eq!(enabled_state.Version, 1);
        assert_eq!(
            enabled_state.ControlMask,
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        );
        assert_eq!(
            enabled_state.StateMask,
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        );

        let disabled_state = build_power_throttling_state(false);
        assert_eq!(disabled_state.Version, 1);
        assert_eq!(
            disabled_state.ControlMask,
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED
        );
        assert_eq!(disabled_state.StateMask, 0);
    }
}
