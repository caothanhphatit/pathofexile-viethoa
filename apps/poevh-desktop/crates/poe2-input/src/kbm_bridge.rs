//! Keyboard & Mouse to Virtual Controller 1 (P1) Bridge.
//!
//! Polls physical input only while a verified PoE2 window is foreground and
//! translates it into Xbox 360 reports. Avoiding system-wide low-level hooks
//! keeps IMEs such as UniKey isolated from the controller bridge.

use crate::VirtualGamepadManager;
use parking_lot::{Mutex, RwLock};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use tracing::info;
use vigem_client::{XButtons, XGamepad};

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

static SHARED_MGR: Mutex<Option<Arc<Mutex<VirtualGamepadManager>>>> = Mutex::new(None);
static HOOK_ENABLED: AtomicBool = AtomicBool::new(true);
static EMULATION_ENABLED: AtomicBool = AtomicBool::new(true);
static FOCUS_SLOT: AtomicU8 = AtomicU8::new(0); // 0 = P1, 1 = P2, 2 = P3, 3 = P4, 4 = P5, 5 = P6
static KEY_STATE: RwLock<[bool; 256]> = RwLock::new([false; 256]);
static MOUSE_CONFIG: RwLock<poe2_types::MouseBindingsConfig> =
    RwLock::new(poe2_types::MouseBindingsConfig {
        right_click_as_a: true,
        right_click_broadcast: false,
        key_a_as_right_click: false,
        mouse_4_action: String::new(),
        mouse_5_action: String::new(),
        middle_click_action: String::new(),
    });

static CONTROLLER_MAPPING: std::sync::LazyLock<RwLock<poe2_types::ControllerMappingConfig>> =
    std::sync::LazyLock::new(|| RwLock::new(poe2_types::ControllerMappingConfig::default()));

static CURRENT_LX: RwLock<f32> = RwLock::new(0.0);
static CURRENT_LY: RwLock<f32> = RwLock::new(0.0);

pub fn key_code_from_str(s: &str) -> Option<usize> {
    let clean = s.trim().to_uppercase();
    if clean.len() == 1 {
        let ch = clean.chars().next()?;
        if ch.is_ascii_alphabetic() {
            return Some(ch as usize);
        }
        if ch.is_ascii_digit() {
            return Some(ch as usize);
        }
        if ch == '`' || ch == '~' {
            return Some(0xC0);
        }
    }
    match clean.as_str() {
        "SPACE" => Some(0x20),
        "SHIFT" => Some(0x10),
        "CTRL" | "CONTROL" => Some(0x11),
        "ALT" => Some(0x12),
        "TAB" => Some(0x09),
        "ENTER" | "RETURN" => Some(0x0D),
        "ESCAPE" | "ESC" => Some(0x1B),
        "BACKSPACE" => Some(0x08),
        "CAPSLOCK" | "CAPS" => Some(0x14),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        "MOUSELEFT" | "LCLICK" | "MOUSE1" => Some(0x01),
        "MOUSERIGHT" | "RCLICK" | "MOUSE2" => Some(0x02),
        "MOUSEMID" | "MCLICK" | "MOUSE3" => Some(0x04),
        "MOUSE4" | "XBUTTON1" => Some(0x05),
        "MOUSE5" | "XBUTTON2" => Some(0x06),
        _ => None,
    }
}

#[cfg(windows)]
fn is_vk_physically_down(vk: usize, state: &[bool; 256]) -> bool {
    if state[vk] {
        return true;
    }
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0
    }
}

#[cfg(not(windows))]
fn is_vk_physically_down(vk: usize, state: &[bool; 256]) -> bool {
    state[vk]
}

pub fn is_key_active(state: &[bool; 256], key_str: &str) -> bool {
    if let Some(vk) = key_code_from_str(key_str) {
        is_vk_physically_down(vk, state)
    } else {
        false
    }
}

pub fn is_key_pressed(state: &[bool; 256], key_str: &str) -> bool {
    is_key_active(state, key_str)
}

