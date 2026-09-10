//! Desktop Application Window (WebView2).
//!
//! Spawns:
//! 1. Main Studio Management Window (1140x800, cream/light theme)
//! 2. Global Hotkeys:
//!    - [F10]: Toggle Bot Start / Pause
//!    - [F12]: Regroup bound followers to the leader

use anyhow::Result;
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use std::sync::Arc;
use tao::{
    dpi::{LogicalPosition, LogicalSize, PhysicalPosition},
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use tracing::info;
use wry::WebViewBuilder;

#[cfg(windows)]
use tao::platform::windows::WindowExtWindows;
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

#[cfg(windows)]
fn is_poe2_foreground() -> bool {
    is_poe2_or_overlay_foreground(0)
}

#[cfg(windows)]
fn is_poe2_or_overlay_foreground(leveling_hwnd: isize) -> bool {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return false;
    }
    if leveling_hwnd != 0 && hwnd.0 as isize == leveling_hwnd {
        return true;
    }
    let mut pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    pid != 0 && poe2_world::instances::inspect_game_process(pid).is_ok()
}

#[derive(Debug)]
enum DesktopEvent {
    #[cfg(windows)]
    TrayIcon(tray_icon::TrayIconEvent),
    #[cfg(windows)]
    TrayMenu(tray_icon::menu::MenuEvent),
    ShowTrade,
    HideTrade,
    ShowTradeCompare,
    HideTradeCompare,
    HideExpedition,
    ToggleLeveling,
    HideLeveling,
    DragLeveling,
    CollapseLeveling,
    ExpandLeveling,
}

#[cfg(windows)]
const TRAY_MENU_OPEN_ID: &str = "poevh.tray.open";
#[cfg(windows)]
const TRAY_MENU_EXIT_ID: &str = "poevh.tray.exit";

#[cfg(windows)]
fn poevh_tray_icon() -> Result<tray_icon::Icon> {
    // A tiny embedded RGBA icon keeps the tray independent of the current
    // working directory (both deployed POEVH.exe locations behave identically).
    const SIZE: u32 = 32;
    let mut rgba = vec![0_u8; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as i32 - 15;
            let dy = y as i32 - 15;
            let inside = dx * dx + dy * dy <= 14 * 14;
            let diamond = dx.abs() + dy.abs() <= 8;
            let pixel = ((y * SIZE + x) * 4) as usize;
            let color = if diamond {
                [221, 180, 73, 255]
            } else if inside {
                [78, 99, 61, 255]
            } else {
                [0, 0, 0, 0]
            };
            rgba[pixel..pixel + 4].copy_from_slice(&color);
        }
    }
    tray_icon::Icon::from_rgba(rgba, SIZE, SIZE).map_err(Into::into)
}

#[cfg(windows)]
fn create_native_tray() -> Result<tray_icon::TrayIcon> {
    use tray_icon::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tray_icon::TrayIconBuilder;

    let open = MenuItem::with_id(TRAY_MENU_OPEN_ID, "Mở POEVH", true, None);
    let separator = PredefinedMenuItem::separator();
    let exit = MenuItem::with_id(TRAY_MENU_EXIT_ID, "Thoát hoàn toàn", true, None);
    let menu = Menu::with_items(&[&open, &separator, &exit])?;

    TrayIconBuilder::new()
        .with_id("poevh.tray")
        .with_tooltip("POEVH — Alt+E để check giá")
        .with_icon(poevh_tray_icon()?)
        .with_menu(Box::new(menu))
        .with_menu_on_left_click(false)
        .build()
        .map_err(Into::into)
}

#[cfg(windows)]
fn tray_event_requests_restore(event: &tray_icon::TrayIconEvent) -> bool {
    use tray_icon::{MouseButton, MouseButtonState, TrayIconEvent};
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        }
    )
}

