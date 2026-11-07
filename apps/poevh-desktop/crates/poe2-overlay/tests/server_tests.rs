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

#[tokio::test]
async fn follow_controls_are_hydrated_from_the_runtime_snapshot() {
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));

    let dashboard = app
        .clone()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(dashboard.status(), StatusCode::OK);
    let dashboard = String::from_utf8(
        dashboard
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(dashboard.contains("id=\"follow-stop-distance\""));
    assert!(dashboard.contains("id=\"follow-sprint-distance\""));

    let script = app
        .oneshot(
            Request::builder()
                .uri("/static/core.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(script.status(), StatusCode::OK);
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
    assert!(script.contains("setChecked('tog-follow', s.settings.follow)"));
    assert!(script.contains("setChecked('tog-prio-catch', s.config?.prioritize_catchup)"));
    assert!(script.contains("setRange('follow-stop-distance', s.config.stop_distance"));
    assert!(script.contains("setRange('follow-sprint-distance', s.config.catch_up_distance"));
}

#[tokio::test]
async fn instance_lifecycle_and_unsupported_graphics_are_explicit() {
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let (status, state) = instance_command(app.clone(), json!({"command":"add_instance"})).await;
    assert_eq!(status, StatusCode::OK);
    let id = state["settings"]["multi_client"]["clients"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()["id"]
        .as_u64()
        .unwrap();
    assert!(id > 3);
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"set_main_instance","instance_id":id})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"remove_instance","instance_id":id})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"set_main_instance","instance_id":1})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"remove_instance","instance_id":id})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"unbind_instance","instance_id":999})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"instance_window","instance_id":2,"value":"focus"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"instance_window","instance_id":2,"value":"kill"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"apply_instance_graphics","instance_id":2})
        )
        .await
        .0,
        StatusCode::NOT_IMPLEMENTED
    );
    assert_eq!(
        instance_command(
            app,
            json!({"command":"bind_instance","instance_id":2,"value":{"pid":123}})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn instance_mutations_require_auth_and_do_not_change_state_when_rejected() {
    let runtime = Arc::new(Mutex::new(BotRuntime::default_mock()));
    let app = build_app(runtime.clone());
    let before = serde_json::to_value(runtime.lock().to_api_snapshot().settings).unwrap();
    for token in [None, Some("wrong-token")] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/command")
            .header("content-type", "application/json");
        if let Some(token) = token {
            request = request.header("x-api-token", token);
        }
        let response = app.clone().oneshot(request.body(Body::from(
            r#"{"command":"update_instance","instance_id":2,"value":{"enabled":false}}"#
        )).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        serde_json::to_value(runtime.lock().to_api_snapshot().settings).unwrap(),
        before
    );
}

#[tokio::test]
async fn api_failures_return_a_traceable_request_id() {
    use serde_json::json;

    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let request_id = "ui-test-request-42";
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/command")
                .header("x-api-token", get_api_token())
                .header("x-request-id", request_id)
                .header("content-type", "application/json")
                .body(Body::from(json!({"command":"not-a-command"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers()["x-request-id"], request_id);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["request_id"], request_id);
}

#[tokio::test]
async fn browser_diagnostic_endpoint_requires_auth_and_accepts_bounded_payload() {
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/client-log")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"level":"error","message":"no token"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/client-log")
                .header("x-api-token", get_api_token())
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"level":"error","message":"render failed","source":"core.js","line":12,"column":4,"stack":"Error: render failed","client_request_id":"ui-42"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(response.headers().get("x-request-id").is_some());
}

async fn instance_command(
    app: axum::Router,
    payload: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/command")
                .header("x-api-token", get_api_token())
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn instance_settings_are_independent_for_same_platform() {
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    for id in [2, 3] {
        let (status, _) = instance_command(
            app.clone(),
            json!({
                "command": "update_instance", "instance_id": id,
                "value": {"flavor": "Standalone"}
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    let (_, before) = instance_command(app.clone(), json!({
        "command": "update_instance", "instance_id": 3, "value": {"black_screen": false, "bg_fps": 60}
    })).await;
    let (status, after) = instance_command(
        app,
        json!({
            "command": "update_instance", "instance_id": 2,
            "value": {"black_screen": true, "bg_fps": 10, "enabled": false}
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let profiles = &after["settings"]["multi_client"]["clients"];
    assert_eq!(profiles[1]["bg_fps"], 10);
    assert_eq!(profiles[1]["enabled"], false);
    assert_eq!(
        profiles[2],
        before["settings"]["multi_client"]["clients"][2]
    );
    assert!(after["settings"].get("smoother_steam").is_none());
}

#[tokio::test]
async fn input_mode_api_keeps_exactly_one_wasd_main() {
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let (status, state) = instance_command(
        app.clone(),
        json!({
            "command": "update_instance",
            "instance_id": 2,
            "value": {"input_mode": "single_wasd"}
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state["settings"]["multi_client"]["main_instance_id"], 2);
    let profiles = state["settings"]["multi_client"]["clients"]
        .as_array()
        .unwrap();
    assert_eq!(profiles[0]["input_mode"], "dual_controller");
    assert_eq!(profiles[1]["input_mode"], "single_wasd");

    assert_eq!(
        instance_command(
            app,
            json!({
                "command": "update_instance",
                "instance_id": 2,
                "value": {"input_mode": "dual_controller"}
            }),
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn instance_api_rejects_missing_unknown_ids_and_bad_patches() {
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    for payload in [
        json!({"command":"update_instance", "value":{"enabled":false}}),
        json!({"command":"update_instance", "instance_id":2, "value":{"bg_fps":0}}),
        json!({"command":"update_instance", "instance_id":2, "value":{"bg_fps":1.5}}),
        json!({"command":"update_instance", "instance_id":2, "value":{"flavor":"Other"}}),
        json!({"command":"update_instance", "instance_id":2, "value":{"password":"secret"}}),
        json!({"command":"update_instance", "instance_id":2, "value":{}}),
    ] {
        assert_eq!(
            instance_command(app.clone(), payload).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        instance_command(
            app,
            json!({"command":"update_instance", "instance_id":999, "value":{"enabled":false}})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn obsolete_platform_graphics_commands_are_explicitly_rejected() {
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    for (command, key, value) in [
        ("toggle", "smoother_steam_black_screen", json!(true)),
        ("set_param", "smoother_standalone_bg_fps", json!(15)),
        ("set_param", "smoother_bg_fps", json!(15)),
    ] {
        assert_eq!(
            instance_command(
                app.clone(),
                json!({"command":command,"key":key,"value":value})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
}

#[tokio::test]
async fn unknown_and_unimplemented_runtime_settings_are_not_reported_as_success() {
    use serde_json::json;
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"toggle","key":"not_a_real_toggle","value":true})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        instance_command(
            app.clone(),
            json!({"command":"toggle","key":"sync_dodge","value":true})
        )
        .await
        .0,
        StatusCode::NOT_IMPLEMENTED
    );
    assert_eq!(
        instance_command(
            app,
            json!({"command":"set_param","key":"not_a_real_number","value":1})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn test_api_unauthorized_without_token() {
    let runtime = Arc::new(Mutex::new(BotRuntime::default_mock()));
    let app = build_app(runtime);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/state")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_api_unauthorized_with_invalid_token() {
    let runtime = Arc::new(Mutex::new(BotRuntime::default_mock()));
    let app = build_app(runtime);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/state")
                .header("x-api-token", "malicious_forged_token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_api_authorized_with_valid_token() {
    let runtime = Arc::new(Mutex::new(BotRuntime::default_mock()));
    let app = build_app(runtime);
    let token = get_api_token();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/state")
                .header("x-api-token", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body_str.contains("\"tick\":"));
    assert!(body_str.contains("\"leader\":"));
}

#[tokio::test]
async fn test_dashboard_serves_html_with_token() {
    let runtime = Arc::new(Mutex::new(BotRuntime::default_mock()));
    let app = build_app(runtime);
    let token = get_api_token();

    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body_str.contains(&format!("window.__API_TOKEN__ = \"{token}\";")));
}

#[tokio::test]
async fn trade_overlay_is_tokenized_and_latest_capture_requires_auth() {
    let app = build_app(Arc::new(Mutex::new(BotRuntime::default_mock())));
    let token = get_api_token();
    let overlay = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/trade-overlay")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overlay.status(), StatusCode::OK);
    let html = String::from_utf8(
        overlay
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(html.contains(&format!("window.__API_TOKEN__ = \"{token}\";")));

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/trade/latest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = app
        .oneshot(
            Request::builder()
                .uri("/api/trade/latest")
                .header("x-api-token", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(authorized.status(), StatusCode::OK);
}
