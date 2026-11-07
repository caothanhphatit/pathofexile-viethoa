use poe2_engine::BotRuntime;
use poe2_types::{ClientFlavor, GameProcess, ProcessIdentity};
use poe2_world::connector::{
    clear_verified_party_members, is_verified_party_member, record_verified_party_member,
    request_party_recovery, take_party_invites,
};

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
fn test_2client_topology_binding_and_controller_requirements() {
    let mut runtime = BotRuntime::default_mock();

    let leader_proc = discovered_process(1001, "0001");
    let follower_proc = discovered_process(1002, "0002");

    runtime.update_instance_inventory(Ok(vec![leader_proc.clone(), follower_proc.clone()]));
    runtime.auto_bind_unbound_instances();

    let instances = runtime.runtime_instances();
    assert_eq!(instances.len(), 2);

    let leader = instances.iter().find(|s| s.instance_id == 1).unwrap();
    assert!(leader.is_main);
    assert_eq!(leader.status, "bound");
    assert_eq!(leader.binding.as_ref().unwrap().pid, 1001);
    // Leader uses WASD and does NOT require virtual pads
    assert!(!runtime.instance_needs_virtual_controllers(1));

    let follower = instances.iter().find(|s| s.instance_id == 2).unwrap();
    assert!(!follower.is_main);
    assert_eq!(follower.status, "bound");
    assert_eq!(follower.binding.as_ref().unwrap().pid, 1002);
    // Secondary client requires dual virtual gamepads
    assert!(runtime.instance_needs_virtual_controllers(2));
}

#[test]
fn test_transient_scan_error_resilience_maintains_controllers_and_bindings() {
    let mut runtime = BotRuntime::default_mock();

    let leader_proc = discovered_process(1001, "0001");
    let follower_proc = discovered_process(1002, "0002");

    runtime.update_instance_inventory(Ok(vec![leader_proc.clone(), follower_proc.clone()]));
    runtime.auto_bind_unbound_instances();

    assert_eq!(runtime.runtime_instances().len(), 2);
    assert!(!runtime.has_scan_error());

    // Inject transient scan failure (e.g. WMI / Toolhelp RPC timeout)
    runtime.update_instance_inventory(Err("WMI query timeout on Win32_Process".to_string()));
    assert!(runtime.has_scan_error());

    // Ensure last-known-good inventory is strictly preserved
    let instances_after_error = runtime.runtime_instances();
    assert_eq!(instances_after_error.len(), 2);
    assert_eq!(instances_after_error[0].status, "bound");
    assert_eq!(instances_after_error[1].status, "bound");
    assert_eq!(instances_after_error[0].binding.as_ref().unwrap().pid, 1001);
    assert_eq!(instances_after_error[1].binding.as_ref().unwrap().pid, 1002);

    // Auto-bind during scan error must NOT unbind anything
    runtime.auto_bind_unbound_instances();
    let instances_still_bound = runtime.runtime_instances();
    assert_eq!(instances_still_bound[0].status, "bound");
    assert_eq!(instances_still_bound[1].status, "bound");

    // Scan recovers successfully
    runtime.update_instance_inventory(Ok(vec![leader_proc, follower_proc]));
    assert!(!runtime.has_scan_error());
    assert_eq!(runtime.runtime_instances().len(), 2);
}

#[test]
fn test_real_party_signals_and_member_verification() {
    clear_verified_party_members();
    let _ = take_party_invites();

    // 1. Party member verification tracks joined members
    assert!(!is_verified_party_member("FollowerChar"));
    record_verified_party_member("FollowerChar");
    assert!(is_verified_party_member("FollowerChar"));
    assert!(is_verified_party_member("followerchar")); // Case-insensitive check

    // 2. Recovery revision increments atomically on regroup request
    let rev1 = poe2_world::connector::party_recovery_revision();
    let rev2 = request_party_recovery();
    assert_eq!(rev2, rev1 + 1);
    assert_eq!(poe2_world::connector::party_recovery_revision(), rev2);

    clear_verified_party_members();
    assert!(!is_verified_party_member("FollowerChar"));
}

#[test]
fn test_per_instance_bot_toggle_independent_execution() {
    let mut runtime = BotRuntime::default_mock();

    let leader_proc = discovered_process(1001, "0001");
    let follower_proc = discovered_process(1002, "0002");
    runtime.update_instance_inventory(Ok(vec![leader_proc, follower_proc]));
    runtime.auto_bind_unbound_instances();

    // Both instances start with automation_enabled == true
    assert!(runtime.is_instance_automation_enabled(1));
    assert!(runtime.is_instance_automation_enabled(2));
    let global_running_initial = runtime.to_api_snapshot().running;

    // Toggle pause on Follower (Client 2)
    let follower_state_after_toggle = runtime.cmd_toggle_client_bot(2);
    assert!(!follower_state_after_toggle); // false = paused
    assert!(!runtime.is_instance_automation_enabled(2));

    // Leader (Client 1) MUST still be automation_enabled
    assert!(runtime.is_instance_automation_enabled(1));

    // Global running state must NOT be flipped
    assert_eq!(runtime.to_api_snapshot().running, global_running_initial);

    // Profile persistent settings must NOT be flipped to disabled
    let snapshot = runtime.to_api_snapshot();
    let client2_profile = snapshot
        .settings
        .multi_client
        .clients
        .iter()
        .find(|c| c.id == 2)
        .unwrap();
    assert!(client2_profile.enabled);

    // Runtime instances reflect the per-instance flag
    let runtime_insts = runtime.runtime_instances();
    assert!(
        runtime_insts
            .iter()
            .find(|i| i.instance_id == 1)
            .unwrap()
            .automation_enabled
    );
    assert!(
        !runtime_insts
            .iter()
            .find(|i| i.instance_id == 2)
            .unwrap()
            .automation_enabled
    );

    // Resume Follower (Client 2)
    let follower_resumed = runtime.cmd_toggle_client_bot(2);
    assert!(follower_resumed);
    assert!(runtime.is_instance_automation_enabled(2));
}