#[cfg(windows)]
fn has_active_kbm_input() -> bool {
    let state = KEY_STATE.read();
    let ctrl_cfg = CONTROLLER_MAPPING.read().clone();
    let mouse_cfg = MOUSE_CONFIG.read().clone();

    if is_key_active(&state, &ctrl_cfg.move_up)
        || is_key_active(&state, &ctrl_cfg.move_down)
        || is_key_active(&state, &ctrl_cfg.move_left)
        || is_key_active(&state, &ctrl_cfg.move_right)
        || is_vk_physically_down(0x25, &state)
        || is_vk_physically_down(0x26, &state)
        || is_vk_physically_down(0x27, &state)
        || is_vk_physically_down(0x28, &state)
    {
        return true;
    }

    if is_key_active(&state, &ctrl_cfg.button_a)
        || is_key_active(&state, &ctrl_cfg.button_b)
        || is_key_active(&state, &ctrl_cfg.button_x)
        || is_key_active(&state, &ctrl_cfg.button_y)
        || is_key_active(&state, &ctrl_cfg.button_lb)
        || is_key_active(&state, &ctrl_cfg.button_rb)
        || is_key_active(&state, &ctrl_cfg.button_lt)
        || is_key_active(&state, &ctrl_cfg.button_rt)
        || is_key_active(&state, &ctrl_cfg.dpad_left)
        || is_key_active(&state, &ctrl_cfg.dpad_right)
        || is_key_active(&state, &ctrl_cfg.dpad_up)
        || is_key_active(&state, &ctrl_cfg.dpad_down)
        || is_key_active(&state, &ctrl_cfg.button_start)
        || is_key_active(&state, &ctrl_cfg.button_back)
        || (mouse_cfg.right_click_as_a && (state[0x02] || is_vk_physically_down(0x02, &state)))
    {
        return true;
    }

    false
}

type ActionCallback = Arc<dyn Fn(&str) + Send + Sync>;
static EXTERNAL_CALLBACK: Mutex<Option<ActionCallback>> = Mutex::new(None);

pub struct KbmBridge {
    pub enabled: Arc<AtomicBool>,
}

impl Default for KbmBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl KbmBridge {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn set_enabled(&self, val: bool) {
        let was_enabled = self.enabled.swap(val, Ordering::AcqRel);
        EMULATION_ENABLED.store(val, Ordering::Relaxed);
        if was_enabled && !val {
            let mut state = KEY_STATE.write();
            for k in state.iter_mut() {
                *k = false;
            }
            drop(state);
            let mut cx = CURRENT_LX.write();
            let mut cy = CURRENT_LY.write();
            *cx = 0.0;
            *cy = 0.0;
            drop(cx);
            drop(cy);
            release_focused_gamepad();
        }
    }

    pub fn update_mouse_config(cfg: &poe2_types::MouseBindingsConfig) {
        *MOUSE_CONFIG.write() = cfg.clone();
    }

    pub fn update_controller_mapping(cfg: &poe2_types::ControllerMappingConfig) {
        *CONTROLLER_MAPPING.write() = cfg.clone();
    }

    pub fn set_action_callback<F>(f: F)
    where
        F: Fn(&str) + Send + Sync + 'static,
    {
        *EXTERNAL_CALLBACK.lock() = Some(Arc::new(f));
    }

    pub fn dispatch_action(action: &str) {
        let cb = {
            let lock = EXTERNAL_CALLBACK.lock();
            lock.clone()
        };
        if let Some(cb) = cb {
            cb(action);
        }
    }

    pub fn set_focus_slot(slot: u8) {
        let clamped = slot.min(5);
        let prev = FOCUS_SLOT.swap(clamped, Ordering::Relaxed);
        if prev != clamped {
            let prev_target = match prev {
                0 => "P1",
                1 => "P2",
                2 => "P3",
                3 => "P4",
                4 => "P5",
                _ => "P6",
            };
            if let Some(ref mgr_lock) = *SHARED_MGR.lock() {
                let mut g = mgr_lock.lock();
                let _ = g.release_all(prev_target);
            }
        }
        info!(
            "🎯 KBM Input Focus switched to Char {} (Slot {})",
            clamped + 1,
            clamped
        );
    }

