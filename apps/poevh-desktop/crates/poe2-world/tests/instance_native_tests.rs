#![cfg(windows)]
use poe2_world::instances::{discover_game_processes, inspect_game_process};
use std::{
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

#[test]
fn child_fixture() {
    if std::env::var_os("POE2_PROCESS_FIXTURE").is_some() {
        std::thread::sleep(Duration::from_secs(20));
    }
}

struct Fixtures {
    children: Vec<Child>,
    directory: std::path::PathBuf,
}
impl Drop for Fixtures {
    fn drop(&mut self) {
        for child in &mut self.children {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_file(self.directory.join("PathOfExile.exe"));
        let _ = std::fs::remove_dir(&self.directory);
    }
}

#[test]
fn native_discovery_distinguishes_two_test_processes_with_the_same_executable() {
    // A renamed test harness, NOT the installed game. No window/input/game memory.
    let directory =
        std::env::temp_dir().join(format!("poe2-native-fixtures-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let exe = directory.join("PathOfExile.exe");
    std::fs::copy(std::env::current_exe().unwrap(), &exe).unwrap();
    let mut fixtures = Fixtures {
        children: Vec::new(),
        directory,
    };
    for _ in 0..2 {
        fixtures.children.push(
            Command::new(&exe)
                .args(["--exact", "child_fixture"])
                .env("POE2_PROCESS_FIXTURE", "1")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
    }
    let pids: Vec<u32> = fixtures.children.iter().map(Child::id).collect();
    let deadline = Instant::now() + Duration::from_secs(3);
    let processes = loop {
        let processes = discover_game_processes().unwrap();
        if pids
            .iter()
            .all(|pid| processes.iter().any(|p| p.identity.pid == *pid))
        {
            break processes;
        }
        assert!(
            Instant::now() < deadline,
            "Both fixtures must become discoverable"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    let a = processes
        .iter()
        .find(|p| p.identity.pid == pids[0])
        .unwrap();
    let b = processes
        .iter()
        .find(|p| p.identity.pid == pids[1])
        .unwrap();
    assert_ne!(a.identity, b.identity);
    assert_eq!(a.identity.exe_path, b.identity.exe_path);
    assert_eq!(a.identity.started_at.len(), 16);
    assert!(a.working_set_bytes.is_some_and(|bytes| bytes > 0));
    assert_eq!(inspect_game_process(pids[0]).unwrap().identity, a.identity);
    fixtures.children[0].kill().unwrap();
    fixtures.children[0].wait().unwrap();
    assert!(inspect_game_process(pids[0]).is_err());
    assert!(inspect_game_process(pids[1]).is_ok());
}
