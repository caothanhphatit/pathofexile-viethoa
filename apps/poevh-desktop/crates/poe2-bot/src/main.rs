#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod logging;

use anyhow::Result;
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use poe2_input::{ActionMapper, FlaskController, KbmBridge, VirtualGamepadManager};
use poe2_overlay::start_server;
use poe2_types::{Actor, FollowerAction, InstanceStatus, MultiClientConfig};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{sync_channel, SyncSender, TrySendError},
    Arc,
};
use std::time::{Duration, Instant};
use tracing::{info, warn};
use vigem_client::XButtons;

const MAX_PARTY_FOLLOWERS: usize = 5;
const MAX_TRANSIENT_PAD_JOBS: usize = 32;
const MAX_TRANSIENT_PAD_JOB_AGE: Duration = Duration::from_secs(1);

// Controller acceptance route decompiled from the locally installed
// MultiPilot Auto Party flow (Start -> Current Party -> invite -> accept).
// Each tuple is (button, hold_ms, settle_ms).
const PARTY_INVITE_ACCEPT_STEPS: [(u16, u64, u64); 4] = [
    (XButtons::START, 100, 500),
    (XButtons::LEFT, 80, 350),
    (XButtons::LEFT, 80, 550),
    (XButtons::A, 80, 500),
];

#[derive(Debug)]
enum TransientPadAction {
    BroadcastA,
    Press {
        target: String,
        button: u16,
        hold: Duration,
    },
    Move {
        target: String,
        dx: f32,
        dy: f32,
        hold: Duration,
    },
}

#[derive(Debug)]
struct TransientPadJob {
    queued_at: Instant,
    action: TransientPadAction,
}

fn queue_transient_pad_job(sender: &SyncSender<TransientPadJob>, action: TransientPadAction) {
    let job = TransientPadJob {
        queued_at: Instant::now(),
        action,
    };
    match sender.try_send(job) {
        Ok(()) => {}
        Err(TrySendError::Full(job)) => {
            warn!(action = ?job.action, "Transient controller queue is full; dropping command")
        }
        Err(TrySendError::Disconnected(job)) => {
            warn!(action = ?job.action, "Transient controller worker stopped; dropping command")
        }
    }
}

fn execute_transient_pad_job(
    manager: &Arc<Mutex<VirtualGamepadManager>>,
    job: TransientPadJob,
) -> Result<()> {
    if job.queued_at.elapsed() > MAX_TRANSIENT_PAD_JOB_AGE {
        warn!(action = ?job.action, "Discarding stale transient controller command");
        return Ok(());
    }
    match job.action {
        TransientPadAction::BroadcastA => {
            manager.lock().broadcast_button_a()?;
            std::thread::sleep(Duration::from_millis(150));
            manager.lock().broadcast_release()?;
        }
        TransientPadAction::Press {
            target,
            button,
            hold,
        } => {
            manager
                .lock()
                .press_button(&target, XButtons { raw: button })?;
            std::thread::sleep(hold);
            if let Err(error) = manager
                .lock()
                .release_buttons(&target, XButtons { raw: button })
            {
                let _ = manager.lock().release_all(&target);
                return Err(error);
            }
        }
        TransientPadAction::Move {
            target,
            dx,
            dy,
            hold,
        } => {
            manager.lock().set_movement(&target, dx, dy, true)?;
            std::thread::sleep(hold);
            if let Err(error) = manager.lock().release_movement(&target) {
                let _ = manager.lock().release_all(&target);
                return Err(error);
            }
        }
    }
    Ok(())
}

fn pulse_controller_button(
    manager: &Arc<Mutex<VirtualGamepadManager>>,
    target: &str,
    button: u16,
    hold_ms: u64,
) -> Result<()> {
    manager
        .lock()
        .press_button(target, XButtons { raw: button })?;
    std::thread::sleep(Duration::from_millis(hold_ms));
    if let Err(error) = manager
        .lock()
        .release_buttons(target, XButtons { raw: button })
    {
        let _ = manager.lock().release_all(target);
        return Err(error);
    }
    Ok(())
}

fn accept_party_invite(manager: &Arc<Mutex<VirtualGamepadManager>>, target: &str) -> Result<()> {
    for (step, (button, hold_ms, settle_ms)) in
        PARTY_INVITE_ACCEPT_STEPS.iter().copied().enumerate()
    {
        info!(
            target,
            step = step + 1,
            button,
            hold_ms,
            settle_ms,
            "executing party invitation controller navigation"
        );
        pulse_controller_button(manager, target, button, hold_ms)?;
        std::thread::sleep(Duration::from_millis(settle_ms));
    }
    Ok(())
}

