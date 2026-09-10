#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod logging;

use anyhow::Result;
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use poe2_input::{ActionMapper, FlaskController, KbmBridge, VirtualGamepadManager};
use poe2_overlay::start_server;
use poe2_types::{Actor, FollowerAction, MultiClientConfig};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tracing::{info, warn};
use vigem_client::XButtons;

const MAX_PARTY_FOLLOWERS: usize = 5;

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
    AcceptReady {
        code: u64,
        attempts: u8,
        next_attempt: Instant,
    },
    AwaitingInviteClear {
        code: u64,
        attempts: u8,
        deadline: Instant,
    },
    WarpReady {
        attempts: u8,
        next_attempt: Instant,
    },
    AwaitingWarp {
        attempts: u8,
        target_instance: u64,
        deadline: Instant,
    },
    Complete {
        leader_instance: Option<u64>,
    },
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PartySignalOutcome {
    Ignored,
    InviteArmed,
    InviteCleared,
}

fn apply_party_signal(
    phase: &mut PartyPhase,
    security_code: u64,
    now: Instant,
) -> PartySignalOutcome {
    if security_code != 0 {
        if matches!(phase, PartyPhase::Complete { .. }) {
            return PartySignalOutcome::Ignored;
        }
        *phase = PartyPhase::AcceptReady {
            code: security_code,
            attempts: 0,
            next_attempt: now,
        };
        PartySignalOutcome::InviteArmed
    } else if let PartyPhase::AwaitingInviteClear { attempts, .. } = phase {
        *phase = PartyPhase::WarpReady {
            attempts: *attempts,
            next_attempt: now,
        };
        PartySignalOutcome::InviteCleared
    } else {
        PartySignalOutcome::Ignored
    }
}

fn leader_transition_requires_warp(
    completed_leader_instance: Option<u64>,
    leader_instance: Option<u64>,
    follower_instance: Option<u64>,
) -> Option<(u64, u64)> {
    let target = leader_instance?;
    let current = follower_instance?;
    (Some(target) != completed_leader_instance && target != current).then_some((current, target))
}

