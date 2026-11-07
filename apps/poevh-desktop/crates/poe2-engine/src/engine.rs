//! Party-follow decision engine with MultiPilot Lite logic.
//!
//! Decision order per follower:
//! 1. Different area OR distance >= warp_distance  -> WARP_TO_MAIN
//! 2. distance <= stop_distance                    -> HOLD
//! 3. distance >= catch_up_distance                -> SPRINT_CATCH_UP (pause loot if prioritize_catchup)
//! 4. otherwise                                   -> FOLLOW_ROUTE
//! 5. Auto-pickup within pickup_radius -> request input; memory disappearance confirms success

use poe2_types::*;
use tracing::{debug, info};

pub struct FollowEngine;

fn profile_enabled_for_follower(
    settings: &MultiClientConfig,
    instance_automation: &std::collections::BTreeMap<u32, bool>,
    follower_name: &str,
    _fallback_index: usize,
) -> bool {
    let clean_follower = poe2_world::connector::strip_guild_tag(follower_name.trim());
    if let Some(profile) = settings.clients.iter().find(|profile| {
        settings.requires_virtual_controllers(profile.id)
            && (profile
                .char1_name
                .trim()
                .eq_ignore_ascii_case(clean_follower)
                || profile
                    .char2_name
                    .trim()
                    .eq_ignore_ascii_case(clean_follower))
    }) {
        return profile.enabled
            && instance_automation
                .get(&profile.id)
                .copied()
                .unwrap_or(true);
    }
    false
}