    pub fn get_focus_slot() -> u8 {
        FOCUS_SLOT.load(Ordering::Relaxed)
    }

    pub fn broadcast_interact_a() {
        if !EMULATION_ENABLED.load(Ordering::Acquire) {
            return;
        }
        if let Some(ref mgr_lock) = *SHARED_MGR.lock() {
            let mut g = mgr_lock.lock();
            let _ = g.broadcast_button_a();
            let mgr_clone = Arc::clone(mgr_lock);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                let mut g = mgr_clone.lock();
                let _ = g.broadcast_release();
            });
        }
    }

    /// Start foreground-scoped physical-input polling. No system-wide Windows
    /// keyboard or mouse hook is installed.
    pub fn start_worker(&self, gamepad_mgr: Arc<Mutex<VirtualGamepadManager>>) {
        info!("⌨️🖱️➡️🎮 Foreground-only KBM polling worker starting (no global hooks)");

        *SHARED_MGR.lock() = Some(gamepad_mgr);
        HOOK_ENABLED.store(self.enabled.load(Ordering::Relaxed), Ordering::Relaxed);

        #[cfg(windows)]
        std::thread::spawn(move || {
            let mut was_active = false;
            let mut previous = [false; 256];
            while HOOK_ENABLED.load(Ordering::Relaxed) {
                let game_active = EMULATION_ENABLED.load(Ordering::Relaxed)
                    && !poe2_world::login::is_active()
                    && is_poe2_foreground();
                std::thread::sleep(std::time::Duration::from_millis(if game_active {
                    8
                } else {
                    50
                }));

                if game_active {
                    poll_shortcuts_and_mouse(&mut previous);
                    let active = has_active_kbm_input();
                    let cur_moving = {
                        let cx = CURRENT_LX.read();
                        let cy = CURRENT_LY.read();
                        cx.abs() > 10.0 || cy.abs() > 10.0
                    };

                    if active || cur_moving {
                        dispatch_gamepad_report();
                        was_active = true;
                    } else if was_active {
                        dispatch_gamepad_report();
                        was_active = false;
                    }
                } else if was_active {
                    let mut cx = CURRENT_LX.write();
                    let mut cy = CURRENT_LY.write();
                    *cx = 0.0;
                    *cy = 0.0;
                    dispatch_gamepad_report();
                    was_active = false;
                    previous.fill(false);
                } else {
                    previous.fill(false);
                }
            }
        });
    }
}

#[cfg(windows)]
static CACHED_POE2_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
#[cfg(windows)]
static CACHED_NOT_POE2_PID: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[cfg(windows)]
fn is_poe2_foreground() -> bool {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return false;
        }

        let known_poe2 = CACHED_POE2_PID.load(Ordering::Relaxed);
        if known_poe2 != 0 && pid == known_poe2 {
            return true;
        }
        let known_not_poe2 = CACHED_NOT_POE2_PID.load(Ordering::Relaxed);
        if known_not_poe2 != 0 && pid == known_not_poe2 {
            return false;
        }

        let is_poe2 = poe2_world::instances::inspect_game_process(pid).is_ok();
        if is_poe2 {
            CACHED_POE2_PID.store(pid, Ordering::Relaxed);
            CACHED_NOT_POE2_PID.store(0, Ordering::Relaxed);
        } else {
            CACHED_NOT_POE2_PID.store(pid, Ordering::Relaxed);
        }
        is_poe2
    }
}

#[cfg(windows)]
fn vk_down(vk: usize) -> bool {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0
    }
}

#[cfg(windows)]
fn rising(previous: &mut [bool; 256], vk: usize) -> bool {
    let down = vk_down(vk);
    let result = down && !previous[vk];
    previous[vk] = down;
    result
}

