//! Auto-Flask / Auto-Potion logic for Smart Recovery.

use crate::controller::VirtualGamepadManager;
use poe2_types::{Actor, BotEvent, SmartFlaskConfig};
use std::collections::HashMap;
use std::time::Instant;
use tracing::info;
use vigem_client::XButtons;

#[derive(Default)]
pub struct FlaskController {
    last_life_flask: HashMap<String, Instant>,
    last_mana_flask: HashMap<String, Instant>,
    pending_releases: HashMap<String, u16>,
}

impl FlaskController {
    pub fn new() -> Self {
        Self::default()
    }

    /// End button pulses emitted during the previous engine tick. This is
    /// called before movement is mapped so releasing a flask never cancels WASD.
    pub fn release_pending(&mut self, gamepad_mgr: &mut VirtualGamepadManager) {
        for (target, raw) in self.pending_releases.drain() {
            let _ = gamepad_mgr.release_buttons(&target, XButtons { raw });
        }
    }

    /// Evaluate HP and Mana for an actor and trigger virtual flask button presses if needed.
    pub fn evaluate(
        &mut self,
        actor: &Actor,
        config: &SmartFlaskConfig,
        tick: u64,
        gamepad_mgr: &mut VirtualGamepadManager,
    ) -> Vec<BotEvent> {
        self.evaluate_target(actor, &actor.name, config, tick, gamepad_mgr)
    }

    /// Evaluate the local player and every follower, mapping memory actor names
    /// onto the stable P1/P2/... ViGEm target names.
    pub fn evaluate_party(
        &mut self,
        leader: &Actor,
        followers: &[Actor],
        config: &SmartFlaskConfig,
        tick: u64,
        gamepad_mgr: &mut VirtualGamepadManager,
    ) -> Vec<BotEvent> {
        let targets = followers
            .iter()
            .take(5)
            .enumerate()
            .map(|(index, actor)| (actor.name.clone(), format!("P{}", index + 2)))
            .collect();
        self.evaluate_mapped_party(
            leader,
            followers,
            (Some("P1"), &targets),
            config,
            tick,
            gamepad_mgr,
        )
    }

    /// Evaluate a six-character couch-coop party using the same stable
    /// actor-to-pad assignment as movement. Memory entity order may change
    /// between frames, so callers must never infer a controller from a
    /// follower's current vector index.
    pub fn evaluate_mapped_party(
        &mut self,
        leader: &Actor,
        followers: &[Actor],
        targets: (Option<&str>, &HashMap<String, String>),
        config: &SmartFlaskConfig,
        tick: u64,
        gamepad_mgr: &mut VirtualGamepadManager,
    ) -> Vec<BotEvent> {
        let (leader_target, follower_targets) = targets;
        let mut events = leader_target
            .map(|target| self.evaluate_target(leader, target, config, tick, gamepad_mgr))
            .unwrap_or_default();
        for actor in followers.iter().take(5) {
            let Some(target) = follower_targets.get(&actor.name) else {
                continue;
            };
            events.extend(self.evaluate_target(actor, target, config, tick, gamepad_mgr));
        }
        events
    }

    fn evaluate_target(
        &mut self,
        actor: &Actor,
        target: &str,
        config: &SmartFlaskConfig,
        tick: u64,
        gamepad_mgr: &mut VirtualGamepadManager,
    ) -> Vec<BotEvent> {
        let mut events = Vec::new();
        let now = Instant::now();

        // ── Life Flask Check ──────────────────────────────────────────────────
        if config.life_enabled && actor.hp <= config.life_hp_pct {
            let cd = std::time::Duration::from_millis(config.life_cooldown_ms);
            let can_drink = match self.last_life_flask.get(target) {
                Some(&last) => now.duration_since(last) >= cd,
                None => true,
            };

            if can_drink {
                self.last_life_flask.insert(target.to_string(), now);
                // POE2 Gamepad default: DPad-Left = Flask 1/Life
                let _ = gamepad_mgr.press_button(
                    target,
                    XButtons {
                        raw: XButtons::LEFT,
                    },
                );
                *self.pending_releases.entry(target.to_string()).or_default() |= XButtons::LEFT;

                let detail = format!("trigger HP {}% \u{2264} {}%", actor.hp, config.life_hp_pct);
                info!(actor = %actor.name, %detail, "🧪 Auto Life Flask triggered");
                events.push(BotEvent::new(
                    tick,
                    &actor.name,
                    "AUTO_FLASK_LIFE",
                    detail,
                    true,
                ));
            }
        }

        // ── Mana Flask Check ──────────────────────────────────────────────────
        if config.mana_enabled && !config.build_no_mana && actor.mana <= config.mana_mp_pct {
            let cd = std::time::Duration::from_millis(config.mana_cooldown_ms);
            let can_drink = match self.last_mana_flask.get(target) {
                Some(&last) => now.duration_since(last) >= cd,
                None => true,
            };

            if can_drink {
                self.last_mana_flask.insert(target.to_string(), now);
                // POE2 Gamepad default: DPad-Right = Flask 2/Mana
                let _ = gamepad_mgr.press_button(
                    target,
                    XButtons {
                        raw: XButtons::RIGHT,
                    },
                );
                *self.pending_releases.entry(target.to_string()).or_default() |= XButtons::RIGHT;

                let detail = format!(
                    "trigger Mana {}% \u{2264} {}%",
                    actor.mana, config.mana_mp_pct
                );
                info!(actor = %actor.name, %detail, "🧪 Auto Mana Flask triggered");
                events.push(BotEvent::new(
                    tick,
                    &actor.name,
                    "AUTO_FLASK_MANA",
                    detail,
                    true,
                ));
            }
        }

        events
    }
}
