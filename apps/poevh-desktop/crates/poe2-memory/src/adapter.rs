//! MemoryWorldAdapter — implements WorldAdapter using live POE2 memory reads.
//!
//! Falls back to last known state if a read fails (e.g. loading screen).

use crate::navigation::NavigationCoordinator;
use crate::reader::{GameStateReader, RawActor};
use parking_lot::Mutex;
use poe2_types::*;
use poe2_world::WorldAdapter;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

pub struct MemoryWorldAdapter {
    target_pid: Mutex<Option<u32>>,
    reader: Mutex<Option<Arc<GameStateReader>>>,
    last_attach_attempt: Mutex<Option<Instant>>,
    last_state: Mutex<WorldState>,
    /// Manual command state (settings/config changed via dashboard)
    cmd_state: Mutex<WorldState>,
    /// Consecutive live-read failures. A short loading-screen gap is normal,
    /// but a sustained failure means the memory schema may have changed and we
    /// must stop automation instead of replaying stale actor coordinates.
    read_failures: Mutex<u32>,
    navigation: Mutex<NavigationCoordinator>,
}

const MAX_TRANSIENT_READ_FAILURES: u32 = 20;

impl MemoryWorldAdapter {
    pub fn new() -> anyhow::Result<Self> {
        let initial_state = WorldState {
            memory_reader: MemoryReaderStatus::default(),
            ..WorldState::default()
        };
        Ok(Self {
            target_pid: Mutex::new(None),
            reader: Mutex::new(None),
            last_attach_attempt: Mutex::new(None),
            last_state: Mutex::new(initial_state),
            cmd_state: Mutex::new(WorldState::default()),
            read_failures: Mutex::new(0),
            navigation: Mutex::new(NavigationCoordinator::default()),
        })
    }

    fn attach_error_status(detail: &str) -> MemoryReaderStatus {
        if detail.contains("process") && detail.contains("not found")
            || detail.contains("GAME_NOT_IN_AREA")
        {
            MemoryReaderStatus::default()
        } else if detail.contains("UNSUPPORTED_POE2_BUILD") {
            let build_key = detail
                .split_whitespace()
                .find(|part| part.starts_with("pe:"))
                .unwrap_or("unknown")
                .trim_end_matches(':');
            MemoryReaderStatus::unsupported(build_key, detail)
        } else {
            MemoryReaderStatus::unavailable(detail)
        }
    }

    fn reader_for_snapshot(&self) -> Option<Arc<GameStateReader>> {
        let target_pid = (*self.target_pid.lock())?;
        if let Some(reader) = self.reader.lock().clone() {
            if reader.pid() == target_pid {
                return Some(reader);
            }
            *self.reader.lock() = None;
        }
        {
            let mut last = self.last_attach_attempt.lock();
            if last.is_some_and(|attempt| attempt.elapsed() < Duration::from_secs(2)) {
                return None;
            }
            *last = Some(Instant::now());
        }
        match GameStateReader::attach_pid(target_pid) {
            Ok(reader) => {
                let reader = Arc::new(reader);
                self.last_state.lock().memory_reader =
                    MemoryReaderStatus::compatible(reader.build_key());
                *self.read_failures.lock() = 0;
                *self.reader.lock() = Some(reader.clone());
                Some(reader)
            }
            Err(error) => {
                let detail = format!("{error:#}");
                self.last_state.lock().memory_reader = Self::attach_error_status(&detail);
                None
            }
        }
    }

    fn raw_to_actor(raw: &RawActor) -> Actor {
        Actor {
            name: raw.name.clone(),
            pos: Vec2::new(raw.x, raw.y),
            hp: raw.hp,
            mana: raw.mana,
            area: raw.area.clone(),
            action: FollowerAction::Hold,
            navigation_target: None,
        }
    }
}

