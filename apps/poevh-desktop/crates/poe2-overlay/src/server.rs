//! Axum HTTP server: /api/state and /api/command.

use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use parking_lot::Mutex;
use poe2_engine::BotRuntime;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::Instant,
};
use tracing::{debug, info, warn};

pub type SharedRuntime = Arc<Mutex<BotRuntime>>;

// Owned by the blocking worker, so disconnecting the HTTP client cannot leave
// an instance permanently marked as launching.
struct LaunchReservation {
    runtime: SharedRuntime,
    instance_id: u32,
}

impl Drop for LaunchReservation {
    fn drop(&mut self) {
        self.runtime.lock().finish_instance_launch(self.instance_id);
    }
}

static API_TOKEN: OnceLock<String> = OnceLock::new();
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);
const AUTO_LOGIN_AVAILABLE: bool = false;

// A request id is kept in a Tokio task-local so every validation branch can
// attach the same id to its diagnostic without threading it through dozens of
// command handlers. It is also returned as X-Request-Id for UI-side reports.
tokio::task_local! {
    static REQUEST_ID: String;
}

fn new_request_id() -> String {
    format!(
        "p{}-r{}",
        std::process::id(),
        REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn request_id_from_headers(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
        .map(str::to_owned)
        .unwrap_or_else(new_request_id)
}

fn current_request_id() -> Option<String> {
    REQUEST_ID.try_with(|request_id| request_id.clone()).ok()
}

fn json_shape(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(_) => "bool".to_string(),
        Value::Number(number) => format!("number:{number}"),
        Value::String(value) => format!("string:len={}", value.len()),
        Value::Array(values) => format!("array:len={}", values.len()),
        Value::Object(values) => format!("object:keys={}", values.len()),
    }
}

pub fn get_api_token() -> &'static str {
    API_TOKEN.get_or_init(|| {
        poe2_world::credentials::random_key()
            .expect("OS cryptographic randomness is required for API authentication")
    })
}

// ─── Modular Dashboard UI (embedded) ─────────────────────────────────────────

const DASHBOARD_HTML: &str = include_str!("../ui/index.html");
const THEME_CSS: &str = include_str!("../ui/css/theme.css");
const COMPONENTS_CSS: &str = include_str!("../ui/css/components.css");
const LAYOUT_CSS: &str = include_str!("../ui/css/layout.css");
const OVERVIEW_CSS: &str = include_str!("../ui/css/overview.css");
const CORE_JS: &str = include_str!("../ui/js/core.js");
const OVERVIEW_JS: &str = include_str!("../ui/js/overview.js");
const CLIENT_MGR_JS: &str = include_str!("../ui/js/client_mgr.js");
const SMOOTHER_JS: &str = include_str!("../ui/js/smoother.js");
const CONTROLLER_JS: &str = include_str!("../ui/js/controller.js");
const PHYSICAL_CONTROLLERS_JS: &str = include_str!("../ui/js/physical-controllers.js");
const CALIBRATION_JS: &str = include_str!("../ui/js/calibration.js");
const TRADE_JS: &str = include_str!("../ui/js/trade.js");
const TRADE_OVERLAY_HTML: &str = include_str!("../ui/trade-overlay.html");
const TRADE_OVERLAY_CSS: &str = include_str!("../ui/css/trade-overlay.css");
const TRADE_OVERLAY_JS: &str = include_str!("../ui/js/trade-overlay.js");
const BASTELEUR_BOLD_WOFF: &[u8] = include_bytes!("../ui/fonts/basteleur-bold.woff");
const BASTELEUR_MOONLIGHT_WOFF: &[u8] = include_bytes!("../ui/fonts/basteleur-moonlight.woff");
const EXPEDITION_JS: &str = include_str!("../ui/js/expedition.js");
const EXPEDITION_OVERLAY_HTML: &str = include_str!("../ui/expedition-overlay.html");
const EXPEDITION_OVERLAY_CSS: &str = include_str!("../ui/css/expedition-overlay.css");
const EXPEDITION_OVERLAY_JS: &str = include_str!("../ui/js/expedition-overlay.js");
const LEVELING_OVERLAY_HTML: &str = include_str!("../ui/leveling-overlay.html");
const LEVELING_OVERLAY_CSS: &str = include_str!("../ui/css/leveling-overlay.css");
const LEVELING_OVERLAY_JS: &str = include_str!("../ui/js/leveling-overlay.js");
const LEVELING_TAB_JS: &str = include_str!("../ui/js/leveling-tab.js");
const LEVELING_DATA_JS: &str = include_str!("../ui/js/leveling-data.js");

// ─── Routes ──────────────────────────────────────────────────────────────────

pub fn build_app(runtime: SharedRuntime) -> Router {
    let _ = get_api_token();
    Router::new()
        .route("/", get(serve_dashboard))
        .route("/dashboard", get(serve_dashboard))
        .route("/trade-overlay", get(serve_trade_overlay))
        .route("/expedition-overlay", get(serve_expedition_overlay))
        .route("/leveling-overlay", get(serve_leveling_overlay))
        .route(
            "/static/theme.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    THEME_CSS,
                )
            }),
        )
        .route(
            "/static/components.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    COMPONENTS_CSS,
                )
            }),
        )
        .route(
            "/static/layout.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    LAYOUT_CSS,
                )
            }),
        )
        .route(
            "/static/overview.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    OVERVIEW_CSS,
                )
            }),
        )
        .route(
            "/static/core.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    CORE_JS,
                )
            }),
        )
        .route(
            "/static/overview.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    OVERVIEW_JS,
                )
            }),
        )
        .route(
            "/static/client_mgr.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    CLIENT_MGR_JS,
                )
            }),
        )
        .route(
            "/static/smoother.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    SMOOTHER_JS,
                )
            }),
        )
        .route(
            "/static/controller.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    CONTROLLER_JS,
                )
            }),
        )
        .route(
            "/static/physical-controllers.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    PHYSICAL_CONTROLLERS_JS,
                )
            }),
        )
        .route(
            "/static/calibration.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    CALIBRATION_JS,
                )
            }),
        )
        .route(
            "/static/trade.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    TRADE_JS,
                )
            }),
        )
        .route(
            "/static/trade-overlay.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    TRADE_OVERLAY_CSS,
                )
            }),
        )
        .route(
            "/static/trade-overlay.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    TRADE_OVERLAY_JS,
                )
            }),
        )
        .route(
            "/static/fonts/basteleur-bold.woff",
            get(|| async {
                (
                    [
                        (header::CONTENT_TYPE, "font/woff"),
                        (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
                    ],
                    BASTELEUR_BOLD_WOFF,
                )
            }),
        )
        .route(
            "/static/fonts/basteleur-moonlight.woff",
            get(|| async {
                (
                    [
                        (header::CONTENT_TYPE, "font/woff"),
                        (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
                    ],
                    BASTELEUR_MOONLIGHT_WOFF,
                )
            }),
        )
        .route(
            "/static/expedition.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    EXPEDITION_JS,
                )
            }),
        )
        .route(
            "/static/expedition-overlay.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    EXPEDITION_OVERLAY_CSS,
                )
            }),
        )
        .route(
            "/static/expedition-overlay.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    EXPEDITION_OVERLAY_JS,
                )
            }),
        )
        .route(
            "/static/leveling-overlay.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    LEVELING_OVERLAY_CSS,
                )
            }),
        )
        .route(
            "/static/leveling-overlay.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    LEVELING_OVERLAY_JS,
                )
            }),
        )
        .route(
            "/static/leveling-tab.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    LEVELING_TAB_JS,
                )
            }),
        )
        .route(
            "/static/leveling-data.js",
            get(|| async {
                (
                    [(
                        header::CONTENT_TYPE,
                        "application/javascript; charset=utf-8",
                    )],
                    LEVELING_DATA_JS,
                )
            }),
        )
        .route("/api/leveling/current-zone", get(get_leveling_current_zone))
        .route("/api/leveling/visibility", get(get_leveling_visibility))
        .route("/api/leveling/toggle", post(post_leveling_toggle))
        .route(
            "/api/leveling/set-visibility",
            post(post_leveling_set_visibility),
        )
        .route("/api/state", get(get_state))
        .route("/api/trade/latest", get(get_latest_trade_capture))
        .route("/api/trade/leagues", get(get_trade_leagues))
        .route("/api/trade/search", post(post_trade_search))
        .route("/api/expedition/latest", get(get_expedition_latest))
        .route("/api/expedition/dismiss", post(post_expedition_dismiss))
        .route("/api/command", post(post_command))
        .route("/api/client-log", post(post_client_log))
        .route("/api/credentials", post(post_credentials))
        .route("/api/login-calibration", post(post_login_calibration))
        .route("/api/standalone-login", post(post_standalone_login))
        .route(
            "/api/standalone-login/cancel",
            post(cancel_standalone_login),
        )
        .layer(DefaultBodyLimit::max(32768))
        .layer(middleware::from_fn(local_request_guard))
        .with_state(runtime)
}

