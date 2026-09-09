//! GGPK, Bundles & Binary Patcher Engine for Path of Exile 2.
//!
//! Provides file-based modifications (Camera Zoom, Minimap Fog of War Reveal,
//! Atlas Fog Reveal, Weather & Particles Removal, Color Mods) with dedicated
//! backup and restoration management, matching PoeRedux architecture.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{info, warn};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ─── Data Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GgpkPatchOptions {
    pub game_path: String,
    pub camera_zoom: bool,
    pub zoom_scale: f32,
    pub minimap_revealed: bool,
    pub atlas_revealed: bool,
    pub remove_rain_clouds: bool,
    pub clean_terrain: bool,
    pub remove_particles: bool,
    pub disable_sounds: bool,
    pub block_deadly_mods: bool,
    pub color_mods_enabled: bool,
}

impl Default for GgpkPatchOptions {
    fn default() -> Self {
        Self {
            game_path: String::new(),
            camera_zoom: true,
            zoom_scale: 1.35,
            minimap_revealed: false,
            atlas_revealed: false,
            remove_rain_clouds: false,
            clean_terrain: true,
            remove_particles: false,
            disable_sounds: false,
            block_deadly_mods: true,
            color_mods_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GgpkPatchStatus {
    pub game_path: String,
    pub game_dir: String,
    pub is_valid_game_path: bool,
    pub has_backup: bool,
    pub backup_folder: String,
    pub backup_count: usize,
    pub is_patched: bool,
    pub patched_features: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GgpkCompatibilityReport {
    pub game_path: String,
    pub asset_container: String,
    /// Fast local fingerprint. It deliberately avoids hashing the complete
    /// multi-gigabyte GGPK; the structural probe below is the authority.
    pub fingerprint: String,
    pub format: String,
    pub supported_features: Vec<String>,
    pub unsupported_features: Vec<String>,
    pub compatible: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PatchManifest {
    pub patched_at: String,
    pub original_exe_name: String,
    pub patched_features: Vec<String>,
    pub zoom_scale: f32,
    pub backup_files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetHelperResult {
    ok: bool,
    changed: bool,
    format: String,
    changed_assets: Vec<String>,
    already_patched_assets: Vec<String>,
    message: String,
    error: Option<String>,
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ─── Path Resolution & Discovery ─────────────────────────────────────────────

/// Resolve the game directory and main executable path from user input or system detection.
pub fn resolve_game_targets(given_path: &str) -> Result<(PathBuf, PathBuf)> {
    let trimmed = given_path.trim().trim_matches('"');
    let mut exe_path: Option<PathBuf> = None;

    if !trimmed.is_empty() {
        let p = PathBuf::from(trimmed);
        if p.is_file() {
            exe_path = Some(p);
        } else if p.is_dir() {
            for candidate in &[
                "PathOfExile.exe",
                "PathOfExileSteam.exe",
                "PathOfExile_x64.exe",
            ] {
                let candidate_path = p.join(candidate);
                if candidate_path.is_file() {
                    exe_path = Some(candidate_path);
                    break;
                }
            }
        }
    }

    if exe_path.is_none() {
        if let Some(detected) = crate::launcher::find_poe2_executable() {
            exe_path = Some(detected);
        }
    }

    let exe = exe_path.ok_or_else(|| {
        anyhow!("Không tìm thấy file thực thi Path of Exile 2. Hãy nhập đường dẫn chính xác đến PathOfExile.exe.")
    })?;

    let game_dir = exe
        .parent()
        .ok_or_else(|| anyhow!("Không xác định được thư mục game từ {}", exe.display()))?
        .to_path_buf();

    Ok((game_dir, exe))
}

/// Return the dedicated POEVH backup folder inside the game directory.
pub fn get_backup_dir(game_dir: &Path) -> PathBuf {
    game_dir.join("POEVH_Backups")
}

fn find_asset_container(game_dir: &Path) -> Option<PathBuf> {
    let content = game_dir.join("Content.ggpk");
    if content.is_file() {
        return Some(content);
    }

    let index = game_dir.join("Bundles2").join("_.index.bin");
    index.is_file().then_some(index)
}

/// Inspect the current game asset index without changing it. This is intended
/// to be run immediately after a patch so a changed shader/metadata contract
/// can be identified before the user attempts Apply.
pub fn probe_ggpk_compatibility(given_path: &str) -> Result<GgpkCompatibilityReport> {
    let (game_dir, exe_path) = resolve_game_targets(given_path)?;
    let container = find_asset_container(&game_dir)
        .ok_or_else(|| anyhow!("Không tìm thấy Content.ggpk hoặc Bundles2/_.index.bin"))?;
    let metadata = fs::metadata(&container)
        .with_context(|| format!("Không đọc được metadata: {}", container.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let fingerprint = format!("size:{:X}-mtime:{modified:X}", metadata.len());

    let probe = invoke_asset_helper("--probe", &container, None, None)?;
    let capabilities = [
        ("minimap", "capability:minimap-layout"),
        ("camera", "capability:camera"),
        ("environment", "capability:environment"),
        ("color_mods", "capability:color_mods"),
    ];
    let mut supported_features = Vec::new();
    let mut unsupported_features = Vec::new();
    for (feature, marker) in capabilities {
        if probe.changed_assets.iter().any(|path| path == marker) {
            supported_features.push(feature.to_string());
        } else {
            unsupported_features.push(feature.to_string());
        }
    }
    if probe
        .changed_assets
        .iter()
        .any(|path| path.ends_with("worldmap_fogofwar.fxgraph"))
    {
        supported_features.push("atlas".into());
    } else {
        unsupported_features.push("atlas".into());
    }
    let compatible = unsupported_features.is_empty();

    Ok(GgpkCompatibilityReport {
        game_path: exe_path.to_string_lossy().into_owned(),
        asset_container: container.to_string_lossy().into_owned(),
        fingerprint,
        format: probe.format,
        supported_features,
        unsupported_features,
        compatible,
        message: probe.message,
    })
}

fn normalize_path_for_compare(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

/// Return only PoE processes that belong to the installation being patched.
/// A different standalone/Steam copy must not block this installation.
fn running_game_pids_in(game_dir: &Path) -> Vec<u32> {
    let expected_dir = normalize_path_for_compare(game_dir);
    crate::instances::discover_game_processes()
        .unwrap_or_default()
        .into_iter()
        .filter(|process| {
            Path::new(&process.identity.exe_path)
                .parent()
                .map(normalize_path_for_compare)
                .is_some_and(|dir| dir == expected_dir)
        })
        .map(|process| process.identity.pid)
        .collect()
}

fn find_asset_helper() -> Result<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("POEVH-GgpkPatch.exe"));
            candidates.push(dir.join("PoevhGgpkPatcher.exe"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("POEVH-GgpkPatch.exe"));
        candidates.push(cwd.join("PoevhGgpkPatcher.exe"));
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tools")
        .join("poevh-ggpk-patcher")
        .join("publish")
        .join("PoevhGgpkPatcher.exe");
    candidates.push(dev);

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            anyhow!("Thiếu POEVH-GgpkPatch.exe cạnh POEVH.exe; không thể patch Content.ggpk")
        })
}

fn invoke_asset_helper(
    command: &str,
    target: &Path,
    features: Option<&str>,
    backup_dir: Option<&Path>,
) -> Result<AssetHelperResult> {
    let helper = find_asset_helper()?;
    let mut process = Command::new(&helper);
    process.arg(command).arg(target);
    if let Some(features) = features {
        process.arg(features);
    }
    if let Some(backup_dir) = backup_dir {
        process.arg(backup_dir);
    }
    #[cfg(windows)]
    process.creation_flags(CREATE_NO_WINDOW);

    let output = process
        .output()
        .with_context(|| format!("Không chạy được GGPK helper: {}", helper.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: AssetHelperResult = serde_json::from_str(stdout.trim()).with_context(|| {
        format!(
            "GGPK helper trả dữ liệu không hợp lệ (exit {:?}): {}",
            output.status.code(),
            stdout.trim()
        )
    })?;
    if !output.status.success() || !result.ok {
        return Err(anyhow!(
            "GGPK helper thất bại: {}{}",
            result.message,
            result
                .error
                .as_deref()
                .map(|e| format!(" — {e}"))
                .unwrap_or_default()
        ));
    }
    Ok(result)
}

// ─── Backup Management ────────────────────────────────────────────────────────

/// Create a pristine backup of a target file inside `POEVH_Backups/` and `<file>.bak`.
pub fn backup_game_file(target: &Path, backup_dir: &Path) -> Result<PathBuf> {
    if !target.is_file() {
        return Err(anyhow!(
            "File không tồn tại để sao lưu: {}",
            target.display()
        ));
    }

    fs::create_dir_all(backup_dir)
        .with_context(|| format!("Không tạo được thư mục backup: {}", backup_dir.display()))?;

    let file_name = target
        .file_name()
        .ok_or_else(|| anyhow!("Invalid filename for {}", target.display()))?;

    let dest = backup_dir.join(file_name);

    // Only backup if pristine copy does not exist yet
    if !dest.exists() {
        fs::copy(target, &dest)
            .with_context(|| format!("Lỗi khi copy file vào thư mục backup: {}", dest.display()))?;
        info!(from = %target.display(), to = %dest.display(), "Created pristine file backup");
    }

    // Also maintain a .bak copy alongside the file for external tools compatibility
    let local_bak = target.with_extension(format!(
        "{}.bak",
        target
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
    ));
    if !local_bak.exists() {
        let _ = fs::copy(target, &local_bak);
    }

    Ok(dest)
}

/// Restore all game files from the dedicated backup folder.
pub fn restore_all_backups(game_dir: &Path) -> Result<usize> {
    let running_pids = running_game_pids_in(game_dir);
    if !running_pids.is_empty() {
        return Err(anyhow!(
            "Game Path of Exile 2 đang chạy (PID: {:?}). Hãy thoát game hoàn toàn trước khi khôi phục asset!",
            running_pids
        ));
    }

    let backup_dir = get_backup_dir(game_dir);
    if !backup_dir.is_dir() {
        return Err(anyhow!(
            "Thư mục sao lưu không tồn tại: {}",
            backup_dir.display()
        ));
    }

    let manifest_path = backup_dir.join("patch_manifest.json");
    let mut restored_count = 0;

    let asset_manifest = backup_dir.join("ggpk_assets_manifest.json");
    if asset_manifest.is_file() {
        let container = find_asset_container(game_dir)
            .ok_or_else(|| anyhow!("Không tìm thấy Content.ggpk hoặc Bundles2/_.index.bin"))?;
        let restored =
            invoke_asset_helper("--restore", &container, Some("restore"), Some(&backup_dir))?;
        restored_count += restored.changed_assets.len();
    }

    for entry in fs::read_dir(&backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let file_name = entry.file_name();
            if file_name == "patch_manifest.json" || file_name == "ggpk_assets_manifest.json" {
                continue;
            }

            let target = game_dir.join(&file_name);
            fs::copy(&path, &target).with_context(|| {
                format!(
                    "Không thể khôi phục file {} từ {}",
                    target.display(),
                    path.display()
                )
            })?;
            restored_count += 1;
            info!(target = %target.display(), "Restored file from backup");
        }
    }

    if manifest_path.exists() {
        let _ = fs::remove_file(manifest_path);
    }

    Ok(restored_count)
}

// ─── Inspection & Status ──────────────────────────────────────────────────────

/// Query current patch status for the given game path or auto-detected path.
pub fn get_patch_status(given_path: &str) -> GgpkPatchStatus {
    let targets = resolve_game_targets(given_path);
    match targets {
        Ok((game_dir, exe_path)) => {
            let backup_dir = get_backup_dir(&game_dir);
            let has_backup_dir = backup_dir.is_dir();
            let manifest_path = backup_dir.join("patch_manifest.json");

            let mut backup_count = 0;
            if has_backup_dir {
                if let Ok(entries) = fs::read_dir(&backup_dir) {
                    backup_count = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.file_name() != "patch_manifest.json")
                        .count();
                }
            }

            let manifest: Option<PatchManifest> = if manifest_path.is_file() {
                fs::read_to_string(&manifest_path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
            } else {
                None
            };

            let is_patched =
                manifest.is_some() && !manifest.as_ref().unwrap().patched_features.is_empty();
            let patched_features = manifest.map(|m| m.patched_features).unwrap_or_default();

            GgpkPatchStatus {
                game_path: exe_path.to_string_lossy().to_string(),
                game_dir: game_dir.to_string_lossy().to_string(),
                is_valid_game_path: true,
                has_backup: backup_count > 0,
                backup_folder: backup_dir.to_string_lossy().to_string(),
                backup_count,
                is_patched,
                patched_features,
                message: if is_patched {
                    "Game đã được áp dụng các bản patch tối ưu hóa".into()
                } else if backup_count > 0 {
                    "Có bản sao lưu gốc sẵn sàng khôi phục".into()
                } else {
                    "Game ở trạng thái gốc chưa can thiệp".into()
                },
            }
        }
        Err(e) => GgpkPatchStatus {
            game_path: given_path.to_string(),
            game_dir: String::new(),
            is_valid_game_path: false,
            has_backup: false,
            backup_folder: String::new(),
            backup_count: 0,
            is_patched: false,
            patched_features: Vec::new(),
            message: format!("Chưa phát hiện file game: {e}"),
        },
    }
}

// ─── Patch Engine ─────────────────────────────────────────────────────────────

/// Apply comprehensive GGPK / Bundles / Binary patches to the specified game installation.
pub fn apply_ggpk_patches(opts: &GgpkPatchOptions) -> Result<GgpkPatchStatus> {
    let (game_dir, exe_path) = resolve_game_targets(&opts.game_path)?;
    let backup_dir = get_backup_dir(&game_dir);

    // 0. Preflight: check if PathOfExile.exe is running.
    let running_pids = running_game_pids_in(&game_dir);
    if !running_pids.is_empty() {
        return Err(anyhow!(
            "Game Path of Exile 2 đang chạy (PID: {:?}). Hãy thoát game hoàn toàn trước khi áp dụng cấu hình binary!",
            running_pids
        ));
    }

    let mut applied_features: Vec<String> = Vec::new();
    let asset_container = find_asset_container(&game_dir);
    let wants_asset_patch = opts.camera_zoom
        || opts.minimap_revealed
        || opts.atlas_revealed
        || opts.remove_rain_clouds
        || opts.remove_particles
        || opts.color_mods_enabled;

    // Current PoE2 builds keep minimap and Atlas logic in bundled assets. Probe
    // the exact paths before mutating either the executable or Content.ggpk.
    if wants_asset_patch {
        if let Some(container) = asset_container.as_deref() {
            let probe = invoke_asset_helper("--probe", container, None, None)?;
            if opts.minimap_revealed
                && !probe
                    .changed_assets
                    .iter()
                    .any(|p| p == "capability:minimap-layout")
            {
                return Err(anyhow!(
                    "Hai shader Mini-Map có tồn tại nhưng cấu trúc build hiện tại chưa vượt qua kiểm tra tương thích; từ chối patch để tránh hỏng Content.ggpk"
                ));
            }
            if opts.atlas_revealed
                && !probe
                    .changed_assets
                    .iter()
                    .any(|p| p.ends_with("worldmap_fogofwar.fxgraph"))
            {
                return Err(anyhow!(
                    "Build game hiện tại không có graph Atlas Fog cần thiết"
                ));
            }
            if opts.camera_zoom
                && !probe
                    .changed_assets
                    .iter()
                    .any(|p| p == "capability:camera")
            {
                return Err(anyhow!(
                    "Build game hiện tại không có metadata Camera cần thiết"
                ));
            }
            if (opts.remove_rain_clouds || opts.remove_particles)
                && !probe
                    .changed_assets
                    .iter()
                    .any(|p| p == "capability:environment")
            {
                return Err(anyhow!(
                    "Build game hiện tại không có Environment Settings cần thiết"
                ));
            }
            if opts.color_mods_enabled
                && !probe
                    .changed_assets
                    .iter()
                    .any(|p| p == "capability:color_mods")
            {
                return Err(anyhow!(
                    "Build game hiện tại không có Stat Descriptions để tô màu map mod"
                ));
            }
        }
    }

    let legacy_asset_fallback =
        (opts.minimap_revealed || opts.atlas_revealed) && asset_container.is_none();
    let needs_exe = (opts.camera_zoom && asset_container.is_none()) || legacy_asset_fallback;
    let mut exe_bytes = if needs_exe {
        backup_game_file(&exe_path, &backup_dir)?;
        fs::read(&exe_path)
            .with_context(|| format!("Không đọc được file thực thi: {}", exe_path.display()))?
    } else {
        Vec::new()
    };

    let mut exe_modified = false;

    // Feature: Camera Zoom
    if opts.camera_zoom && asset_container.is_none() {
        if apply_zoom_patch(&mut exe_bytes, opts.zoom_scale) {
            exe_modified = true;
            applied_features.push(format!("Camera Zoom ({:.2}x)", opts.zoom_scale));
        } else {
            warn!("Legacy camera zoom signature was not found; skipping unsafe opcode patch");
        }
    }

    // Legacy fallback for old unpacked builds. Current standalone/Steam builds
    // are handled through Content.ggpk/Bundles2 below.
    if opts.minimap_revealed && legacy_asset_fallback {
        if apply_minimap_reveal_patch(&mut exe_bytes) {
            exe_modified = true;
            applied_features.push("Maps Revealed (Minimap Unfog)".into());
        } else {
            return Err(anyhow!(
                "Không tìm thấy signature Mini-Map duy nhất trong PathOfExile.exe; build hiện tại cần patch shader Content.ggpk, không thể patch opcode cũ an toàn"
            ));
        }
    }

    if opts.atlas_revealed && legacy_asset_fallback {
        if apply_atlas_reveal_patch(&mut exe_bytes) {
            exe_modified = true;
            applied_features.push("Atlas Revealed (Fog of War)".into());
        } else {
            return Err(anyhow!(
                "Không tìm thấy signature Atlas duy nhất trong PathOfExile.exe; build hiện tại không hỗ trợ opcode patch này"
            ));
        }
    }

    let mut asset_was_changed = false;
    if wants_asset_patch && asset_container.is_some() {
        let container = asset_container
            .as_deref()
            .expect("asset container checked above");
        let mut features: Vec<String> = Vec::new();
        if opts.minimap_revealed {
            features.push("minimap".into());
        }
        if opts.atlas_revealed {
            features.push("atlas".into());
        }
        if opts.camera_zoom {
            features.push(format!("camera={:.3}", opts.zoom_scale));
        }
        if opts.remove_rain_clouds && !opts.remove_particles {
            features.push("rain".into());
        }
        if opts.remove_particles {
            features.push("environment_particles".into());
        }
        if opts.color_mods_enabled {
            features.push("color_mods".into());
        }
        let result = invoke_asset_helper(
            "--apply",
            container,
            Some(&features.join(",")),
            Some(&backup_dir),
        )?;
        asset_was_changed = result.changed;
        info!(
            format = %result.format,
            changed_count = result.changed_assets.len(),
            already_patched_count = result.already_patched_assets.len(),
            message = %result.message,
            "GGPK asset helper completed"
        );
        if opts.minimap_revealed {
            applied_features.push("Maps Revealed (GGPK shaders)".into());
        }
        if opts.atlas_revealed {
            applied_features.push("Atlas Revealed (GGPK graph)".into());
        }
        if opts.camera_zoom {
            applied_features.push(format!(
                "Camera Zoom ({:.2}x, GGPK metadata)",
                opts.zoom_scale
            ));
        }
        if opts.remove_rain_clouds {
            applied_features.push("Rain disabled (GGPK environment)".into());
        }
        if opts.remove_particles {
            applied_features.push("Environment particles disabled (GGPK assets)".into());
        }
        if opts.color_mods_enabled {
            applied_features.push("Waystone mod colors (GGPK stat descriptions)".into());
        }
    }

    if exe_modified {
        if let Err(error) = fs::write(&exe_path, &exe_bytes) {
            if asset_was_changed {
                if let Some(container) = asset_container.as_deref() {
                    let _ = invoke_asset_helper(
                        "--restore",
                        container,
                        Some("restore"),
                        Some(&backup_dir),
                    );
                }
            }
            return Err(error)
                .with_context(|| format!("Lỗi ghi file nhị phân game: {}", exe_path.display()));
        }
        info!(path = %exe_path.display(), "Successfully wrote patched executable");
    }

    // Apply supported INI settings as a separate layer. Asset-only settings are
    // never reported as successful merely because an INI file was saved.
    if let Some(ini_path) = crate::smoother::find_default_config_path() {
        let _ = crate::smoother::backup_config(&ini_path);
        let smoother_cfg = poe2_types::PoeSmootherConfig {
            enabled: true,
            remove_shadows: true,
            clean_terrain: opts.clean_terrain,
            remove_soft_particles: opts.remove_particles,
            zero_particles: opts.remove_particles,
            disable_sounds: opts.disable_sounds,
            patch_rain: opts.remove_rain_clouds,
            patch_clouds: opts.remove_rain_clouds,
            maps_revealed: opts.minimap_revealed,
            atlas_revealed: opts.atlas_revealed,
            zoom_enabled: opts.camera_zoom,
            zoom_scale: opts.zoom_scale,
            ..Default::default()
        };
        crate::smoother::apply_poe_smoother_policy(&ini_path, &smoother_cfg)?;
        if opts.clean_terrain {
            applied_features.push("Low-detail terrain policy".into());
        }
        if opts.remove_particles {
            applied_features.push("Dynamic particle culling".into());
        }
        if opts.disable_sounds {
            applied_features.push("Sound effects disabled".into());
        }
    }

    // 5. Save Patch Manifest
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let manifest = PatchManifest {
        patched_at: format!("unix_{now_secs}"),
        original_exe_name: exe_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        patched_features: applied_features.clone(),
        zoom_scale: opts.zoom_scale,
        backup_files: if needs_exe {
            vec![exe_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()]
        } else {
            vec!["ggpk_assets_manifest.json".into()]
        },
    };

    fs::create_dir_all(&backup_dir).with_context(|| {
        format!(
            "Không tạo được thư mục manifest backup: {}",
            backup_dir.display()
        )
    })?;
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    fs::write(backup_dir.join("patch_manifest.json"), manifest_json)
        .context("Không ghi được patch manifest")?;

    info!(features = ?applied_features, "GGPK & binary patch applied successfully");

    Ok(get_patch_status(&opts.game_path))
}

// ─── Pattern Matching & Byte Patchers ─────────────────────────────────────────

/// Helper to find a byte slice pattern in a target buffer.
#[allow(dead_code)]
fn find_pattern(bytes: &[u8], pattern: &[u8]) -> Option<usize> {
    bytes.windows(pattern.len()).position(|w| w == pattern)
}

/// Return a match only when the signature occurs exactly once. Short
/// instruction sequences are common in a large game executable; selecting
/// the first occurrence can corrupt an unrelated function after an update.
fn find_unique_pattern(bytes: &[u8], pattern: &[u8]) -> Option<usize> {
    let mut found = None;
    for (offset, window) in bytes.windows(pattern.len()).enumerate() {
        if window == pattern {
            if found.is_some() {
                return None;
            }
            found = Some(offset);
        }
    }
    found
}

/// Helper to find a byte slice with wildcard (mask: true means must match, false means any).
#[allow(dead_code)]
fn find_pattern_masked(bytes: &[u8], pattern: &[u8], mask: &[bool]) -> Option<usize> {
    if pattern.len() != mask.len() || bytes.len() < pattern.len() {
        return None;
    }
    bytes.windows(pattern.len()).position(|window| {
        window
            .iter()
            .zip(pattern.iter())
            .zip(mask.iter())
            .all(|((&b, &p), &m)| !m || b == p)
    })
}

/// Apply camera zoom distance patch directly in executable memory/file pattern.
pub fn apply_zoom_patch(bytes: &mut [u8], zoom_scale: f32) -> bool {
    let target_val: f32 = 1350.0 * zoom_scale;
    let new_bytes = target_val.to_le_bytes();

    let default_pattern = [0x00, 0xC0, 0xA8, 0x44];
    let mut matches = Vec::new();
    let mut offset = 0;
    while let Some(pos) = bytes[offset..]
        .windows(4)
        .position(|w| w == default_pattern)
    {
        let abs_pos = offset + pos;
        matches.push(abs_pos);
        offset = abs_pos + 1;
    }

    // Only patch if there is an exact unique match in the float constant table
    if matches.len() == 1 {
        let pos = matches[0];
        bytes[pos..pos + 4].copy_from_slice(&new_bytes);
        return true;
    }

    false
}

/// Apply minimap fog removal patch (revealing entire map tile state).
pub fn apply_minimap_reveal_patch(bytes: &mut [u8]) -> bool {
    let pattern = [0x84, 0xC0, 0x74];
    if let Some(pos) = find_unique_pattern(bytes, &pattern) {
        bytes[pos + 2] = 0xEB;
        return true;
    }
    false
}

/// Apply Atlas of Worlds fog of war reveal patch.
pub fn apply_atlas_reveal_patch(bytes: &mut [u8]) -> bool {
    let pattern = [0x80, 0x78, 0x00, 0x00, 0x74];
    let mask = [true, true, false, true, true];
    if let Some(pos) = find_pattern_masked(bytes, &pattern, &mask) {
        bytes[pos + 4] = 0xEB;
        return true;
    }
    false
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backup_and_restore_cycle() {
        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let game_dir = std::env::temp_dir().join(format!("poevh_ggpk_test_{unique_id}"));
        fs::create_dir_all(&game_dir).unwrap();
        let exe_file = game_dir.join("PathOfExile.exe");
        fs::write(&exe_file, b"ORIGINAL_EXE_BYTES_FOR_POE2").unwrap();

        let backup_dir = get_backup_dir(&game_dir);
        let backup_result = backup_game_file(&exe_file, &backup_dir);
        assert!(backup_result.is_ok());
        assert!(backup_dir.join("PathOfExile.exe").exists());

        // Modify the exe file
        fs::write(&exe_file, b"MODIFIED_PATCHED_BYTES").unwrap();
        assert_eq!(fs::read(&exe_file).unwrap(), b"MODIFIED_PATCHED_BYTES");

        // Restore
        let restore_result = restore_all_backups(&game_dir);
        assert!(restore_result.is_ok());
        assert_eq!(restore_result.unwrap(), 1);

        // Verify restoration
        let content = fs::read_to_string(&exe_file).unwrap();
        assert_eq!(content, "ORIGINAL_EXE_BYTES_FOR_POE2");
    }

    #[test]
    fn test_pattern_zoom_patch() {
        let mut mock_exe = vec![0x90, 0x90, 0x00, 0xC0, 0xA8, 0x44, 0x90];
        let patched = apply_zoom_patch(&mut mock_exe, 1.5);
        assert!(patched);
        let expected_val: f32 = 1350.0 * 1.5;
        let expected_bytes = expected_val.to_le_bytes();
        assert_eq!(&mock_exe[2..6], &expected_bytes);
    }

    #[test]
    fn test_pattern_minimap_reveal() {
        let mut mock_exe = vec![0x48, 0x89, 0x84, 0xC0, 0x74, 0x1A, 0xC3];
        let patched = apply_minimap_reveal_patch(&mut mock_exe);
        assert!(patched, "Minimap pattern should match and patch");
        assert_eq!(mock_exe[4], 0xEB);
    }

    #[test]
    fn test_pattern_minimap_rejects_ambiguous_signature() {
        let mut mock_exe = vec![0x84, 0xC0, 0x74, 0x01, 0x90, 0x84, 0xC0, 0x74, 0x02];
        assert!(!apply_minimap_reveal_patch(&mut mock_exe));
        assert_eq!(mock_exe[2], 0x74);
        assert_eq!(mock_exe[7], 0x74);
    }
}
