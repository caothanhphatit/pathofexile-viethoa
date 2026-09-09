//! Security regression tests. No game is launched and no login input is sent.
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use parking_lot::Mutex;
use poe2_engine::{profile_store::ProfileStore, BotRuntime};
use poe2_overlay::{build_app, get_api_token};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

async fn request(
    app: Router,
    path: &str,
    body: String,
    token: bool,
    host: &str,
    origin: Option<&str>,
) -> (StatusCode, String) {
    let mut request = Request::builder()
        .method("POST")
        .uri(path)
        .header("content-type", "application/json")
        .header("host", host);
    if token {
        request = request.header("x-api-token", get_api_token());
    }
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    let response = app
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let text = String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    (status, text)
}

#[tokio::test]
async fn secret_routes_authenticate_before_parsing_and_reject_rebinding() {
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    for path in [
        "/api/credentials",
        "/api/standalone-login",
        "/api/standalone-login/cancel",
        "/api/login-calibration",
    ] {
        assert_eq!(
            request(
                app.clone(),
                path,
                "malformed secret body".into(),
                false,
                "127.0.0.1:8766",
                None
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(
                app.clone(),
                path,
                "{}".into(),
                true,
                "attacker.invalid:8766",
                None
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                app.clone(),
                path,
                "{}".into(),
                true,
                "127.0.0.1:8766",
                Some("https://attacker.invalid")
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                app.clone(),
                path,
                "{}".into(),
                true,
                "127.0.0.1:8766",
                Some("null")
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/")
                .header("host", "attacker.invalid:8766")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/")
                .header("host", "127.0.0.1:8766")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["x-frame-options"], "DENY");
    assert_eq!(get_api_token().len(), 64);
}

#[tokio::test]
async fn credential_validation_never_echoes_submitted_secrets() {
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    for value in [
        json!({"instance_id":1,"action":"save","email":"bad","password":"fixture-super-secret"}),
        json!({"instance_id":1,"action":"save","email":"fixture@example.invalid","password":"fixture-super-secret","unknown":"fixture-super-secret"}),
    ] {
        let (status, body) = request(
            app.clone(),
            "/api/credentials",
            value.to_string(),
            true,
            "127.0.0.1:8766",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!body.contains("fixture-super-secret"));
    }
    assert_eq!(
        request(
            app.clone(),
            "/api/credentials",
            "x".repeat(40000),
            true,
            "127.0.0.1:8766",
            None
        )
        .await
        .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        request(
            app,
            "/api/standalone-login",
            json!({"instance_id":1,"launch":true,"confirmed":false}).to_string(),
            true,
            "127.0.0.1:8766",
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
#[cfg(windows)]
async fn vault_lifecycle_redaction_reload_and_profile_guards() {
    let folder = std::env::temp_dir().join(format!(
        "poe2-login-test-{}",
        poe2_world::credentials::random_key().unwrap()
    ));
    std::fs::create_dir(&folder).unwrap();
    struct Cleanup {
        folder: std::path::PathBuf,
        key: Option<String>,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Some(key) = &self.key {
                let _ = poe2_world::credentials::delete(key);
            }
            let _ = std::fs::remove_dir_all(&self.folder);
        }
    }
    let mut cleanup = Cleanup {
        folder: folder.clone(),
        key: None,
    };
    let store = ProfileStore::new(folder.join("profiles.json"));
    let mut rt = BotRuntime::default_mock();
    rt.enable_profile_store(ProfileStore::new(folder.join("profiles.json")))
        .unwrap();
    rt.cmd_update_instance(
        2,
        poe2_types::InstancePatch {
            flavor: Some(poe2_types::ClientFlavor::Standalone),
            ..Default::default()
        },
    )
    .unwrap();
    let runtime = Arc::new(Mutex::new(rt));
    let app = build_app(runtime.clone());
    let payload = json!({"instance_id":2,"action":"save","email":"fixture@example.invalid","password":"fixture-only-password"});
    let (status, body) = request(
        app.clone(),
        "/api/credentials",
        payload.to_string(),
        true,
        "127.0.0.1:8766",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    cleanup.key = store.load().unwrap().unwrap().clients[1]
        .credential_ref
        .clone();
    assert!(cleanup.key.is_some());
    for forbidden in [
        "fixture@example.invalid",
        "fixture-only-password",
        "credential_ref",
    ] {
        assert!(!body.contains(forbidden));
    }
    let state: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        state["settings"]["multi_client"]["clients"][1]["has_credentials"],
        true
    );
    assert_eq!(
        request(
            app.clone(),
            "/api/credentials",
            payload.to_string(),
            true,
            "127.0.0.1:8766",
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert!(runtime.lock().cmd_remove_instance(2).is_err());
    assert!(runtime
        .lock()
        .cmd_update_instance(
            2,
            poe2_types::InstancePatch {
                exe_path: Some("D:\\Changed\\PathOfExile.exe".into()),
                ..Default::default()
            }
        )
        .is_err());
    let mut reloaded = BotRuntime::default_mock();
    reloaded
        .enable_profile_store(ProfileStore::new(folder.join("profiles.json")))
        .unwrap();
    assert!(reloaded.to_api_snapshot().settings.multi_client.clients[1].has_credentials);
    for path in [
        folder.join("profiles.json"),
        folder.join("profiles.json.bak"),
    ] {
        if path.exists() {
            let text = std::fs::read_to_string(path).unwrap();
            assert!(!text.contains("fixture-only-password"));
            assert!(!text.contains("fixture@example.invalid"));
        }
    }
    assert_eq!(
        request(
            app,
            "/api/credentials",
            json!({"instance_id":2,"action":"delete"}).to_string(),
            true,
            "127.0.0.1:8766",
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(
        poe2_world::credentials::read(cleanup.key.as_deref().unwrap())
            .unwrap()
            .is_none()
    );
    assert!(
        !runtime
            .lock()
            .to_api_snapshot()
            .settings
            .multi_client
            .clients[1]
            .has_credentials
    );
    runtime.lock().cmd_remove_instance(2).unwrap();
}
