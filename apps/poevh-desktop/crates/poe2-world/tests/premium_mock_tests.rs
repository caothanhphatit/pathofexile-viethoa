//! End-to-end check of the premium client against `tools/premium-mock-server.mjs`.
//! Ignored by default: it needs `node` and talks over loopback HTTP.
//!
//!   cargo test -p poe2-world --test premium_mock_tests -- --ignored

use poe2_types::PremiumState;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
};

struct MockServer {
    child: Child,
    base: String,
}

impl MockServer {
    fn start() -> Self {
        let script =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tools/premium-mock-server.mjs");
        let mut child = Command::new("node")
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("node is required for the premium mock server");
        let stdout = child.stdout.take().unwrap();
        let mut lines = BufReader::new(stdout).lines();
        let banner = lines.next().unwrap().unwrap();
        let base = banner
            .split_whitespace()
            .find(|word| word.starts_with("http://"))
            .expect("mock server banner names its URL")
            .to_string();
        // Keep draining stdout so the child never blocks on a full pipe.
        std::thread::spawn(move || for _ in lines.by_ref() {});
        Self { child, base }
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
#[ignore = "needs node; run with --ignored"]
fn activates_refreshes_and_deactivates_against_the_mock_server() {
    let server = MockServer::start();
    let store_root = std::env::temp_dir().join(format!("poevh-premium-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&store_root);
    // Both are read before the runtime is first touched (below), so the test
    // never writes to the real %LOCALAPPDATA% store.
    std::env::set_var("LOCALAPPDATA", &store_root);
    std::env::set_var("POEVH_PREMIUM_API", &server.base);

    use poe2_world::premium;
    premium::init();
    assert_eq!(premium::status().state, PremiumState::NoKey);
    assert!(!premium::is_active());

    let rejected = premium::activate("PVH-ABCDE-FGHJK-MNPQR-STVWX").unwrap_err();
    assert_eq!(rejected.code, "unknown_key");
    let status = premium::status();
    assert_eq!(
        status.state,
        PremiumState::NoKey,
        "a refused key is not stored"
    );
    assert_eq!(status.last_error_code.as_deref(), Some("unknown_key"));

    // Pasted sloppily: lower case, no dashes, trailing space.
    let active = premium::activate("pvh testkeytestkeytestke ").unwrap();
    assert_eq!(active.state, PremiumState::Active);
    assert!(active.active);
    assert_eq!(active.key_prefix.as_deref(), Some("PVH-TESTK"));
    assert_eq!(active.plan.as_deref(), Some("month"));
    assert!(active.premium_until.is_some());
    assert!(active.last_error_code.is_none());
    assert!(premium::is_active());

    let refreshed = premium::refresh().unwrap();
    assert_eq!(refreshed.state, PremiumState::Active);

    let store =
        std::fs::read_to_string(store_root.join("POE2MultiPilot").join("premium.json")).unwrap();
    let store: serde_json::Value = serde_json::from_str(&store).unwrap();
    assert_eq!(store["key"], "PVH-TESTK-EYTES-TKEYT-ESTKE");
    assert!(store["token"]
        .as_str()
        .is_some_and(|token| token.contains('.')));
    assert!(store["public_key_pem"]
        .as_str()
        .is_some_and(|pem| pem.contains("BEGIN PUBLIC KEY")));

    let cleared = premium::deactivate();
    assert_eq!(cleared.state, PremiumState::NoKey);
    assert!(!premium::is_active());

    let _ = std::fs::remove_dir_all(&store_root);
}

#[test]
#[ignore = "needs node; run with --ignored"]
fn offer_comes_from_the_server_with_a_page_url() {
    let server = MockServer::start();
    // Only the API base matters here; the offer does not touch the licence store.
    std::env::set_var("POEVH_PREMIUM_API", &server.base);
    let offer = poe2_world::premium::offer().unwrap();
    assert_eq!(offer["currency"], "VND");
    assert_eq!(offer["plans"].as_array().unwrap().len(), 3);
    assert_eq!(offer["plans"][0]["price"], 49000);
    assert!(offer["page_url"].as_str().unwrap().ends_with("/premium"));
}
