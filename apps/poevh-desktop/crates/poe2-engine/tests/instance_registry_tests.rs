use poe2_engine::instances::InstanceRegistry;
use poe2_types::*;
use std::time::{Duration, Instant};

fn process(pid: u32, start: &str) -> GameProcess {
    GameProcess {
        identity: ProcessIdentity {
            pid,
            started_at: start.into(),
            exe_path: r"D:\Game\PathOfExile.exe".into(),
        },
        flavor: ClientFlavor::Standalone,
        window: None,
        working_set_bytes: Some(100_000_000),
        cpu_percent: None,
        cpu_ticks: 100,
    }
}

#[test]
fn same_executable_instances_bind_separately_and_never_rebind_a_reused_pid() {
    let config = MultiClientConfig::default();
    let mut registry = InstanceRegistry::default();
    let a = process(101, "old");
    let b = process(102, "other");
    registry.update(Ok(vec![a.clone(), b.clone()]), Instant::now());
    registry.bind(&config, 2, a.identity.clone()).unwrap();
    assert!(registry.bind(&config, 3, a.identity.clone()).is_err());
    registry.bind(&config, 3, b.identity.clone()).unwrap();
    let statuses = registry.statuses(&config);
    assert_eq!(statuses[1].process.as_ref().unwrap().identity.pid, 101);
    assert_eq!(statuses[2].process.as_ref().unwrap().identity.pid, 102);
    registry.update(Ok(vec![process(101, "REUSED"), b]), Instant::now());
    assert_eq!(
        registry.statuses(&config)[1].status,
        "exited_or_unavailable"
    );
    assert_eq!(registry.binding(2).unwrap().started_at, "old");
    registry.update(Err("access denied".into()), Instant::now());
    assert_eq!(registry.statuses(&config)[1].status, "scan_unavailable");
}

#[test]
fn binding_checks_platform_path_disabled_and_stale_identity() {
    let mut config = MultiClientConfig::default();
    let mut registry = InstanceRegistry::default();
    let a = process(101, "old");
    registry.update(Ok(vec![a.clone()]), Instant::now());
    config.clients[1].flavor = ClientFlavor::Steam;
    assert!(registry.bind(&config, 2, a.identity.clone()).is_err());
    config.clients[1].flavor = ClientFlavor::Standalone;
    config.clients[1].exe_path = r"D:\Other\PathOfExile.exe".into();
    assert!(registry.bind(&config, 2, a.identity.clone()).is_err());
    config.clients[1].exe_path.clear();
    config.clients[1].enabled = false;
    assert!(registry.bind(&config, 2, a.identity.clone()).is_err());
    assert!(registry.bind(&config, 999, a.identity).is_err());
    assert!(registry
        .bind(&config, 1, process(101, "stale").identity)
        .is_err());
}

#[test]
fn cpu_requires_two_samples_and_missing_metrics_remain_unknown() {
    let mut registry = InstanceRegistry::default();
    let mut a = process(101, "old");
    a.working_set_bytes = None;
    let now = Instant::now();
    registry.update(Ok(vec![a.clone()]), now);
    assert!(registry.processes[0].cpu_percent.is_none());
    a.cpu_ticks += 10_000_000;
    registry.update(Ok(vec![a]), now + Duration::from_secs(1));
    let cores = std::thread::available_parallelism().unwrap().get() as f32;
    assert!((registry.processes[0].cpu_percent.unwrap() - 100.0 / cores).abs() < 0.001);
    assert!(registry.processes[0].working_set_bytes.is_none());
}

#[test]
fn auto_bind_assigns_first_game_to_first_free_slot() {
    let config = MultiClientConfig::default();
    let mut registry = InstanceRegistry::default();
    // Discovery order is launch order in production, but the registry must
    // still choose the lowest profile id and never reuse an occupied process.
    let first = process(201, "0002");
    let second = process(202, "0003");
    registry.update(Ok(vec![second.clone(), first.clone()]), Instant::now());
    registry.auto_bind_unbound(&config);
    assert_eq!(registry.binding(1), Some(&first.identity));
    assert_eq!(registry.binding(2), Some(&second.identity));
}

#[test]
fn auto_bind_does_not_jump_to_later_slot_when_earlier_profile_mismatches() {
    let mut config = MultiClientConfig::default();
    config.clients[0].exe_path = r"D:\Other\PathOfExile.exe".into();
    let mut registry = InstanceRegistry::default();
    let game = process(203, "0004");
    registry.update(Ok(vec![game.clone()]), Instant::now());
    registry.auto_bind_unbound(&config);
    assert_eq!(registry.binding(1), None);
    assert_eq!(registry.binding(2), Some(&game.identity));
}

#[test]
fn launch_guard_and_bound_profile_edits_preserve_identity_rules() {
    use poe2_engine::BotRuntime;
    let mut runtime = BotRuntime::default_mock();
    runtime.begin_instance_launch(2).unwrap();
    assert!(runtime.begin_instance_launch(2).is_err());
    assert!(runtime.cmd_remove_instance(2).is_err());
    assert!(runtime
        .cmd_update_instance(
            2,
            InstancePatch {
                enabled: Some(false),
                ..Default::default()
            }
        )
        .is_err());
    runtime.finish_instance_launch(2);
    let a = process(101, "old");
    runtime.update_instance_inventory(Ok(vec![a.clone()]));
    runtime.cmd_bind_instance(2, a.identity.clone()).unwrap();
    assert!(runtime.begin_instance_launch(2).is_err());
    runtime
        .cmd_update_instance(
            2,
            InstancePatch {
                label: Some("Renamed".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(runtime.bound_identity(2).unwrap(), a.identity);
    runtime
        .cmd_update_instance(
            2,
            InstancePatch {
                flavor: Some(ClientFlavor::Steam),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(runtime.bound_identity(2).is_err());
}
