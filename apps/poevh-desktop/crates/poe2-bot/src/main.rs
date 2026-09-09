#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod logging;

use anyhow::Result;
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use poe2_input::{ActionMapper, FlaskController, KbmBridge, VirtualGamepadManager};
use poe2_overlay::start_server;
use poe2_types::{Actor, FollowerAction, MultiClientConfig};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};
use vigem_client::XButtons;

const MAX_PARTY_FOLLOWERS: usize = 5;

#[derive(Debug, Clone)]
struct PortalAttempt {
    target: String,
    attempts: u8,
    next_tick: u64,
}

#[derive(Default)]
struct PortalRecovery {
    area: Option<String>,
    pending: HashMap<String, PortalAttempt>,
}

impl PortalRecovery {
    /// When the main process changes area, followers may disappear from its
    /// entity list before they can request a warp. Pulse the documented couch
    /// teleport input per configured follower, then stop after bounded retries.
    fn observe(&mut self, snapshot: &poe2_engine::runtime::ApiSnapshot) -> Vec<(String, u8)> {
        let area = snapshot.leader.area.trim();
        if area.is_empty() || area == "Unknown" {
            return Vec::new();
        }
        match self.area.as_deref() {
            None => self.area = Some(area.to_owned()),
            Some(previous) if previous != area => {
                self.area = Some(area.to_owned());
                self.pending = configured_party_slots(&snapshot.settings.multi_client)
                    .into_iter()
                    .filter(|(name, _)| !name.is_empty())
                    .map(|(name, target)| {
                        (
                            name,
                            PortalAttempt {
                                target,
                                attempts: 0,
                                next_tick: snapshot.tick.saturating_add(2),
                            },
                        )
                    })
                    .collect();
                info!(%area, followers = self.pending.len(), "portal recovery armed after main area transition");
            }
            _ => {}
        }

        for follower in &snapshot.followers {
            if self.pending.remove(&follower.name).is_some() {
                info!(actor = %follower.name, %area, "portal recovery confirmed follower in main area");
            }
        }

        let retry_ticks = (1_000 / snapshot.config.tick_ms.clamp(10, 1_000)).max(1);
        let mut pulses = Vec::new();
        self.pending.retain(|actor, attempt| {
            if snapshot.tick < attempt.next_tick {
                return true;
            }
            if attempt.attempts >= 3 {
                warn!(%actor, target = %attempt.target, %area, "portal recovery exhausted after 3 attempts");
                return false;
            }
            attempt.attempts += 1;
            attempt.next_tick = snapshot.tick.saturating_add(retry_ticks);
            pulses.push((attempt.target.clone(), attempt.attempts));
            true
        });
        pulses
    }

    fn reset(&mut self) {
        self.pending.clear();
        self.area = None;
    }
}

#[cfg(windows)]
const SINGLE_INSTANCE_MUTEX: &str = "Local\\POEVH.Desktop.SingleInstance.v1";

/// Owns the named Windows mutex for the full lifetime of the application.
/// Both deployed executable paths use the same name, so they cannot start two
/// independent ViGEm managers in one Windows session.
#[cfg(windows)]
struct SingleInstanceGuard(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl SingleInstanceGuard {
    fn acquire_named(name: &str) -> Result<Option<Self>> {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
        use windows::Win32::System::Threading::CreateMutexW;

        let wide = name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let handle = unsafe { CreateMutexW(None, false, PCWSTR(wide.as_ptr()))? };
        let already_running = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if already_running {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
            Ok(None)
        } else {
            Ok(Some(Self(handle)))
        }
    }
}

#[cfg(windows)]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
fn acquire_single_instance() -> Result<Option<SingleInstanceGuard>> {
    SingleInstanceGuard::acquire_named(SINGLE_INSTANCE_MUTEX)
}

#[cfg(windows)]
fn show_already_running_message() {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND,
    };

    unsafe {
        let _ = MessageBoxW(
            None,
            w!("POEVH đã được mở. Hãy kiểm tra cửa sổ đang chạy hoặc biểu tượng ở khay hệ thống."),
            w!("POEVH đang chạy"),
            MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND,
        );
    }
}