async fn local_request_guard(request: Request, next: Next) -> Response {
    let request_id = request_id_from_headers(request.headers());
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let started = Instant::now();
    let headers = request.headers();
    let valid_host = |host: &str| matches!(host, "127.0.0.1:8766" | "localhost:8766");
    let invalid_origin = headers
        .get(header::HOST)
        .is_some_and(|h| h.to_str().map(|h| !valid_host(h)).unwrap_or(true))
        || headers.get(header::ORIGIN).is_some_and(|h| {
            !matches!(
                h.to_str(),
                Ok("http://127.0.0.1:8766" | "http://localhost:8766")
            )
        })
        || headers
            .get("sec-fetch-site")
            .is_some_and(|h| h == "cross-site");

    let mut response = if invalid_origin {
        (StatusCode::FORBIDDEN, "Local origin required").into_response()
    } else {
        // Authenticate BEFORE deserializing request bodies (including malformed secrets).
        let is_safe_leveling_get = method == axum::http::Method::GET
            && (path == "/api/leveling/current-zone" || path == "/api/leveling/visibility");
        if path.starts_with("/api/") && !is_safe_leveling_get && !is_authorized(headers) {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"Missing or invalid API token"})),
            )
                .into_response()
        } else {
            REQUEST_ID
                .scope(request_id.clone(), next.run(request))
                .await
        }
    };
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        warn!(
            target: "poevh_overlay::http",
            request_id = %request_id,
            method = %method,
            path = %path,
            status = status.as_u16(),
            duration_ms = started.elapsed().as_millis() as u64,
            "HTTP request failed"
        );
    } else if path == "/api/command"
        || (path.starts_with("/api/") && method != axum::http::Method::GET)
    {
        info!(
            target: "poevh_overlay::http",
            request_id = %request_id,
            method = %method,
            path = %path,
            status = status.as_u16(),
            duration_ms = started.elapsed().as_millis() as u64,
            "HTTP request completed"
        );
    } else {
        debug!(
            target: "poevh_overlay::http",
            request_id = %request_id,
            method = %method,
            path = %path,
            status = status.as_u16(),
            duration_ms = started.elapsed().as_millis() as u64,
            "HTTP request completed"
        );
    }
    if let Ok(value) = axum::http::HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("x-request-id", value);
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    response
        .headers_mut()
        .insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
}

pub async fn start_server(runtime: SharedRuntime) -> anyhow::Result<()> {
    let app = build_app(runtime);

    let addr = "127.0.0.1:8766";
    info!("POE2 Bot overlay: http://{addr} (Token auth enforced, CORS restricted)");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ─── Handlers ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CredentialPayload {
    instance_id: u32,
    action: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    password: String,
}
impl Drop for CredentialPayload {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.email.zeroize();
        self.password.zeroize();
    }
}

