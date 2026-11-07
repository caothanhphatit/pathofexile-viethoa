#![cfg(windows)]
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use poe2_overlay::{build_app, get_api_token};
use serde_json::{json, Value};
use std::{
    process::{Child, Command, Stdio},
    sync::Arc,
};
use tower::ServiceExt;

#[test]
fn api_child_fixture() {
    if std::env::var_os("POE2_API_FIXTURE").is_some() {
        std::thread::sleep(std::time::Duration::from_secs(20));
    }
}

struct Fixture {
    child: Child,
    directory: std::path::PathBuf,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(self.directory.join("PathOfExile.exe"));
        let _ = std::fs::remove_dir(&self.directory);
    }
}

async fn post(app: axum::Router, value: Value) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/command")
                .header("x-api-token", get_api_token())
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn actual_windows_process_can_be_scanned_bound_and_unbound_via_real_api() {
    let directory =
        std::env::temp_dir().join(format!("poe2-native-api-fixture-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let exe = directory.join("PathOfExile.exe");
    std::fs::copy(std::env::current_exe().unwrap(), &exe).unwrap();
    let child = Command::new(&exe)
        .args(["--exact", "api_child_fixture"])
        .env("POE2_API_FIXTURE", "1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut fixture = Fixture { child, directory };
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let (status, state) = post(app.clone(), json!({"command":"scan_instances"})).await;
    assert_eq!(status, StatusCode::OK);
    let identity = state["instance_services"]["processes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["identity"]["pid"] == fixture.child.id())
        .unwrap()["identity"]
        .clone();
    let (status, state) = post(
        app.clone(),
        json!({"command":"bind_instance","instance_id":2,"value":identity}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        state["instance_services"]["instances"][1]["status"],
        "bound"
    );
    assert_eq!(
        post(
            app.clone(),
            json!({"command":"bind_instance","instance_id":3,"value":identity})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    fixture.child.kill().unwrap();
    fixture.child.wait().unwrap();
    let _ = post(app.clone(), json!({"command":"scan_instances"})).await;
    let _ = post(app.clone(), json!({"command":"scan_instances"})).await;
    let (_, state) = post(app.clone(), json!({"command":"scan_instances"})).await;
    assert_eq!(
        state["instance_services"]["instances"][1]["status"],
        "exited_or_unavailable"
    );
    assert_eq!(
        post(
            app.clone(),
            json!({"command":"bind_instance","instance_id":2,"value":identity})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, state) = post(app, json!({"command":"unbind_instance","instance_id":2})).await;
    assert_eq!(
        state["instance_services"]["instances"][1]["status"],
        "unbound"
    );
}