/// Build follower slots from persistent profiles. A single-WASD profile owns no
/// virtual pad. Every dual-controller profile contributes both characters.
fn configured_party_slots(config: &MultiClientConfig) -> Vec<(String, String)> {
    let mut profiles = config
        .clients
        .iter()
        .filter(|profile| profile.enabled)
        .collect::<Vec<_>>();
    profiles.sort_by_key(|profile| (profile.id != config.main_instance_id, profile.id));

    let mut followers = Vec::with_capacity(MAX_PARTY_FOLLOWERS);
    for profile in profiles {
        if !config.requires_virtual_controllers(profile.id) {
            continue;
        }
        let (first, second) = VirtualGamepadManager::targets_for_instance(profile.id);
        followers.push((profile.char1_name.trim().to_string(), first));
        followers.push((profile.char2_name.trim().to_string(), second));
        if followers.len() >= MAX_PARTY_FOLLOWERS {
            break;
        }
    }
    followers.truncate(MAX_PARTY_FOLLOWERS);
    followers
}

/// Reconcile live actors with stable controller slots. Configured character
/// names win and a previous verified assignment may be retained. Unknown
/// nearby actors are never assigned to an input device.
fn reconcile_follower_targets(
    followers: &[Actor],
    config: &MultiClientConfig,
    previous: &HashMap<String, String>,
) -> HashMap<String, String> {
    let slots = configured_party_slots(config);
    let allowed = slots
        .iter()
        .map(|(_, target)| target.clone())
        .collect::<Vec<_>>();
    let mut assigned = HashMap::with_capacity(MAX_PARTY_FOLLOWERS);
    let mut used = HashSet::with_capacity(MAX_PARTY_FOLLOWERS);
    let live = followers
        .iter()
        .take(MAX_PARTY_FOLLOWERS)
        .collect::<Vec<_>>();

    for actor in &live {
        let actor_name = actor.name.trim();
        let configured = slots.iter().find(|(name, target)| {
            !name.is_empty() && name.eq_ignore_ascii_case(actor_name) && !used.contains(target)
        });
        if let Some((_, target)) = configured {
            assigned.insert(actor.name.clone(), target.clone());
            used.insert(target.clone());
        }
    }

    for actor in &live {
        if assigned.contains_key(&actor.name) {
            continue;
        }
        if let Some(target) = previous
            .get(&actor.name)
            .filter(|target| allowed.contains(target) && !used.contains(*target))
        {
            assigned.insert(actor.name.clone(), target.clone());
            used.insert(target.clone());
        }
    }

    assigned
}

fn removed_follow_targets(
    previous: &HashMap<String, String>,
    current: &HashMap<String, String>,
) -> Vec<String> {
    let current_targets = current.values().collect::<HashSet<_>>();
    previous
        .values()
        .filter(|target| !current_targets.contains(target))
        .cloned()
        .collect()
}

