//! Read-only XInput inventory with POEVH-owned ViGEm slots excluded.

use parking_lot::RwLock;
use poe2_types::{ControllerInventory, PhysicalControllerInfo, VirtualControllerInfo};
use std::collections::{BTreeMap, BTreeSet};

static VIRTUAL_SLOTS: RwLock<BTreeMap<String, u32>> = RwLock::new(BTreeMap::new());

/// Register the XInput index assigned to a ViGEm target created by POEVH.
/// XInput uses zero-based indices; the UI intentionally displays one-based slots.
pub fn register_virtual_slot(target: &str, index: u32) {
    VIRTUAL_SLOTS.write().insert(target.to_owned(), index);
}

pub fn unregister_virtual_target(target: &str) {
    VIRTUAL_SLOTS.write().remove(target);
}

pub fn inventory() -> ControllerInventory {
    let virtual_targets = VIRTUAL_SLOTS.read().clone();
    let virtual_slots = virtual_targets.values().copied().collect::<BTreeSet<_>>();
    let mut result = platform_inventory(&virtual_slots);
    result.virtual_controllers = virtual_controller_info(&virtual_targets);
    result.virtual_count = result.virtual_controllers.len();
    result
}

fn virtual_controller_info(slots: &BTreeMap<String, u32>) -> Vec<VirtualControllerInfo> {
    slots
        .iter()
        .map(|(target, index)| VirtualControllerInfo {
            target: target.clone(),
            xinput_slot: index + 1,
        })
        .collect()
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct XInputGamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    thumb_lx: i16,
    thumb_ly: i16,
    thumb_rx: i16,
    thumb_ry: i16,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct XInputState {
    packet_number: u32,
    gamepad: XInputGamepad,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct XInputBatteryInformation {
    battery_type: u8,
    battery_level: u8,
}

#[cfg(windows)]
type XInputGetStateFn = unsafe extern "system" fn(u32, *mut XInputState) -> u32;
#[cfg(windows)]
type XInputGetBatteryInformationFn =
    unsafe extern "system" fn(u32, u8, *mut XInputBatteryInformation) -> u32;

#[cfg(windows)]
static XINPUT: std::sync::OnceLock<Option<(XInputGetStateFn, XInputGetBatteryInformationFn)>> =
    std::sync::OnceLock::new();

#[cfg(windows)]
fn xinput_api() -> Option<(XInputGetStateFn, XInputGetBatteryInformationFn)> {
    *XINPUT.get_or_init(|| unsafe {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn LoadLibraryW(name: *const u16) -> *mut std::ffi::c_void;
            fn GetProcAddress(
                module: *mut std::ffi::c_void,
                name: *const u8,
            ) -> *mut std::ffi::c_void;
        }
        let dll_name = [
            'x' as u16, 'i' as u16, 'n' as u16, 'p' as u16, 'u' as u16, 't' as u16, '1' as u16,
            '_' as u16, '4' as u16, '.' as u16, 'd' as u16, 'l' as u16, 'l' as u16, 0,
        ];
        let module = LoadLibraryW(dll_name.as_ptr());
        if module.is_null() {
            return None;
        }
        let state = GetProcAddress(module, c"XInputGetState".as_ptr() as *const u8);
        let battery = GetProcAddress(module, c"XInputGetBatteryInformation".as_ptr() as *const u8);
        if state.is_null() || battery.is_null() {
            return None;
        }
        Some((
            std::mem::transmute::<*mut std::ffi::c_void, XInputGetStateFn>(state),
            std::mem::transmute::<*mut std::ffi::c_void, XInputGetBatteryInformationFn>(battery),
        ))
    })
}

#[cfg(windows)]
fn platform_inventory(virtual_slots: &BTreeSet<u32>) -> ControllerInventory {
    let Some((get_state, get_battery)) = xinput_api() else {
        return ControllerInventory {
            virtual_count: virtual_slots.len(),
            scan_error: Some("Không tải được XInput (xinput1_4.dll)".into()),
            ..Default::default()
        };
    };
    let mut connected = Vec::new();
    for index in 0..4 {
        let mut state = XInputState::default();
        if unsafe { get_state(index, &mut state) } != 0 {
            continue;
        }
        connected.push((index, state, battery(get_battery, index)));
    }
    build_inventory(connected, virtual_slots)
}

#[cfg(not(windows))]
fn platform_inventory(virtual_slots: &BTreeSet<u32>) -> ControllerInventory {
    ControllerInventory {
        virtual_count: virtual_slots.len(),
        scan_error: Some("XInput inventory chỉ khả dụng trên Windows".into()),
        ..Default::default()
    }
}

#[cfg(windows)]
fn battery(
    get_battery: XInputGetBatteryInformationFn,
    index: u32,
) -> Option<XInputBatteryInformation> {
    let mut info = XInputBatteryInformation::default();
    (unsafe { get_battery(index, 0, &mut info) } == 0).then_some(info)
}

#[cfg(windows)]
fn build_inventory(
    connected: Vec<(u32, XInputState, Option<XInputBatteryInformation>)>,
    virtual_slots: &BTreeSet<u32>,
) -> ControllerInventory {
    let physical = connected
        .into_iter()
        .filter(|(index, _, _)| !virtual_slots.contains(index))
        .map(|(index, state, battery)| PhysicalControllerInfo {
            slot: index + 1,
            name: format!("Tay cầm XInput {}", index + 1),
            connection: connection_label(battery),
            battery: battery_label(battery),
            active: report_is_active(state.gamepad),
        })
        .collect();
    ControllerInventory {
        physical,
        virtual_count: virtual_slots.len(),
        scan_error: None,
        ..Default::default()
    }
}

#[cfg(windows)]
fn report_is_active(gamepad: XInputGamepad) -> bool {
    gamepad.buttons != 0
        || gamepad.left_trigger > 8
        || gamepad.right_trigger > 8
        || gamepad.thumb_lx.unsigned_abs() > 4096
        || gamepad.thumb_ly.unsigned_abs() > 4096
        || gamepad.thumb_rx.unsigned_abs() > 4096
        || gamepad.thumb_ry.unsigned_abs() > 4096
}

#[cfg(windows)]
fn connection_label(info: Option<XInputBatteryInformation>) -> String {
    match info.map(|value| value.battery_type) {
        Some(1) => "USB / có dây",
        Some(2 | 3) => "Không dây",
        Some(0) | None => "XInput",
        _ => "Kết nối khác",
    }
    .into()
}

#[cfg(windows)]
fn battery_label(info: Option<XInputBatteryInformation>) -> Option<String> {
    let info = info?;
    if matches!(info.battery_type, 0 | 1) {
        return None;
    }
    Some(
        match info.battery_level {
            0 => "Cạn pin",
            1 => "Pin yếu",
            2 => "Pin trung bình",
            3 => "Pin đầy",
            _ => "Không rõ pin",
        }
        .into(),
    )
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn virtual_xinput_slots_are_excluded_from_physical_inventory() {
        let connected = vec![
            (0, XInputState::default(), None),
            (1, XInputState::default(), None),
            (2, XInputState::default(), None),
        ];
        let result = build_inventory(connected, &BTreeSet::from([1, 2]));
        assert_eq!(result.physical.len(), 1);
        assert_eq!(result.physical[0].slot, 1);
        assert_eq!(result.virtual_count, 2);
    }

    #[test]
    fn virtual_controller_mapping_uses_game_facing_one_based_slots() {
        let mapping = virtual_controller_info(&BTreeMap::from([
            ("P3".to_owned(), 0),
            ("P4".to_owned(), 2),
        ]));
        assert_eq!(
            mapping,
            vec![
                VirtualControllerInfo {
                    target: "P3".into(),
                    xinput_slot: 1,
                },
                VirtualControllerInfo {
                    target: "P4".into(),
                    xinput_slot: 3,
                },
            ]
        );
    }
}