async fn post_credentials(
    State(runtime): State<SharedRuntime>,
    body: axum::body::Bytes,
) -> Response {
    use poe2_types::InstanceUpdateError as IE;
    // Never return serde's parse errors: they may contain submitted values.
    let mut payload: CredentialPayload = match serde_json::from_slice(&body) {
        Ok(payload) => payload,
        Err(_) => return instance_error(IE::Invalid("Invalid credential request")),
    };
    if poe2_world::login::is_active() {
        return instance_error(IE::Conflict("Login in progress"));
    }
    let credentials = match payload.action.as_str() {
        "save" => match poe2_world::credentials::Credentials::new(
            std::mem::take(&mut payload.email),
            std::mem::take(&mut payload.password),
        ) {
            Ok(value) => Some(value),
            Err(_) => return instance_error(IE::Invalid("Invalid email or password format")),
        },
        "delete" if payload.email.is_empty() && payload.password.is_empty() => None,
        _ => return instance_error(IE::Invalid("Use save or delete")),
    };
    let result = tokio::task::spawn_blocking(move || {
        let mut rt = runtime.lock();
        if poe2_world::login::is_active() {
            return Err(IE::Conflict("Login in progress"));
        }
        match credentials {
            Some(value) => rt.save_credentials(payload.instance_id, &value)?,
            None => rt.clear_credentials(payload.instance_id)?,
        }
        Ok(rt.to_api_snapshot())
    })
    .await;
    match result {
        Ok(Ok(snapshot)) => (StatusCode::OK, Json(snapshot)).into_response(),
        Ok(Err(error)) => instance_error(error),
        Err(_) => instance_error(IE::Unavailable("Credential worker failed".into())),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginPayload {
    instance_id: u32,
    launch: bool,
    confirmed: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CalibrationPayload {
    instance_id: u32,
    confirmed: bool,
    calibration: Option<poe2_types::LoginCalibration>,
}

async fn post_login_calibration(
    State(runtime): State<SharedRuntime>,
    Json(payload): Json<CalibrationPayload>,
) -> Response {
    use poe2_types::InstanceUpdateError as IE;
    if !payload.confirmed {
        return instance_error(IE::Invalid("Confirm game-client-area calibration first"));
    }
    if !AUTO_LOGIN_AVAILABLE {
        return instance_error(IE::Unavailable(
            "Standalone auto-login đang tạm thời bị vô hiệu hóa; hãy đăng nhập thủ công".into(),
        ));
    }
    let result = tokio::task::spawn_blocking(move || {
        let _guard =
            poe2_world::login::automation_guard().ok_or(IE::Conflict("Login is active"))?;
        let mut rt = runtime.lock();
        rt.save_login_calibration(payload.instance_id, payload.calibration)?;
        Ok::<_, IE>(rt.to_api_snapshot())
    })
    .await;
    match result {
        Ok(Ok(snapshot)) => (StatusCode::OK, Json(snapshot)).into_response(),
        Ok(Err(error)) => instance_error(error),
        Err(_) => instance_error(IE::Unavailable("Calibration save failed".into())),
    }
}

async fn cancel_standalone_login() -> Response {
    if !AUTO_LOGIN_AVAILABLE {
        return instance_error(poe2_types::InstanceUpdateError::Unavailable(
            "Standalone auto-login đang tạm thời bị vô hiệu hóa".into(),
        ));
    }
    poe2_world::login::cancel();
    (StatusCode::ACCEPTED,Json(json!({"status":"cancellation_requested","detail":"Input already sent cannot be undone"}))).into_response()
}

async fn post_standalone_login(
    State(runtime): State<SharedRuntime>,
    Json(payload): Json<LoginPayload>,
) -> Response {
    use poe2_types::InstanceUpdateError as IE;
    if !payload.confirmed {
        return instance_error(IE::Invalid("Explicit user confirmation required"));
    }
    if !AUTO_LOGIN_AVAILABLE {
        return instance_error(IE::Unavailable(
            "Standalone auto-login đang tạm thời bị vô hiệu hóa; hãy đăng nhập thủ công".into(),
        ));
    }
    // The worker owns both reservations. A disconnected browser must not trigger retries.
    let result = tokio::task::spawn_blocking(move || {
        let session = poe2_world::login::LoginSession::begin().map_err(|_|IE::Conflict("Another login or input macro is active"))?;
        let (profile, existing) = {
            let mut rt = runtime.lock();
            let existing = rt.bound_identity(payload.instance_id).ok();
            if !payload.launch && existing.is_none() { return Err(IE::Conflict("Bind the running Standalone process first")); }
            let profile = rt.reserve_login(payload.instance_id)?;
            (profile,existing)
        };
        let reservation = LaunchReservation {runtime:Arc::clone(&runtime),instance_id:payload.instance_id};
        let outcome = (|| -> anyhow::Result<()> {
            let credentials = poe2_world::credentials::read(profile.credential_ref.as_deref().ok_or_else(||anyhow::anyhow!("Credentials missing"))?)?
                .ok_or_else(||anyhow::anyhow!("Saved credentials were removed; save them again"))?;
            let identity = if let Some(existing) = existing {
                existing
            } else {
                let mut child = poe2_world::launcher::spawn_configured_instance(&profile)?;
                let pid = child.id();
                // Inspect only the PID we launched. Never guess another/newest game PID.
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
                let process = loop {
                    anyhow::ensure!(!poe2_world::login::is_cancelled(),"Login cancelled by user");
                    anyhow::ensure!(child.try_wait()?.is_none(),"Launched process exited; bind the correct PID manually");
                    match poe2_world::instances::inspect_game_process(pid) {
                        Ok(process) if process.window.is_some() => break process,
                        Ok(_) => {},
                        Err(_) => anyhow::bail!("Launched process exited or cannot be verified; bind the correct PID manually"),
                    }
                    anyhow::ensure!(std::time::Instant::now() < deadline,"Game window not ready after 60 seconds; bind and retry manually");
                    std::thread::sleep(std::time::Duration::from_millis(500));
                };
                let inventory=poe2_world::instances::discover_game_processes().map_err(|e|e.to_string());
                let mut rt=runtime.lock();
                rt.update_instance_inventory(inventory);
                rt.cmd_bind_instance(payload.instance_id,process.identity.clone()).map_err(|_|anyhow::anyhow!("Failed to bind launched process"))?;
                process.identity
            };
            poe2_world::instances::operate_window(&identity,"focus")?;
            // Let old bounded pad workers finish and the main loop neutralize controllers.
            std::thread::sleep(std::time::Duration::from_secs(3));
            #[cfg(windows)]
            poe2_world::login::native::submit(&identity,&credentials,&session,profile.login_calibration.as_ref())?;
            #[cfg(not(windows))]
            anyhow::bail!("Standalone login requires Windows");
            Ok(())
        })();
        let mut rt=runtime.lock();
        match &outcome {
            Ok(()) => rt.set_login_status(payload.instance_id,"submitted_unverified"),
            Err(_) => rt.set_login_status(payload.instance_id,"needs_attention_no_retry"),
        }
        let snapshot=rt.to_api_snapshot();
        drop(rt); drop(reservation); drop(session);
        outcome.map_err(|e|IE::Unavailable(e.to_string()))?;
        Ok(snapshot)
    }).await;
    match result {
        Ok(Ok(snapshot)) => (StatusCode::OK, Json(snapshot)).into_response(),
        Ok(Err(error)) => instance_error(error),
        Err(_) => instance_error(IE::Unavailable(
            "Login worker stopped; check game manually before retrying".into(),
        )),
    }
}

fn is_authorized(headers: &HeaderMap) -> bool {
    let expected = get_api_token();
    if let Some(token) = headers.get("x-api-token").and_then(|v| v.to_str().ok()) {
        if token == expected {
            return true;
        }
    }
    if let Some(auth) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if auth
            .strip_prefix("Bearer ")
            .map(|t| t == expected)
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

async fn serve_dashboard() -> impl IntoResponse {
    let token = get_api_token();
    let injected = format!("<script>window.__API_TOKEN__ = \"{token}\";</script>\n");
    let html = DASHBOARD_HTML.replace("<head>", &format!("<head>\n    {injected}"));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(html)
        .unwrap()
}

async fn serve_trade_overlay() -> impl IntoResponse {
    let token = get_api_token();
    let injected = format!("<script>window.__API_TOKEN__ = \"{token}\";</script>\n");
    let html = TRADE_OVERLAY_HTML.replace("<head>", &format!("<head>\n    {injected}"));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(html)
        .unwrap()
}

async fn serve_expedition_overlay() -> impl IntoResponse {
    let token = get_api_token();
    let injected = format!("<script>window.__API_TOKEN__ = \"{token}\";</script>\n");
    let html = EXPEDITION_OVERLAY_HTML.replace("<head>", &format!("<head>\n    {injected}"));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(html)
        .unwrap()
}

async fn serve_leveling_overlay() -> impl IntoResponse {
    let token = get_api_token();
    let injected = format!("<script>window.__API_TOKEN__ = \"{token}\";</script>\n");
    let html = LEVELING_OVERLAY_HTML.replace("<head>", &format!("<head>\n    {injected}"));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(html)
        .unwrap()
}

async fn get_leveling_current_zone() -> impl IntoResponse {
    let zone = poe2_world::get_last_logged_zone();
    (StatusCode::OK, Json(json!({ "zone": zone }))).into_response()
}

async fn get_leveling_visibility() -> impl IntoResponse {
    let visible = poe2_world::is_leveling_overlay_visible();
    (StatusCode::OK, Json(json!({ "visible": visible }))).into_response()
}

async fn post_leveling_toggle() -> impl IntoResponse {
    let visible = poe2_world::toggle_leveling_overlay_visible();
    (StatusCode::OK, Json(json!({ "visible": visible }))).into_response()
}

#[derive(serde::Deserialize)]
struct SetLevelingVisibilityPayload {
    visible: bool,
}

async fn post_leveling_set_visibility(
    Json(payload): Json<SetLevelingVisibilityPayload>,
) -> impl IntoResponse {
    poe2_world::set_leveling_overlay_visible(payload.visible);
    (StatusCode::OK, Json(json!({ "visible": payload.visible }))).into_response()
}

async fn get_latest_trade_capture() -> impl IntoResponse {
    (StatusCode::OK, Json(poe2_world::latest_capture()))
}

async fn get_trade_leagues() -> Response {
    match tokio::task::spawn_blocking(poe2_world::list_leagues).await {
        Ok(Ok(leagues)) => (StatusCode::OK, Json(json!({"leagues": leagues}))).into_response(),
        Ok(Err(error)) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": error.to_string()})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"League worker stopped unexpectedly"})),
        )
            .into_response(),
    }
}

async fn post_trade_search(
    State(runtime): State<SharedRuntime>,
    Json(input): Json<poe2_types::TradeSearchInput>,
) -> Response {
    let result = tokio::task::spawn_blocking(move || poe2_world::search_market(input)).await;
    match result {
        Ok(Ok(result)) => {
            runtime.lock().push_event(
                "TRADE",
                "MARKET_SEARCH",
                &format!(
                    "GGG Trade2: {} kết quả cho {}",
                    result.total,
                    result.item.display_title()
                ),
                true,
            );
            (StatusCode::OK, Json(json!(result))).into_response()
        }
        Ok(Err(error)) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("{error:#}")})),
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Trade worker stopped unexpectedly"})),
        )
            .into_response(),
    }
}

