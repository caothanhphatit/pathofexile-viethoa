//! Maps engine decisions into virtual gamepad commands.

use crate::controller::VirtualGamepadManager;
use anyhow::{bail, Result};
use poe2_types::{Actor, FollowerAction, Vec2};
use tracing::{debug, info};
use vigem_client::XButtons;

pub struct ActionMapper;

impl ActionMapper {
    /// Dispatch the gamepad inputs for a follower according to its current action and relative position to leader.
    pub fn apply_action(
        follower: &Actor,
        leader_pos: Vec2,
        gamepad_mgr: &mut VirtualGamepadManager,
    ) -> Result<()> {
        Self::apply_action_to_target(follower, &follower.name, leader_pos, gamepad_mgr)
    }

    /// Apply an actor decision to an explicitly allocated controller target.
    /// Actor names come from game memory and are not stable controller IDs.
    pub fn apply_action_to_target(
        follower: &Actor,
        target_name: &str,
        leader_pos: Vec2,
        gamepad_mgr: &mut VirtualGamepadManager,
    ) -> Result<()> {
        if !gamepad_mgr.has_target(target_name) {
            bail!("controller target {target_name} is not connected");
        }

        // Action buttons are momentary. Clear only the mapper-owned buttons at
        // the start of the next frame; flask buttons are managed separately.
        gamepad_mgr.release_buttons(
            target_name,
            XButtons {
                raw: XButtons::A | XButtons::B | XButtons::DOWN,
            },
        )?;

        let (dx, dy) = steering_delta(follower, leader_pos);

        match &follower.action {
            FollowerAction::Hold => {
                gamepad_mgr.release_all(target_name)?;
            }
            FollowerAction::FollowRoute => {
                gamepad_mgr.set_movement(target_name, dx, dy, false)?;
            }
            FollowerAction::SprintCatchUp => {
                gamepad_mgr.set_movement(target_name, dx, dy, true)?;
            }
            FollowerAction::RunToLoot { target, .. } => {
                let steering = follower.navigation_target.unwrap_or(*target);
                let loot_dx = steering.x - follower.pos.x;
                let loot_dy = steering.y - follower.pos.y;
                gamepad_mgr.set_movement(target_name, loot_dx, loot_dy, true)?;
                debug!(
                    target = target_name,
                    x = steering.x,
                    y = steering.y,
                    "loot.route controller movement sent"
                );
            }
            FollowerAction::AutoLoot {
                item_id,
                item,
                button,
            } => {
                let raw = pickup_button(button)?;
                gamepad_mgr.press_button(target_name, XButtons { raw })?;
                info!(
                    target = target_name,
                    item_id,
                    item = %item,
                    button = %button,
                    "loot.input controller button sent successfully"
                );
            }
            FollowerAction::WarpToMain => {
                // Quick Portal / Teleport key: DPad Down
                gamepad_mgr.press_button(
                    target_name,
                    XButtons {
                        raw: XButtons::DOWN,
                    },
                )?;
            }
            FollowerAction::ManualControl => {
                // Do not override user input
            }
            FollowerAction::ReviveLeader => {
                let dist = (dx * dx + dy * dy).sqrt();
                if dist <= 4.5 {
                    // In Couch Co-op / Party: hold Button B to channel revive
                    gamepad_mgr.press_button(target_name, XButtons { raw: XButtons::B })?;
                } else {
                    // Sprint toward leader's corpse
                    gamepad_mgr.set_movement(target_name, dx, dy, true)?;
                }
            }
        }
        Ok(())
    }
}

fn pickup_button(name: &str) -> Result<u16> {
    match name.trim().to_ascii_uppercase().as_str() {
        "A" => Ok(XButtons::A),
        "B" => Ok(XButtons::B),
        "X" => Ok(XButtons::X),
        "Y" => Ok(XButtons::Y),
        other => bail!("unsupported pickup controller button: {other}"),
    }
}

fn steering_delta(follower: &Actor, leader_pos: Vec2) -> (f32, f32) {
    let target = follower.navigation_target.unwrap_or(leader_pos);
    (target.x - follower.pos.x, target.y - follower.pos.y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_follow_waypoint_takes_precedence_over_direct_leader_vector() {
        let mut follower = Actor::new("P2", 10.0, 10.0);
        follower.navigation_target = Some(Vec2::new(10.0, 20.0));
        assert_eq!(
            steering_delta(&follower, Vec2::new(100.0, 10.0)),
            (0.0, 10.0)
        );
    }

    #[test]
    fn direct_follow_remains_immediate_without_a_route_waypoint() {
        let follower = Actor::new("P2", 10.0, 10.0);
        assert_eq!(steering_delta(&follower, Vec2::new(15.0, 12.0)), (5.0, 2.0));
    }

    #[test]
    fn pickup_button_uses_the_persisted_configuration() {
        assert_eq!(pickup_button("x").unwrap(), XButtons::X);
        assert!(pickup_button("START").is_err());
    }
}
