//! FPS Smoother & Graphics Config Optimizer for Path of Exile 2.
//!
//! Directly manages and writes configuration to `poe2_production_Config.ini`
//! to limit background client framerates and optimize GPU/CPU consumption.

use anyhow::{anyhow, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::info;

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

    for line in &mut lines {
        if line.starts_with("background_framerate_limit=") {
            *line = format!("background_framerate_limit={}", cfg.background_fps);
        } else if line.starts_with("background_framerate_limit_enabled=") {
            *line = "background_framerate_limit_enabled=true".into();
        } else if line.starts_with("framerate_limit=") {
            *line = format!("framerate_limit={}", cfg.foreground_fps);
        } else if cfg.remove_shadows && line.starts_with("shadow_type=") {
            *line = "shadow_type=Off".into();
        } else if cfg.clean_terrain && line.starts_with("texture_quality=") {
            *line = "texture_quality=TextureQualityLow".into();
        } else if (cfg.remove_soft_particles || cfg.zero_particles)
            && line.starts_with("use_dynamic_particle_culling2=")
        {
            *line = "use_dynamic_particle_culling2=true".into();
        } else if (cfg.zero_effects || cfg.performance_mode)
            && line.starts_with("screenspace_effects=")
        {
            *line = "screenspace_effects=0".into();
        } else if line.starts_with("water_detail=") && (cfg.clean_terrain || cfg.high_performance) {
            *line = "water_detail=0".into();
        } else if line.starts_with("global_illumination_detail=")
            && (cfg.remove_shadows || cfg.high_performance)
        {
            *line = "global_illumination_detail=0".into();
        } else if cfg.disable_sounds && line.starts_with("sound_effects_volume2=") {
            *line = "sound_effects_volume2=0".into();
        } else if cfg.disable_sounds && line.starts_with("ambient_sound_volume2=") {
            *line = "ambient_sound_volume2=0".into();
        }
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

/// Apply CPU/GPU priority and efficiency mode to a game process.
#[cfg(windows)]
pub fn apply_process_tuning(pid: u32, low_priority: bool, eco_mode: bool) -> Result<()> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, ProcessPowerThrottling, SetPriorityClass, SetProcessInformation,
        BELOW_NORMAL_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
        PROCESS_SET_INFORMATION,
    };
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, pid) {
            let prio = if low_priority {
                BELOW_NORMAL_PRIORITY_CLASS
            } else {
                NORMAL_PRIORITY_CLASS
            };
            let _ = SetPriorityClass(handle, prio);

            if eco_mode {
                let mut state = PROCESS_POWER_THROTTLING_STATE {
                    Version: 1, // PROCESS_POWER_THROTTLING_CURRENT_VERSION
                    ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                    StateMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                };
                let _ = SetProcessInformation(
                    handle,
                    ProcessPowerThrottling,
                    &mut state as *mut _ as *mut std::ffi::c_void,
                    std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
                );
            }
            let _ = CloseHandle(handle);
            info!(
                pid,
                low_priority, eco_mode, "Applied process priority & efficiency tuning"
            );
        }
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
            fn GetProcAddress(
                hModule: *mut std::ffi::c_void,
                lpProcName: *const u8,
            ) -> *mut std::ffi::c_void;
        }

        let module = LoadLibraryA(c"dwmapi.dll".as_ptr().cast());
        if !module.is_null() {
            let proc = GetProcAddress(module, c"DwmSetWindowAttribute".as_ptr().cast());
            if !proc.is_null() {
                let func: DwmSetWindowAttributeFn = std::mem::transmute(proc);
                let val: u32 = if cloaked { 1 } else { 0 };
                let _ = func(
                    hwnd_val as *mut std::ffi::c_void,
                    13, // DWMWA_CLOAK
                    &val as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                );
                info!(hwnd = hwnd_val, cloaked, "Applied DWM window cloaking");
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_window_cloaking(_hwnd_val: usize, _cloaked: bool) -> Result<()> {
    Ok(())
}