fn run_warp_to_leader(manager: &Arc<Mutex<VirtualGamepadManager>>, target: &str) -> Result<()> {
    // Current Party route observed in the reference app's shipped guide:
    // Start -> D-pad Left -> first party member -> Warp -> confirm -> cleanup.
    pulse_controller_button(manager, target, XButtons::START, 120)?;
    std::thread::sleep(Duration::from_millis(120));
    pulse_controller_button(manager, target, XButtons::LEFT, 80)?;
    std::thread::sleep(Duration::from_millis(50));
    pulse_controller_button(manager, target, XButtons::A, 100)?;
    std::thread::sleep(Duration::from_millis(100));
    pulse_controller_button(manager, target, XButtons::A, 100)?;
    std::thread::sleep(Duration::from_millis(200));
    pulse_controller_button(manager, target, XButtons::A, 100)?;
    std::thread::sleep(Duration::from_millis(400));
    pulse_controller_button(manager, target, XButtons::B, 100)?;
    Ok(())
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

    // Manual invite -> verified accept -> verified warp. Client.txt events are
    // tagged by exact PID. We report success only after the invitation clears
    // and both clients expose the same Client-Safe Instance ID.
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
                    let _ = poe2_world::connector::take_party_invites();
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }

                let (leader, secondaries) = {
                    let r = rt.lock();
                    let statuses = r.runtime_instances();
                    let leader = statuses
                        .iter()
                        .find(|status| status.is_main && status.status == "bound")
                        .and_then(|status| status.binding.clone());
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
                    (leader, secondaries)
                };

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

                let requested_revision = poe2_world::connector::party_recovery_revision();
                if requested_revision != recovery_revision {
                    recovery_revision = requested_revision;
                    for (_, identity) in &secondaries {
                        sessions.insert(
                            identity.started_at.clone(),
                            PartyPhase::WarpReady {
                                attempts: 0,
                                next_attempt: Instant::now(),
                            },
                        );
                    }
                    info!(
                        revision = requested_revision,
                        followers = secondaries.len(),
                        "manual follower regroup armed for bound secondary clients"
                    );
                }

                for signal in poe2_world::connector::take_party_invites() {
                    let Some((_, identity)) = secondaries
                        .iter()
                        .find(|(_, identity)| identity.pid == signal.pid)
                    else {
                        continue;
                    };
                    let phase = sessions
                        .entry(identity.started_at.clone())
                        .or_insert(PartyPhase::Waiting);
                    match apply_party_signal(phase, signal.security_code, Instant::now()) {
                        PartySignalOutcome::InviteArmed => {
                            info!(
                                pid = signal.pid,
                                "party invitation armed for automatic acceptance"
                            );
                        }
                        PartySignalOutcome::InviteCleared => {
                            info!(
                                pid = signal.pid,
                                "party invitation cleared; preparing verified warp"
                            );
                        }
                        PartySignalOutcome::Ignored => {}
                    }
                }

                let Some(leader) = leader else {
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                };

                for (instance_id, identity) in &secondaries {
                    let phase = sessions
                        .get(&identity.started_at)
                        .cloned()
                        .unwrap_or(PartyPhase::Waiting);
                    let (first, second) = VirtualGamepadManager::targets_for_instance(*instance_id);
                    match phase {
                        PartyPhase::AcceptReady {
                            code,
                            attempts,
                            next_attempt,
                        } => {
                            if Instant::now() < next_attempt {
                                continue;
                            }
                            if attempts >= 3 {
                                sessions.insert(identity.started_at.clone(), PartyPhase::Failed);
                                warn!(instance_id, pid = identity.pid, "party acceptance failed after 3 attempts; waiting for a new invite");
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
                                    PartyPhase::AcceptReady {
                                        code,
                                        attempts: next_attempt_count,
                                        next_attempt: Instant::now() + Duration::from_millis(500),
                                    },
                                );
                                warn!(instance_id, pid = identity.pid, attempt = next_attempt_count, %error, "party accept could not focus secondary client; bounded retry scheduled");
                                continue;
                            }
                            std::thread::sleep(Duration::from_millis(180));
                            {
                                let mut manager = gm.lock();
                                let _ = manager.release_all(&first);
                                let _ = manager.release_all(&second);
                            }
                            let next_attempt = attempts + 1;
                            match pulse_controller_button(&gm, &first, XButtons::A, 450) {
                                Ok(()) => {
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::AwaitingInviteClear {
                                            code,
                                            attempts: next_attempt,
                                            deadline: Instant::now() + Duration::from_secs(2),
                                        },
                                    );
                                    info!(instance_id, pid = identity.pid, target = %first, attempt = next_attempt, "party accept input delivered; awaiting invitation-clear confirmation");
                                }
                                Err(error) => {
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::AcceptReady {
                                            code,
                                            attempts: next_attempt,
                                            next_attempt: Instant::now()
                                                + Duration::from_millis(500),
                                        },
                                    );
                                    warn!(instance_id, pid = identity.pid, target = %first, %error, "party accept input delivery failed");
                                }
                            }
                        }
                        PartyPhase::AwaitingInviteClear {
                            code,
                            attempts,
                            deadline,
                        } => {
                            if Instant::now() >= deadline {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::AcceptReady {
                                        code,
                                        attempts,
                                        next_attempt: Instant::now(),
                                    },
                                );
                            }
                        }
                        PartyPhase::WarpReady {
                            attempts,
                            next_attempt,
                        } => {
                            if Instant::now() < next_attempt {
                                continue;
                            }
                            let leader_location =
                                poe2_world::connector::get_client_location(leader.pid);
                            let follower_location =
                                poe2_world::connector::get_client_location(identity.pid);
                            if leader_location.instance_id.is_some()
                                && leader_location.instance_id == follower_location.instance_id
                            {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::Complete {
                                        leader_instance: leader_location.instance_id,
                                    },
                                );
                                info!(instance_id, pid = identity.pid, instance = ?leader_location.instance_id, "party onboarding verified complete; follower already with leader");
                                continue;
                            }
                            let Some(target_instance) = leader_location.instance_id else {
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
                                    },
                                );
                                warn!(instance_id, pid = identity.pid, attempt = next_attempt_count, %error, "party warp could not focus secondary client; bounded retry scheduled");
                                continue;
                            }
                            std::thread::sleep(Duration::from_millis(180));
                            match run_warp_to_leader(&gm, &first) {
                                Ok(()) => {
                                    let next_attempt = attempts + 1;
                                    sessions.insert(
                                        identity.started_at.clone(),
                                        PartyPhase::AwaitingWarp {
                                            attempts: next_attempt,
                                            target_instance,
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
                                        },
                                    );
                                    warn!(instance_id, pid = identity.pid, target = %first, %error, "party warp input delivery failed");
                                }
                            }
                        }
                        PartyPhase::AwaitingWarp {
                            attempts,
                            target_instance,
                            deadline,
                        } => {
                            let location = poe2_world::connector::get_client_location(identity.pid);
                            if location.instance_id == Some(target_instance) {
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
                                poe2_world::connector::get_client_location(leader.pid);
                            let follower_location =
                                poe2_world::connector::get_client_location(identity.pid);
                            if let Some((current, target)) = leader_transition_requires_warp(
                                leader_instance,
                                leader_location.instance_id,
                                follower_location.instance_id,
                            ) {
                                sessions.insert(
                                    identity.started_at.clone(),
                                    PartyPhase::WarpReady {
                                        attempts: 0,
                                        next_attempt: Instant::now() + Duration::from_millis(800),
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

                // 3. Process pad commands - spawn each as own thread (non-blocking)
                let pad_cmds = {
                    let mut r = rt.lock();
                    r.drain_pad_commands()
                };

                for cmd in pad_cmds {
                    let gm_clone = Arc::clone(&gm);
                    let operation = Arc::clone(&controller_operation);
                    if cmd.target == "FOCUS" {
                        let slot = cmd.button.parse::<u8>().unwrap_or(0);
                        poe2_input::KbmBridge::set_focus_slot(slot);
                    } else if cmd.target == "MACRO" && cmd.button == "STASH_SWEEP" {
                        poe2_input::stash_macro::execute_stash_sweep();
                    } else if cmd.button == "BROADCAST_A" {
                        std::thread::spawn(move || {
                            let _operation_guard = operation.lock();
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.broadcast_button_a();
                            drop(mgr);
                            std::thread::sleep(Duration::from_millis(150));
                            let mut mgr = gm_clone.lock();
                            let _ = mgr.broadcast_release();
                        });
                    } else if cmd.button == "A" || cmd.button == "START" {
                        let target = cmd.target.clone();
                        let raw_btn = if cmd.button == "A" {
                            XButtons::A
                        } else {
                            XButtons::START
                        };
                        std::thread::spawn(move || {
                            let _operation_guard = operation.lock();
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
                            let _operation_guard = operation.lock();
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
                            let _operation_guard = operation.lock();
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
    fn party_signal_requires_nonzero_invite_before_zero_can_advance() {
        let now = Instant::now();
        let mut phase = PartyPhase::Waiting;
        assert_eq!(
            apply_party_signal(&mut phase, 0, now),
            PartySignalOutcome::Ignored
        );
        assert!(matches!(phase, PartyPhase::Waiting));

        assert_eq!(
            apply_party_signal(&mut phase, 1234, now),
            PartySignalOutcome::InviteArmed
        );
        assert!(matches!(phase, PartyPhase::AcceptReady { code: 1234, .. }));

        phase = PartyPhase::AwaitingInviteClear {
            code: 1234,
            attempts: 1,
            deadline: now,
        };
        assert_eq!(
            apply_party_signal(&mut phase, 0, now),
            PartySignalOutcome::InviteCleared
        );
        assert!(matches!(phase, PartyPhase::WarpReady { attempts: 1, .. }));
    }

    #[test]
    fn completed_party_ignores_invites_and_tracks_real_leader_transition() {
        let now = Instant::now();
        let mut phase = PartyPhase::Complete {
            leader_instance: Some(100),
        };
        assert_eq!(
            apply_party_signal(&mut phase, 4321, now),
            PartySignalOutcome::Ignored
        );
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
    }
}