impl FollowEngine {
    /// Advance the world state by one tick.
    /// Returns a list of events generated this tick.
    pub fn step(state: &mut WorldState) -> Vec<BotEvent> {
        if !state.running {
            return vec![];
        }

        state.tick += 1;
        let tick = state.tick;
        let cfg = state.config.clone();
        let settings = state.settings.clone();
        let leader_pos = state.leader.pos;
        let leader_area = state.leader.area.clone();

        // Track real configured tick duration instead of assuming 5 ticks is
        // always one second. The tick interval is user-configurable.
        state.settings.tracker.session_elapsed_ms = state
            .settings
            .tracker
            .session_elapsed_ms
            .saturating_add(cfg.tick_ms.clamp(10, 1000));
        state.settings.tracker.session_seconds = state.settings.tracker.session_elapsed_ms / 1000;
        let secs = state.settings.tracker.session_seconds.max(1) as f32;
        state.settings.tracker.div_per_hour =
            (state.settings.tracker.total_div_estimate / secs) * 3600.0;

        let mut events: Vec<BotEvent> = Vec::new();
        let mut any_catchup = false;

        // ── Per-follower decisions ────────────────────────────────────────────
        for (idx, follower) in state.followers.iter_mut().enumerate() {
            let client_enabled = profile_enabled_for_follower(
                &settings.multi_client,
                &state.instance_automation,
                &follower.name,
                idx,
            );

            if !settings.follow || !client_enabled {
                follower.action = FollowerAction::Hold;
                continue;
            }

            let dist = follower.pos.distance_to(leader_pos);

            // 0. Auto-Revive Leader when P1 is down
            if state.leader.hp == 0 && settings.auto_revive && follower.area == leader_area {
                follower.action = FollowerAction::ReviveLeader;
                if dist <= 4.5 && tick.is_multiple_of(10) {
                    events.push(BotEvent::new(
                        tick,
                        &follower.name,
                        "REVIVE_LEADER",
                        "Đang giữ nút B hồi sinh Leader P1",
                        true,
                    ));
                }
                continue;
            }

            // 1. Warp condition
            if follower.area != leader_area || dist >= cfg.warp_distance {
                follower.action = FollowerAction::WarpToMain;
                events.push(BotEvent::new(
                    tick,
                    &follower.name,
                    "WARP_TO_MAIN",
                    format!("dist={dist:.1} area_match={}", follower.area == leader_area),
                    true,
                ));
                continue;
            }

            // 2. Hold condition (Stop distance default 9.0)
            let mut is_sprint = false;
            if dist <= cfg.stop_distance {
                follower.action = FollowerAction::Hold;
                debug!(tick, name=%follower.name, dist, "HOLD");
            } else {
                // 3 & 4. Move toward leader (Sprint catch-up or regular follow)
                is_sprint = settings.catchup && dist >= cfg.catch_up_distance;
                if is_sprint {
                    any_catchup = true;
                }
                follower.action = if is_sprint {
                    FollowerAction::SprintCatchUp
                } else {
                    FollowerAction::FollowRoute
                };
            }

            // 5. Auto-pickup check (only while loot gate is open or not sprinting)
            if settings.loot
                && settings.pickup.enabled
                && (!is_sprint || !settings.pickup.pause_on_sprint)
            {
                let pickup_rad = settings.pickup.pickup_radius;
                let candidate = state
                    .loot
                    .iter()
                    .enumerate()
                    .filter(|(_, item)| {
                        item.pickup.can_attempt(tick, 3)
                            && follower.pos.distance_to(item.pos) <= pickup_rad
                            && should_pickup_item(item, &settings.pickup)
                    })
                    .min_by(|(_, left), (_, right)| {
                        follower
                            .pos
                            .distance_to(left.pos)
                            .total_cmp(&follower.pos.distance_to(right.pos))
                    })
                    .map(|(index, item)| (index, item.source_id, item.name.clone(), item.pos));

                if let Some((idx, item_id, item_name, item_pos)) = candidate {
                    const INTERACT_DISTANCE: f32 = 5.0;
                    if follower.pos.distance_to(item_pos) > INTERACT_DISTANCE {
                        if settings.pickup.auto_run_to_loot {
                            follower.action = FollowerAction::RunToLoot {
                                item_id,
                                item: item_name,
                                target: item_pos,
                            };
                        }
                        continue;
                    }
                    let item = &mut state.loot[idx];
                    let attempts = item.pickup.attempts().saturating_add(1);
                    item.pickup = PickupStatus::Pending {
                        actor: follower.name.clone(),
                        attempts,
                        requested_tick: tick,
                        input_sent: false,
                    };
                    follower.action = FollowerAction::AutoLoot {
                        item_id,
                        item: item_name.clone(),
                        button: settings.pickup.button.clone(),
                    };
                    info!(
                        tick,
                        item_id,
                        item = %item_name,
                        actor = %follower.name,
                        attempts,
                        "loot.pickup selected and queued for controller input"
                    );
                    events.push(BotEvent::new(
                        tick,
                        &follower.name,
                        "PICKUP_REQUESTED",
                        format!("{item_name} (attempt {attempts}/3)"),
                        false,
                    ));
                }
            }
        }

        // ── Loot gate: pause/resume when sprinting ────────────────────────────
        if any_catchup && !state.loot_paused {
            state.loot_paused = true;
            events.push(BotEvent::new(
                tick,
                "PARTY",
                "PAUSE_AUTO_LOOT",
                "catch-up active",
                false,
            ));
        } else if !any_catchup && state.loot_paused {
            state.loot_paused = false;
            events.push(BotEvent::new(
                tick,
                "PARTY",
                "RESUME_AUTO_LOOT",
                "formation settled",
                false,
            ));
        }

        events
    }
}

fn should_pickup_item(item: &WorldItem, config: &AutoPickupConfig) -> bool {
    // Allocation is not yet part of the validated live schema. Fail closed
    // instead of pretending an item is assigned to this follower.
    if config.only_allocated_to_bot {
        return false;
    }
    let name = item.name.to_ascii_lowercase();
    if item.rarity == Some(ItemRarity::Unique) {
        config.uniques
    } else if name.contains("divine") || name.contains("mirror") {
        config.currency_tier >= 1 && config.currency_top_tier
    } else if name.contains("chaos") || name.contains("exalt") || name.contains("vaal") {
        config.currency_tier >= 2 && config.currency_high_tier
    } else if name.contains("shard") || name.contains("fragment") {
        config.currency_tier >= 3 && config.currency_shards
    } else if name.contains("orb") || name.contains("bauble") || name.contains("chisel") {
        config.currency_tier >= 3 && config.currency_regular
    } else if name.contains("gold") {
        config.gold
    } else if name.contains("waystone") || name.contains("map") {
        config.waystones
    } else if name.contains("gem") {
        config.gems
    } else if config.exceptional_bases {
        false
    } else {
        // Unknown equipment/base categories are not currency. Picking them as
        // a fallback caused the bot to interact with almost every ground item.
        false
    }
}