async fn get_state(State(runtime): State<SharedRuntime>, headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized: Missing or invalid API token" })),
        )
            .into_response();
    }
    let snap = runtime.lock().to_api_snapshot();
    (StatusCode::OK, Json(snap)).into_response()
}

async fn get_expedition_latest(headers: HeaderMap) -> impl IntoResponse {
    if !is_authorized(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response();
    }
    (
        StatusCode::OK,
        Json(poe2_world::latest_expedition_snapshot()),
    )
        .into_response()
}

#[derive(Deserialize)]
struct ExpeditionDismissPayload {
    session_id: String,
}

async fn post_expedition_dismiss(
    headers: HeaderMap,
    Json(payload): Json<ExpeditionDismissPayload>,
) -> impl IntoResponse {
    if !is_authorized(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response();
    }
    if payload.session_id.trim().is_empty() || payload.session_id.len() > 128 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Invalid session_id"})),
        )
            .into_response();
    }
    poe2_world::dismiss_session(payload.session_id);
    (StatusCode::OK, Json(json!({"success":true}))).into_response()
}

#[derive(Deserialize)]
struct CommandPayload {
    command: String,
    #[serde(default)]
    instance_id: Option<u32>,
    /// New runtime API: choose a persistent account, then create a
    /// process-lifetime instance from it. `instance_id` remains accepted for
    /// old dashboards during migration.
    #[serde(default)]
    account_profile_id: Option<u32>,
    #[serde(default)]
    is_main: Option<bool>,
    #[serde(default)]
    black_screen: Option<bool>,
    #[serde(default)]
    bg_fps: Option<u32>,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    button: Option<String>,
    #[serde(default)]
    dx: Option<f32>,
    #[serde(default)]
    dy: Option<f32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClientLogPayload {
    level: String,
    message: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    line: Option<u32>,
    #[serde(default)]
    column: Option<u32>,
    #[serde(default)]
    stack: String,
    #[serde(default)]
    client_request_id: String,
}

async fn post_client_log(Json(payload): Json<ClientLogPayload>) -> impl IntoResponse {
    let level = match payload.level.as_str() {
        "error" => tracing::Level::ERROR,
        "warn" => tracing::Level::WARN,
        "info" => tracing::Level::INFO,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"Invalid log level"})),
            )
                .into_response()
        }
    };
    if payload.message.trim().is_empty() || payload.message.len() > 4096 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"Invalid client log message"})),
        )
            .into_response();
    }
    let request_id = current_request_id().unwrap_or_else(new_request_id);
    let source = payload.source.chars().take(512).collect::<String>();
    let stack = payload.stack.chars().take(6000).collect::<String>();
    // Client logs intentionally exclude raw form values and API tokens. The
    // source location, stack and request id are enough to correlate a UI fault
    // with the corresponding backend request in the session log.
    match level {
        tracing::Level::ERROR => tracing::error!(
            target: "poevh_overlay::client",
            request_id = %request_id,
            client_request_id = %payload.client_request_id,
            source = %source,
            line = ?payload.line,
            column = ?payload.column,
            message = %payload.message,
            stack = %stack,
            "browser error"
        ),
        tracing::Level::WARN => tracing::warn!(
            target: "poevh_overlay::client",
            request_id = %request_id,
            client_request_id = %payload.client_request_id,
            source = %source,
            line = ?payload.line,
            column = ?payload.column,
            message = %payload.message,
            stack = %stack,
            "browser warning"
        ),
        _ => tracing::info!(
            target: "poevh_overlay::client",
            request_id = %request_id,
            client_request_id = %payload.client_request_id,
            source = %source,
            line = ?payload.line,
            column = ?payload.column,
            message = %payload.message,
            stack = %stack,
            "browser log"
        ),
    }
    // 204 carries no body; the request id is returned in X-Request-Id by the
    // request guard.
    StatusCode::NO_CONTENT.into_response()
}

fn api_error(status: StatusCode, message: impl Into<String>) -> Response {
    let message = message.into();
    let request_id = current_request_id();
    warn!(
        target: "poevh_overlay::command",
        request_id = request_id.as_deref().unwrap_or("unknown"),
        status = status.as_u16(),
        error = %message,
        "command rejected"
    );
    let mut body = json!({"error": message});
    if let Some(request_id) = request_id {
        body["request_id"] = json!(request_id);
    }
    (status, Json(body)).into_response()
}

