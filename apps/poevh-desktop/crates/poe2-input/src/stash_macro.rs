//! Auto-Stash Inventory Sweep Macro for Path of Exile 2.
//!
//! Simulates `Ctrl + LeftClick` over the 12x5 inventory grid. Every input is
//! guarded by the original foreground HWND/PID, and RAII cleanup always releases
//! Ctrl if the user changes focus or the macro exits early.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tracing::{info, warn};

static STASHING_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT,
    VK_CONTROL, VK_ESCAPE,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, SetCursorPos,
};

/// Calculates grid coordinates for all 60 slots given window rectangle.
pub fn calculate_inventory_slot_coords(rect: (i32, i32, i32, i32)) -> Vec<(i32, i32)> {
    let (left, top, right, bottom) = rect;
    let width = (right - left) as f32;
    let height = (bottom - top) as f32;

    let grid_start_x = left as f32 + width * 0.685;
    let grid_end_x = left as f32 + width * 0.975;
    let grid_start_y = top as f32 + height * 0.585;
    let grid_end_y = top as f32 + height * 0.825;

    let cell_w = (grid_end_x - grid_start_x) / 12.0;
    let cell_h = (grid_end_y - grid_start_y) / 5.0;

    let mut slots = Vec::with_capacity(60);
    for row in 0..5 {
        for col in 0..12 {
            let cx = (grid_start_x + (col as f32 + 0.5) * cell_w) as i32;
            let cy = (grid_start_y + (row as f32 + 0.5) * cell_h) as i32;
            slots.push((cx, cy));
        }
    }
    slots
}

struct ProgressGuard;
impl Drop for ProgressGuard {
    fn drop(&mut self) {
        STASHING_IN_PROGRESS.store(false, Ordering::SeqCst);
    }
}

#[cfg(windows)]
struct CtrlGuard {
    pressed: bool,
}

#[cfg(windows)]
impl CtrlGuard {
    fn press() -> Option<Self> {
        if send_key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)) {
            Some(Self { pressed: true })
        } else {
            None
        }
    }
}

#[cfg(windows)]
impl Drop for CtrlGuard {
    fn drop(&mut self) {
        if self.pressed && !send_key(VK_CONTROL, KEYEVENTF_KEYUP) {
            warn!("Failed to release Ctrl after Auto-Stash");
        }
    }
}

#[cfg(windows)]
fn send_key(
    key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    flags: KEYBD_EVENT_FLAGS,
) -> bool {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) == 1 }
}

#[cfg(windows)]
fn send_left_click() -> bool {
    let inputs = [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP].map(|flags| INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dwFlags: flags,
                ..Default::default()
            },
        },
    });
    unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32 }
}

#[cfg(windows)]
fn foreground_is(hwnd: HWND, pid: u32) -> bool {
    let current = unsafe { GetForegroundWindow() };
    if current != hwnd {
        return false;
    }
    let mut current_pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(current, Some(&mut current_pid));
    }
    current_pid == pid
}

/// Triggers the 60-slot auto stash sweep in a background worker thread.
pub fn execute_stash_sweep() -> bool {
    if STASHING_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        warn!("Auto-Stash sweep already in progress; skipping duplicate trigger");
        return false;
    }

    #[cfg(windows)]
    thread::spawn(move || {
        let _progress = ProgressGuard;
        let Some(_automation) = poe2_world::login::automation_guard() else {
            return;
        };

        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            warn!("Auto-Stash cancelled: no foreground window");
            return;
        }
        let mut pid = 0_u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == 0 || poe2_world::instances::inspect_game_process(pid).is_err() {
            warn!("Auto-Stash cancelled: foreground window is not a verified PoE process");
            return;
        }

        let mut win_rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut win_rect) }.is_err() {
            warn!("Failed to retrieve PoE foreground window rectangle");
            return;
        }
        let slots = calculate_inventory_slot_coords((
            win_rect.left,
            win_rect.top,
            win_rect.right,
            win_rect.bottom,
        ));

        let Some(_ctrl) = CtrlGuard::press() else {
            warn!("Auto-Stash cancelled: could not press Ctrl");
            return;
        };
        thread::sleep(Duration::from_millis(20));

        let mut deposited = 0;
        for (x, y) in slots {
            if !foreground_is(hwnd, pid) {
                warn!("Auto-Stash cancelled because PoE lost foreground focus");
                return;
            }
            let esc_down = unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } < 0;
            if esc_down {
                warn!("Auto-Stash aborted by user pressing Escape");
                break;
            }

            if unsafe { SetCursorPos(x, y) }.is_err() {
                warn!(x, y, "Auto-Stash cancelled: failed to move cursor");
                return;
            }
            thread::sleep(Duration::from_millis(10));
            if !foreground_is(hwnd, pid) {
                warn!("Auto-Stash cancelled before click because PoE lost focus");
                return;
            }
            if !send_left_click() {
                warn!("Auto-Stash cancelled: partial mouse input delivery");
                return;
            }
            thread::sleep(Duration::from_millis(25));
            deposited += 1;
        }

        info!(deposited, "Auto-Stash sweep completed");
    });

    #[cfg(not(windows))]
    {
        let _progress = ProgressGuard;
        info!("Auto-stash sweep mock executed on non-Windows");
    }

    true
}
