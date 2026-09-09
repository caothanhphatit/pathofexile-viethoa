//! Virtual Xbox 360 Gamepad management via ViGEmBus.

use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{info, warn};
use vigem_client::{Client, TargetId, XButtons, XGamepad, Xbox360Wired};

pub struct VirtualGamepadManager {
    client: Option<Arc<Client>>,
    targets: HashMap<String, Xbox360Wired<Arc<Client>>>,
    reports: HashMap<String, XGamepad>,
}

impl Default for VirtualGamepadManager {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtualGamepadManager {
    /// Connect to ViGEmBus. If ViGEmBus is not running, falls back gracefully.
    pub fn new() -> Self {
        match Client::connect() {
            Ok(client) => {
                info!("🎮 Connected to ViGEmBus driver successfully");
                Self {
                    client: Some(Arc::new(client)),
                    targets: HashMap::new(),
                    reports: HashMap::new(),
                }
            }
            Err(e) => {
                warn!("⚠️ Could not connect to ViGEmBus ({e}) — virtual gamepad input disabled");
                Self {
                    client: None,
                    targets: HashMap::new(),
                    reports: HashMap::new(),
                }
            }
        }
    }

    pub fn is_vigem_connected(&self) -> bool {
        self.client.is_some()
    }

    pub fn get_client(&self) -> Option<Arc<Client>> {
        self.client.clone()
    }

    pub fn has_target(&self, name: &str) -> bool {
        self.targets.contains_key(name)
    }

    pub fn has_instance_controllers(&self, instance_id: u32) -> bool {
        let (first, second) = Self::targets_for_instance(instance_id);
        self.targets.contains_key(&first) && self.targets.contains_key(&second)
    }

