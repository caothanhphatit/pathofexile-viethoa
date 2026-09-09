use poe2_engine::profile_store::ProfileStore;
use poe2_types::{BotSettings, FollowConfig, MultiClientConfig};

fn workspace(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("poe2-profiles-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn profiles_round_trip_without_runtime_pid_and_keep_last_good_backup() {
    let dir = workspace("roundtrip");
    let store = ProfileStore::new(dir.join("profiles.json"));
    let mut config = MultiClientConfig::default();
    store.save(&config).unwrap();
    config.clients[1].label = "Second standalone".into();
    store.save(&config).unwrap();
    assert_eq!(
        store.load().unwrap().unwrap().clients[1].label,
        "Second standalone"
    );
    let backup = ProfileStore::new(dir.join("profiles.json.bak"));
    assert_ne!(
        backup.load().unwrap().unwrap().clients[1].label,
        "Second standalone"
    );
    assert!(!std::fs::read_to_string(store.path())
        .unwrap()
        .contains("pid"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn keyboard_bridge_preference_round_trips_without_changing_profiles() {
    let dir = workspace("kbm-preference");
    let store = ProfileStore::new(dir.join("profiles.json"));
    let mut config = MultiClientConfig::default();
    config.clients[0].label = "Leader".into();
    store.save(&config).unwrap();

    store.save_kbm_bridge(false).unwrap();
    assert_eq!(store.load_kbm_bridge().unwrap(), Some(false));
    assert_eq!(store.load().unwrap().unwrap().clients[0].label, "Leader");

    store.save_kbm_bridge(true).unwrap();
    assert_eq!(store.load_kbm_bridge().unwrap(), Some(true));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn feature_settings_round_trip_without_session_state() {
    let dir = workspace("feature-settings");
    let store = ProfileStore::new(dir.join("profiles.json"));
    let config = MultiClientConfig::default();
    let settings = BotSettings {
        follow: false,
        flask: poe2_types::SmartFlaskConfig {
            life_hp_pct: 42,
            ..Default::default()
        },
        pickup: poe2_types::AutoPickupConfig {
            pickup_radius: 31.0,
            ..Default::default()
        },
        mouse_bindings: poe2_types::MouseBindingsConfig {
            right_click_as_a: false,
            ..Default::default()
        },
        expedition: poe2_types::ExpeditionConfig {
            enabled: true,
            league: "MyLeague".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    let follow = FollowConfig {
        tick_ms: 333,
        warp_distance: 88.0,
        ..Default::default()
    };

    store
        .save_runtime_settings(&config, &settings, &follow)
        .unwrap();

    let mut restored_settings = BotSettings::default();
    let mut restored_follow = FollowConfig::default();
    store
        .load_runtime_settings(&mut restored_settings, &mut restored_follow)
        .unwrap();
    assert!(!restored_settings.follow);
    assert_eq!(restored_settings.flask.life_hp_pct, 42);
    assert_eq!(restored_settings.pickup.pickup_radius, 31.0);
    assert!(!restored_settings.mouse_bindings.right_click_as_a);
    assert!(restored_settings.expedition.enabled);
    assert_eq!(restored_settings.expedition.league, "MyLeague");
    assert_eq!(restored_follow.tick_ms, 333);
    assert_eq!(restored_follow.warp_distance, 88.0);

    let json = std::fs::read_to_string(store.path()).unwrap();
    assert!(json.contains("\"settings\""));
    assert!(json.contains("\"follow_config\""));
    assert!(!json.contains("session_seconds"));
    assert!(!json.contains("\"running\""));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn startup_migrates_legacy_profile_to_schema_v2() {
    use poe2_engine::BotRuntime;

    let dir = workspace("startup-migration");
    let path = dir.join("profiles.json");
    let legacy = serde_json::json!({
        "version": 1,
        "config": MultiClientConfig::default(),
        "kbm_bridge": false
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();

    let mut runtime = BotRuntime::default_mock();
    runtime
        .enable_profile_store(ProfileStore::new(path.clone()))
        .unwrap();

    let migrated: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(migrated["version"], 2);
    assert!(migrated.get("settings").is_some());
    assert!(migrated.get("follow_config").is_some());
    assert_eq!(migrated["kbm_bridge"], false);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn runtime_feature_mutations_survive_restart() {
    use poe2_engine::BotRuntime;
    use poe2_types::ExpeditionConfig;
    let dir = workspace("feature-runtime");
    let path = dir.join("profiles.json");
    {
        let mut runtime = BotRuntime::default_mock();
        runtime
            .enable_profile_store(ProfileStore::new(path.clone()))
            .unwrap();
        runtime.cmd_toggle("follow", false);
        runtime.cmd_toggle("flask_life", false);
        runtime.cmd_set_param("tick_ms", 375.0);
        runtime.cmd_update_expedition(ExpeditionConfig {
            enabled: true,
            league: "MyLeague".into(),
            ..Default::default()
        });
    }
    let mut restored = BotRuntime::default_mock();
    restored
        .enable_profile_store(ProfileStore::new(path.clone()))
        .unwrap();
    let snapshot = restored.to_api_snapshot();
    assert!(!snapshot.settings.follow);
    assert!(!snapshot.settings.flask.life_enabled);
    assert_eq!(snapshot.config.tick_ms, 375);
    assert!(snapshot.settings.expedition.enabled);
    assert_eq!(snapshot.settings.expedition.league, "MyLeague");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn runtime_toggle_persists_keyboard_bridge_across_restart() {
    use poe2_engine::BotRuntime;
    let dir = workspace("kbm-runtime");
    let path = dir.join("profiles.json");
    let mut runtime = BotRuntime::default_mock();
    runtime
        .enable_profile_store(ProfileStore::new(path.clone()))
        .unwrap();
    runtime.cmd_toggle("kbm", false);
    assert!(!runtime.to_api_snapshot().settings.kbm_bridge);

    let mut restored = BotRuntime::default_mock();
    restored
        .enable_profile_store(ProfileStore::new(path))
        .unwrap();
    assert!(!restored.to_api_snapshot().settings.kbm_bridge);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn corrupt_or_future_profiles_are_not_silently_overwritten() {
    let dir = workspace("corrupt");
    let path = dir.join("profiles.json");
    let store = ProfileStore::new(path.clone());
    for content in ["{broken", r#"{"version":999,"config":{}}"#] {
        std::fs::write(&path, content).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(&MultiClientConfig::default()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn runtime_restart_and_reset_preserve_profiles_but_not_pid_bindings() {
    use poe2_engine::BotRuntime;
    use poe2_types::{ClientFlavor, InstancePatch};
    let dir = workspace("runtime");
    let path = dir.join("profiles.json");
    {
        let mut runtime = BotRuntime::default_mock();
        runtime
            .enable_profile_store(ProfileStore::new(path.clone()))
            .unwrap();
        runtime
            .cmd_update_instance(
                2,
                InstancePatch {
                    label: Some("Saved".into()),
                    flavor: Some(ClientFlavor::Standalone),
                    ..Default::default()
                },
            )
            .unwrap();
        let id = runtime.cmd_add_instance().unwrap();
        runtime.cmd_remove_instance(id).unwrap();
        assert!(runtime.cmd_remove_instance(1).is_err());
        let newer = runtime.cmd_add_instance().unwrap();
        assert!(newer > id);
        runtime.cmd_set_main_instance(2).unwrap();
        runtime.cmd_reset();
        assert_eq!(
            runtime.to_api_snapshot().settings.multi_client.clients[1].label,
            "Saved"
        );
    }
    let mut restored = BotRuntime::default_mock();
    restored
        .enable_profile_store(ProfileStore::new(path.clone()))
        .unwrap();
    let snapshot = restored.to_api_snapshot();
    assert_eq!(snapshot.settings.multi_client.main_instance_id, 2);
    assert_eq!(snapshot.settings.multi_client.clients[1].label, "Saved");
    assert!(snapshot.instance_services.profiles_persistent);
    assert!(snapshot
        .instance_services
        .instances
        .iter()
        .all(|s| s.binding.is_none()));
    // Simulate an external writer lock: API/runtime must not commit unsaved changes.
    let writer_lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path.with_extension("json.lock"))
        .unwrap();
    writer_lock.try_lock().unwrap();
    assert!(restored
        .cmd_update_instance(
            2,
            InstancePatch {
                label: Some("Not saved".into()),
                ..Default::default()
            }
        )
        .is_err());
    assert_eq!(
        restored.to_api_snapshot().settings.multi_client.clients[1].label,
        "Saved"
    );
    drop(writer_lock);
    std::fs::remove_dir_all(dir).unwrap();
}
