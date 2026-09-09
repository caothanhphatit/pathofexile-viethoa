use poe2_world::{apply_fps_limits, apply_low_spec_policy, find_poe2_executable};
use std::fs;

#[test]
fn instance_launch_routing_does_not_fall_back_to_another_platform() {
    use poe2_types::{ClientFlavor, MultiClientConfig};
    use poe2_world::launcher::instance_launch_path;
    let mut profiles = MultiClientConfig::default().clients;
    profiles[0].flavor = ClientFlavor::Steam;
    profiles[0].exe_path = r"D:\Standalone\PathOfExile.exe".into();
    assert!(instance_launch_path(&profiles[0])
        .unwrap_err()
        .contains("Steam"));
    profiles[0].flavor = ClientFlavor::EpicGames;
    assert!(instance_launch_path(&profiles[0])
        .unwrap_err()
        .contains("Epic"));
    assert!(instance_launch_path(&profiles[1]).is_err());
    profiles[1].flavor = ClientFlavor::Standalone;
    assert!(instance_launch_path(&profiles[1]).is_err());
    #[cfg(windows)]
    {
        profiles[1].exe_path = r"D:\StandaloneA\PathOfExile.exe".into();
        profiles[2].flavor = ClientFlavor::Standalone;
        profiles[2].exe_path = r"D:\StandaloneB\PathOfExile.exe".into();
        assert_ne!(
            instance_launch_path(&profiles[1]).unwrap(),
            instance_launch_path(&profiles[2]).unwrap()
        );
        profiles[2].exe_path = profiles[1].exe_path.clone();
        assert_eq!(
            instance_launch_path(&profiles[1]).unwrap(),
            instance_launch_path(&profiles[2]).unwrap()
        );
        profiles[2].exe_path = r"D:\Steam\PathOfExileSteam.exe".into();
        assert!(instance_launch_path(&profiles[2]).is_err());
    }
}

#[test]
fn instance_telemetry_does_not_claim_connections_or_metrics_without_pid_binding() {
    use poe2_world::{MockWorldAdapter, WorldAdapter};
    let mut adapter = MockWorldAdapter::new();
    let mut state = adapter.snapshot();
    state.settings.multi_client.clients.reverse();
    state.settings.multi_client.clients[0].id = 400;
    adapter.apply_state(state);
    let snapshot = adapter.snapshot();
    assert_eq!(snapshot.telemetry[0].client_id, 400);
    assert!(snapshot
        .telemetry
        .iter()
        .all(|t| !t.connected && !t.metrics_available));
}

#[test]
fn test_find_poe2_executable() {
    // Should run without crashing and find the game if installed
    let result = find_poe2_executable();
    if let Some(path) = result {
        assert!(path.is_file());
        assert!(path.to_string_lossy().contains("PathOfExile"));
    }
}

#[test]
fn test_smoother_fps_limits_injection() {
    let temp_dir = std::env::temp_dir();
    let test_ini = temp_dir.join("poe2_test_config.ini");

    let initial = "[DISPLAY]\r\nresolution_width=1920\r\nresolution_height=1080\r\n";
    fs::write(&test_ini, initial).expect("write test ini");

    apply_fps_limits(&test_ini, 15, 60).expect("apply limits");

    let updated = fs::read_to_string(&test_ini).expect("read test ini");
    assert!(updated.contains("background_framerate_limit=15"));
    assert!(updated.contains("background_framerate_limit_enabled=true"));
    assert!(updated.contains("framerate_limit=60"));

    let _ = fs::remove_file(test_ini);
}

#[test]
fn test_smoother_low_spec_policy() {
    let temp_dir = std::env::temp_dir();
    let test_ini = temp_dir.join("poe2_test_lowspec.ini");

    let initial =
        "[DISPLAY]\r\nshadow_type=High\r\ntexture_quality=TextureQualityHigh\r\nwater_detail=1\r\n";
    fs::write(&test_ini, initial).expect("write test ini");

    apply_low_spec_policy(&test_ini).expect("apply low spec");

    let updated = fs::read_to_string(&test_ini).expect("read test ini");
    assert!(updated.contains("shadow_type=Off"));
    assert!(updated.contains("texture_quality=TextureQualityLow"));
    assert!(updated.contains("water_detail=0"));

    let _ = fs::remove_file(test_ini);
}

#[test]
fn test_poe_smoother_policy_and_backup() {
    use poe2_types::PoeSmootherConfig;
    use poe2_world::smoother::{apply_poe_smoother_policy, backup_config};

    let temp_dir = std::env::temp_dir();
    let test_ini = temp_dir.join("poe2_test_smoother_full.ini");
    let test_bak = temp_dir.join("poe2_test_smoother_full.ini.bak");
    let _ = fs::remove_file(&test_bak);

    let initial = "[DISPLAY]\r\nshadow_type=High\r\ntexture_quality=TextureQualityHigh\r\nwater_detail=2\r\nsound_effects_volume2=80\r\nscreenspace_effects=1\r\n";
    fs::write(&test_ini, initial).expect("write test ini");

    let bak_path = backup_config(&test_ini).expect("backup");
    assert!(bak_path.exists());

    let cfg = PoeSmootherConfig {
        remove_shadows: true,
        clean_terrain: true,
        zero_effects: true,
        disable_sounds: true,
        background_fps: 10,
        foreground_fps: 60,
        ..Default::default()
    };

    apply_poe_smoother_policy(&test_ini, &cfg).expect("apply policy");

    let updated = fs::read_to_string(&test_ini).expect("read test ini");
    assert!(updated.contains("shadow_type=Off"));
    assert!(updated.contains("texture_quality=TextureQualityLow"));
    assert!(updated.contains("screenspace_effects=0"));
    assert!(updated.contains("sound_effects_volume2=0"));

    let _ = fs::remove_file(&test_ini);
    let _ = fs::remove_file(&test_bak);
}
