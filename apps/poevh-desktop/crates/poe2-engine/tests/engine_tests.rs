use poe2_engine::{BotRuntime, FollowEngine};
use poe2_types::*;

fn discovered_process(pid: u32, started_at: &str) -> GameProcess {
    GameProcess {
        identity: ProcessIdentity {
            pid,
            started_at: started_at.into(),
            exe_path: r"D:\Game\PathOfExile.exe".into(),
        },
        flavor: ClientFlavor::Standalone,
        window: None,
        working_set_bytes: Some(1_000_000),
        cpu_percent: None,
        cpu_ticks: 0,
    }
}

#[test]
fn instance_updates_survive_engine_ticks_and_keep_other_profiles_unchanged() {
    let mut runtime = BotRuntime::default_mock();
    let before = runtime.to_api_snapshot().settings.multi_client.clients[2].clone();
    runtime
        .cmd_update_instance(
            2,
            InstancePatch {
                flavor: Some(ClientFlavor::Standalone),
                bg_fps: Some(12),
                enabled: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
    runtime.step();
    runtime.step();
    let snapshot = runtime.to_api_snapshot();
    let changed = snapshot
        .settings
        .multi_client
        .clients
        .iter()
        .find(|c| c.id == 2)
        .unwrap();
    assert_eq!(changed.flavor, ClientFlavor::Standalone);
    assert_eq!(changed.bg_fps, 12);
    assert!(!changed.enabled);
    assert_eq!(
        serde_json::to_value(&snapshot.settings.multi_client.clients[2]).unwrap(),
        serde_json::to_value(before).unwrap()
    );
}

#[test]
fn test_follow_engine_hold_within_stop_distance() {
    let mut state = WorldState {
        running: true,
        leader: Actor {
            area: "Camp".into(),
            pos: Vec2::new(0.0, 0.0),
            ..Actor::new("Leader", 0.0, 0.0)
        },
        followers: vec![Actor {
            name: "Culler".into(),
            pos: Vec2::new(5.0, 0.0), // distance = 5.0 <= stop_distance (9.0)
            hp: 100,
            mana: 100,
            area: "Camp".into(),
            action: FollowerAction::Hold,
            navigation_target: None,
        }],
        ..Default::default()
    };

    FollowEngine::step(&mut state);
    assert_eq!(state.followers[0].action, FollowerAction::Hold);
}

#[test]
fn test_follow_engine_move_and_sprint() {
    let mut state = WorldState {
        running: true,
        settings: BotSettings {
            follow: true,
            catchup: true,
            ..Default::default()
        },
        config: FollowConfig {
            stop_distance: 9.0,
            catch_up_distance: 18.0,
            warp_distance: 45.0,
            ..Default::default()
        },
        leader: Actor {
            area: "Camp".into(),
            pos: Vec2::new(0.0, 0.0),
            ..Actor::new("Leader", 0.0, 0.0)
        },
        followers: vec![Actor {
            name: "Culler".into(),
            pos: Vec2::new(12.0, 0.0),
            hp: 100,
            mana: 100,
            area: "Camp".into(),
            action: FollowerAction::Hold,
            navigation_target: None,
        }],
        ..Default::default()
    };
    FollowEngine::step(&mut state);
    assert_eq!(state.followers[0].action, FollowerAction::FollowRoute);

    // Sprint catch-up (25.0 distance)
    state.followers[0].pos = Vec2::new(25.0, 0.0);
    FollowEngine::step(&mut state);
    assert_eq!(state.followers[0].action, FollowerAction::SprintCatchUp);

    // Warp catch-up (55.0 distance > warp_distance 45.0)
    state.followers[0].pos = Vec2::new(55.0, 0.0);
    FollowEngine::step(&mut state);
    assert_eq!(state.followers[0].action, FollowerAction::WarpToMain);
}

#[test]
fn disabled_profile_holds_its_named_characters_without_fixed_client_ids() {
    let mut multi_client = MultiClientConfig::default();
    multi_client.clients[1].id = 9;
    multi_client.clients[1].enabled = false;
    let settings = BotSettings {
        follow: true,
        multi_client,
        ..Default::default()
    };
    let mut state = WorldState {
        running: true,
        settings,
        leader: Actor {
            area: "Camp".into(),
            pos: Vec2::new(0.0, 0.0),
            ..Actor::new("Leader", 0.0, 0.0)
        },
        followers: vec![Actor {
            area: "Camp".into(),
            ..Actor::new("Culler", 20.0, 0.0)
        }],
        ..Default::default()
    };

    FollowEngine::step(&mut state);
    assert_eq!(state.followers[0].action, FollowerAction::Hold);
}

#[test]
fn test_follow_engine_loot_prioritization() {
    let mut state = WorldState {
        running: true,
        settings: BotSettings {
            loot: true,
            pickup: AutoPickupConfig {
                enabled: true,
                currency_top_tier: true,
                currency_regular: true,
                pickup_radius: 50.0,
                ..Default::default()
            },
            ..Default::default()
        },
        leader: Actor {
            area: "Camp".into(),
            pos: Vec2::new(0.0, 0.0),
            ..Actor::new("Leader", 0.0, 0.0)
        },
        followers: vec![Actor {
            name: "Culler".into(),
            pos: Vec2::new(5.0, 0.0),
            hp: 100,
            mana: 100,
            area: "Camp".into(),
            action: FollowerAction::Hold,
            navigation_target: None,
        }],
        loot: vec![WorldItem {
            source_id: 101,
            name: "Divine Orb".into(),
            pos: Vec2::new(7.0, 0.0),
            value: 100,
            rarity: None,
            identified: None,
            pickup: PickupStatus::default(),
            picked_by: None,
        }],
        ..Default::default()
    };

    FollowEngine::step(&mut state);
    match &state.followers[0].action {
        FollowerAction::AutoLoot {
            item_id,
            item,
            button,
        } => {
            assert_eq!(*item_id, 101);
            assert_eq!(item, "Divine Orb");
            assert_eq!(button, "A");
        }
        other => panic!("Expected AutoLoot, got {:?}", other),
    }
    assert_eq!(state.settings.tracker.items_picked, 0);
    assert!(matches!(
        state.loot[0].pickup,
        PickupStatus::Pending {
            input_sent: false,
            attempts: 1,
            ..
        }
    ));
    assert!(state.loot[0].picked_by.is_none());
}

#[test]
fn unique_filter_uses_rarity_instead_of_name_text() {
    let mut state = WorldState {
        running: true,
        settings: BotSettings {
            loot: true,
            pickup: AutoPickupConfig {
                enabled: true,
                currency_regular: false,
                uniques: true,
                pickup_radius: 50.0,
                ..Default::default()
            },
            ..Default::default()
        },
        leader: Actor::new("Leader", 0.0, 0.0),
        followers: vec![Actor::new("Culler", 0.0, 0.0)],
        loot: vec![WorldItem {
            source_id: 303,
            name: "Forgotten Warden".into(),
            pos: Vec2::new(2.0, 0.0),
            value: 0,
            rarity: Some(ItemRarity::Unique),
            identified: Some(true),
            pickup: PickupStatus::default(),
            picked_by: None,
        }],
        ..Default::default()
    };
    state.leader.area = "Ashen Yard".into();
    FollowEngine::step(&mut state);
    assert!(matches!(
        state.followers[0].action,
        FollowerAction::AutoLoot { item_id: 303, .. }
    ));
}

#[test]
fn allocation_only_filter_fails_closed_without_validated_allocation_data() {
    let mut state = WorldState {
        running: true,
        settings: BotSettings {
            loot: true,
            pickup: AutoPickupConfig {
                enabled: true,
                only_allocated_to_bot: true,
                pickup_radius: 50.0,
                ..Default::default()
            },
            ..Default::default()
        },
        followers: vec![Actor::new("Culler", 0.0, 0.0)],
        loot: vec![WorldItem {
            source_id: 404,
            name: "Divine Orb".into(),
            pos: Vec2::new(2.0, 0.0),
            value: 0,
            rarity: Some(ItemRarity::Normal),
            identified: Some(true),
            pickup: PickupStatus::default(),
            picked_by: None,
        }],
        ..Default::default()
    };
    FollowEngine::step(&mut state);
    assert!(!matches!(
        state.followers[0].action,
        FollowerAction::AutoLoot { .. }
    ));
}

#[test]
fn unknown_normal_equipment_is_not_misclassified_as_regular_currency() {
    let mut state = WorldState {
        running: true,
        settings: BotSettings {
            loot: true,
            pickup: AutoPickupConfig {
                enabled: true,
                currency_regular: true,
                pickup_radius: 50.0,
                ..Default::default()
            },
            ..Default::default()
        },
        followers: vec![Actor::new("Culler", 0.0, 0.0)],
        loot: vec![WorldItem {
            source_id: 405,
            name: "Mantled Mail".into(),
            pos: Vec2::new(2.0, 0.0),
            value: 0,
            rarity: Some(ItemRarity::Normal),
            identified: Some(true),
            pickup: PickupStatus::default(),
            picked_by: None,
        }],
        ..Default::default()
    };
    FollowEngine::step(&mut state);
    assert!(!matches!(
        state.followers[0].action,
        FollowerAction::AutoLoot { .. }
    ));
}

#[test]
fn failed_controller_input_is_retriable_but_not_counted_as_pickup() {
    let mut runtime = BotRuntime::default_mock();
    runtime.last_state.loot[0].source_id = 505;
    runtime.last_state.loot[0].pickup = PickupStatus::Pending {
        actor: "P2".into(),
        attempts: 1,
        requested_tick: 10,
        input_sent: false,
    };
    runtime.last_state.tick = 10;
    runtime.record_pickup_input(505, "P2", "Exalted Shard", Err("ViGEm offline".into()));
    assert_eq!(runtime.last_state.settings.tracker.items_picked, 0);
    assert!(matches!(
        runtime.last_state.loot[0].pickup,
        PickupStatus::Failed {
            attempts: 1,
            retry_after_tick: 13,
            ..
        }
    ));
}

#[test]
fn auto_run_moves_toward_loot_before_interacting() {
    let mut state = WorldState {
        running: true,
        settings: BotSettings {
            follow: true,
            loot: true,
            pickup: AutoPickupConfig {
                enabled: true,
                auto_run_to_loot: true,
                pickup_radius: 50.0,
                currency_top_tier: true,
                ..Default::default()
            },
            ..Default::default()
        },
        leader: Actor {
            area: "Camp".into(),
            pos: Vec2::new(0.0, 0.0),
            ..Actor::new("Leader", 0.0, 0.0)
        },
        followers: vec![Actor {
            name: "Culler".into(),
            pos: Vec2::new(10.0, 0.0),
            hp: 100,
            mana: 100,
            area: "Camp".into(),
            action: FollowerAction::Hold,
            navigation_target: None,
        }],
        loot: vec![WorldItem {
            source_id: 202,
            name: "Divine Orb".into(),
            pos: Vec2::new(30.0, 0.0),
            value: 100,
            rarity: None,
            identified: None,
            pickup: PickupStatus::default(),
            picked_by: None,
        }],
        ..Default::default()
    };

    FollowEngine::step(&mut state);
    assert_eq!(
        state.followers[0].action,
        FollowerAction::RunToLoot {
            item_id: 202,
            item: "Divine Orb".into(),
            target: Vec2::new(30.0, 0.0),
        }
    );
    assert!(state.loot[0].picked_by.is_none());
}

#[test]
fn tracker_uses_configured_tick_duration() {
    let mut state = WorldState {
        running: true,
        followers: Vec::new(),
        config: FollowConfig {
            tick_ms: 125,
            ..Default::default()
        },
        ..Default::default()
    };
    for _ in 0..8 {
        FollowEngine::step(&mut state);
    }
    assert_eq!(state.settings.tracker.session_seconds, 1);
}

#[test]
fn test_runtime_step_preserves_action_in_snapshot() {
    let mut runtime = BotRuntime::default_mock();
    runtime.cmd_run(true);
    // Put leader and follower far apart to trigger movement
    runtime.cmd_move(20.0, 0.0);

    let state = runtime.step();
    assert_ne!(state.followers[0].action, FollowerAction::Hold);

    let api_snapshot = runtime.to_api_snapshot();
    // Verify that to_api_snapshot does NOT wipe out the action to Hold
    assert_eq!(api_snapshot.followers[0].action, state.followers[0].action);
}

#[test]
fn test_controller_mapping_unique_keys_clears_conflict() {
    let mut runtime = BotRuntime::default_mock();
    // Initially move_up is "W" and move_left is "A"
    assert_eq!(
        runtime
            .to_api_snapshot()
            .settings
            .controller_mapping
            .move_up,
        "W"
    );
    assert_eq!(
        runtime
            .to_api_snapshot()
            .settings
            .controller_mapping
            .move_left,
        "A"
    );

    // Assign "W" to button_x
    runtime.cmd_set_controller_key("button_x", "W");
    let cm = runtime.to_api_snapshot().settings.controller_mapping;
    assert_eq!(cm.button_x, "W");
    // move_up had "W", so it must have been cleared
    assert_eq!(cm.move_up, "");
    // move_left still "A"
    assert_eq!(cm.move_left, "A");

    // Case-insensitive test: assign "a" to button_y
    runtime.cmd_set_controller_key("button_y", "a");
    let cm = runtime.to_api_snapshot().settings.controller_mapping;
    assert_eq!(cm.button_y, "a");
    assert_eq!(cm.move_left, "");
}

#[test]
fn runtime_instance_is_ephemeral_but_account_profile_is_persistent() {
    let mut runtime = BotRuntime::default_mock();
    let id = runtime
        .ensure_runtime_instance(1, Some(true), Some(false), Some(60))
        .unwrap();
    assert_eq!(id, 1);
    let snapshot = runtime.to_api_snapshot();
    assert_eq!(snapshot.instance_services.runtime_instances.len(), 1);
    assert_eq!(
        snapshot.instance_services.runtime_instances[0].account_profile_id,
        Some(1)
    );
    assert!(snapshot
        .instance_services
        .account_profiles
        .iter()
        .any(|p| p.id == 1));

    let process = discovered_process(9001, "0001");
    runtime.update_instance_inventory(Ok(vec![process.clone()]));
    runtime.cmd_bind_instance(1, process.identity).unwrap();
    assert_eq!(
        runtime
            .to_api_snapshot()
            .instance_services
            .runtime_instances[0]
            .status,
        "bound"
    );

    runtime.update_instance_inventory(Ok(Vec::new()));
    let snapshot = runtime.to_api_snapshot();
    assert!(snapshot.instance_services.runtime_instances.is_empty());
    assert!(snapshot
        .instance_services
        .account_profiles
        .iter()
        .any(|p| p.id == 1));
}
