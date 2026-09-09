//! Foreground-scoped hotkey for the in-game trade overlay.
//!
//! `Alt+E` is registered only while a verified PoE process owns the foreground.
//! This keeps the shortcut available to every other Windows application and
//! avoids a system-wide keyboard hook.

use anyhow::Result;
use std::sync::Arc;

const HOTKEY_ID: i32 = 0x50_45;
const MOD_ALT: u32 = 0x0001;
const MOD_NOREPEAT: u32 = 0x4000;
const VK_E: u32 = 0x45;

/// Run the foreground-aware hotkey state machine on a dedicated Win32 thread.
pub fn spawn_hotkey_listener<F>(on_overlay_event: F) -> Result<std::thread::JoinHandle<()>>
where
    F: Fn() + Send + Sync + 'static,
{
    Ok(std::thread::Builder::new()
        .name("trade-hotkey-listener".to_string())
        .spawn(move || {
            #[cfg(windows)]
            unsafe {
                run_win32_hotkey_loop(Arc::new(on_overlay_event));
            }
            #[cfg(not(windows))]
            let _ = on_overlay_event;
        })?)
}

#[cfg(windows)]
unsafe fn run_win32_hotkey_loop<F>(on_overlay_event: Arc<F>)
where
    F: Fn() + Send + Sync + 'static,
{
    use poe2_types::ProcessIdentity;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VK_C, VK_CONTROL, VK_MENU,
    };

    extern "system" {
        fn RegisterHotKey(hwnd: *mut c_void, id: i32, modifiers: u32, vk: u32) -> i32;
        fn UnregisterHotKey(hwnd: *mut c_void, id: i32) -> i32;
        fn PeekMessageW(
            message: *mut RawMessage,
            hwnd: *mut c_void,
            min_filter: u32,
            max_filter: u32,
            remove_message: u32,
        ) -> i32;
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, pid: *mut u32) -> u32;
        fn GetClipboardSequenceNumber() -> u32;
    }

    #[repr(C)]
    struct RawMessage {
        hwnd: *mut c_void,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        point_x: i32,
        point_y: i32,
    }

    struct CaptureGuard(Arc<AtomicBool>);
    impl Drop for CaptureGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }

    const WM_HOTKEY: u32 = 0x0312;
    const PM_REMOVE: u32 = 0x0001;
    let capture_active = Arc::new(AtomicBool::new(false));
    let mut registered = false;
    let mut cached_foreground: Option<(u32, Option<ProcessIdentity>)> = None;
    let mut last_register_attempt: Option<Instant> = None;
    let mut warned_registration_failure = false;
    let mut message: RawMessage = std::mem::zeroed();

    loop {
        let foreground = foreground_game_identity(&mut cached_foreground);
        let should_register = foreground.is_some() && !crate::login::is_active();

        if !should_register && registered {
            UnregisterHotKey(std::ptr::null_mut(), HOTKEY_ID);
            registered = false;
            while PeekMessageW(
                &mut message,
                std::ptr::null_mut(),
                WM_HOTKEY,
                WM_HOTKEY,
                PM_REMOVE,
            ) != 0
            {}
            last_register_attempt = None;
            warned_registration_failure = false;
            tracing::debug!("Alt+E released outside the PoE foreground window");
        }

        let retry_due =
            last_register_attempt.is_none_or(|attempt| attempt.elapsed() >= Duration::from_secs(2));
        if should_register && !registered && retry_due {
            last_register_attempt = Some(Instant::now());
            registered = RegisterHotKey(
                std::ptr::null_mut(),
                HOTKEY_ID,
                MOD_ALT | MOD_NOREPEAT,
                VK_E,
            ) != 0;
            if registered {
                warned_registration_failure = false;
                tracing::info!("Alt+E enabled for the foreground PoE Trade overlay");
            } else if !warned_registration_failure {
                warned_registration_failure = true;
                tracing::warn!("Alt+E is already in use while PoE is foreground");
                super::market::publish_capture_error(
                    "Alt+E đang được ứng dụng khác sử dụng khi PoE đang mở.",
                );
            }
        }

        while registered
            && PeekMessageW(
                &mut message,
                std::ptr::null_mut(),
                WM_HOTKEY,
                WM_HOTKEY,
                PM_REMOVE,
            ) != 0
        {
            if message.message != WM_HOTKEY || message.wparam as i32 != HOTKEY_ID {
                continue;
            }
            let Some(identity) = foreground.clone() else {
                continue;
            };
            if capture_active.swap(true, Ordering::AcqRel) {
                tracing::debug!("Trade capture ignored because another capture is in progress");
                continue;
            }

            let callback = Arc::clone(&on_overlay_event);
            let busy = Arc::clone(&capture_active);
            std::thread::spawn(move || {
                let _guard = CaptureGuard(busy);

                // RegisterHotKey fires while Alt/E may still be physically down.
                // Never combine those physical modifiers with the synthetic Ctrl+C.
                let release_deadline = Instant::now() + Duration::from_millis(350);
                while key_down(VK_MENU.0 as i32) || key_down(VK_E as i32) {
                    if Instant::now() >= release_deadline {
                        super::market::publish_capture_error(
                            "Hãy thả Alt+E rồi bấm lại để check giá.",
                        );
                        callback();
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }

                if !foreground_matches(&identity) {
                    super::market::publish_capture_error(
                        "Cửa sổ PoE đã mất focus; không gửi Ctrl+C.",
                    );
                    callback();
                    return;
                }

                let clipboard_before = GetClipboardSequenceNumber();
                let make_key = |key, flags| INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: key,
                            dwFlags: flags,
                            ..Default::default()
                        },
                    },
                };
                let inputs = [
                    make_key(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
                    make_key(VK_C, KEYBD_EVENT_FLAGS(0)),
                    make_key(VK_C, KEYEVENTF_KEYUP),
                    make_key(VK_CONTROL, KEYEVENTF_KEYUP),
                ];
                let sent =
                    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) == inputs.len() as u32;
                let mut captured = None;
                if sent {
                    for delay in [200_u64, 500, 500] {
                        std::thread::sleep(Duration::from_millis(delay));
                        let clipboard_now = GetClipboardSequenceNumber();
                        if clipboard_before != 0 && clipboard_now == clipboard_before {
                            continue;
                        }
                        if let Ok(raw) = super::clipboard::read_clipboard_text() {
                            if let Ok(item) = super::parser::parse_poe2_item(&raw) {
                                captured = Some((raw, item));
                                break;
                            }
                        }
                    }
                }
                if let Some((raw, item)) = captured {
                    let mod_count = item.mods.len();
                    super::market::publish_capture(raw, item);
                    tracing::info!(mods = mod_count, "Trade hotkey captured a PoE item");
                } else {
                    super::market::publish_capture_error(
                        "No item found. Hãy trỏ chuột lên item rồi thử Alt+E.",
                    );
                }
                callback();
            });
        }

        std::thread::sleep(Duration::from_millis(25));
    }

    unsafe fn key_down(vk: i32) -> bool {
        (GetAsyncKeyState(vk) as u16 & 0x8000) != 0
    }

    unsafe fn foreground_game_identity(
        cached: &mut Option<(u32, Option<ProcessIdentity>)>,
    ) -> Option<ProcessIdentity> {
        let hwnd = GetForegroundWindow();
        let mut pid = 0_u32;
        if hwnd.is_null() || GetWindowThreadProcessId(hwnd, &mut pid) == 0 || pid == 0 {
            *cached = None;
            return None;
        }
        if let Some((cached_pid, identity)) = cached {
            if *cached_pid == pid {
                return identity.clone();
            }
        }
        let identity = crate::instances::inspect_game_process(pid)
            .ok()
            .map(|process| process.identity);
        *cached = Some((pid, identity.clone()));
        identity
    }

    unsafe fn foreground_matches(expected: &ProcessIdentity) -> bool {
        let hwnd = GetForegroundWindow();
        let mut pid = 0_u32;
        !hwnd.is_null()
            && GetWindowThreadProcessId(hwnd, &mut pid) != 0
            && pid == expected.pid
            && crate::instances::inspect_game_process(pid)
                .is_ok_and(|process| process.identity == *expected)
    }
}