#[cfg(windows)]
fn poll_shortcuts_and_mouse(previous: &mut [bool; 256]) {
    let ctrl = vk_down(0x11) || vk_down(0xA2) || vk_down(0xA3);
    let alt = vk_down(0x12) || vk_down(0xA4) || vk_down(0xA5);
    for (offset, vk) in (0x31usize..=0x36).enumerate() {
        if rising(previous, vk) && ctrl {
            KbmBridge::set_focus_slot(offset as u8);
        }
    }
    if (rising(previous, 0x20) && alt) || rising(previous, 0x47) {
        KbmBridge::broadcast_interact_a();
    }
    if rising(previous, 0x78) {
        std::thread::spawn(crate::stash_macro::execute_stash_sweep);
    }

    let cfg = MOUSE_CONFIG.read().clone();
    if rising(previous, 0x02) && cfg.right_click_broadcast {
        KbmBridge::broadcast_interact_a();
    }
    if rising(previous, 0x04) {
        handle_mouse_action(&cfg.middle_click_action);
    }
    if rising(previous, 0x05) {
        handle_mouse_action(&cfg.mouse_4_action);
    }
    if rising(previous, 0x06) {
        handle_mouse_action(&cfg.mouse_5_action);
    }
}

#[cfg(windows)]
fn dispatch_gamepad_report() {
    // The worker may have observed the old enabled state immediately before
    // the UI toggled the bridge off.  Refuse that late report instead of
    // re-reading a still-held physical key and re-latching it onto ViGEm.
    if !EMULATION_ENABLED.load(Ordering::Acquire) {
        return;
    }

    let mut report = XGamepad::default();
    let state = KEY_STATE.read();
    let mouse_cfg = MOUSE_CONFIG.read().clone();
    let ctrl_cfg = CONTROLLER_MAPPING.read().clone();

    // ─── Analog Movement (Thumbstick) ──────────────────────────────────────
    let mut dx: f32 = 0.0;
    let mut dy: f32 = 0.0;

    if is_key_active(&state, &ctrl_cfg.move_up) || is_vk_physically_down(0x26, &state) {
        dy += 1.0;
    }
    if is_key_active(&state, &ctrl_cfg.move_down) || is_vk_physically_down(0x28, &state) {
        dy -= 1.0;
    }
    if is_key_active(&state, &ctrl_cfg.move_left) || is_vk_physically_down(0x25, &state) {
        dx -= 1.0;
    }
    if is_key_active(&state, &ctrl_cfg.move_right) || is_vk_physically_down(0x27, &state) {
        dx += 1.0;
    }

    let target_x: f32;
    let target_y: f32;

    if dx == 0.0 && dy == 0.0 {
        target_x = 0.0;
        target_y = 0.0;
    } else {
        let len = (dx * dx + dy * dy).sqrt();
        let scale = 32767.0;
        target_x = (dx / len) * scale;
        target_y = (dy / len) * scale;
    }

    // Smooth inertia interpolation:
    // Reaches full sprint within ~35ms, providing natural analog acceleration
    // and smooth diagonal steering without abrupt snapping!
    let mut cur_x = CURRENT_LX.write();
    let mut cur_y = CURRENT_LY.write();

    let lerp_rate = if target_x == 0.0 && target_y == 0.0 {
        0.45
    } else {
        0.38
    };
    *cur_x += (target_x - *cur_x) * lerp_rate;
    *cur_y += (target_y - *cur_y) * lerp_rate;

    if target_x == 0.0 && cur_x.abs() < 800.0 {
        *cur_x = 0.0;
    }
    if target_y == 0.0 && cur_y.abs() < 800.0 {
        *cur_y = 0.0;
    }

    report.thumb_lx = cur_x.clamp(-32768.0, 32767.0) as i16;
    report.thumb_ly = cur_y.clamp(-32768.0, 32767.0) as i16;

    // ─── Button Mapping ────────────────────────────────────────────────────
    let mut raw_buttons: u16 = 0;

    // Button A (Dodge Roll / Attack / Interact)
    if is_key_active(&state, &ctrl_cfg.button_a)
        || (mouse_cfg.right_click_as_a && (state[0x02] || is_vk_physically_down(0x02, &state)))
        || (mouse_cfg.key_a_as_right_click && is_vk_physically_down(0x41, &state))
    {
        raw_buttons |= XButtons::A;
    }

    // Button B (Skill 3)
    if is_key_active(&state, &ctrl_cfg.button_b) {
        raw_buttons |= XButtons::B;
    }

    // Button X (Skill 1)
    if is_key_active(&state, &ctrl_cfg.button_x) {
        raw_buttons |= XButtons::X;
    }

    // Button Y (Skill 2)
    if is_key_active(&state, &ctrl_cfg.button_y) {
        raw_buttons |= XButtons::Y;
    }

    // Left Bumper (LB / Modifier)
    if is_key_active(&state, &ctrl_cfg.button_lb)
        || state[0xA0]
        || state[0xA1]
        || is_vk_physically_down(0xA0, &state)
        || is_vk_physically_down(0xA1, &state)
    {
        raw_buttons |= XButtons::LB;
    }

    // Right Bumper (RB / Skill 4)
    if is_key_active(&state, &ctrl_cfg.button_rb) {
        raw_buttons |= XButtons::RB;
    }

    // Left & Right Triggers (LT & RT)
    if is_key_active(&state, &ctrl_cfg.button_lt) {
        report.left_trigger = 255;
    }
    if is_key_active(&state, &ctrl_cfg.button_rt) {
        report.right_trigger = 255;
    }

    // D-Pad Left (Life Flask)
    if is_key_active(&state, &ctrl_cfg.dpad_left) && !is_vk_physically_down(0x11, &state) {
        raw_buttons |= XButtons::LEFT;
    }

    // D-Pad Right (Mana Flask)
    if is_key_active(&state, &ctrl_cfg.dpad_right) && !is_vk_physically_down(0x11, &state) {
        raw_buttons |= XButtons::RIGHT;
    }

    // D-Pad Up
    if is_key_active(&state, &ctrl_cfg.dpad_up) && !is_vk_physically_down(0x11, &state) {
        raw_buttons |= XButtons::UP;
    }

    // D-Pad Down
    if is_key_active(&state, &ctrl_cfg.dpad_down) && !is_vk_physically_down(0x11, &state) {
        raw_buttons |= XButtons::DOWN;
    }

    // Back / View (Toggle Map)
    if is_key_active(&state, &ctrl_cfg.button_back) {
        raw_buttons |= XButtons::BACK;
    }

    // Start / Menu (Game Menu)
    if is_key_active(&state, &ctrl_cfg.button_start) {
        raw_buttons |= XButtons::START;
    }

    drop(state);

    report.buttons = XButtons { raw: raw_buttons };

    let slot = FOCUS_SLOT.load(Ordering::Relaxed);
    let target_name = match slot {
        0 => "P1",
        1 => "P2",
        2 => "P3",
        3 => "P4",
        4 => "P5",
        _ => "P6",
    };

    if let Some(ref mgr_lock) = *SHARED_MGR.lock() {
        let mut g = mgr_lock.lock();
        let _ = g.update(target_name, &report);
    }
}