pub fn run_desktop_app(runtime: Arc<Mutex<BotRuntime>>) -> Result<()> {
    info!("🚀 Launching POE2 Desktop Application...");

    // Optimize WebView2 rendering to never stall GPU or drop in-game FPS
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGS",
        "--disable-gpu-vsync --disable-background-timer-throttling --disable-renderer-backgrounding",
    );

    let mut event_loop_builder = EventLoopBuilder::<DesktopEvent>::with_user_event();
    let event_loop = event_loop_builder.build();

    #[cfg(windows)]
    {
        let tray_proxy = event_loop.create_proxy();
        tray_icon::TrayIconEvent::set_event_handler(Some(move |event| {
            let _ = tray_proxy.send_event(DesktopEvent::TrayIcon(event));
        }));
        let menu_proxy = event_loop.create_proxy();
        tray_icon::menu::MenuEvent::set_event_handler(Some(move |event| {
            let _ = menu_proxy.send_event(DesktopEvent::TrayMenu(event));
        }));
    }

    // ── Main Desktop App Window ─────────────────────────────────────────────
    let main_window = WindowBuilder::new()
        .with_title("POEVH")
        .with_theme(Some(tao::window::Theme::Light))
        .with_inner_size(LogicalSize::new(1140.0, 800.0))
        .with_min_inner_size(LogicalSize::new(960.0, 640.0))
        .build(&event_loop)?;

    let main_id = main_window.id();

    #[cfg(windows)]
    let tray_icon = create_native_tray()?;

    let main_ipc = event_loop.create_proxy();
    let main_webview = WebViewBuilder::new()
        .with_background_color((245, 241, 231, 255))
        .with_url("http://127.0.0.1:8766")
        .with_ipc_handler(move |request| match request.body().as_str() {
            "toggle-leveling" => {
                let _ = main_ipc.send_event(DesktopEvent::ToggleLeveling);
            }
            "hide-leveling" => {
                let _ = main_ipc.send_event(DesktopEvent::HideLeveling);
            }
            _ => {}
        })
        .build(&main_window)?;

    // Dedicated compact window. It remains warm but hidden, so Ctrl+E only
    // needs to capture the item and paint current data instead of booting a UI.
    let trade_window = WindowBuilder::new()
        .with_title("POEVH — Trade")
        .with_theme(Some(tao::window::Theme::Dark))
        .with_inner_size(LogicalSize::new(980.0, 980.0))
        .with_min_inner_size(LogicalSize::new(840.0, 700.0))
        .with_position(LogicalPosition::new(620.0, 60.0))
        .with_decorations(false)
        .with_transparent(true)
        .with_resizable(false)
        .with_always_on_top(true)
        .with_visible(false)
        .build(&event_loop)?;
    let trade_id = trade_window.id();

    #[cfg(windows)]
    unsafe {
        extern "system" {
            fn LoadLibraryA(lpLibFileName: *const u8) -> *mut std::ffi::c_void;
            fn GetProcAddress(
                hModule: *mut std::ffi::c_void,
                lpProcName: *const u8,
            ) -> *const std::ffi::c_void;
        }
        let h_dwm = LoadLibraryA(c"dwmapi.dll".as_ptr().cast());
        if !h_dwm.is_null() {
            let func = GetProcAddress(h_dwm, c"DwmSetWindowAttribute".as_ptr().cast());
            if !func.is_null() {
                type FnDwmSetWindowAttribute = unsafe extern "system" fn(
                    *mut std::ffi::c_void,
                    u32,
                    *const std::ffi::c_void,
                    u32,
                ) -> i32;
                let set_attr: FnDwmSetWindowAttribute = std::mem::transmute(func);
                let hwnd = trade_window.hwnd() as *mut std::ffi::c_void;
                let dark_mode: i32 = 1;
                // DWMWA_USE_IMMERSIVE_DARK_MODE = 20
                let _ = set_attr(hwnd, 20, &dark_mode as *const _ as *const _, 4);
                // DWMWA_BORDER_COLOR = 34
                let border_color: u32 = 0x000A0C0D;
                let _ = set_attr(hwnd, 34, &border_color as *const _ as *const _, 4);
            }
        }
    }

    let ipc_proxy = event_loop.create_proxy();
    let trade_webview = WebViewBuilder::new()
        .with_background_color((0, 0, 0, 0))
        .with_url("http://127.0.0.1:8766/trade-overlay")
        .with_ipc_handler(move |request| match request.body().as_str() {
            "hide-trade" => {
                let _ = ipc_proxy.send_event(DesktopEvent::HideTrade);
            }
            "show-trade-compare" => {
                let _ = ipc_proxy.send_event(DesktopEvent::ShowTradeCompare);
            }
            "hide-trade-compare" => {
                let _ = ipc_proxy.send_event(DesktopEvent::HideTradeCompare);
            }
            _ => {}
        })
        .build(&trade_window)?;

    let expedition_window = WindowBuilder::new()
        .with_title("POEVH — Expedition Radar")
        .with_inner_size(LogicalSize::new(560.0, 820.0))
        .with_min_inner_size(LogicalSize::new(480.0, 500.0))
        .with_decorations(false)
        .with_always_on_top(true)
        .with_visible(false)
        .build(&event_loop)?;
    let expedition_id = expedition_window.id();
    let expedition_ipc = event_loop.create_proxy();
    let _expedition_webview = WebViewBuilder::new()
        .with_background_color((17, 16, 13, 0))
        .with_url("http://127.0.0.1:8766/expedition-overlay")
        .with_ipc_handler(move |request| {
            if request.body().as_str() == "hide-expedition" {
                let _ = expedition_ipc.send_event(DesktopEvent::HideExpedition);
            }
        })
        .build(&expedition_window)?;

    let leveling_window = WindowBuilder::new()
        .with_title("POEVH — Leveling")
        .with_inner_size(LogicalSize::new(280.0, 180.0))
        .with_min_inner_size(LogicalSize::new(240.0, 34.0))
        .with_position(LogicalPosition::new(20.0, 140.0))
        .with_decorations(false)
        .with_always_on_top(true)
        .with_visible(false)
        .build(&event_loop)?;
    let leveling_id = leveling_window.id();
    #[cfg(windows)]
    let leveling_raw_hwnd = leveling_window.hwnd();
    #[cfg(not(windows))]
    let leveling_raw_hwnd = 0_isize;

    #[cfg(windows)]
    unsafe {
        extern "system" {
            fn LoadLibraryA(lpLibFileName: *const u8) -> *mut std::ffi::c_void;
            fn GetProcAddress(
                hModule: *mut std::ffi::c_void,
                lpProcName: *const u8,
            ) -> *const std::ffi::c_void;
        }
        let h_dwm = LoadLibraryA(c"dwmapi.dll".as_ptr().cast());
        if !h_dwm.is_null() {
            let func = GetProcAddress(h_dwm, c"DwmSetWindowAttribute".as_ptr().cast());
            if !func.is_null() {
                type FnDwmSetWindowAttribute = unsafe extern "system" fn(
                    *mut std::ffi::c_void,
                    u32,
                    *const std::ffi::c_void,
                    u32,
                ) -> i32;
                let set_attr: FnDwmSetWindowAttribute = std::mem::transmute(func);
                let hwnd = leveling_window.hwnd() as *mut std::ffi::c_void;
                let dark_mode: i32 = 1;
                let _ = set_attr(hwnd, 20, &dark_mode as *const _ as *const _, 4);
                let border_color: u32 = 0x000A0C0D;
                let _ = set_attr(hwnd, 34, &border_color as *const _ as *const _, 4);
            }
        }
    }

    let leveling_ipc = event_loop.create_proxy();
    let _leveling_webview = WebViewBuilder::new()
        .with_background_color((14, 13, 11, 255))
        .with_url("http://127.0.0.1:8766/leveling-overlay")
        .with_ipc_handler(move |request| {
            let msg = request.body();
            match msg.as_str() {
                "hide-leveling" => {
                    let _ = leveling_ipc.send_event(DesktopEvent::HideLeveling);
                }
                "drag-leveling" => {
                    let _ = leveling_ipc.send_event(DesktopEvent::DragLeveling);
                }
                "collapse-leveling" => {
                    let _ = leveling_ipc.send_event(DesktopEvent::CollapseLeveling);
                }
                "expand-leveling" => {
                    let _ = leveling_ipc.send_event(DesktopEvent::ExpandLeveling);
                }
                _ => {}
            }
        })
        .build(&leveling_window)?;

    {
        let proxy = event_loop.create_proxy();
        poe2_world::spawn_hotkey_listener(move || {
            let _ = proxy.send_event(DesktopEvent::ShowTrade);
        })?;
    }

    let trade_visible = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // ── Global Hotkey Polling Thread (Esc: Close Trade, F6: Leveling, F10: Toggle Bot, F12: Regroup followers) ──
    {
        let rt = Arc::clone(&runtime);
        let leveling_hotkey_proxy = event_loop.create_proxy();
        let trade_hotkey_proxy = event_loop.create_proxy();
        let trade_vis_clone = Arc::clone(&trade_visible);

        std::thread::spawn(move || {
            let mut last_esc = false;
            let mut last_f6 = false;
            let mut last_f10 = false;
            let mut last_f12 = false;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(50));

                #[cfg(windows)]
                unsafe {
                    // Esc (0x1B): Close Trade Overlay if visible
                    let esc = (GetAsyncKeyState(0x1B) as u16 & 0x8000) != 0;
                    if esc && !last_esc && trade_vis_clone.load(std::sync::atomic::Ordering::SeqCst)
                    {
                        let _ = trade_hotkey_proxy.send_event(DesktopEvent::HideTrade);
                        info!("⌨️ [Esc] Hotkey dismissed Trade Overlay");
                    }
                    last_esc = esc;

                    // F6 (0x75): Toggle Leveling Overlay
                    let f6 = (GetAsyncKeyState(0x75) as u16 & 0x8000) != 0;
                    if f6 && !last_f6 && is_poe2_foreground() {
                        let _ = leveling_hotkey_proxy.send_event(DesktopEvent::ToggleLeveling);
                        info!("🗺️ [F6] Hotkey toggled Leveling Overlay");
                    }
                    last_f6 = f6;
                    // F10 (0x79): Toggle Bot Run/Pause
                    let f10 = (GetAsyncKeyState(0x79) as u16 & 0x8000) != 0;
                    if f10 && !last_f10 && !poe2_world::login::is_active() && is_poe2_foreground() {
                        let mut r = rt.lock();
                        let cur = r.to_api_snapshot().running;
                        r.cmd_run(!cur);
                        info!(running = !cur, "⌨️ [F10] Hotkey toggled Bot state");
                    }
                    last_f10 = f10;

                    // F12 (0x7B): request a PID-bound follower regroup.
                    let f12 = (GetAsyncKeyState(0x7B) as u16 & 0x8000) != 0;
                    if f12 && !last_f12 && !poe2_world::login::is_active() && is_poe2_foreground() {
                        let mut r = rt.lock();
                        r.cmd_join_p2();
                        info!("⌨️ [F12] Hotkey requested follower regroup");
                    }
                    last_f12 = f12;
                }
            }
        });
    }

    // ── Desktop Event Loop ──────────────────────────────────────────────────
    let mut last_expedition_ui_poll =
        std::time::Instant::now() - std::time::Duration::from_millis(500);
    event_loop.run(move |event, _, control_flow| {
        #[cfg(windows)]
        let _keep_tray_alive = &tray_icon;
        *control_flow = ControlFlow::WaitUntil(
            std::time::Instant::now() + std::time::Duration::from_millis(100),
        );

        match event {
            Event::NewEvents(StartCause::Init) => {
                info!("Desktop application initialized");
            }
            #[cfg(windows)]
            Event::UserEvent(DesktopEvent::TrayIcon(event)) => {
                tracing::debug!(?event, "System tray pointer event received");
                if tray_event_requests_restore(&event) {
                    main_window.set_visible(true);
                    main_window.set_minimized(false);
                    main_window.set_focus();
                    info!("System tray left click restored POEVH");
                }
            }
            #[cfg(windows)]
            Event::UserEvent(DesktopEvent::TrayMenu(event)) => {
                if event.id == TRAY_MENU_OPEN_ID {
                    main_window.set_visible(true);
                    main_window.set_minimized(false);
                    main_window.set_focus();
                    info!("System tray menu restored POEVH");
                } else if event.id == TRAY_MENU_EXIT_ID {
                    info!("System tray menu requested full exit");
                    *control_flow = ControlFlow::Exit;
                }
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::CloseRequested,
                ..
            } if window_id == main_id => {
                main_window.set_visible(false);
                info!("Main window hidden to system tray");
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::Resized(_),
                ..
            } if window_id == main_id && main_window.is_minimized() => {
                main_window.set_visible(false);
                main_window.set_minimized(false);
                info!("Main window minimized to system tray");
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::CloseRequested,
                ..
            } if window_id == trade_id => {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                    let hwnd = HWND(trade_window.hwnd() as *mut _);
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
                trade_window.set_visible(false);
                trade_window.set_inner_size(LogicalSize::new(980.0, 980.0));
                trade_visible.store(false, std::sync::atomic::Ordering::SeqCst);
                poe2_world::clear_trade_capture();
                let _ = trade_webview.evaluate_script("window.resetTradeOverlay?.();");
            }
            Event::UserEvent(DesktopEvent::ShowTrade) => {
                trade_window.set_inner_size(LogicalSize::new(980.0, 980.0));
                if let Some(monitor) = main_window.current_monitor() {
                    let monitor_position = monitor.position();
                    let monitor_size = monitor.size();
                    let overlay_size = trade_window.outer_size();
                    let x = monitor_position.x
                        + (monitor_size.width.saturating_sub(overlay_size.width) / 2) as i32;
                    let y = monitor_position.y
                        + (monitor_size.height.saturating_sub(overlay_size.height) / 2) as i32;
                    trade_window.set_outer_position(PhysicalPosition::new(x, y));
                }
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
                        SWP_NOSIZE, SW_SHOWNOACTIVATE,
                    };
                    let hwnd = HWND(trade_window.hwnd() as *mut _);
                    let _ = SetWindowPos(
                        hwnd,
                        Some(HWND_TOPMOST),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    );
                    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                }
                #[cfg(not(windows))]
                {
                    trade_window.set_visible(true);
                }
                trade_visible.store(true, std::sync::atomic::Ordering::SeqCst);
                let _ = trade_webview.evaluate_script("window.refreshTradeCapture?.();");
            }
            Event::UserEvent(DesktopEvent::HideTrade) => {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                    let hwnd = HWND(trade_window.hwnd() as *mut _);
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
                trade_window.set_visible(false);
                trade_window.set_inner_size(LogicalSize::new(980.0, 980.0));
                trade_visible.store(false, std::sync::atomic::Ordering::SeqCst);
                poe2_world::clear_trade_capture();
                let _ = trade_webview.evaluate_script("window.resetTradeOverlay?.();");
            }
            Event::UserEvent(DesktopEvent::ShowTradeCompare) => {
                if trade_visible.load(std::sync::atomic::Ordering::SeqCst) {
                    trade_window.set_inner_size(LogicalSize::new(1380.0, 980.0));
                }
            }
            Event::UserEvent(DesktopEvent::HideTradeCompare) => {
                trade_window.set_inner_size(LogicalSize::new(980.0, 980.0));
            }
            Event::UserEvent(DesktopEvent::HideExpedition) => {
                expedition_window.set_visible(false);
                if let Some(snapshot) = poe2_world::latest_expedition_snapshot().snapshot {
                    poe2_world::dismiss_session(snapshot.session_id);
                }
            }
            Event::UserEvent(DesktopEvent::ToggleLeveling) => {
                let cur_enabled = poe2_world::is_leveling_overlay_visible();
                let next_enabled = !cur_enabled;
                poe2_world::set_leveling_overlay_visible(next_enabled);
                let _ = main_webview.evaluate_script(&format!(
                    "window.updateLevelingOverlayVisibility?.({});",
                    next_enabled
                ));

                #[cfg(windows)]
                let should_show = next_enabled && is_poe2_or_overlay_foreground(leveling_raw_hwnd);
                #[cfg(not(windows))]
                let should_show = next_enabled;

                if should_show {
                    #[cfg(windows)]
                    unsafe {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::UI::WindowsAndMessaging::{
                            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
                            SWP_NOSIZE, SW_SHOWNOACTIVATE,
                        };
                        let hwnd = HWND(leveling_window.hwnd() as *mut _);
                        let _ = SetWindowPos(
                            hwnd,
                            Some(HWND_TOPMOST),
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    }
                    #[cfg(not(windows))]
                    leveling_window.set_visible(true);
                } else {
                    #[cfg(windows)]
                    unsafe {
                        use windows::Win32::Foundation::HWND;
                        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                        let hwnd = HWND(leveling_window.hwnd() as *mut _);
                        let _ = ShowWindow(hwnd, SW_HIDE);
                    }
                    leveling_window.set_visible(false);
                }
            }
            Event::UserEvent(DesktopEvent::HideLeveling) => {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                    let hwnd = HWND(leveling_window.hwnd() as *mut _);
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
                leveling_window.set_visible(false);
                poe2_world::set_leveling_overlay_visible(false);
                let _ = main_webview
                    .evaluate_script("window.updateLevelingOverlayVisibility?.(false);");
            }
            Event::UserEvent(DesktopEvent::DragLeveling) => {
                let _ = leveling_window.drag_window();
            }
            Event::UserEvent(DesktopEvent::CollapseLeveling) => {
                leveling_window.set_inner_size(LogicalSize::new(280.0, 34.0));
            }
            Event::UserEvent(DesktopEvent::ExpandLeveling) => {
                leveling_window.set_inner_size(LogicalSize::new(280.0, 180.0));
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::CloseRequested,
                ..
            } if window_id == leveling_id => {
                #[cfg(windows)]
                unsafe {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                    let hwnd = HWND(leveling_window.hwnd() as *mut _);
                    let _ = ShowWindow(hwnd, SW_HIDE);
                }
                leveling_window.set_visible(false);
                poe2_world::set_leveling_overlay_visible(false);
                let _ = main_webview
                    .evaluate_script("window.updateLevelingOverlayVisibility?.(false);");
            }
            Event::WindowEvent {
                window_id,
                event: WindowEvent::CloseRequested,
                ..
            } if window_id == expedition_id => {
                expedition_window.set_visible(false);
                if let Some(snapshot) = poe2_world::latest_expedition_snapshot().snapshot {
                    poe2_world::dismiss_session(snapshot.session_id);
                }
            }
            Event::MainEventsCleared => {
                if last_expedition_ui_poll.elapsed() >= std::time::Duration::from_millis(500) {
                    last_expedition_ui_poll = std::time::Instant::now();
                    let expedition_enabled = runtime.lock().expedition_overlay_enabled();
                    let current = poe2_world::latest_expedition_snapshot();
                    if expedition_enabled {
                        if let Some(snapshot) = current.snapshot {
                            let has_stations = !snapshot.stations.is_empty();
                            let dismissed = current.dismissed_session.as_deref()
                                == Some(snapshot.session_id.as_str());
                            if has_stations && !dismissed && !expedition_window.is_visible() {
                                if let Some(monitor) = main_window.current_monitor() {
                                    let p = monitor.position();
                                    let s = monitor.size();
                                    let w = expedition_window.outer_size();
                                    expedition_window.set_outer_position(PhysicalPosition::new(
                                        p.x + (s.width.saturating_sub(w.width) / 2) as i32,
                                        p.y + (s.height.saturating_sub(w.height) / 2) as i32,
                                    ));
                                    let _ = _expedition_webview
                                        .evaluate_script("window.refreshExpedition?.();");
                                    expedition_window.set_visible(true);
                                }
                            }
                        }
                    } else if expedition_window.is_visible() {
                        expedition_window.set_visible(false);
                    }
                }

                let leveling_enabled = poe2_world::is_leveling_overlay_visible();
                #[cfg(windows)]
                let should_show =
                    leveling_enabled && is_poe2_or_overlay_foreground(leveling_raw_hwnd);
                #[cfg(not(windows))]
                let should_show = leveling_enabled;

                if leveling_window.is_visible() != should_show {
                    if should_show {
                        #[cfg(windows)]
                        unsafe {
                            use windows::Win32::Foundation::HWND;
                            use windows::Win32::UI::WindowsAndMessaging::{
                                SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
                                SWP_NOSIZE, SW_SHOWNOACTIVATE,
                            };
                            let hwnd = HWND(leveling_window.hwnd() as *mut _);
                            let _ = SetWindowPos(
                                hwnd,
                                Some(HWND_TOPMOST),
                                0,
                                0,
                                0,
                                0,
                                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                            );
                            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                        }
                        #[cfg(not(windows))]
                        leveling_window.set_visible(true);
                    } else {
                        #[cfg(windows)]
                        unsafe {
                            use windows::Win32::Foundation::HWND;
                            use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
                            let hwnd = HWND(leveling_window.hwnd() as *mut _);
                            let _ = ShowWindow(hwnd, SW_HIDE);
                        }
                        leveling_window.set_visible(false);
                    }
                }
            }
            _ => (),
        }
    });
}