    pub fn controller_instance_ids(&self) -> Vec<u32> {
        let mut ids = self
            .targets
            .keys()
            .filter_map(|target| target.strip_prefix('P'))
            .filter_map(|number| number.parse::<u32>().ok())
            .filter(|number| *number > 0)
            .map(|number| (number - 1) / 2 + 1)
            .collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    /// Ensure a virtual Xbox 360 controller exists for a character name (e.g. "P2", "P3").
    pub fn ensure_target(&mut self, name: &str) -> Result<()> {
        if self.targets.contains_key(name) {
            return Ok(());
        }

        if let Some(ref client) = self.client {
            let mut target = Xbox360Wired::new(Arc::clone(client), TargetId::XBOX360_WIRED);
            target
                .plugin()
                .context("Failed to plugin virtual Xbox 360 controller")?;
            target
                .wait_ready()
                .context("Virtual controller wait_ready timed out")?;
            match target.get_user_index() {
                Ok(index) => {
                    poe2_world::controllers::register_virtual_slot(name, index);
                    info!(
                        target = name,
                        xinput_slot = index + 1,
                        "Registered POEVH virtual XInput slot"
                    );
                }
                Err(error) => {
                    warn!(target = name, %error, "Virtual pad has no XInput slot; physical inventory may include it")
                }
            }
            // Send initial report so Windows XInput immediately registers it as active
            let init_report = XGamepad::default();
            target
                .update(&init_report)
                .context("Failed to initialize virtual controller report")?;
            info!(
                target = name,
                "🎮 Virtual Xbox 360 pad spawned and initialized with active report"
            );
            self.targets.insert(name.to_string(), target);
            self.reports.insert(name.to_string(), init_report);
        }
        Ok(())
    }

    /// Map instance ID to its 2 Couch Co-op controller target names:
    /// Instance 1 -> ("P1", "P2") [Leader & Aurabot]
    /// Instance 2 -> ("P3", "P4") [Culler & Looter 1]
    /// Instance 3 -> ("P5", "P6") [Cursebot & Looter 2]
    pub fn targets_for_instance(instance_id: u32) -> (String, String) {
        // Runtime instances are allocated dynamically.  Never fall back to
        // P1/P2 for an id outside the old three-slot range: doing so aliases
        // two instances to the same virtual pads and causes duplicate input.
        let first = instance_id
            .saturating_sub(1)
            .saturating_mul(2)
            .saturating_add(1);
        (format!("P{first}"), format!("P{}", first.saturating_add(1)))
    }

    /// Ensure the 2 virtual Xbox 360 controllers for an instance exist and are ready.
    /// Called immediately before the game instance is launched/started.
    pub fn ensure_instance_controllers(&mut self, instance_id: u32) -> Result<(String, String)> {
        let (t1, t2) = Self::targets_for_instance(instance_id);
        self.ensure_target(&t1).with_context(|| {
            format!("Failed to initialize virtual controller {t1} for instance {instance_id}")
        })?;
        self.ensure_target(&t2).with_context(|| {
            format!("Failed to initialize virtual controller {t2} for instance {instance_id}")
        })?;
        info!(
            instance_id,
            t1, t2, "🎮 Initialized 2 virtual controllers for instance successfully"
        );
        Ok((t1, t2))
    }

    /// Unplug and remove controllers for an instance when it is unbound or stopped.
    pub fn remove_instance_controllers(&mut self, instance_id: u32) {
        let (t1, t2) = Self::targets_for_instance(instance_id);
        if let Some(mut target) = self.targets.remove(&t1) {
            let _ = target.unplug();
            poe2_world::controllers::unregister_virtual_target(&t1);
            info!(target = t1, instance_id, "🔌 Unplugged virtual controller");
        }
        self.reports.remove(&t1);
        if let Some(mut target) = self.targets.remove(&t2) {
            let _ = target.unplug();
            poe2_world::controllers::unregister_virtual_target(&t2);
            info!(target = t2, instance_id, "🔌 Unplugged virtual controller");
        }
        self.reports.remove(&t2);
    }

    /// Update gamepad state (thumbsticks, triggers, buttons) for a character.
    pub fn update(&mut self, name: &str, report: &XGamepad) -> Result<()> {
        if self.client.is_none() {
            bail!("ViGEmBus is not connected");
        }
        let guard = poe2_world::login::automation_guard();
        let neutral = XGamepad::default();
        let effective = if guard.is_some() { *report } else { neutral };
        let target = self
            .targets
            .get_mut(name)
            .with_context(|| format!("Virtual controller target {name} is not connected"))?;
        target
            .update(&effective)
            .context("Failed to send gamepad report to ViGEm")?;
        self.reports.insert(name.to_string(), effective);
        Ok(())
    }

    /// Send a directional move command: angle `(dx, dy)` normalized to analog stick range (-32768..32767).
    pub fn set_movement(&mut self, name: &str, dx: f32, dy: f32, sprint: bool) -> Result<()> {
        let mut report = self.reports.get(name).copied().unwrap_or_default();
        report.thumb_lx = 0;
        report.thumb_ly = 0;

        let len = (dx * dx + dy * dy).sqrt();
        if len > 0.001 {
            let scale = if sprint { 32767.0 } else { 22000.0 };
            let nx = (dx / len) * scale;
            let ny = -(dy / len) * scale; // Invert Y for screen-to-joystick standard
            report.thumb_lx = nx.clamp(-32768.0, 32767.0) as i16;
            report.thumb_ly = ny.clamp(-32768.0, 32767.0) as i16;
        }

        self.update(name, &report)
    }

    /// Press a specific button on the controller.
    pub fn press_button(&mut self, name: &str, buttons: XButtons) -> Result<()> {
        let mut report = self.reports.get(name).copied().unwrap_or_default();
        report.buttons.raw |= buttons.raw;
        self.update(name, &report)
    }

    /// Release only the requested buttons while preserving movement and other
    /// independently managed inputs.
    pub fn release_buttons(&mut self, name: &str, buttons: XButtons) -> Result<()> {
        let mut report = self.reports.get(name).copied().unwrap_or_default();
        report.buttons.raw &= !buttons.raw;
        self.update(name, &report)
    }

    /// Return the left stick to neutral without cancelling a button pulse.
    pub fn release_movement(&mut self, name: &str) -> Result<()> {
        let mut report = self.reports.get(name).copied().unwrap_or_default();
        report.thumb_lx = 0;
        report.thumb_ly = 0;
        self.update(name, &report)
    }

    /// Release all inputs on a controller (neutral position).
    pub fn release_all(&mut self, name: &str) -> Result<()> {
        let report = XGamepad::default();
        self.update(name, &report)
    }

    /// Broadcast Button 'A' (Interact / Revive / Portal) to ALL registered controllers simultaneously.
    pub fn broadcast_button_a(&mut self) -> Result<()> {
        let Some(_guard) = poe2_world::login::automation_guard() else {
            return self.broadcast_release();
        };
        let report = XGamepad {
            buttons: XButtons { raw: XButtons::A },
            ..Default::default()
        };
        for target in self.targets.values_mut() {
            let _ = target.update(&report);
        }
        for target_name in self.targets.keys() {
            self.reports.insert(target_name.clone(), report);
        }
        info!("📢 Broadcast Button 'A' sent to all active pads");
        Ok(())
    }

    /// Release buttons on all controllers.
    pub fn broadcast_release(&mut self) -> Result<()> {
        let report = XGamepad::default();
        for target in self.targets.values_mut() {
            let _ = target.update(&report);
        }
        for target_name in self.targets.keys() {
            self.reports.insert(target_name.clone(), report);
        }
        Ok(())
    }
}