#[tokio::main]
async fn main() {
    #[cfg(windows)]
    let _single_instance = match acquire_single_instance() {
        Ok(Some(guard)) => guard,
        Ok(None) => {
            show_already_running_message();
            return;
        }
        Err(error) => {
            logging::show_error(&format!(
                "Không thể kiểm tra trạng thái POEVH đang chạy:\n{error:#}"
            ));
            return;
        }
    };

    if let Err(error) = logging::init() {
        logging::show_error(&format!("Không tạo được file log cho POEVH:\n{error:#}"));
        std::process::exit(1);
    }
    if let Err(error) = run().await {
        tracing::error!("POEVH stopped: {error:#}");
        logging::show_error(&format!("POEVH không thể tiếp tục:\n{error:#}"));
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    info!("POE2 Party-Follow Bot starting.");

    // World Adapter Initialization
    let mut runtime = {
        #[cfg(windows)]
        {
            use poe2_memory::MemoryWorldAdapter;
            match MemoryWorldAdapter::new() {
                Ok(adapter) => {
                    info!(
                        "Live memory adapter ready; it will attach/reconnect when POE2 is in an area"
                    );
                    BotRuntime::with_adapter(Box::new(adapter))
                }
                Err(e) => {
                    let detail = format!("{e:#}");
                    let mut runtime = BotRuntime::default_mock();
                    if detail.contains("process") && detail.contains("not found") {
                        runtime.set_memory_reader_status(poe2_types::MemoryReaderStatus::default());
                        warn!("Memory reader waiting for a running game process");
                    } else if detail.contains("UNSUPPORTED_POE2_BUILD") {
                        let build_key = detail
                            .split_whitespace()
                            .find(|part| part.starts_with("pe:"))
                            .unwrap_or("unknown")
                            .trim_end_matches(':');
                        runtime.set_memory_reader_status(
                            poe2_types::MemoryReaderStatus::unsupported(build_key, &detail),
                        );
                        warn!("{detail}; automation is fail-closed");
                    } else {
                        runtime.set_memory_reader_status(
                            poe2_types::MemoryReaderStatus::unavailable(&detail),
                        );
                        warn!("Memory reader unavailable ({detail}); automation is fail-closed");
                    }
                    runtime
                }
            }
        }
        #[cfg(not(windows))]
        {
            warn!("Non-Windows build - using mock world adapter");
            BotRuntime::default_mock()
        }
    };

    runtime.enable_profile_store(poe2_engine::profile_store::ProfileStore::new(
        poe2_engine::profile_store::ProfileStore::default_path()?,
    ))?;
    let runtime = Arc::new(Mutex::new(runtime));
    // Virtual Gamepad Manager (Lazy per-instance initialization)
    let raw_gamepad_mgr = VirtualGamepadManager::new();
    let gamepad_mgr = Arc::new(Mutex::new(raw_gamepad_mgr));

    // Reconcile the configured input topology immediately before launch.
    {
        let gm_for_launch = Arc::clone(&gamepad_mgr);
        runtime
            .lock()
            .set_pre_launch_hook(move |instance_id, needs_virtual_controllers| {
                let mut gm = gm_for_launch.lock();
                if needs_virtual_controllers {
                    gm.ensure_instance_controllers(instance_id)
                        .map(|(t1, t2)| {
                            info!(
                                instance_id,
                                t1,
                                t2,
                                "🎮 2 virtual controllers initialized for instance before launch"
                            );
                        })
                        .map_err(|e| e.to_string())
                } else {
                    gm.remove_instance_controllers(instance_id);
                    info!(
                        instance_id,
                        "⌨️ single-account WASD mode: no virtual controller allocated"
                    );
                    Ok(())
                }
            });
    }

    // OS inventory collection happens outside the engine mutex, independent of ticks.
    // Automatically binds pre-opened game instances and ensures their virtual controllers are ready.
    {
        let rt = Arc::clone(&runtime);
        let gm = Arc::clone(&gamepad_mgr);
        std::thread::spawn(move || {
            let mut tuned_processes = std::collections::HashSet::new();
            loop {
                let processes =
                    poe2_world::instances::discover_game_processes().map_err(|e| e.to_string());
                {
                    let mut r = rt.lock();
                    r.update_instance_inventory(processes);
                    r.auto_bind_unbound_instances();
                    r.sync_memory_target_to_main();
                    let statuses = r.runtime_instances();
                    let active_controller_ids: std::collections::HashSet<u32> = statuses
                        .iter()
                        .filter(|s| {
                            (s.status == "bound" || s.status == "launching")
                                && r.instance_needs_virtual_controllers(s.instance_id)
                        })
                        .map(|s| s.instance_id)
                        .collect();
                    for s in statuses {
                        if s.status == "bound" {
                            if r.instance_needs_virtual_controllers(s.instance_id)
                                && !gm.lock().has_instance_controllers(s.instance_id)
                            {
                                let _ = gm.lock().ensure_instance_controllers(s.instance_id);
                            } else if !r.instance_needs_virtual_controllers(s.instance_id) {
                                gm.lock().remove_instance_controllers(s.instance_id);
                            }
                            if let Some(ref proc) = s.process {
                                if let Some(profile) = r.client_profile(s.instance_id) {
                                    let tuning_key = (
                                        proc.identity.clone(),
                                        profile.black_screen,
                                        profile.black_screen,
                                    );
                                    if tuned_processes.insert(tuning_key) {
                                        let _ = poe2_world::smoother::apply_process_tuning(
                                            proc.identity.pid,
                                            profile.black_screen,
                                            profile.black_screen,
                                        );
                                    }
                                }
                            }
                        }
                    }
                    // Controllers exist only for live bound instances. This also
                    // cleans up a pre-launch pair if the game launch fails.
                    let controller_instances = gm.lock().controller_instance_ids();
                    for instance_id in controller_instances {
                        if !active_controller_ids.contains(&instance_id) {
                            gm.lock().remove_instance_controllers(instance_id);
                        }
                    }
                    tuned_processes.retain(|(identity, _, _)| {
                        r.instance_statuses().iter().any(|status| {
                            status
                                .process
                                .as_ref()
                                .is_some_and(|process| process.identity == *identity)
                        })
                    });
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });
    }

    let mut flask_ctrl = FlaskController::new();

    // Start the foreground-only WASD-to-controller polling bridge.
    let kbm_bridge = KbmBridge::new();
    kbm_bridge.start_worker(Arc::clone(&gamepad_mgr));

    // Register mouse & hotkey action callback
    {
        let rt_for_actions = Arc::clone(&runtime);
        poe2_input::KbmBridge::set_action_callback(move |action| {
            let mut r = rt_for_actions.lock();
            match action {
                "TOGGLE_BOT" => {
                    let cur = r.to_api_snapshot().running;
                    r.cmd_run(!cur);
                    info!(running = !cur, "🖱️ [Mouse 4 / Hotkey] Toggled Bot state");
                }
                "REGROUP" => {
                    r.cmd_join_p2();
                    info!("🖱️ [Mouse 5 / Hotkey] Triggered 1-Click Regroup Followers");
                }
                "AUTO_STASH" => {
                    poe2_input::stash_macro::execute_stash_sweep();
                }
                _ => {}
            }
        });
    }

    // Main Tick Loop Thread
    {
        let rt = Arc::clone(&runtime);
        let gm = Arc::clone(&gamepad_mgr);
        std::thread::spawn(move || {
            info!("Main decision & input tick loop started");
            let mut active_follow_targets = HashMap::<String, String>::new();
            let mut portal_recovery = PortalRecovery::default();

            loop {
                // 1. Advance engine state and get snapshot
                let snapshot = {
                    let mut r = rt.lock();
                    r.set_focus_slot(poe2_input::KbmBridge::get_focus_slot());
                    r.advance();
                    r.to_api_snapshot()
                };

                // 2. Sync KBM bridge toggle and mouse bindings from UI settings
                kbm_bridge
                    .set_enabled(snapshot.settings.kbm_bridge && !poe2_world::login::is_active());
                poe2_input::KbmBridge::update_mouse_config(&snapshot.settings.mouse_bindings);
                poe2_input::KbmBridge::update_controller_mapping(
                    &snapshot.settings.controller_mapping,
                );
                if poe2_world::login::is_active() {
                    let _ = gm.lock().broadcast_release();
                    rt.lock().drain_pad_commands();
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }

                // 3. Process pad commands - spawn each as own thread (non-blocking)
                let pad_cmds = {
                    let mut r = rt.lock();
                    r.drain_pad_commands()
                };

                for cmd in pad_cmds {
                    let gm_clone = Arc::clone(&gm);
                    if cmd.target == "FOCUS" {
                        let slot = cmd.button.parse::<u8>().unwrap_or(0);
                        poe2_input::KbmBridge::set_focus_slot(slot);
                    } else if cmd.target == "MACRO" && cmd.button == "STASH_SWEEP" {
                        poe2_input::stash_macro::execute_stash_sweep();
                    } else if cmd.button == "BROADCAST_A" {
                        std::thread::spawn(move || {
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.broadcast_button_a();
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(150));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.broadcast_release();
                        });
                    } else if cmd.button == "JOIN" {
                        let target = cmd.target.clone();
                        std::thread::spawn(move || {
                            info!(
                                "Holding START+A+X for Couch Co-Op join on {target} (non-blocking)"
                            );
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.press_button(
                                &target,
                                XButtons {
                                    raw: XButtons::START | XButtons::A | XButtons::X,
                                },
                            );
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(2000));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.release_all(&target);
                        });
                    } else if cmd.button == "A" || cmd.button == "START" {
                        let target = cmd.target.clone();
                        let raw_btn = if cmd.button == "A" {
                            XButtons::A
                        } else {
                            XButtons::START
                        };
                        std::thread::spawn(move || {
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.press_button(&target, XButtons { raw: raw_btn });
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(300));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.release_all(&target);
                        });
                    } else if cmd.button == "LEFT" || cmd.button == "RIGHT" {
                        let target = cmd.target.clone();
                        let raw_btn = if cmd.button == "LEFT" {
                            XButtons::LEFT
                        } else {
                            XButtons::RIGHT
                        };
                        std::thread::spawn(move || {
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.press_button(&target, XButtons { raw: raw_btn });
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(80));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.release_buttons(&target, XButtons { raw: raw_btn });
                        });
                    } else if cmd.dx != 0.0 || cmd.dy != 0.0 {
                        let target = cmd.target.clone();
                        std::thread::spawn(move || {
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.set_movement(&target, cmd.dx, cmd.dy, true);
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(250));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.release_movement(&target);
                        });
                    }
                }

                // Always end flask pulses from the previous tick, including
                // while a loading frame temporarily blocks automation.
                flask_ctrl.release_pending(&mut gm.lock());

                // 4. Gamepad input + Auto-Flask for Followers. A transient or
                // incompatible memory frame must never replay stale movement.
                let live_input_allowed =
                    snapshot.running && snapshot.memory_reader.state == "compatible";
                if live_input_allowed {
                    let mut extra_events = Vec::new();
                    let mut pickup_outcomes = Vec::new();

                    for (target, attempt) in portal_recovery.observe(&snapshot) {
                        let gm_clone = Arc::clone(&gm);
                        std::thread::spawn(move || {
                            let mut mgr = gm_clone.lock();
                            let result = mgr.press_button(
                                &target,
                                XButtons {
                                    raw: XButtons::DOWN,
                                },
                            );
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(120));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.release_buttons(
                                &target,
                                XButtons {
                                    raw: XButtons::DOWN,
                                },
                            );
                            match result {
                                Ok(()) => {
                                    info!(%target, attempt, "portal recovery input pulse sent")
                                }
                                Err(error) => {
                                    warn!(%target, attempt, %error, "portal recovery input failed")
                                }
                            }
                        });
                    }

                    {
                        let mut mgr = gm.lock();
                        // Memory actor names are character names, while ViGEm
                        // targets are stable P2/P3/... allocations.
                        let current_targets = reconcile_follower_targets(
                            &snapshot.followers,
                            &snapshot.settings.multi_client,
                            &active_follow_targets,
                        );
                        for (actor, target) in &current_targets {
                            if active_follow_targets.get(actor) != Some(target) {
                                info!(%actor, %target, "follower identity mapped to virtual controller");
                            }
                        }
                        for target in
                            removed_follow_targets(&active_follow_targets, &current_targets)
                        {
                            let _ = mgr.release_all(&target);
                        }
                        active_follow_targets = current_targets;
                        for follower in snapshot.followers.iter().take(MAX_PARTY_FOLLOWERS) {
                            let Some(target) = active_follow_targets.get(&follower.name) else {
                                continue;
                            };
                            let result = ActionMapper::apply_action_to_target(
                                follower,
                                target,
                                snapshot.leader.pos,
                                &mut mgr,
                            );
                            if let FollowerAction::AutoLoot { item_id, item, .. } = &follower.action
                            {
                                pickup_outcomes.push((
                                    *item_id,
                                    follower.name.clone(),
                                    item.clone(),
                                    result.map_err(|error| format!("{error:#}")),
                                ));
                            } else if let Err(error) = result {
                                warn!(
                                    actor = %follower.name,
                                    target = %target,
                                    action = %follower.action,
                                    %error,
                                    "controller action failed"
                                );
                            }
                        }
                        // Emit flask pulses after movement so they cannot be
                        // overwritten by the mapper in the same engine tick.
                        // The WASD leader has no virtual pad. Recovery input is
                        // generated only for mapped follower controllers.
                        extra_events.extend(flask_ctrl.evaluate_mapped_party(
                            &snapshot.leader,
                            &snapshot.followers,
                            (None, &active_follow_targets),
                            &snapshot.settings.flask,
                            snapshot.tick,
                            &mut mgr,
                        ));
                    }

                    if !pickup_outcomes.is_empty() {
                        let mut r = rt.lock();
                        for (item_id, actor, item, result) in pickup_outcomes {
                            r.record_pickup_input(item_id, &actor, &item, result);
                        }
                    }

                    // 5. Feed events into overlay live feed
                    if !extra_events.is_empty() {
                        let mut r = rt.lock();
                        for ev in extra_events {
                            r.push_event(&ev.actor, &ev.action, &ev.detail, ev.important);
                        }
                    }
                } else if !active_follow_targets.is_empty() {
                    let mut mgr = gm.lock();
                    for (_, target) in active_follow_targets.drain() {
                        let _ = mgr.release_all(&target);
                    }
                } else {
                    portal_recovery.reset();
                }

                // 6. Dynamic tick - reads fresh value every loop
                let sleep_ms = snapshot.config.tick_ms.clamp(10, 1000);
                std::thread::sleep(Duration::from_millis(sleep_ms));
            }
        });
    }

    // HTTP Overlay Server (background tokio task)
    let server_rt = Arc::clone(&runtime);
    tokio::spawn(async move {
        if let Err(e) = start_server(server_rt).await {
            warn!("HTTP server error: {e}");
        }
    });

    // Run Native Desktop App & In-Game Overlay Window (blocking)
    poe2_overlay::run_desktop_app(runtime)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn named_mutex_rejects_a_second_app_instance() {
        let name = format!("Local\\POEVH.SingleInstance.Test.{}", std::process::id());
        let first = SingleInstanceGuard::acquire_named(&name)
            .expect("first mutex acquisition should succeed")
            .expect("first caller should own the mutex");
        assert!(
            SingleInstanceGuard::acquire_named(&name)
                .expect("second mutex check should succeed")
                .is_none(),
            "a second POEVH process must be rejected before ViGEm initialization"
        );
        drop(first);
        assert!(SingleInstanceGuard::acquire_named(&name)
            .expect("mutex should be reusable after owner exits")
            .is_some());
    }

    #[test]
    fn follower_target_shrink_releases_only_removed_controllers() {
        let previous = HashMap::from([
            ("Aura".to_string(), "P2".to_string()),
            ("Culler".to_string(), "P3".to_string()),
            ("Looter".to_string(), "P4".to_string()),
        ]);
        let current = HashMap::from([("Aura".to_string(), "P2".to_string())]);
        let mut removed = removed_follow_targets(&previous, &current);
        removed.sort();
        assert_eq!(removed, vec!["P3", "P4"]);
    }

    #[test]
    fn native_main_is_not_a_virtual_follower_and_secondary_client_owns_two_pads() {
        let config = MultiClientConfig::default();
        let followers = vec![
            Actor::new("Aurabot", 0.0, 0.0),
            Actor::new("Culler", 0.0, 0.0),
            Actor::new("Looter1", 0.0, 0.0),
        ];
        let assigned = reconcile_follower_targets(&followers, &config, &HashMap::new());
        assert_eq!(assigned.get("Aurabot"), None);
        assert_eq!(assigned.get("Culler").map(String::as_str), Some("P3"));
        assert_eq!(assigned.get("Looter1").map(String::as_str), Some("P4"));
        assert_eq!(assigned.len(), 2);
    }

    #[test]
    fn unknown_nearby_actors_never_receive_a_controller() {
        let config = MultiClientConfig::default();
        let followers = (0..8)
            .map(|index| Actor::new(format!("Unknown{index}"), 0.0, 0.0))
            .collect::<Vec<_>>();
        let assigned = reconcile_follower_targets(&followers, &config, &HashMap::new());
        assert!(assigned.is_empty());
    }

    #[test]
    fn portal_recovery_is_armed_only_after_a_real_area_transition() {
        let runtime = BotRuntime::default_mock();
        let mut snapshot = runtime.to_api_snapshot();
        snapshot.leader.area = "Area A".into();
        snapshot.followers.clear();
        snapshot.tick = 1;
        let mut recovery = PortalRecovery::default();
        assert!(recovery.observe(&snapshot).is_empty());

        snapshot.leader.area = "Area B".into();
        snapshot.tick = 2;
        assert!(recovery.observe(&snapshot).is_empty());
        snapshot.tick = 4;
        let pulses = recovery.observe(&snapshot);
        assert_eq!(pulses.len(), 4);
        assert!(pulses.iter().all(|(target, attempt)| matches!(
            target.as_str(),
            "P3" | "P4" | "P5" | "P6"
        ) && *attempt == 1));
    }
}