#[cfg(all(test, windows))]
mod tray_tests {
    use super::*;
    use tray_icon::{MouseButton, MouseButtonState, Rect, TrayIconEvent, TrayIconId};

    fn click(button: MouseButton, button_state: MouseButtonState) -> TrayIconEvent {
        let rect = Rect::default();
        TrayIconEvent::Click {
            id: TrayIconId::new("poevh.tray"),
            position: rect.position,
            rect,
            button,
            button_state,
        }
    }

    #[test]
    fn released_left_click_restores_the_window() {
        assert!(tray_event_requests_restore(&click(
            MouseButton::Left,
            MouseButtonState::Up
        )));
    }

    #[test]
    fn press_and_right_click_do_not_restore_the_window() {
        assert!(!tray_event_requests_restore(&click(
            MouseButton::Left,
            MouseButtonState::Down
        )));
        assert!(!tray_event_requests_restore(&click(
            MouseButton::Right,
            MouseButtonState::Up
        )));
    }

    #[test]
    fn double_left_click_restores_the_window() {
        let rect = Rect::default();
        let event = TrayIconEvent::DoubleClick {
            id: TrayIconId::new("poevh.tray"),
            position: rect.position,
            rect,
            button: MouseButton::Left,
        };
        assert!(tray_event_requests_restore(&event));
    }
}
