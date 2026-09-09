//! Multi-client launcher for Path of Exile 2.
//!
//! Handles locating PathOfExile.exe, launching multiple instances,
//! and integrating multi-instance mutex bypass.

use anyhow::{anyhow, Result};
use poe2_types::{ClientAccountProfile, ClientFlavor};
use std::path::{Path, PathBuf};

/// Pure routing decision: an instance never borrows another platform's executable.
/// Validate existence only in launch_poe2_client; this function does not spawn anything.
pub fn instance_launch_path(instance: &ClientAccountProfile) -> Result<&Path, &'static str> {
    match instance.flavor {
        ClientFlavor::Steam => return Err("Start this instance manually through Steam"),
        ClientFlavor::EpicGames => return Err("Start this instance manually through Epic Games"),
        ClientFlavor::Unknown => {
            return Err("Select a platform and executable for this instance first")
        }
        ClientFlavor::Standalone => {}
    }
    let path = Path::new(instance.exe_path.trim());
    if instance.exe_path.trim().is_empty() || !path.is_absolute() {
        return Err("Set an absolute Standalone executable path for this instance");
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    if !["pathofexile.exe", "pathofexile_x64.exe"]
        .iter()
        .any(|n| name.eq_ignore_ascii_case(n))
    {
        return Err("Use the Standalone PathOfExile.exe or PathOfExile_x64.exe");
    }
    Ok(path)
}
use std::process::{Child, Command};
use tracing::info;

/// Normal OS launch only. The new instance API does not invoke third-party probes.
pub fn launch_configured_instance(instance: &ClientAccountProfile) -> Result<u32> {
    Ok(spawn_configured_instance(instance)?.id())
}

/// Retain the process handle while waiting for a login window to avoid PID reuse.
pub fn spawn_configured_instance(instance: &ClientAccountProfile) -> Result<Child> {
    if !instance.enabled {
        return Err(anyhow!("Instance is disabled"));
    }
    prepare_multi_instance();
    let path = match instance_launch_path(instance) {
        Ok(p) => p.to_path_buf(),
        Err(_)
            if instance.flavor != ClientFlavor::Steam
                && instance.flavor != ClientFlavor::EpicGames =>
        {
            find_poe2_executable().ok_or_else(|| {
                anyhow!("Path of Exile 2 executable not found in standard paths. Please specify EXE path.")
            })?
        }
        Err(e) => return Err(anyhow!(e)),
    };
    if !path.is_file() {
        return Err(anyhow!(
            "Configured executable does not exist: {}",
            path.display()
        ));
    }
    let child = Command::new(&path)
        .args(["--nologo", "--windowed"])
        .current_dir(
            path.parent()
                .ok_or_else(|| anyhow!("Executable has no parent"))?,
        )
        .spawn()?;
    Ok(child)
}

const KNOWN_POE2_PATHS: &[&str] = &[
    r"D:\Grinding Gear Games\Path of Exile 2\PathOfExile.exe",
    r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2 - poe2_production\PathOfExile.exe",
    r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\PathOfExile.exe",
    r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile 2\PathOfExileSteam.exe",
];

/// Locate the installed Path of Exile 2 executable.
pub fn find_poe2_executable() -> Option<PathBuf> {
    for path_str in KNOWN_POE2_PATHS {
        let p = Path::new(path_str);
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }
    None
}

/// Run multi-instance probe / mutex preparation if sidecar is available.
pub fn prepare_multi_instance() -> bool {
    // Check local sidecars directory next to executable or working directory
    let candidate_paths = [
        PathBuf::from("sidecars/multi_instance/FindigoMultiInstanceProbe.exe"),
        PathBuf::from("FindigoMultiInstanceProbe.exe"),
    ];

    for probe in &candidate_paths {
        if probe.is_file() {
            if let Ok(mut child) = Command::new(probe).spawn() {
                let _ = child.wait();
                info!(path = %probe.display(), "Multi-instance probe executed successfully");
                return true;
            }
        }
    }
    false
}

/// Launch a PoE 2 client process.
pub fn launch_poe2_client(
    exe_path: Option<&Path>,
    client_index: u32,
    extra_args: &[&str],
) -> Result<u32> {
    let path = match exe_path {
        Some(p) => p.to_path_buf(),
        None => find_poe2_executable()
            .ok_or_else(|| anyhow!("Path of Exile 2 executable not found in standard paths"))?,
    };

    prepare_multi_instance();

    let mut cmd = Command::new(&path);
    cmd.arg("--nologo").arg("--windowed");

    for arg in extra_args {
        cmd.arg(arg);
    }

    info!(
        client_index,
        exe = %path.display(),
        "Launching Path of Exile 2 client process..."
    );

    let child: Child = cmd
        .spawn()
        .map_err(|e| anyhow!("Failed to spawn {}: {e}", path.display()))?;

    let pid = child.id();
    info!(client_index, pid, "Client launched successfully");
    Ok(pid)
}
