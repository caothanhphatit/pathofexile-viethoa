//! No game, capture or credential operations. Isolated profile file only.
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use parking_lot::Mutex;
use poe2_engine::{profile_store::ProfileStore, BotRuntime};
use poe2_overlay::{build_app, get_api_token};
use poe2_types::{ClientFlavor, InstancePatch};
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

#[tokio::test]
async fn calibration_endpoint_is_temporarily_disabled_without_mutating_profiles() {
    let folder = std::env::temp_dir().join(format!(
        "poe2-calibration-{}",
        poe2_world::credentials::random_key().unwrap()
    ));
    std::fs::create_dir(&folder).unwrap();
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if self.0.parent() == Some(std::env::temp_dir().as_path())
                && self
                    .0
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("poe2-calibration-")
            {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
    let _cleanup = Cleanup(folder.clone());
    let mut rt = BotRuntime::default_mock();
    rt.enable_profile_store(ProfileStore::new(folder.join("profiles.json")))
        .unwrap();
    rt.cmd_update_instance(
        2,
        InstancePatch {
            flavor: Some(ClientFlavor::Standalone),
            ..Default::default()
        },
    )
    .unwrap();
    let runtime = Arc::new(Mutex::new(rt));
    let app = build_app(runtime.clone());
    let store = ProfileStore::new(folder.join("profiles.json"));
    let payload = json!({"instance_id":2,"confirmed":true,"calibration":{"version":1,"capture_width":1920,"capture_height":1080,"email":[0.5,0.65],"password":[0.5,0.72],"submit":[0.5,0.85]}});
    let call = |payload: Value| {
        app.clone().oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/login-calibration")
                .header("x-api-token", get_api_token())
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
    };
    let mut unconfirmed = payload.clone();
    unconfirmed["confirmed"] = json!(false);
    assert_eq!(
        call(unconfirmed).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );

    assert_eq!(
        call(payload).await.unwrap().status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    let loaded = store.load().unwrap().unwrap();
    assert!(loaded
        .clients
        .iter()
        .all(|client| client.login_calibration.is_none()));
}