fn client_is_in_world(pid: u32, started_at: &str) -> bool {
    poe2_world::connector::get_client_location_verified(pid, Some(started_at)).is_some_and(
        |location| {
            !location.area.trim().is_empty()
                && location.instance_id.is_some()
                && location
                    .observed_at
                    .is_some_and(|observed_at| observed_at.elapsed() <= Duration::from_secs(900))
        },
    )
}

struct PartyOperationGuard(Arc<AtomicBool>);

impl PartyOperationGuard {
    fn try_acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(Arc::clone(flag)))
    }
}

impl Drop for PartyOperationGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone)]
enum PartyPhase {
    Waiting,
    InviteReady {
        attempts: u8,
        next_attempt: Instant,
    },
    AwaitingPartyJoin {
        attempts: u8,
        deadline: Instant,
    },
    WarpReady {
        attempts: u8,
        next_attempt: Instant,
        close_party_menu: bool,
    },
    AwaitingWarp {
        attempts: u8,
        target_instance: u64,
        command_started_at: Instant,
        deadline: Instant,
    },
    Complete {
        leader_instance: Option<u64>,
    },
    Failed,
}

fn leader_transition_requires_warp(
    completed_leader_instance: Option<u64>,
    leader_instance: Option<u64>,
    follower_instance: Option<u64>,
) -> Option<(u64, u64)> {
    let target = leader_instance?;
    if Some(target) == completed_leader_instance {
        return None;
    }
    let current = follower_instance.unwrap_or(0);
    (target != current).then_some((current, target))
}

fn run_warp_to_leader(manager: &Arc<Mutex<VirtualGamepadManager>>, target: &str) -> Result<()> {
    // 1. Reset any open menus to clean state (press B twice)
    pulse_controller_button(manager, target, XButtons::B, 80)?;
    std::thread::sleep(Duration::from_millis(80));
    pulse_controller_button(manager, target, XButtons::B, 80)?;
    std::thread::sleep(Duration::from_millis(150));

    // 2. Open pause menu: Start -> D-pad Left into party menu
    pulse_controller_button(manager, target, XButtons::START, 120)?;
    std::thread::sleep(Duration::from_millis(150));
    pulse_controller_button(manager, target, XButtons::LEFT, 100)?;
    std::thread::sleep(Duration::from_millis(80));

    // 3. Ensure cursor is at the top of the party list (Party Leader)
    pulse_controller_button(manager, target, XButtons::UP, 80)?;
    std::thread::sleep(Duration::from_millis(50));
    pulse_controller_button(manager, target, XButtons::UP, 80)?;
    std::thread::sleep(Duration::from_millis(80));

    // 4. Select leader -> warp option -> confirm
    pulse_controller_button(manager, target, XButtons::A, 100)?;
    std::thread::sleep(Duration::from_millis(120));
    pulse_controller_button(manager, target, XButtons::A, 100)?;
    std::thread::sleep(Duration::from_millis(200));
    pulse_controller_button(manager, target, XButtons::A, 100)?;
    std::thread::sleep(Duration::from_millis(300));

    // 5. Clean up open overlay
    pulse_controller_button(manager, target, XButtons::B, 100)?;
    Ok(())
}

/// A follower counts as a verified party member when either its own Client.txt
/// or the leader's Client.txt logged "<name> has joined the party." for one of
/// its configured characters during the current process generations. The
/// leader's log is the authoritative source: the joining client does not
/// always echo its own join line, while every other member's client does.
fn instance_has_verified_party_member(
    runtime: &BotRuntime,
    instance_id: u32,
    leader: &poe2_types::ProcessIdentity,
) -> bool {
    let Some(identity) = runtime.bound_identity(instance_id).ok() else {
        return false;
    };
    runtime.client_profile(instance_id).is_some_and(|profile| {
        [&profile.char1_name, &profile.char2_name]
            .into_iter()
            .filter(|name| !name.trim().is_empty())
            .any(|name| {
                poe2_world::connector::is_verified_party_member_for_client(
                    leader.pid,
                    &leader.started_at,
                    name,
                ) || poe2_world::connector::is_verified_party_member_for_client(
                    identity.pid,
                    &identity.started_at,
                    name,
                )
            })
    })
}

