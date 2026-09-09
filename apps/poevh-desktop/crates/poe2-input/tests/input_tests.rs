use poe2_input::{FlaskController, KbmBridge, VirtualGamepadManager};
use poe2_types::{Actor, FollowerAction, SmartFlaskConfig, Vec2};

#[test]
fn test_kbm_bridge_focus_slot_transitions() {
    KbmBridge::set_focus_slot(0);
    assert_eq!(KbmBridge::get_focus_slot(), 0);

    KbmBridge::set_focus_slot(3);
    assert_eq!(KbmBridge::get_focus_slot(), 3);

    // Clamps to max 5 (6th slot)
    KbmBridge::set_focus_slot(10);
    assert_eq!(KbmBridge::get_focus_slot(), 5);

    KbmBridge::set_focus_slot(1);
    assert_eq!(KbmBridge::get_focus_slot(), 1);
}

#[test]
fn test_flask_controller_evaluation() {
    let mut ctrl = FlaskController::new();
    let mut mgr = VirtualGamepadManager::new();

    let cfg = SmartFlaskConfig {
        life_enabled: true,
        mana_enabled: false,
        life_hp_pct: 50,
        mana_mp_pct: 30,
        life_cooldown_ms: 1000,
        mana_cooldown_ms: 1000,
        avoid_waste_recovery: false,
        use_recoverable_life: false,
        low_life_build: false,
        ignore_reserved_mana: false,
        build_no_mana: false,
    };

    let healthy = Actor {
        name: "P2".into(),
        pos: Vec2::new(0.0, 0.0),
        hp: 80,
        mana: 100,
        area: "Camp".into(),
        action: FollowerAction::Hold,
        navigation_target: None,
    };

    // HP is 80% (> 50%) -> no flask triggered
    let events = ctrl.evaluate(&healthy, &cfg, 1, &mut mgr);
    assert!(events.is_empty());

    let injured = Actor {
        name: "P2".into(),
        pos: Vec2::new(0.0, 0.0),
        hp: 40,
        mana: 100,
        area: "Camp".into(),
        action: FollowerAction::Hold,
        navigation_target: None,
    };

    // HP is 40% (<= 50%) -> triggers life flask
    let events = ctrl.evaluate(&injured, &cfg, 2, &mut mgr);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].action, "AUTO_FLASK_LIFE");
}

#[test]
fn test_flask_controller_evaluates_leader_in_solo_session() {
    let mut ctrl = FlaskController::new();
    let mut mgr = VirtualGamepadManager::new();
    let cfg = SmartFlaskConfig {
        life_enabled: true,
        mana_enabled: false,
        life_hp_pct: 50,
        ..SmartFlaskConfig::default()
    };
    let leader = Actor {
        name: "SoloLeader".into(),
        pos: Vec2::new(0.0, 0.0),
        hp: 25,
        mana: 100,
        area: "Camp".into(),
        action: FollowerAction::Hold,
        navigation_target: None,
    };

    let events = ctrl.evaluate_party(&leader, &[], &cfg, 1, &mut mgr);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].actor, "SoloLeader");
    assert_eq!(events[0].action, "AUTO_FLASK_LIFE");
}

#[test]
fn test_calculate_inventory_slot_coords_60_slots() {
    let window_rect = (0, 0, 1920, 1080);
    let slots = poe2_input::calculate_inventory_slot_coords(window_rect);

    assert_eq!(slots.len(), 60);

    // All slots must be within the window bounds
    for (x, y) in &slots {
        assert!(*x > 0 && *x < 1920);
        assert!(*y > 0 && *y < 1080);
    }

    // First slot is at top-left of inventory, last slot is at bottom-right
    let (first_x, first_y) = slots[0];
    let (last_x, last_y) = slots[59];
    assert!(last_x > first_x);
    assert!(last_y > first_y);
}