fn instance_error(error: poe2_types::InstanceUpdateError) -> Response {
    use poe2_types::InstanceUpdateError::*;
    match error {
        NotFound => api_error(StatusCode::NOT_FOUND, "Instance ID not found"),
        Invalid(message) => api_error(StatusCode::BAD_REQUEST, message),
        Conflict(message) => api_error(StatusCode::CONFLICT, message),
        Unsupported(message) => api_error(StatusCode::NOT_IMPLEMENTED, message),
        Unavailable(message) => api_error(StatusCode::SERVICE_UNAVAILABLE, message),
    }
}

async fn post_command(
    State(runtime): State<SharedRuntime>,
    headers: HeaderMap,
    Json(payload): Json<CommandPayload>,
) -> impl IntoResponse {
    if !is_authorized(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Unauthorized: Missing or invalid API token" })),
        )
            .into_response();
    }
    let request_id = current_request_id().unwrap_or_else(new_request_id);
    info!(
        target: "poevh_overlay::command",
        request_id = %request_id,
        command = %payload.command,
        instance_id = ?payload.instance_id,
        account_profile_id = ?payload.account_profile_id,
        key = ?payload.key,
        target = ?payload.target,
        button = ?payload.button,
        value = %json_shape(&payload.value),
        "command received"
    );
    if poe2_world::login::is_active() {
        return instance_error(poe2_types::InstanceUpdateError::Conflict(
            "Login in progress; other commands are paused",
        ));
    }
    // Never let an old dashboard write a shared INI while claiming instance isolation.
    if matches!(payload.command.as_str(), "toggle" | "set_param")
        && payload
            .key
            .as_deref()
            .is_some_and(|key| key.starts_with("smoother_"))
    {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Platform/global graphics commands retired. Use update_instance for preferences; graphics are not applied.",
        );
    }
    use poe2_types::InstanceUpdateError as IE;
    if matches!(payload.command.as_str(), "toggle" | "set_param")
        && payload
            .key
            .as_deref()
            .is_some_and(|key| key.starts_with("client"))
    {
        return instance_error(IE::Invalid(
            "Legacy client configuration keys retired; use instance commands",
        ));
    }
    // OS work runs off the async executor and outside the runtime/tick mutex.
    if payload.command == "scan_instances" || payload.command == "bind_instance" {
        let binding = if payload.command == "bind_instance" {
            let Some(id) = payload.instance_id else {
                return instance_error(IE::Invalid("instance_id is required"));
            };
            let identity = match serde_json::from_value::<poe2_types::ProcessIdentity>(
                payload.value.clone(),
            ) {
                Ok(identity) => identity,
                Err(_) => {
                    return instance_error(IE::Invalid(
                        "Full process identity is required; scan first",
                    ))
                }
            };
            Some((id, identity))
        } else {
            None
        };
        let result = tokio::task::spawn_blocking(poe2_world::instances::discover_game_processes)
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r.map_err(|e| e.to_string()));
        let mut rt = runtime.lock();
        rt.update_instance_inventory(result.clone());
        if let Err(e) = result {
            return instance_error(IE::Unavailable(e));
        }
        if let Some((id, identity)) = binding {
            if let Err(e) = rt.cmd_bind_instance(id, identity) {
                return instance_error(e);
            }
        }
        return (StatusCode::OK, Json(rt.to_api_snapshot())).into_response();
    }
    if payload.command == "instance_window" {
        let Some(id) = payload.instance_id else {
            return instance_error(IE::Invalid("instance_id is required"));
        };
        let action = match payload.value.as_str() {
            Some("focus") => "focus",
            Some("minimize") => "minimize",
            Some("restore") => "restore",
            Some("cloak") => "cloak",
            Some("uncloak") => "uncloak",
            _ => {
                return instance_error(IE::Invalid(
                    "Window action must be focus, minimize, restore, cloak or uncloak",
                ))
            }
        };
        let identity = match runtime.lock().bound_identity(id) {
            Ok(identity) => identity,
            Err(e) => return instance_error(e),
        };
        let result = tokio::task::spawn_blocking(move || {
            poe2_world::instances::operate_window(&identity, action)
        })
        .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return instance_error(IE::Unavailable(e.to_string())),
            Err(e) => return instance_error(IE::Unavailable(e.to_string())),
        }
        return (StatusCode::OK, Json(runtime.lock().to_api_snapshot())).into_response();
    }
    if payload.command == "get_smoother_info" {
        let config_path = poe2_world::smoother::find_default_config_path();
        let has_backup = config_path
            .as_ref()
            .map(|p| p.with_extension("ini.bak").is_file())
            .unwrap_or(false);
        let game_path = poe2_world::find_poe2_executable().map(|p| p.to_string_lossy().to_string());
        return (
            StatusCode::OK,
            Json(json!({
                "config_found": config_path.is_some(),
                "config_path": config_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                "game_path": game_path,
                "has_backup": has_backup,
            })),
        )
            .into_response();
    }
    if payload.command == "get_ggpk_status" {
        let game_path = payload
            .value
            .get("game_path")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let status = poe2_world::get_patch_status(game_path);
        return (StatusCode::OK, Json(json!({ "status": status }))).into_response();
    }
    if payload.command == "probe_ggpk_compatibility" {
        let game_path = payload
            .value
            .get("game_path")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        return match tokio::task::spawn_blocking(move || {
            poe2_world::probe_ggpk_compatibility(&game_path)
        })
        .await
        {
            Ok(Ok(report)) => (StatusCode::OK, Json(json!({ "report": report }))).into_response(),
            Ok(Err(error)) => instance_error(IE::Unavailable(error.to_string())),
            Err(error) => instance_error(IE::Unavailable(format!(
                "GGPK compatibility worker bị dừng: {error}"
            ))),
        };
    }
    if payload.command == "trade_parse_item" {
        let raw_text = payload
            .value
            .get("raw_text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        match poe2_world::parse_poe2_item(raw_text) {
            Ok(item) => {
                let mut rt = runtime.lock();
                rt.push_event(
                    "TRADE",
                    "ITEM_PARSED",
                    &format!("Đã phân tích vật phẩm: {}", item.display_title()),
                    true,
                );
                return (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "item": item,
                        "raw_text": raw_text
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                return instance_error(IE::Unavailable(e.to_string()));
            }
        }
    }
    if payload.command == "update_expedition" {
        let config =
            match serde_json::from_value::<poe2_types::ExpeditionConfig>(payload.value.clone()) {
                Ok(config) => config,
                Err(e) => {
                    return api_error(
                        StatusCode::BAD_REQUEST,
                        format!("Invalid Expedition config: {e}"),
                    )
                }
            };
        let mut rt = runtime.lock();
        rt.cmd_update_expedition(config);
        return (StatusCode::OK, Json(rt.to_api_snapshot())).into_response();
    }
    if payload.command == "trade_check_clipboard" {
        match poe2_world::read_clipboard_text().and_then(|raw_text| {
            poe2_world::parse_poe2_item(&raw_text).map(|item| (raw_text, item))
        }) {
            Ok((raw_text, item)) => {
                let mut rt = runtime.lock();
                rt.push_event(
                    "TRADE",
                    "CLIPBOARD_CHECKED",
                    &format!("Đã đọc item từ Clipboard: {}", item.display_title()),
                    true,
                );
                return (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "item": item,
                        "raw_text": raw_text
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                return instance_error(IE::Unavailable(format!("Lỗi đọc Clipboard: {e}")));
            }
        }
    }
    if payload.command == "apply_ggpk_patch" {
        let opts: poe2_world::GgpkPatchOptions =
            serde_json::from_value(payload.value.clone()).unwrap_or_default();
        let patch_result =
            tokio::task::spawn_blocking(move || poe2_world::apply_ggpk_patches(&opts)).await;
        match patch_result {
            Err(e) => {
                return instance_error(IE::Unavailable(format!(
                    "GGPK worker bị dừng bất thường: {e}"
                )))
            }
            Ok(Err(e)) => {
                return instance_error(IE::Unavailable(format!("Lỗi áp dụng patch: {e}")))
            }
            Ok(Ok(status)) => {
                let mut rt = runtime.lock();
                rt.push_event(
                    "GGPK",
                    "PATCH_APPLIED",
                    &format!("Đã áp dụng patch: {:?}", status.patched_features),
                    true,
                );
                return (
                    StatusCode::OK,
                    Json(json!({ "success": true, "status": status })),
                )
                    .into_response();
            }
        }
    }
    if payload.command == "restore_ggpk_patch" {
        let game_path = payload
            .value
            .get("game_path")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        match poe2_world::ggpk_patcher::resolve_game_targets(game_path) {
            Ok((game_dir, _)) => {
                let restore_result =
                    tokio::task::spawn_blocking(move || poe2_world::restore_all_backups(&game_dir))
                        .await;
                match restore_result {
                    Ok(Ok(count)) => {
                        let mut rt = runtime.lock();
                        rt.push_event(
                            "GGPK",
                            "PATCH_RESTORED",
                            &format!("Đã khôi phục {count} file từ bản sao lưu"),
                            true,
                        );
                        return (
                            StatusCode::OK,
                            Json(json!({ "success": true, "restored_count": count })),
                        )
                            .into_response();
                    }
                    Ok(Err(e)) => {
                        return instance_error(IE::Unavailable(format!(
                            "Lỗi khôi phục backup: {e}"
                        )))
                    }
                    Err(e) => {
                        return instance_error(IE::Unavailable(format!(
                            "GGPK restore worker bị dừng bất thường: {e}"
                        )))
                    }
                }
            }
            Err(e) => {
                return instance_error(IE::Unavailable(format!("Không tìm thấy thư mục game: {e}")))
            }
        }
    }
    if payload.command == "apply_smoother_ini" {
        let bg_fps = payload
            .value
            .get("bg_fps")
            .and_then(|v| v.as_u64())
            .unwrap_or(15) as u32;
        let fg_fps = payload
            .value
            .get("fg_fps")
            .and_then(|v| v.as_u64())
            .unwrap_or(60) as u32;
        let low_spec = payload
            .value
            .get("low_spec")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let config_path = match poe2_world::smoother::find_default_config_path() {
            Some(p) => p,
            None => {
                return instance_error(IE::Unavailable(
                    "Không tìm thấy file cấu hình PoE2 (poe2_production_Config.ini)".into(),
                ))
            }
        };

        let _ = poe2_world::smoother::backup_config(&config_path);
        if let Err(e) = poe2_world::smoother::apply_fps_limits(&config_path, bg_fps, fg_fps) {
            return instance_error(IE::Unavailable(format!("Lỗi ghi giới hạn FPS: {e}")));
        }
        if low_spec {
            if let Err(e) = poe2_world::smoother::apply_low_spec_policy(&config_path) {
                return instance_error(IE::Unavailable(format!(
                    "Lỗi áp dụng cấu hình Low-Spec: {e}"
                )));
            }
        }
        let mut rt = runtime.lock();
        rt.push_event(
            "SMOOTHER",
            "INI_OPTIMIZED",
            &format!("Đã tối ưu cấu hình PoE2: Nền {bg_fps} FPS, Trước {fg_fps} FPS, Low-Spec: {low_spec}"),
            true,
        );
        let snap = rt.to_api_snapshot();
        return (StatusCode::OK, Json(json!({
            "success": true,
            "message": format!("Đã tối ưu cấu hình game thành công! Nền {} FPS, Trước {} FPS", bg_fps, fg_fps),
            "config_path": config_path.to_string_lossy(),
            "snapshot": snap,
        }))).into_response();
    }
    if payload.command == "restore_smoother_ini" {
        let config_path = match poe2_world::smoother::find_default_config_path() {
            Some(p) => p,
            None => {
                return instance_error(IE::Unavailable("Không tìm thấy file cấu hình PoE2".into()))
            }
        };
        if let Err(e) = poe2_world::smoother::restore_config(&config_path) {
            return instance_error(IE::Unavailable(format!("Lỗi khôi phục cấu hình: {e}")));
        }
        let mut rt = runtime.lock();
        rt.push_event(
            "SMOOTHER",
            "INI_RESTORED",
            "Đã khôi phục file cấu hình PoE2 gốc từ .bak",
            true,
        );
        let snap = rt.to_api_snapshot();
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "Đã khôi phục file cấu hình gốc thành công!",
                "config_path": config_path.to_string_lossy(),
                "snapshot": snap,
            })),
        )
            .into_response();
    }
    if payload.command == "tune_instance_smoother" {
        let Some(id) = payload.instance_id else {
            return instance_error(IE::Invalid("instance_id is required"));
        };
        let (binding, profile) = {
            let rt = runtime.lock();
            let binding = rt.bound_identity(id).ok();
            let profile = rt
                .to_api_snapshot()
                .settings
                .multi_client
                .clients
                .into_iter()
                .find(|c| c.id == id);
            (binding, profile)
        };
        let Some(profile) = profile else {
            return instance_error(IE::NotFound);
        };
        let mut details = Vec::new();
        if let Some(ref identity) = binding {
            if let Err(error) = poe2_world::smoother::apply_process_tuning(
                identity.pid,
                profile.black_screen,
                profile.black_screen,
            ) {
                return instance_error(IE::Unavailable(error.to_string()));
            }
            details.push(format!(
                "PID {}: Priority & EcoQoS = {}",
                identity.pid,
                if profile.black_screen {
                    "Tiết kiệm"
                } else {
                    "Bình thường"
                }
            ));

            let action = if profile.black_screen {
                "cloak"
            } else {
                "uncloak"
            };
            if let Err(error) = poe2_world::instances::operate_window(identity, action) {
                return instance_error(IE::Unavailable(format!(
                    "Window operation failed for PID {}: {error}",
                    identity.pid
                )));
            }
            details.push(format!(
                "Cửa sổ: {}",
                if profile.black_screen {
                    "Màn đen (DWM Cloaked)"
                } else {
                    "Hiện bình thường"
                }
            ));
        } else {
            details.push("Chưa gắn PID - cấu hình sẽ tự áp dụng khi process mở".to_string());
        }

        if profile.bg_fps > 0 {
            if let Some(config_path) = poe2_world::smoother::find_default_config_path() {
                let _ = poe2_world::smoother::backup_config(&config_path);
                let _ = poe2_world::smoother::apply_fps_limits(&config_path, profile.bg_fps, 60);
                details.push(format!("Ghi INI: Nền {} FPS", profile.bg_fps));
            }
        }
        let msg = format!("Instance #{id} đã áp dụng: {}", details.join(" · "));
        let mut rt = runtime.lock();
        rt.push_event("SMOOTHER", "INSTANCE_TUNED", &msg, true);
        let snap = rt.to_api_snapshot();
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": msg,
                "instance_id": id,
                "black_screen": profile.black_screen,
                "bg_fps": profile.bg_fps,
                "snapshot": snap,
            })),
        )
            .into_response();
    }
    if payload.command == "launch_instance" {
        let account_id = payload.account_profile_id.or(payload.instance_id);
        let Some(account_id) = account_id else {
            return instance_error(IE::Invalid("account_profile_id is required"));
        };
        let (id, profile, needs_virtual_controllers) = {
            let mut rt = runtime.lock();
            let id = match rt.ensure_runtime_instance(
                account_id,
                payload.is_main,
                payload.black_screen,
                payload.bg_fps,
            ) {
                Ok(id) => id,
                Err(e) => return instance_error(e),
            };
            let profile = match rt.begin_instance_launch(id) {
                Ok(profile) => profile,
                Err(e) => {
                    rt.finish_instance_launch(id);
                    return instance_error(e);
                }
            };
            let needs_virtual_controllers = rt.instance_needs_virtual_controllers(id);
            (id, profile, needs_virtual_controllers)
        };
        let pre_hook = runtime.lock().pre_launch_hook();
        let reservation = LaunchReservation {
            runtime: Arc::clone(&runtime),
            instance_id: id,
        };
        let result = tokio::task::spawn_blocking(move || {
            if let Some(ref hook) = pre_hook {
                if let Err(e) = hook(id, needs_virtual_controllers) {
                    return Err(anyhow::anyhow!(
                        "Lỗi khởi tạo controller cho instance {id}: {e}"
                    ));
                }
            }
            let pid = poe2_world::launcher::launch_configured_instance(&profile)?;
            let inventory = poe2_world::instances::discover_game_processes();
            let mut rt = reservation.runtime.lock();
            match inventory {
                Ok(processes) => {
                    let identity = processes
                        .iter()
                        .find(|p| p.identity.pid == pid)
                        .map(|p| p.identity.clone());
                    rt.update_instance_inventory(Ok(processes));
                    if let Some(identity) = identity {
                        let _ = rt.cmd_bind_instance(id, identity);
                    }
                }
                Err(e) => {
                    rt.update_instance_inventory(Err(e.to_string()));
                }
            };
            rt.push_event(
                "INSTANCE",
                "PROCESS_STARTED",
                &format!("Instance {id}: PID {pid} đã mở và gắn thành công"),
                true,
            );
            let snapshot = rt.to_api_snapshot();
            drop(rt);
            drop(reservation);
            Ok::<_, anyhow::Error>(snapshot)
        })
        .await;
        return match result {
            Ok(Ok(snapshot)) => (StatusCode::OK, Json(snapshot)).into_response(),
            Ok(Err(e)) => instance_error(IE::Unavailable(e.to_string())),
            Err(e) => instance_error(IE::Unavailable(e.to_string())),
        };
    }
    if payload.command == "apply_poe_smoother" {
        // Persist desired state under the runtime lock, then release it before any
        // file-system or Win32 work.  The tick loop must never wait on DWM/process
        // APIs just because the dashboard applied graphics settings.
        let (cfg, statuses) = {
            let mut rt = runtime.lock();
            let cfg = match serde_json::from_value::<poe2_types::PoeSmootherConfig>(
                payload.value.clone(),
            ) {
                Ok(cfg) => {
                    rt.cmd_update_poe_smoother(cfg.clone());
                    cfg
                }
                Err(_) => {
                    return instance_error(IE::Invalid("Invalid PoeSmoother configuration"));
                }
            };
            (cfg, rt.instance_statuses())
        };

        let worker_cfg = cfg.clone();
        let apply_result = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            if let Some(path) = poe2_world::smoother::find_default_config_path() {
                poe2_world::smoother::backup_config(&path)?;
                poe2_world::smoother::apply_poe_smoother_policy(&path, &worker_cfg)?;
            }
            // Apply to every follower even when one of them fails, then report
            // the failures together; a single inaccessible PID must not leave
            // the remaining clients untuned.
            let mut failures = Vec::new();
            for status in statuses {
                if status.is_main || status.status != "bound" {
                    continue;
                }
                let Some(process) = status.process else {
                    continue;
                };
                let pid = process.identity.pid;
                if let Err(error) = poe2_world::smoother::apply_process_tuning(
                    pid,
                    worker_cfg.black_screen || worker_cfg.high_performance,
                    worker_cfg.black_screen || worker_cfg.high_performance,
                ) {
                    failures.push(format!("PID {pid}: {error}"));
                }
                if let Some(window) = process.window {
                    let cloak_result = window
                        .handle
                        .parse::<usize>()
                        .map_err(|error| anyhow::anyhow!("invalid HWND {}: {error}", window.handle))
                        .and_then(|hwnd| {
                            poe2_world::smoother::apply_window_cloaking(
                                hwnd,
                                worker_cfg.black_screen,
                            )
                        });
                    if let Err(error) = cloak_result {
                        failures.push(format!("PID {pid} window: {error}"));
                    }
                }
            }
            if failures.is_empty() {
                Ok(())
            } else {
                Err(anyhow::anyhow!(
                    "config applied, but process tuning failed for: {}",
                    failures.join("; ")
                ))
            }
        })
        .await;

        let mut rt = runtime.lock();
        match apply_result {
            Ok(Ok(())) => rt.push_event(
                "SYSTEM",
                "APPLY_POE_SMOOTHER",
                "PoeSmoother 2 settings applied to game",
                true,
            ),
            Ok(Err(error)) => {
                rt.push_event(
                    "SYSTEM",
                    "APPLY_POE_SMOOTHER_FAILED",
                    &error.to_string(),
                    true,
                );
                return instance_error(IE::Unavailable(error.to_string()));
            }
            Err(error) => {
                rt.push_event(
                    "SYSTEM",
                    "APPLY_POE_SMOOTHER_FAILED",
                    &format!("smoother worker stopped: {error}"),
                    true,
                );
                return instance_error(IE::Unavailable(format!(
                    "smoother worker stopped: {error}"
                )));
            }
        }
        return (StatusCode::OK, Json(rt.to_api_snapshot())).into_response();
    }
    let mut rt = runtime.lock();
    if poe2_world::login::is_active() {
        return instance_error(IE::Conflict("Login in progress; other commands are paused"));
    }
    match payload.command.as_str() {
        "add_instance" => {
            if let Err(e) = rt.cmd_add_instance() {
                return instance_error(e);
            }
        }
        "remove_instance" | "set_main_instance" | "unbind_instance" | "apply_instance_graphics" => {
            let Some(id) = payload.instance_id else {
                return instance_error(IE::Invalid("instance_id is required"));
            };
            let result = match payload.command.as_str() {
                "remove_instance" => rt.cmd_remove_instance(id),
                "set_main_instance" => rt.cmd_set_main_instance(id),
                "unbind_instance" => rt.cmd_unbind_instance(id),
                _ => Err(IE::Unsupported(
                    "No verified per-process graphics backend is installed; nothing applied",
                )),
            };
            if let Err(e) = result {
                return instance_error(e);
            }
        }
        "update_instance" => {
            let Some(id) = payload.instance_id else {
                return api_error(StatusCode::BAD_REQUEST, "instance_id is required");
            };
            let patch = match serde_json::from_value::<poe2_types::InstancePatch>(payload.value) {
                Ok(patch) => patch,
                Err(_) => return api_error(StatusCode::BAD_REQUEST, "Invalid instance patch"),
            };
            if let Err(error) = rt.cmd_update_instance(id, patch) {
                return instance_error(error);
            }
        }
        "run" => {
            let v = payload.value.as_bool().unwrap_or(true);
            rt.cmd_run(v);
        }
        "move" => {
            let dx = payload.dx.unwrap_or(0.0);
            let dy = payload.dy.unwrap_or(0.0);
            rt.cmd_move(dx, dy);
        }
        "toggle" => {
            if let Some(key) = &payload.key {
                let v = payload.value.as_bool().unwrap_or(false);
                if let Err(error) = rt.cmd_toggle(key, v) {
                    return instance_error(error);
                }
            } else {
                return instance_error(IE::Invalid("toggle key is required"));
            }
        }
        "join_p2" => {
            rt.cmd_join_p2();
        }
        "press_button" => {
            let target = payload.target.as_deref().unwrap_or("P2");
            let button = payload.button.as_deref().unwrap_or("A");
            rt.cmd_pulse_pad(target, button);
        }
        "test_stick" => {
            let target = payload.target.as_deref().unwrap_or("P2");
            let dx = payload.dx.unwrap_or(0.0);
            let dy = payload.dy.unwrap_or(0.0);
            rt.cmd_test_stick(target, dx, dy);
        }
        "set_param" => {
            if let (Some(key), Some(v)) = (&payload.key, payload.value.as_f64()) {
                if let Err(error) = rt.cmd_set_param(key, v as f32) {
                    return instance_error(error);
                }
            } else {
                return instance_error(IE::Invalid("numeric key and value are required"));
            }
        }
        "set_mouse_action" => {
            if let (Some(button), Some(action)) = (&payload.key, payload.value.as_str()) {
                if let Err(error) = rt.cmd_set_mouse_action_checked(button, action) {
                    return instance_error(error);
                }
            } else {
                return instance_error(IE::Invalid("mouse button and action are required"));
            }
        }
        "set_controller_key" => {
            if let (Some(button), Some(key)) = (&payload.key, payload.value.as_str()) {
                if let Err(error) = rt.cmd_set_controller_key_checked(button, key) {
                    return instance_error(error);
                }
            } else {
                return instance_error(IE::Invalid("controller button and key are required"));
            }
        }
        "update_poe_smoother" => {
            let cfg = match serde_json::from_value::<poe2_types::PoeSmootherConfig>(
                payload.value.clone(),
            ) {
                Ok(cfg) => cfg,
                Err(_) => {
                    return instance_error(IE::Invalid("Invalid PoeSmoother configuration"));
                }
            };
            rt.cmd_update_poe_smoother(cfg);
        }
        "update_waystone_colors" => {
            let cfg = match serde_json::from_value::<poe2_types::WaystoneColorConfig>(
                payload.value.clone(),
            ) {
                Ok(cfg) => cfg,
                Err(_) => {
                    return instance_error(IE::Invalid("Invalid Waystone color configuration"));
                }
            };
            rt.cmd_update_waystone_colors(cfg);
        }
        "set_smoother_zoom" => {
            let Some(scale) = payload.value.as_f64() else {
                return instance_error(IE::Invalid("zoom scale is required"));
            };
            if !scale.is_finite() || !(1.0..=3.0).contains(&scale) {
                return instance_error(IE::Invalid("zoom scale must be between 1 and 3"));
            }
            rt.cmd_set_smoother_zoom(scale as f32);
        }
        "toggle_client_bot" => {
            let Some(id) = payload.instance_id else {
                return instance_error(IE::Invalid("instance_id is required"));
            };
            // Controller ownership belongs to launch/inventory reconciliation.
            // A pause/resume command must be a pure runtime-state transition;
            // reconnecting pads here can reorder XInput slots and eject players.
            if let Err(error) = rt.cmd_toggle_client_bot_checked(id) {
                return instance_error(error);
            }
        }
        "request_party_invite" => {
            let Some(id) = payload.instance_id else {
                return instance_error(IE::Invalid("instance_id is required"));
            };
            if let Err(error) = rt.cmd_request_party_invite(id) {
                return instance_error(error);
            }
        }
        "reset_tracker" => {
            rt.cmd_reset_tracker();
        }
        "launch_clients" => {
            return instance_error(IE::Invalid(
                "Use launch_instance with an explicit instance_id",
            ))
        }
        "stash" => rt.cmd_trigger_stash_sweep(),
        "broadcast_a" => rt.cmd_broadcast_interact_a(),
        "set_focus" => {
            let slot = payload.value.as_u64().unwrap_or(0) as u8;
            rt.cmd_set_focus_slot(slot);
        }
        "spawn_loot" => rt.cmd_spawn_loot(),
        "spawn_threat" => rt.cmd_spawn_threat(),
        "reset" => rt.cmd_reset(),
        _unknown => return instance_error(IE::Invalid("unknown command")),
    }
    let snap = rt.to_api_snapshot();
    (StatusCode::OK, Json(snap)).into_response()
}