#[cfg(windows)]
fn release_focused_gamepad() {
    let slot = FOCUS_SLOT.load(Ordering::Relaxed);
    let target_name = match slot {
        0 => "P1",
        1 => "P2",
        2 => "P3",
        3 => "P4",
        4 => "P5",
        _ => "P6",
    };
    if let Some(ref mgr_lock) = *SHARED_MGR.lock() {
        let mut manager = mgr_lock.lock();
        let _ = manager.release_all(target_name);
    }
}

#[cfg(windows)]
fn handle_mouse_action(action: &str) {
    match action {
        "TOGGLE_BOT" => {
            KbmBridge::dispatch_action("TOGGLE_BOT");
        }
        "REGROUP" => {
            KbmBridge::dispatch_action("REGROUP");
        }
        "AUTO_STASH" => {
            std::thread::spawn(crate::stash_macro::execute_stash_sweep);
        }
        "BUTTON_A" => {
            KbmBridge::broadcast_interact_a();
        }
        "DODGE_ROLL" => {
            std::thread::spawn(|| {
                let mut state = KEY_STATE.write();
                state[0x20] = true;
                drop(state);
                dispatch_gamepad_report();
                std::thread::sleep(std::time::Duration::from_millis(100));
                let mut state = KEY_STATE.write();
                state[0x20] = false;
                drop(state);
                dispatch_gamepad_report();
            });
        }
        _ => {}
    }
}