fn is_target_automation_enabled(target: &str, runtime_instances: &[InstanceStatus]) -> bool {
    for inst in runtime_instances {
        let (first, second) = VirtualGamepadManager::targets_for_instance(inst.instance_id);
        if target == first || target == second {
            return inst.automation_enabled;
        }
    }
    true
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
    let party_operation_active = Arc::new(AtomicBool::new(false));
    // Every multi-step controller operation takes this lock for its entire
    // lifetime. A delayed release from an older command therefore cannot
    // neutralize the accept/warp sequence that follows it.
    let controller_operation = Arc::new(Mutex::new(()));

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
        let controller_operation = Arc::clone(&controller_operation);
        std::thread::spawn(move || {
            let mut tuned_processes = std::collections::HashSet::new();
            // PIDs whose identity was published to the Client.txt connector on
            // a previous pass, so an unbind can be told apart from a new bind.
            let mut published_bindings = HashMap::<u32, String>::new();
            loop {
                let processes =
                    poe2_world::instances::discover_game_processes().map_err(|e| e.to_string());
                let (
                    active_controller_ids,
                    controller_modes,
                    tuning_requests,
                    live_identities,
                    has_scan_error,
                ) = {
                    let mut r = rt.lock();
                    r.update_instance_inventory(processes);
                    r.auto_bind_unbound_instances();
                    r.sync_memory_target_to_main();
                    // The engine registry is pure state; this loop owns the
                    // side effect of scoping Client.txt evidence to the exact
                    // bound process generations.
                    let current_bindings = r
                        .bound_identities()
                        .into_iter()
                        .map(|identity| (identity.pid, identity.started_at))
                        .collect::<HashMap<_, _>>();
                    for (pid, _) in published_bindings
                        .iter()
                        .filter(|(pid, started_at)| current_bindings.get(pid) != Some(started_at))
                    {
                        poe2_world::connector::invalidate_client_location(*pid);
                    }
                    for (pid, started_at) in &current_bindings {
                        poe2_world::connector::associate_client_identity(*pid, started_at);
                    }
                    published_bindings = current_bindings;
                    let statuses = r.runtime_instances();
                    let active_controller_ids: std::collections::HashSet<u32> = statuses
                        .iter()
                        .filter(|s| {
                            (s.status == "bound" || s.status == "launching")
                                && r.instance_needs_virtual_controllers(s.instance_id)
                        })
                        .map(|s| s.instance_id)
                        .collect();
                    let controller_modes = statuses
                        .iter()
                        .filter(|status| status.status == "bound")
                        .map(|status| {
                            (
                                status.instance_id,
                                r.instance_needs_virtual_controllers(status.instance_id),
                            )
                        })
                        .collect::<Vec<_>>();
                    let tuning_requests = statuses
                        .iter()
                        .filter(|status| status.status == "bound")
                        .filter_map(|status| {
                            let process = status.process.as_ref()?;
                            let profile = r.client_profile(status.instance_id)?;
                            Some((
                                process.identity.clone(),
                                process.identity.pid,
                                profile.black_screen,
                            ))
                        })
                        .collect::<Vec<_>>();
                    let live_identities = statuses
                        .iter()
                        .filter_map(|status| {
                            status
                                .process
                                .as_ref()
                                .map(|process| process.identity.clone())
                        })
                        .collect::<HashSet<_>>();
                    let has_scan_error = r.has_scan_error();
                    (
                        active_controller_ids,
                        controller_modes,
                        tuning_requests,
                        live_identities,
                        has_scan_error,
                    )
                };

                // Driver waits and unplug calls must never run while holding
                // the shared runtime mutex. Serialize them with button macros
                // so a lifecycle refresh cannot neutralize an in-flight route.
                {
                    let _operation_guard = controller_operation.lock();
                    let mut manager = gm.lock();
                    for (instance_id, needs_controllers) in controller_modes {
                        if needs_controllers && !manager.has_instance_controllers(instance_id) {
                            if let Err(error) = manager.ensure_instance_controllers(instance_id) {
                                warn!(instance_id, %error, "failed to ensure instance controllers");
                            }
                        } else if !needs_controllers && !has_scan_error {
                            manager.remove_instance_controllers(instance_id);
                        }
                    }
                    // Controllers exist only for live bound instances. This also
                    // cleans up a pre-launch pair if the game launch fails.
                    // Never unplug on transient scan errors.
                    if !has_scan_error {
                        let controller_instances = manager.controller_instance_ids();
                        for instance_id in controller_instances {
                            if !active_controller_ids.contains(&instance_id) {
                                manager.remove_instance_controllers(instance_id);
                            }
                        }
                    }
                }

                for (identity, pid, black_screen) in tuning_requests {
                    let tuning_key = (identity, black_screen, black_screen);
                    if tuned_processes.insert(tuning_key) {
                        if let Err(error) = poe2_world::smoother::apply_process_tuning(
                            pid,
                            black_screen,
                            black_screen,
                        ) {
                            warn!(pid, %error, "process tuning failed");
                        }
                    }
                }
                tuned_processes.retain(|(identity, _, _)| live_identities.contains(identity));
                std::thread::sleep(Duration::from_secs(2));
            }
        });
    }

    // Auto Party mirrors MultiPilot: send a fresh invite from the exact leader
    // window, accept it on the exact receiver controller, then verify roster
    // membership before attempting a warp. Incoming Client.txt invites remain
    // supported as an alternate way to arm the receiver.
    {
        let rt = Arc::clone(&runtime);
        let gm = Arc::clone(&gamepad_mgr);
        let operation_active = Arc::clone(&party_operation_active);
        let controller_operation = Arc::clone(&controller_operation);
        std::thread::spawn(move || {
            let mut sessions = HashMap::<String, PartyPhase>::new();
            let mut recovery_revision = poe2_world::connector::party_recovery_revision();
            loop {
                let party_enabled = rt.lock().to_api_snapshot().settings.party.enabled;
                if !party_enabled {
                    sessions.clear();
                    poe2_world::connector::clear_verified_party_members();
                    let _ = poe2_world::connector::take_party_invites();
                    let _ = rt.lock().take_party_invite_requests();
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }

                let invite_requests = rt.lock().take_party_invite_requests();

                let (leader, leader_name, secondaries) = {
                    let r = rt.lock();
                    let statuses = r.runtime_instances();
                    let leader_status = statuses
                        .iter()
                        .find(|status| status.is_main && status.status == "bound");
                    let leader = leader_status.and_then(|status| status.binding.clone());
                    let leader_name = leader_status
                        .and_then(|status| r.client_profile(status.instance_id))
                        .map(|profile| profile.char1_name.trim().to_owned())
                        .filter(|name| !name.is_empty());
                    let secondaries = statuses
                        .into_iter()
                        .filter(|status| {
                            !status.is_main
                                && status.status == "bound"
                                && r.instance_needs_virtual_controllers(status.instance_id)
                        })
                        .filter_map(|status| {
                            status
                                .binding
                                .map(|identity| (status.instance_id, identity))
                        })
                        .collect::<Vec<_>>();
                    (leader, leader_name, secondaries)
                };

                // Party evidence is scoped per PID and process generation by
                // the connector itself (a restarted client gets an empty
                // roster when its identity is re-associated), so a restart of
                // one follower must not erase what other clients verified.
                sessions.retain(|started_at, _| {
                    secondaries
                        .iter()
                        .any(|(_, identity)| identity.started_at == *started_at)
                });
                for (_, identity) in &secondaries {
                    sessions
                        .entry(identity.started_at.clone())
                        .or_insert(PartyPhase::Waiting);
                }

                // Only a click on a runtime client's Invite Party button can
                // arm sending/acceptance. A process becoming bound is not an
                // in-game readiness signal and must never generate inputs.
                for requested_id in invite_requests {
                    if let Some((_, identity)) = secondaries
                        .iter()
                        .find(|(instance_id, _)| *instance_id == requested_id)
                    {
                        sessions.insert(
                            identity.started_at.clone(),
                            PartyPhase::InviteReady {
                                attempts: 0,
                                next_attempt: Instant::now(),
                            },
                        );
                        info!(
                            instance_id = requested_id,
                            pid = identity.pid,
                            "explicit party invite requested from overview"
                        );
                    } else {
                        warn!(
                            instance_id = requested_id,
                            "party invite request ignored: no bound follower client"
                        );
                    }
                }

                let requested_revision = poe2_world::connector::party_recovery_revision();
                if requested_revision != recovery_revision {
                    recovery_revision = requested_revision;
                    for (_, identity) in &secondaries {
                        sessions.insert(
                            identity.started_at.clone(),
                            PartyPhase::WarpReady {
                                attempts: 0,
                                next_attempt: Instant::now(),
                                close_party_menu: false,
                            },
                        );
                    }
                    info!(
                        revision = requested_revision,
                        followers = secondaries.len(),
                        "manual follower regroup armed for bound secondary clients"
                    );
                }

                // Client.txt invite events are still collected for diagnostics,
                // but never initiate input; the explicit overview action is
                // the sole trigger for this workflow.
                let _ = poe2_world::connector::take_party_invites();

                let Some(leader) = leader else {
                    let waiting = sessions
                        .iter()
                        .filter(|(_, phase)| matches!(phase, PartyPhase::InviteReady { .. }))
                        .map(|(started_at, _)| started_at.clone())
                        .collect::<Vec<_>>();
                    for started_at in waiting {
                        sessions.insert(started_at, PartyPhase::Failed);
                    }
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                };
                let Some(leader_name) = leader_name.as_deref() else {
                    let waiting = sessions
                        .iter()
                        .filter(|(_, phase)| matches!(phase, PartyPhase::InviteReady { .. }))
                        .map(|(started_at, _)| started_at.clone())
                        .collect::<Vec<_>>();
                    for started_at in waiting {
                        sessions.insert(started_at, PartyPhase::Failed);
                    }
                    std::thread::sleep(Duration::from_millis(500));
                    continue;
                };

                for (instance_id, identity) in &secondaries {
                    let phase = sessions
                        .get(&identity.started_at)
                        .cloned()
                        .unwrap_or(PartyPhase::Waiting);
                    let (first, second) = VirtualGamepadManager::targets_for_instance(*instance_id);
                    match phase {
                        PartyPhase::InviteReady {
                            attempts,
                            next_attempt,
                        } => {
                            if Instant::now() < next_attempt {
                                continue;
                            }
                            // A bound PID is not proof that a character has entered
                            // the world. Fail closed before sending chat or controller
                            // input; retry is user-driven via the overview button.
                            if !client_is_in_world(leader.pid, &leader.started_at)
                                || !client_is_in_world(identity.pid, &identity.started_at)
                            {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(leader_pid = leader.pid, receiver_pid = identity.pid, instance_id,
                                    "party invite refused: leader and receiver must both have fresh in-world Client.txt state");
                                continue;
                            }
                            let target_name = rt
                                .lock()
                                .client_profile(*instance_id)
                                .map(|profile| profile.char1_name.trim().to_owned())
                                .filter(|name| !name.is_empty());
                            let Some(target_name) = target_name else {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(instance_id, pid = identity.pid, "party invite refused: configure the receiver's actual in-game character name first");
                                continue;
                            };
                            if target_name.eq_ignore_ascii_case(leader_name) {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(instance_id, pid = identity.pid, %target_name, "auto party refused to invite the leader character to itself");
                                continue;
                            }
                            let Some(_guard) = PartyOperationGuard::try_acquire(&operation_active)
                            else {
                                continue;
                            };
                            let _controller_guard = controller_operation.lock();
                            let attempt = attempts + 1;
                            let invite_result = poe2_world::instances::operate_window(
                                &leader, "focus",
                            )
                            .and_then(|()| {
                                poe2_world::instances::send_party_invite(&leader, &target_name)
                            });
                            if let Err(error) = invite_result {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(leader_pid = leader.pid, receiver_pid = identity.pid, instance_id, attempt, %target_name, %error, "party invite command failed; stopped without retry");
                                continue;
                            }
                            info!(leader_pid = leader.pid, receiver_pid = identity.pid, instance_id, attempt, %target_name, "fresh /invite command sent from main client");

                            if let Err(error) =
                                poe2_world::instances::operate_window(identity, "focus")
                            {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(instance_id, pid = identity.pid, attempt, %error, "invite sent but receiver focus failed; stopped without retry");
                                continue;
                            }
                            std::thread::sleep(Duration::from_millis(180));
                            {
                                let mut manager = gm.lock();
                                let _ = manager.release_all(&first);
                                let _ = manager.release_all(&second);
                            }
                            match accept_party_invite(&gm, &first) {
                                Ok(()) => {
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::AwaitingPartyJoin {
                                            attempts: attempt,
                                            deadline: Instant::now() + Duration::from_secs(5),
                                        },
                                    );
                                    info!(instance_id, pid = identity.pid, target = %first, attempt, steps = PARTY_INVITE_ACCEPT_STEPS.len(), "receiver accept sequence delivered; waiting for Client.txt party roster confirmation");
                                }
                                Err(error) => {
                                    sessions
                                        .insert(identity.started_at.clone(), PartyPhase::Failed);
                                    warn!(instance_id, pid = identity.pid, target = %first, attempt, %error, "receiver accept input failed; stopped without retry");
                                }
                            }
                        }
                        PartyPhase::AwaitingPartyJoin { attempts, deadline } => {
                            let joined = {
                                let r = rt.lock();
                                instance_has_verified_party_member(&r, *instance_id, &leader)
                            };
                            if joined {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::WarpReady {
                                        attempts: 0,
                                        next_attempt: Instant::now(),
                                        close_party_menu: false,
                                    },
                                );
                                info!(instance_id, pid = identity.pid, attempts, "party roster confirms receiver joined; preparing warp to leader");
                            } else if Instant::now() >= deadline {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(instance_id, pid = identity.pid, attempts, "no party-join confirmation before timeout; stopped after one invite/accept attempt; click Mời party to retry manually");
                            }
                        }
                        PartyPhase::WarpReady {
                            attempts,
                            next_attempt,
                            close_party_menu,
                        } => {
                            if Instant::now() < next_attempt {
                                continue;
                            }
                            if close_party_menu {
                                let Some(_guard) =
                                    PartyOperationGuard::try_acquire(&operation_active)
                                else {
                                    continue;
                                };
                                let _controller_guard = controller_operation.lock();
                                if let Err(error) =
                                    poe2_world::instances::operate_window(identity, "focus")
                                {
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::WarpReady {
                                            attempts,
                                            next_attempt: Instant::now()
                                                + Duration::from_millis(500),
                                            close_party_menu: true,
                                        },
                                    );
                                    warn!(instance_id, pid = identity.pid, %error, "party accepted but could not refocus receiver to close its menu; retry scheduled");
                                    continue;
                                }
                                std::thread::sleep(Duration::from_millis(180));
                                match pulse_controller_button(&gm, &first, XButtons::B, 60) {
                                    Ok(()) => {
                                        sessions.insert(
                                            identity.started_at.clone(),
                                            PartyPhase::WarpReady {
                                                attempts,
                                                next_attempt: Instant::now(),
                                                close_party_menu: false,
                                            },
                                        );
                                        info!(instance_id, pid = identity.pid, target = %first, "closed Current Party menu after invite was cleared");
                                    }
                                    Err(error) => {
                                        sessions.insert(
                                            identity.started_at.clone(),
                                            PartyPhase::WarpReady {
                                                attempts,
                                                next_attempt: Instant::now()
                                                    + Duration::from_millis(500),
                                                close_party_menu: true,
                                            },
                                        );
                                        warn!(instance_id, pid = identity.pid, target = %first, %error, "failed to close Current Party menu after accepting invite; retry scheduled");
                                    }
                                }
                                continue;
                            }
                            let is_verified_party = {
                                let r = rt.lock();
                                instance_has_verified_party_member(&r, *instance_id, &leader)
                            };
                            if !is_verified_party {
                                // Membership evidence is gone (party left,
                                // disbanded, or the client restarted). Waiting
                                // here would stall silently; fail so the
                                // overview button can start a fresh invite.
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(instance_id, pid = identity.pid, "warp skipped: follower is no longer a verified party member; click Mời party to re-invite");
                                continue;
                            }
                            let leader_location =
                                poe2_world::connector::get_client_location_verified(
                                    leader.pid,
                                    Some(&leader.started_at),
                                );
                            let follower_location =
                                poe2_world::connector::get_client_location_verified(
                                    identity.pid,
                                    Some(&identity.started_at),
                                );
                            if leader_location
                                .as_ref()
                                .and_then(|location| location.instance_id)
                                .is_some()
                                && leader_location
                                    .as_ref()
                                    .and_then(|location| location.instance_id)
                                    == follower_location
                                        .as_ref()
                                        .and_then(|location| location.instance_id)
                            {
                                let completed_instance = leader_location
                                    .as_ref()
                                    .and_then(|location| location.instance_id);
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::Complete {
                                        leader_instance: completed_instance,
                                    },
                                );
                                info!(instance_id, pid = identity.pid, instance = ?completed_instance, "party onboarding verified complete; follower already with leader");
                                continue;
                            }
                            let Some(target_instance) = leader_location
                                .as_ref()
                                .and_then(|location| location.instance_id)
                            else {
                                continue;
                            };
                            if attempts >= 3 {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(
                                    instance_id,
                                    pid = identity.pid,
                                    "party warp failed after 3 attempts"
                                );
                                continue;
                            }
                            let Some(_guard) = PartyOperationGuard::try_acquire(&operation_active)
                            else {
                                continue;
                            };
                            let _controller_guard = controller_operation.lock();
                            if let Err(error) =
                                poe2_world::instances::operate_window(identity, "focus")
                            {
                                let next_attempt_count = attempts + 1;
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::WarpReady {
                                        attempts: next_attempt_count,
                                        next_attempt: Instant::now() + Duration::from_millis(500),
                                        close_party_menu: false,
                                    },
                                );
                                warn!(instance_id, pid = identity.pid, attempt = next_attempt_count, %error, "party warp could not focus secondary client; bounded retry scheduled");
                                continue;
                            }
                            std::thread::sleep(Duration::from_millis(180));
                            let command_started_at = Instant::now();
                            match run_warp_to_leader(&gm, &first) {
                                Ok(()) => {
                                    let next_attempt = attempts + 1;
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::AwaitingWarp {
                                            attempts: next_attempt,
                                            target_instance,
                                            command_started_at,
                                            deadline: Instant::now() + Duration::from_secs(8),
                                        },
                                    );
                                    info!(instance_id, pid = identity.pid, target = %first, attempt = next_attempt, target_instance, "party warp route delivered; awaiting instance confirmation");
                                }
                                Err(error) => {
                                    let _ = gm.lock().release_all(&first);
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::WarpReady {
                                            attempts: attempts + 1,
                                            next_attempt: Instant::now()
                                                + Duration::from_millis(500),
                                            close_party_menu: false,
                                        },
                                    );
                                    warn!(instance_id, pid = identity.pid, target = %first, %error, "party warp input delivery failed");
                                }
                            }
                        }
                        PartyPhase::AwaitingWarp {
                            attempts,
                            target_instance,
                            command_started_at,
                            deadline,
                        } => {
                            let location = poe2_world::connector::get_client_location_verified(
                                identity.pid,
                                Some(&identity.started_at),
                            );
                            let fresh_confirmation = location.as_ref().is_some_and(|location| {
                                location.instance_id == Some(target_instance)
                                    && location
                                        .observed_at
                                        .is_some_and(|observed| observed >= command_started_at)
                            });
                            if fresh_confirmation {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::Complete {
                                        leader_instance: Some(target_instance),
                                    },
                                );
                                info!(
                                    instance_id,
                                    pid = identity.pid,
                                    target_instance,
                                    "party onboarding verified complete"
                                );
                            } else if Instant::now() >= deadline {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::WarpReady {
                                        attempts,
                                        next_attempt: Instant::now(),
                                        close_party_menu: false,
                                    },
                                );
                                warn!(
                                    instance_id,
                                    pid = identity.pid,
                                    attempt = attempts,
                                    "party warp not confirmed; retry scheduled"
                                );
                            }
                        }
                        PartyPhase::Complete { leader_instance } => {
                            let leader_location =
                                poe2_world::connector::get_client_location_verified(
                                    leader.pid,
                                    Some(&leader.started_at),
                                );
                            let follower_location =
                                poe2_world::connector::get_client_location_verified(
                                    identity.pid,
                                    Some(&identity.started_at),
                                );
                            if let Some((current, target)) = leader_transition_requires_warp(
                                leader_instance,
                                leader_location.and_then(|location| location.instance_id),
                                follower_location.and_then(|location| location.instance_id),
                            ) {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::WarpReady {
                                        attempts: 0,
                                        next_attempt: Instant::now() + Duration::from_millis(800),
                                        close_party_menu: false,
                                    },
                                );
                                info!(
                                    instance_id,
                                    pid = identity.pid,
                                    from_instance = current,
                                    target_instance = target,
                                    "leader changed instance; verified follower warp scheduled"
                                );
                            }
                        }
                        PartyPhase::Waiting | PartyPhase::Failed => {}
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
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
        let party_op = Arc::clone(&party_operation_active);
        let controller_operation = Arc::clone(&controller_operation);
        let (pad_job_tx, pad_job_rx) = sync_channel(MAX_TRANSIENT_PAD_JOBS);
        {
            let worker_gm = Arc::clone(&gm);
            let worker_operation = Arc::clone(&controller_operation);
            std::thread::spawn(move || {
                info!(
                    capacity = MAX_TRANSIENT_PAD_JOBS,
                    "Transient controller worker started"
                );
                while let Ok(job) = pad_job_rx.recv() {
                    let _operation_guard = worker_operation.lock();
                    if let Err(error) = execute_transient_pad_job(&worker_gm, job) {
                        warn!(%error, "Transient controller command failed");
                    }
                }
                warn!("Transient controller worker stopped");
            });
        }
        std::thread::spawn(move || {
            info!("Main decision & input tick loop started");
            let mut active_follow_targets = HashMap::<String, String>::new();

            loop {
                // 1. Advance engine state and get snapshot
                let snapshot = {
                    let mut r = rt.lock();
                    r.set_focus_slot(poe2_input::KbmBridge::get_focus_slot());
                    r.advance();
                    r.to_api_snapshot()
                };

                if party_op.load(Ordering::Acquire) {
                    flask_ctrl.release_pending(&mut gm.lock());
                    std::thread::sleep(Duration::from_millis(20));
                    continue;
                }

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

                // Serialize the complete tick's controller output against
                // party accept/warp and older transient macros.
                let Some(_controller_cycle) = controller_operation.try_lock() else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };

                // 3. Dispatch transient commands to one bounded worker.  Spawning
                // one sleeping thread per click used to create a delayed command
                // backlog and could replay stale input after a scene transition.
                let pad_cmds = {
                    let mut r = rt.lock();
                    r.drain_pad_commands()
                };

                for cmd in pad_cmds {
                    if cmd.target == "FOCUS" {
                        let slot = cmd.button.parse::<u8>().unwrap_or(0);
                        poe2_input::KbmBridge::set_focus_slot(slot);
                    } else if cmd.target == "MACRO" && cmd.button == "STASH_SWEEP" {
                        poe2_input::stash_macro::execute_stash_sweep();
                    } else if cmd.button == "BROADCAST_A" {
                        queue_transient_pad_job(&pad_job_tx, TransientPadAction::BroadcastA);
                    } else if cmd.button == "A" || cmd.button == "START" {
                        let raw_btn = if cmd.button == "A" {
                            XButtons::A
                        } else {
                            XButtons::START
                        };
                        queue_transient_pad_job(
                            &pad_job_tx,
                            TransientPadAction::Press {
                                target: cmd.target,
                                button: raw_btn,
                                hold: Duration::from_millis(300),
                            },
                        );
                    } else if cmd.button == "LEFT" || cmd.button == "RIGHT" {
                        let raw_btn = if cmd.button == "LEFT" {
                            XButtons::LEFT
                        } else {
                            XButtons::RIGHT
                        };
                        queue_transient_pad_job(
                            &pad_job_tx,
                            TransientPadAction::Press {
                                target: cmd.target,
                                button: raw_btn,
                                hold: Duration::from_millis(80),
                            },
                        );
                    } else if cmd.dx != 0.0 || cmd.dy != 0.0 {
                        queue_transient_pad_job(
                            &pad_job_tx,
                            TransientPadAction::Move {
                                target: cmd.target,
                                dx: cmd.dx,
                                dy: cmd.dy,
                                hold: Duration::from_millis(250),
                            },
                        );
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
                            if !is_target_automation_enabled(
                                target,
                                &snapshot.instance_services.runtime_instances,
                            ) {
                                let _ = mgr.release_all(target);
                                continue;
                            }
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
                        // generated only for mapped follower controllers with automation enabled.
                        let enabled_follow_targets = active_follow_targets
                            .iter()
                            .filter(|(_, target)| {
                                is_target_automation_enabled(
                                    target,
                                    &snapshot.instance_services.runtime_instances,
                                )
                            })
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect::<HashMap<_, _>>();
                        extra_events.extend(flask_ctrl.evaluate_mapped_party(
                            &snapshot.leader,
                            &snapshot.followers,
                            (None, &enabled_follow_targets),
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
                }

                // 6. Dynamic tick - reads fresh value every loop
                let sleep_ms = snapshot.config.tick_ms.clamp(10, 1000);
                drop(_controller_cycle);
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
    fn party_accept_route_opens_menu_selects_invite_and_confirms() {
        assert_eq!(
            PARTY_INVITE_ACCEPT_STEPS,
            [
                (XButtons::START, 100, 500),
                (XButtons::LEFT, 80, 350),
                (XButtons::LEFT, 80, 550),
                (XButtons::A, 80, 500),
            ]
        );
    }

    #[test]
    fn completed_party_tracks_real_leader_transition() {
        let phase = PartyPhase::Complete {
            leader_instance: Some(100),
        };
        assert!(matches!(phase, PartyPhase::Complete { .. }));
        assert_eq!(
            leader_transition_requires_warp(Some(100), Some(100), Some(90)),
            None
        );
        assert_eq!(
            leader_transition_requires_warp(Some(100), Some(200), Some(100)),
            Some((100, 200))
        );
        assert_eq!(
            leader_transition_requires_warp(Some(100), Some(200), Some(200)),
            None
        );
        assert_eq!(
            leader_transition_requires_warp(Some(100), Some(200), None),
            Some((0, 200))
        );
    }
}