impl WorldAdapter for MemoryWorldAdapter {
    fn set_target_process(&mut self, pid: Option<u32>) {
        let current = *self.target_pid.lock();
        if current == pid {
            return;
        }
        *self.target_pid.lock() = pid;
        *self.reader.lock() = None;
        *self.last_attach_attempt.lock() = None;
        *self.read_failures.lock() = 0;
        self.navigation.lock().invalidate_world();
        let mut state = self.last_state.lock();
        state.running = false;
        state.memory_reader = MemoryReaderStatus::default();
        info!(previous_pid = ?current, target_pid = ?pid, "memory target process changed; reader reset");
    }

    fn snapshot(&self) -> WorldState {
        let Some(reader) = self.reader_for_snapshot() else {
            let mut state = self.last_state.lock();
            state.running = false;
            return state.clone();
        };
        // Read fresh state from game memory
        let expedition = self.cmd_state.lock().settings.expedition.clone();
        if let Some(raw) =
            reader.read_state_throttled(expedition.enabled, expedition.scan_interval_ms)
        {
            *self.read_failures.lock() = 0;
            let mut cmd = self.cmd_state.lock();
            let mut state = self.last_state.lock();

            if cmd.settings.loot && !raw.loot_health.schema_ok {
                cmd.running = false;
                state.running = false;
                state.memory_reader = MemoryReaderStatus::unavailable(format!(
                    "Loot reader schema failed {} consecutive scans ({} candidates, {} decoded)",
                    raw.loot_health.consecutive_schema_failures,
                    raw.loot_health.candidates,
                    raw.loot_health.decoded
                ));
                error!(
                    candidates = raw.loot_health.candidates,
                    decoded = raw.loot_health.decoded,
                    failures = raw.loot_health.consecutive_schema_failures,
                    "loot.schema fail-closed; automation stopped"
                );
                return state.clone();
            }

            // The saved leader name is an identity guard, not decoration. It
            // prevents a correctly opened but wrongly bound secondary process
            // from driving every follower as if it were the carry.
            let expected_leader = cmd
                .settings
                .multi_client
                .clients
                .iter()
                .find(|profile| profile.id == cmd.settings.multi_client.main_instance_id)
                .map(|profile| profile.char1_name.trim().to_owned())
                .unwrap_or_default();
            if !expected_leader.is_empty()
                && !raw.local_player.name.eq_ignore_ascii_case(&expected_leader)
            {
                cmd.running = false;
                state.running = false;
                state.memory_reader = MemoryReaderStatus::unavailable(format!(
                    "Main PID character mismatch: expected '{expected_leader}', read '{}'",
                    raw.local_player.name
                ));
                error!(
                    expected = %expected_leader,
                    actual = %raw.local_player.name,
                    pid = reader.pid(),
                    "leader identity mismatch; automation stopped"
                );
                return state.clone();
            }

            // Update leader from the explicitly bound main process.
            let leader = Self::raw_to_actor(&raw.local_player);

            // Update followers from nearby entities, preserving existing follower actions
            let mut followers: Vec<Actor> = raw
                .nearby
                .iter()
                .map(|raw_actor| {
                    let prev_action = state
                        .followers
                        .iter()
                        .find(|f| f.name == raw_actor.name)
                        .map(|f| f.action.clone())
                        .unwrap_or(FollowerAction::Hold);
                    Actor {
                        name: raw_actor.name.clone(),
                        pos: Vec2::new(raw_actor.x, raw_actor.y),
                        hp: raw_actor.hp,
                        mana: raw_actor.mana,
                        area: raw_actor.area.clone(),
                        action: prev_action,
                        navigation_target: None,
                    }
                })
                .collect();

            if cmd.settings.follow {
                if let Some(terrain) = raw.terrain.clone() {
                    let mut navigation = self.navigation.lock();
                    let world_ready =
                        navigation.observe_world_frame(terrain.area_id, terrain.generation);
                    navigation.retain_followers(followers.iter().map(|actor| actor.name.as_str()));
                    for follower in &mut followers {
                        if follower.area == leader.area {
                            // During the first confirmed frames of a new area,
                            // target the follower's current position. This
                            // deliberately produces a neutral stick rather than
                            // falling back to a direct vector through unknown
                            // terrain while the new route feed settles.
                            if world_ready {
                                // A route request is asynchronous.  While A* is
                                // preparing (or after a failed route), returning
                                // `follower.pos` would make the mapper hold the
                                // stick and leave the follower frozen.  Only
                                // publish a waypoint when it is actionable;
                                // otherwise the engine falls back to the live
                                // leader vector for responsive follow.
                                let route_goal = match &follower.action {
                                    FollowerAction::RunToLoot { target, .. } => *target,
                                    _ => leader.pos,
                                };
                                let waypoint = navigation.steering_target(
                                    &follower.name,
                                    follower.pos,
                                    route_goal,
                                    terrain.clone(),
                                );
                                if waypoint.distance_to(follower.pos) > 0.5 {
                                    follower.navigation_target = Some(waypoint);
                                }
                            }
                        }
                    }
                } else {
                    self.navigation.lock().invalidate_world();
                }
            } else {
                self.navigation.lock().invalidate_world();
            }

            state.leader = leader;
            state.followers = followers;
            state.area_name_hint = raw.area_name.clone();
            state.running = cmd.running;
            state.settings = cmd.settings.clone();
            state.config = cmd.config.clone();
            let live_ids = raw
                .loot
                .iter()
                .map(|item| item.source_id)
                .collect::<std::collections::HashSet<_>>();
            for old in &state.loot {
                let PickupStatus::Pending {
                    actor,
                    attempts,
                    input_sent: true,
                    ..
                } = &old.pickup
                else {
                    continue;
                };
                if live_ids.contains(&old.source_id) {
                    continue;
                }
                record_confirmed_pickup(&mut cmd.settings.tracker, old);
                info!(
                    item_id = old.source_id,
                    item = %old.name,
                    actor = %actor,
                    attempts,
                    "loot.pickup confirmed: entity disappeared after successful input"
                );
            }

            // Reconcile by the std::map entity id. Names and nearby positions
            // are not unique when several equal currency stacks are dropped.
            state.loot = raw
                .loot
                .iter()
                .map(|item| {
                    let mut pickup = state
                        .loot
                        .iter()
                        .find(|old| old.source_id == item.source_id)
                        .map(|old| old.pickup.clone())
                        .unwrap_or_default();
                    if let PickupStatus::Pending {
                        attempts,
                        requested_tick,
                        input_sent: true,
                        ..
                    } = &pickup
                    {
                        const CONFIRM_TIMEOUT_TICKS: u64 = 8;
                        if state.tick.saturating_sub(*requested_tick) >= CONFIRM_TIMEOUT_TICKS {
                            let attempts = *attempts;
                            pickup = PickupStatus::Failed {
                                attempts,
                                retry_after_tick: state.tick.saturating_add(3),
                                reason: "entity remained after input".into(),
                            };
                            warn!(
                                item_id = item.source_id,
                                item = %item.name,
                                attempts,
                                "loot.pickup not confirmed; bounded retry scheduled"
                            );
                        }
                    }
                    WorldItem {
                        source_id: item.source_id,
                        name: item.name.clone(),
                        pos: Vec2::new(item.x, item.y),
                        value: 0,
                        rarity: item.rarity,
                        identified: item.identified,
                        pickup,
                        picked_by: None,
                    }
                })
                .collect();
            // Confirmation may have advanced the durable session tracker after
            // the initial settings copy above.
            state.settings.tracker = cmd.settings.tracker.clone();
            state.threats = cmd.threats.clone();
            state.memory_reader = MemoryReaderStatus::compatible(reader.build_key());

            if state.settings.expedition.enabled {
                let session_id = format!("{:016X}", raw.area_id);
                let stations = raw
                    .expedition
                    .iter()
                    .map(|station| poe2_types::RuneStationSnapshot {
                        station_id: station.address,
                        label: format!("RUNE-{:02X}", station.address & 0xff),
                        slot_count: station.slot_count,
                        anchor_rune_id: station.anchor_idx,
                        anchor_rune: station.anchor_name.clone(),
                        anchor_position: station.anchor_position,
                        unique: station.unique,
                        collected: false,
                    })
                    .map(|station| poe2_types::ExpeditionStationResult {
                        station,
                        combinations: Vec::new(),
                        best_value_exalted: None,
                    })
                    .collect();
                let snapshot = poe2_types::ExpeditionSnapshot {
                    session_id,
                    area_name: raw.area_name.clone(),
                    area_level: raw.area_level,
                    scan_unix: chrono_like_unix(),
                    stations,
                };
                let catalog = poe2_world::ExpeditionCatalog::default();
                let league = state.settings.expedition.league.clone();
                let ranked = catalog.rank_snapshot(
                    snapshot,
                    |reward| poe2_world::reward_price_or_queue(reward, &league),
                    state.settings.expedition.max_rows_per_station as usize,
                    state.settings.expedition.min_value_exalted,
                    state.settings.expedition.show_unpriced,
                );
                poe2_world::publish_expedition_snapshot(ranked);
            }

            state.clone()
        } else {
            // Loading screens can briefly make the pointer chain unreadable.
            // Do not let an indefinitely stale snapshot drive controllers: after
            // a bounded grace period fail closed and require an explicit restart.
            let failures = {
                let mut count = self.read_failures.lock();
                *count = count.saturating_add(1);
                *count
            };
            let mut cmd = self.cmd_state.lock();
            let mut state = self.last_state.lock();
            if failures >= MAX_TRANSIENT_READ_FAILURES {
                cmd.running = false;
                state.running = false;
                state.memory_reader = MemoryReaderStatus::unavailable(format!(
                    "Live memory read failed {failures} times; PoE2 build or memory schema may have changed. Restart POEVH after verifying the game update."
                ));
                warn!(failures, "memory reader failed closed after repeated reads");
                *self.reader.lock() = None;
            } else {
                // Keep the user's Run preference intact, but mark this frame as
                // unsafe for controller output. The input loop releases the
                // previous movement immediately and resumes automatically only
                // after a fresh compatible snapshot arrives.
                state.memory_reader = MemoryReaderStatus::transient(
                    reader.build_key(),
                    format!("Live memory frame unavailable during load ({failures}/{MAX_TRANSIENT_READ_FAILURES})"),
                );
                self.navigation.lock().invalidate_world();
                warn!(
                    failures,
                    "memory read failed during transient/loading state"
                );
            }
            state.clone()
        }
    }

