use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use poe2_overlay::{build_app, get_api_token};
use std::sync::Arc;
use tower::ServiceExt;

/// Points the premium store at an empty temp folder so these tests never read
/// the licence of the machine running them. Must run before the premium runtime
/// is first used in this process.
fn isolate_premium_store() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let root = std::env::temp_dir().join(format!("poevh-premium-overlay-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::env::set_var("LOCALAPPDATA", &root);
        std::env::remove_var("POEVH_PREMIUM_UNLOCK");
    });
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn premium_status_requires_the_local_api_token() {
    isolate_premium_store();
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));

    let anonymous = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/premium/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/premium/status")
                .header("x-api-token", get_api_token())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["ok"], true);
    let premium = &body["premium"];
    assert!(
        ["no_key", "active", "expired", "rejected"]
            .contains(&premium["state"].as_str().unwrap_or("")),
        "unexpected state: {premium}"
    );
    assert!(premium["active"].is_boolean());
    assert!(premium["device_label"].is_string());
    // The full key never leaves the process; at most a 9-character prefix does.
    assert!(premium["key_prefix"]
        .as_str()
        .is_none_or(|prefix| prefix.len() <= 9));
}

#[tokio::test]
async fn premium_activate_rejects_malformed_keys_before_any_network_call() {
    isolate_premium_store();
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/premium/activate")
                .header("x-api-token", get_api_token())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"key":"not-a-premium-key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["code"], "bad_key");
    assert!(body["premium"]["state"].is_string());

    // Unknown fields and broken JSON are refused without echoing the payload.
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/premium/activate")
                .header("x-api-token", get_api_token())
                .header("content-type", "application/json")
                .body(Body::from(r#"{"key":"PVH-SECRET","extra":1"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(!body.to_string().contains("PVH-SECRET"));
}

#[tokio::test]
async fn dashboard_ships_the_premium_page_and_script() {
    isolate_premium_store();
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));

    let dashboard = app
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let html = String::from_utf8(
        dashboard
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains("id=\"tab-premium\""));
    assert!(html.contains("id=\"premium-key-input\""));
    assert!(html.contains("id=\"premiumPill\""));
    assert!(html.contains("/static/premium.js"));

    let script = app
        .oneshot(
            Request::builder()
                .uri("/static/premium.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(script.status(), StatusCode::OK);
    assert_eq!(
        script.headers()["content-type"],
        "application/javascript; charset=utf-8"
    );
    let script = String::from_utf8(
        script
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    for route in [
        "/api/premium/status",
        "/api/premium/activate",
        "/api/premium/refresh",
        "/api/premium/deactivate",
    ] {
        assert!(script.contains(route), "premium.js calls {route}");
    }
}

async fn command(app: axum::Router, body: serde_json::Value) -> StatusCode {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri("/api/command")
            .header("x-api-token", get_api_token())
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

#[tokio::test]
async fn follow_bot_commands_need_premium_but_other_commands_do_not() {
    isolate_premium_store();
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    assert!(!poe2_world::premium::is_active());

    for body in [
        json!({"command":"run","value":true}),
        json!({"command":"toggle","key":"follow","value":true}),
        json!({"command":"toggle","key":"flask_life","value":true}),
        json!({"command":"toggle","key":"pickup_gold","value":true}),
        json!({"command":"set_param","key":"stop_dist","value":40}),
        json!({"command":"stash"}),
        json!({"command":"broadcast_a"}),
        json!({"command":"move","dx":1.0,"dy":0.0}),
    ] {
        assert_eq!(
            command(app.clone(), body.clone()).await,
            StatusCode::PAYMENT_REQUIRED,
            "{body} must be refused without premium"
        );
    }

    // Stopping the bot, the KBM bridge switch and non-bot commands stay free.
    for body in [
        json!({"command":"run","value":false}),
        json!({"command":"toggle","key":"kbm","value":false}),
        json!({"command":"reset"}),
        json!({"command":"add_instance"}),
    ] {
        assert_ne!(
            command(app.clone(), body.clone()).await,
            StatusCode::PAYMENT_REQUIRED,
            "{body} must not need premium"
        );
    }
}

#[tokio::test]
async fn dashboard_locks_the_follow_bot_group_and_ships_the_buy_screen() {
    isolate_premium_store();
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let html = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let html = String::from_utf8(html.into_body().collect().await.unwrap().to_bytes().to_vec())
        .unwrap();
    for id in [
        "id=\"premium-lock\"",
        "id=\"premium-buy-card\"",
        "id=\"premium-plans\"",
        "id=\"premium-open-page\"",
        "id=\"premium-tag-auto\"",
    ] {
        assert!(html.contains(id), "dashboard has {id}");
    }
}
