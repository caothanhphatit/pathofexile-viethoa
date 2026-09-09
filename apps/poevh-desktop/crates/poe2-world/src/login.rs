//! Experimental pixel-based Standalone login. No memory offsets or injected DLLs.
//! A submission is NOT proof of authentication. Never retry after sending input.
use anyhow::{ensure, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    RwLock, RwLockReadGuard,
};

static ACTIVE: AtomicBool = AtomicBool::new(false);
static CANCELLED: AtomicBool = AtomicBool::new(false);
static INPUT_GATE: RwLock<()> = RwLock::new(());

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}
pub fn cancel() {
    CANCELLED.store(true, Ordering::SeqCst);
}
pub fn is_cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}
pub fn automation_guard() -> Option<RwLockReadGuard<'static, ()>> {
    INPUT_GATE.try_read().ok()
}

pub struct LoginSession(std::sync::RwLockWriteGuard<'static, ()>);
impl LoginSession {
    pub fn begin() -> Result<Self> {
        let guard = INPUT_GATE
            .try_write()
            .map_err(|_| anyhow::anyhow!("Another login or input macro is active"))?;
        CANCELLED.store(false, Ordering::SeqCst);
        ACTIVE.store(true, Ordering::SeqCst);
        Ok(Self(guard))
    }
}
impl Drop for LoginSession {
    fn drop(&mut self) {
        let _ = &self.0;
        ACTIVE.store(false, Ordering::SeqCst);
    }
}

#[path = "login_pixels.rs"]
mod pixels;
pub use pixels::{detect_form, resize_capture, LoginLayout, PixelCapture};

#[cfg(windows)]
pub mod native {
    use super::*;
    use poe2_types::ProcessIdentity;
    use windows::Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::*,
        UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
    };

    #[derive(Clone, Copy, PartialEq, Debug)]
    struct Frame {
        hwnd: HWND,
        origin: POINT,
        width: i32,
        height: i32,
    }

    fn verify(identity: &ProcessIdentity) -> Result<Frame> {
        ensure!(!is_cancelled(), "Login cancelled by user");
        let actual = crate::instances::inspect_game_process(identity.pid)?;
        ensure!(
            actual.identity == *identity && actual.flavor == poe2_types::ClientFlavor::Standalone,
            "Process identity changed; login cancelled"
        );
        let mut pid = 0;
        let hwnd = unsafe { GetForegroundWindow() };
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        ensure!(
            pid == identity.pid && !unsafe { IsIconic(hwnd) }.as_bool(),
            "Keep the selected game foreground; login cancelled"
        );
        // ESC is a user cancellation key
        if unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } < 0 {
            anyhow::bail!("User cancelled login via Escape");
        }
        let mut rect = RECT::default();
        let mut origin = POINT::default();
        unsafe {
            GetClientRect(hwnd, &mut rect)?;
            ClientToScreen(hwnd, &mut origin).ok()?;
        }
        let frame = Frame {
            hwnd,
            origin,
            width: rect.right,
            height: rect.bottom,
        };
        ensure!(
            (800..=7680).contains(&frame.width) && (500..=4320).contains(&frame.height),
            "Unsupported window size"
        );
        Ok(frame)
    }

    fn capture(frame: Frame) -> Result<PixelCapture> {
        struct Capture {
            screen: HDC,
            memory: HDC,
            bitmap: HBITMAP,
            previous: HGDIOBJ,
        }
        impl Drop for Capture {
            fn drop(&mut self) {
                unsafe {
                    if !self.previous.0.is_null() {
                        SelectObject(self.memory, self.previous);
                    }
                    if !self.bitmap.0.is_null() {
                        let _ = DeleteObject(self.bitmap.into());
                    }
                    if !self.memory.0.is_null() {
                        let _ = DeleteDC(self.memory);
                    }
                    if !self.screen.0.is_null() {
                        ReleaseDC(None, self.screen);
                    }
                }
            }
        }
        let width = frame.width;
        let height = frame.height;
        let mut capture = Capture {
            screen: unsafe { GetDC(None) },
            memory: HDC::default(),
            bitmap: HBITMAP::default(),
            previous: HGDIOBJ::default(),
        };
        ensure!(!capture.screen.0.is_null(), "Screen capture unavailable");
        unsafe {
            capture.memory = CreateCompatibleDC(Some(capture.screen));
            ensure!(!capture.memory.0.is_null(), "Capture DC failed");
            capture.bitmap = CreateCompatibleBitmap(capture.screen, width, height);
            ensure!(!capture.bitmap.0.is_null(), "Capture bitmap failed");
            capture.previous = SelectObject(capture.memory, capture.bitmap.into());
            ensure!(!capture.previous.0.is_null(), "Capture selection failed");
            StretchBlt(
                capture.memory,
                0,
                0,
                width,
                height,
                Some(capture.screen),
                frame.origin.x,
                frame.origin.y,
                frame.width,
                frame.height,
                SRCCOPY,
            )
            .ok()?;
            SelectObject(capture.memory, capture.previous);
            capture.previous = HGDIOBJ::default();
        }
        let mut pixels = zeroize::Zeroizing::new(vec![0u8; (width * height * 4) as usize]);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        ensure!(
            unsafe {
                GetDIBits(
                    capture.screen,
                    capture.bitmap,
                    0,
                    height as u32,
                    Some(pixels.as_mut_ptr().cast()),
                    &mut info,
                    DIB_RGB_COLORS,
                )
            } == height,
            "Capture read failed"
        );
        // Analyze physical pixels: shrinking can erase the one-pixel field edges.
        Ok((pixels, width as usize, height as usize, 1.))
    }

    fn observe(
        identity: &ProcessIdentity,
        calibration: Option<&poe2_types::LoginCalibration>,
    ) -> Result<(Frame, LoginLayout)> {
        let frame = verify(identity)?;
        if let Some(cal) = calibration {
            let layout = LoginLayout {
                email: (cal.email[0], cal.email[1]),
                password: (cal.password[0], cal.password[1]),
                submit: (cal.submit[0], cal.submit[1]),
            };
            return Ok((frame, layout));
        }
        let (pixels, width, height, scale) = capture(frame)?;
        let mut layout = detect_form(&pixels, width, height, calibration)?;
        ensure!(
            verify(identity)? == frame,
            "Window moved during recognition"
        );
        for point in [&mut layout.email, &mut layout.password, &mut layout.submit] {
            point.0 *= scale;
            point.1 *= frame.height as f32 / height as f32;
        }
        Ok((frame, layout))
    }

    fn recheck(
        identity: &ProcessIdentity,
        frame: Frame,
        _layout: &LoginLayout,
        _calibration: Option<&poe2_types::LoginCalibration>,
    ) -> Result<()> {
        let current = verify(identity)?;
        ensure!(current == frame, "Game window moved or unfocused");
        Ok(())
    }

    fn guarded_click(identity: &ProcessIdentity, frame: Frame, point: (f32, f32)) -> Result<()> {
        ensure!(verify(identity)? == frame, "Window moved; login cancelled");
        let screen = POINT {
            x: frame.origin.x + point.0.round() as i32,
            y: frame.origin.y + point.1.round() as i32,
        };
        unsafe {
            let _ = SetCursorPos(screen.x, screen.y);
        }
        std::thread::sleep(std::time::Duration::from_millis(60));
        let inputs = [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP].map(|flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        });
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
        Ok(())
    }

    // Map the ENTIRE input before sending anything. No clipboard and no silent
    // Unicode fallback: unsupported layouts/characters fail before credentials.
    fn keyboard_plan(text: &str, keyboard: HKL) -> Result<zeroize::Zeroizing<Vec<i16>>> {
        let mut plan = zeroize::Zeroizing::new(Vec::new());
        for unit in text.encode_utf16() {
            let mapped = unsafe { VkKeyScanExW(unit, keyboard) };
            ensure!(
                mapped != -1 && (mapped as u16 >> 8) & !7 == 0,
                "Character unsupported by the game keyboard layout; no input sent"
            );
            plan.push(mapped);
        }
        Ok(plan)
    }

    fn send_key_chord(
        identity: &ProcessIdentity,
        frame: Frame,
        keys: &[VIRTUAL_KEY],
    ) -> Result<()> {
        ensure!(
            verify(identity)? == frame,
            "Focus changed before keyboard input"
        );
        let make = |key, flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        let mut inputs: Vec<_> = keys
            .iter()
            .map(|k| make(*k, KEYBD_EVENT_FLAGS(0)))
            .collect();
        inputs.extend(keys.iter().rev().map(|k| make(*k, KEYEVENTF_KEYUP)));
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            // Release any modifiers/keys delivered by a partial SendInput.
            let releases: Vec<_> = keys
                .iter()
                .rev()
                .map(|k| make(*k, KEYEVENTF_KEYUP))
                .collect();
            unsafe {
                SendInput(&releases, std::mem::size_of::<INPUT>() as i32);
            }
        }
        for input in &mut inputs {
            input.Anonymous.ki.wVk = VIRTUAL_KEY(0);
        }
        ensure!(
            sent == (keys.len() * 2) as u32,
            "Partial keyboard delivery; inspect manually, no automatic retry"
        );
        std::thread::sleep(std::time::Duration::from_millis(40));
        Ok(())
    }

    fn type_plan(
        identity: &ProcessIdentity,
        frame: Frame,
        _keyboard: HKL,
        plan: &[i16],
    ) -> Result<()> {
        for mapped in plan {
            let flags = (*mapped as u16) >> 8;
            let mut keys = Vec::new();
            for (bit, key) in [(1, VK_SHIFT), (2, VK_CONTROL), (4, VK_MENU)] {
                if flags & bit != 0 {
                    keys.push(key);
                }
            }
            keys.push(VIRTUAL_KEY(*mapped as u16 & 255));
            let result = send_key_chord(identity, frame, &keys);
            keys.fill(VIRTUAL_KEY(0));
            result?;
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Ok(())
    }

    /// Caller must own a LoginSession and quiesce existing gamepad workers first.
    pub fn submit(
        identity: &ProcessIdentity,
        credentials: &crate::credentials::Credentials,
        _session: &LoginSession,
        calibration: Option<&poe2_types::LoginCalibration>,
    ) -> Result<()> {
        use windows::Win32::UI::HiDpi::{
            SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        struct DpiContext(DPI_AWARENESS_CONTEXT);
        impl Drop for DpiContext {
            fn drop(&mut self) {
                unsafe {
                    SetThreadDpiAwarenessContext(self.0);
                }
            }
        }
        let previous =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        ensure!(
            !previous.0.is_null(),
            "Cannot establish physical-pixel coordinates; login cancelled"
        );
        let _dpi = DpiContext(previous);
        // Waiting is allowed only BEFORE any credential input. After the first
        // character, all failures return to the user, never to this loop.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
        let (frame, layout) = loop {
            verify(identity)?;
            match observe(identity, calibration) {
                Ok(observation) => break observation,
                Err(error) => {
                    ensure!(
                        std::time::Instant::now() < deadline,
                        "Login form not ready after 45 seconds: {error}"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
        };
        let thread = unsafe { GetWindowThreadProcessId(frame.hwnd, None) };
        let keyboard = unsafe { GetKeyboardLayout(thread) };
        ensure!(
            unsafe { GetKeyState(VK_CAPITAL.0 as i32) } & 1 == 0,
            "Turn Caps Lock off; no input sent"
        );
        let email = keyboard_plan(&credentials.email, keyboard)?;
        let password = keyboard_plan(&credentials.password, keyboard)?;

        // 1. Email
        recheck(identity, frame, &layout, calibration)?;
        guarded_click(identity, frame, layout.email)?;
        send_key_chord(identity, frame, &[VK_CONTROL, VK_A])?;
        send_key_chord(identity, frame, &[VK_BACK])?;
        type_plan(identity, frame, keyboard, &email)?;
        std::thread::sleep(std::time::Duration::from_millis(100));

        // 2. Password
        recheck(identity, frame, &layout, calibration)?;
        guarded_click(identity, frame, layout.password)?;
        send_key_chord(identity, frame, &[VK_CONTROL, VK_A])?;
        send_key_chord(identity, frame, &[VK_BACK])?;
        type_plan(identity, frame, keyboard, &password)?;
        std::thread::sleep(std::time::Duration::from_millis(100));

        // 3. Submit & Enter
        recheck(identity, frame, &layout, calibration)?;
        guarded_click(identity, frame, layout.submit)?;
        send_key_chord(identity, frame, &[VK_RETURN])?;

        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn keyboard_preflight_maps_digits_and_rejects_surrogates_without_sending_input() {
            let keyboard = unsafe { GetKeyboardLayout(0) };
            assert_eq!(keyboard_plan("0123456789", keyboard).unwrap().len(), 10);
            assert!(keyboard_plan("123🧪", keyboard).is_err());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_serializes_and_blocks_other_automation() {
        let session = LoginSession::begin().unwrap();
        assert!(is_active());
        assert!(LoginSession::begin().is_err());
        assert!(automation_guard().is_none());
        cancel();
        assert!(is_cancelled());
        drop(session);
        assert!(!is_active());
        assert!(automation_guard().is_some());
        let _session = LoginSession::begin().unwrap();
        assert!(!is_cancelled());
    }
}