    fn move_leader(&mut self, _dx: f32, _dy: f32) {
        // Leader position comes from real game memory — cannot move via API
        // (no-op: movement is done by the player with real controller/keyboard)
    }

    fn spawn_loot(&mut self) {
        // No-op for real adapter — loot is read from game world
    }

    fn spawn_threat(&mut self) {
        // No-op for real adapter
    }

    fn apply_state(&mut self, state: WorldState) {
        // Engine writes its computed state back — store it as last known
        *self.last_state.lock() = state.clone();
        // Persist command-layer fields
        let mut cmd = self.cmd_state.lock();
        cmd.running = state.running;
        cmd.settings = state.settings;
        cmd.config = state.config;
    }

    fn reset(&mut self) {
        *self.cmd_state.lock() = WorldState::default();
    }
}

fn chrono_like_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn record_confirmed_pickup(tracker: &mut CurrencyTrackerSession, item: &WorldItem) {
    tracker.items_picked = tracker.items_picked.saturating_add(1);
    let name = item.name.to_ascii_lowercase();
    if name.contains("divine") {
        tracker.div_count = tracker.div_count.saturating_add(1);
        tracker.total_div_estimate += 1.0;
    } else if name.contains("exalt") {
        tracker.exalt_count = tracker.exalt_count.saturating_add(1);
        tracker.total_div_estimate += 0.05;
    } else if name.contains("chaos") {
        tracker.chaos_count = tracker.chaos_count.saturating_add(1);
        tracker.total_div_estimate += 0.005;
    } else if name.contains("gold") {
        tracker.gold_count = tracker.gold_count.saturating_add(item.value.max(0) as u32);
    }
    debug!(
        item_id = item.source_id,
        item = %item.name,
        items_picked = tracker.items_picked,
        "loot.tracker updated after confirmed pickup"
    );
}
