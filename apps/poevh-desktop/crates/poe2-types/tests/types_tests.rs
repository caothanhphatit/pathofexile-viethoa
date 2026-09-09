use poe2_types::*;

#[test]
fn test_vec2_distance_and_move_toward() {
    let a = Vec2::new(0.0, 0.0);
    let b = Vec2::new(3.0, 4.0);
    assert!((a.distance_to(b) - 5.0).abs() < 1e-5);

    let moved = a.move_toward(b, 2.5);
    assert!((moved.x - 1.5).abs() < 1e-5);
    assert!((moved.y - 2.0).abs() < 1e-5);
    assert!((moved.distance_to(b) - 2.5).abs() < 1e-5);
}

#[test]
fn test_client_account_profile_no_raw_passwords() {
    let profile = ClientAccountProfile {
        id: 1,
        label: "Aurabot Account".into(),
        flavor: ClientFlavor::Standalone,
        exe_path: String::new(),
        email_masked: "us***@example.com".into(),
        has_credentials: true,
        credential_ref: None,
        login_calibration: None,
        auto_login: true,
        char1_name: "CarryDPS".into(),
        char1_role: "Main DPS".into(),
        char2_name: "SupportAura".into(),
        char2_role: "Aurabot".into(),
        input_mode: Some(ClientInputMode::DualController),
        black_screen: false,
        bg_fps: 30,
        enabled: true,
    };

    let serialized = serde_json::to_string(&profile).expect("serialize profile");
    // Ensure raw password is fundamentally absent from data structure
    assert!(!serialized.contains("password"));
    assert!(serialized.contains("has_credentials"));
    assert!(serialized.contains("email_masked"));
}

#[test]
fn input_topology_defaults_legacy_main_to_wasd_and_followers_to_dual_pad() {
    let mut config = MultiClientConfig::default();
    for profile in &mut config.clients {
        profile.input_mode = None;
    }
    assert_eq!(config.input_mode_for(1), Some(ClientInputMode::SingleWasd));
    assert_eq!(
        config.input_mode_for(2),
        Some(ClientInputMode::DualController)
    );
    assert!(!config.requires_virtual_controllers(1));
    assert!(config.requires_virtual_controllers(2));
}

#[test]
fn selecting_single_wasd_moves_main_and_converts_old_main_to_dual() {
    let mut config = MultiClientConfig::default();
    config
        .update_instance(
            2,
            InstancePatch {
                input_mode: Some(ClientInputMode::SingleWasd),
                ..Default::default()
            },
        )
        .expect("switch main topology");
    assert_eq!(config.main_instance_id, 2);
    assert_eq!(config.input_mode_for(2), Some(ClientInputMode::SingleWasd));
    assert_eq!(
        config.input_mode_for(1),
        Some(ClientInputMode::DualController)
    );
}

#[test]
fn current_main_cannot_become_dual_without_replacement() {
    let mut config = MultiClientConfig::default();
    let result = config.update_instance(
        1,
        InstancePatch {
            input_mode: Some(ClientInputMode::DualController),
            ..Default::default()
        },
    );
    assert!(matches!(result, Err(InstanceUpdateError::Conflict(_))));
}

#[test]
fn test_follower_action_display() {
    assert_eq!(FollowerAction::Hold.to_string(), "HOLD");
    assert_eq!(FollowerAction::SprintCatchUp.to_string(), "SPRINT_CATCH_UP");
    assert_eq!(FollowerAction::WarpToMain.to_string(), "WARP_TO_MAIN");
}

#[test]
fn instance_updates_use_stable_ids_after_reordering() {
    let mut config = MultiClientConfig::default();
    config.clients.reverse();
    config.clients[1].id = 400; // Not restricted to three platform keys or a u8.
    config
        .update_instance(
            400,
            InstancePatch {
                bg_fps: Some(42),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        config.clients.iter().find(|c| c.id == 400).unwrap().bg_fps,
        42
    );
    assert_eq!(
        config.clients.iter().find(|c| c.id == 1).unwrap().bg_fps,
        60
    );
    config
        .update_instance(
            1,
            InstancePatch {
                flavor: Some(ClientFlavor::Steam),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        config.clients.iter().find(|c| c.id == 400).unwrap().flavor,
        ClientFlavor::Unknown
    );
}

#[test]
fn invalid_instance_patch_is_atomic_and_duplicate_ids_are_rejected() {
    let mut config = MultiClientConfig::default();
    let before = serde_json::to_value(&config).unwrap();
    assert!(config
        .update_instance(
            2,
            InstancePatch {
                enabled: Some(false),
                bg_fps: Some(0),
                ..Default::default()
            }
        )
        .is_err());
    assert_eq!(serde_json::to_value(&config).unwrap(), before);
    config.clients[1].id = 1;
    assert_eq!(
        config.update_instance(
            1,
            InstancePatch {
                enabled: Some(false),
                ..Default::default()
            }
        ),
        Err(InstanceUpdateError::Invalid("Duplicate instance ID"))
    );
}

#[test]
fn legacy_instance_profile_defaults_to_unknown_not_a_platform_by_slot() {
    let original = MultiClientConfig::default().clients[2].clone();
    let mut json = serde_json::to_value(&original).unwrap();
    json.as_object_mut().unwrap().remove("flavor");
    json.as_object_mut().unwrap().remove("exe_path");
    let restored: ClientAccountProfile = serde_json::from_value(json).unwrap();
    assert_eq!(restored.id, 3);
    assert_eq!(restored.flavor, ClientFlavor::Unknown);
    assert_eq!(restored.black_screen, original.black_screen);
    assert_eq!(restored.bg_fps, original.bg_fps);
    assert!(restored.exe_path.is_empty());
}

#[test]
fn runtime_split_preserves_accounts_and_moves_process_preferences() {
    let mut legacy = MultiClientConfig::default();
    legacy.clients[0].label = "Leader account".into();
    legacy.clients[0].black_screen = true;
    legacy.clients[0].bg_fps = 17;
    legacy.main_instance_id = legacy.clients[0].id;

    let runtime = legacy.split_runtime();
    assert_eq!(runtime.accounts[0].label, "Leader account");
    assert_eq!(runtime.instances[0].account_profile_id, Some(1));
    assert!(runtime.instances[0].is_main);
    assert!(runtime.instances[0].black_screen);
    assert_eq!(runtime.instances[0].bg_fps, 17);

    let restored = legacy.from_runtime(&runtime);
    assert_eq!(restored.clients[0].label, "Leader account");
    assert!(restored.clients[0].black_screen);
    assert_eq!(restored.clients[0].bg_fps, 17);
    assert_eq!(restored.main_instance_id, 1);
}

#[test]
fn runtime_config_can_represent_no_running_instances() {
    let legacy = MultiClientConfig::default();
    let mut runtime = legacy.split_runtime();
    runtime.instances.clear();
    let restored = legacy.from_runtime(&runtime);
    assert!(restored.clients.is_empty());
    assert_eq!(restored.next_instance_id, 1);
}
