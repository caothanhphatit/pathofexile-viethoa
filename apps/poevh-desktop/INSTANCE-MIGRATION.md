# Instance profile migration — 2026-09-04

> The runtime split is now wired end-to-end. The legacy `clients` vector remains
> an internal/API compatibility view while account profiles and process-lifetime
> instances are exposed explicitly in the snapshot.

## Finding and scope

The old dashboard displayed Client 1/2/3 but sent `smoother_steam_*`,
`smoother_standalone_*`, and `smoother_epic_*`. FPS commands for all three wrote
the same default INI. Enable toggles used vector positions, and the launcher
reused the first executable it found for every enabled profile.

This change migrates **profile identity and configuration routing**, not the
game memory reader, controller-to-process routing, or rendering pipeline.

## Current contract

- `settings.multi_client.clients` remains the persisted compatibility container.
  `instance_services.account_profiles` is the redacted persistent account view;
  `instance_services.runtime_instances` contains only processes alive in the
  current app session.
- `flavor` is independent metadata: Steam, Standalone, EpicGames, or Unknown.
  Multiple profiles can use the same flavor and the same or different EXE paths.
- New fields default to Unknown / empty when reading older profiles. An ID does
  not imply a platform. Existing per-profile `black_screen` / `bg_fps` survive.
- `update_instance` requires authentication, an explicit ID, and a validated,
  whitelisted patch. Unknown IDs return 404; invalid/empty patches return 400;
  validation is atomic. Duplicate IDs are rejected rather than ambiguously edited.
- The legacy platform/global `smoother_*` commands return 400. Their shared-INI
  writes are removed from runtime command handlers. Other smoother utility
  functions remain in the world crate but are not called by this dashboard path.
- UI profiles/options are generated from IDs, not array positions. Polling does
  not overwrite unsaved profile edits. Errors are visible; profile text uses DOM
  text/value APIs, not HTML interpolation.
- Standalone launch routing uses only the executable saved on that profile.
  Empty/relative/wrong executable names are rejected. Steam/Epic launch manually
  through their launcher; they do not silently launch Standalone instead.
  A successful process spawn is not reported as a verified game connection.
- `launch_instance` accepts the new `account_profile_id`, `is_main`,
  `black_screen`, and `bg_fps` fields. `instance_id` is still accepted as an
  account-id alias for older dashboards.

Example authenticated request:

```json
{
  "command": "update_instance",
  "instance_id": 2,
  "value": {
    "flavor": "Standalone",
    "exe_path": "D:\\Games\\Path of Exile 2\\PathOfExile.exe",
    "black_screen": true,
    "bg_fps": 15
  }
}
```

`black_screen` and `bg_fps` above are **preferences only**, not proof of applied
graphics. Changing Instance 2 does not change Instance 3's profile, even when
both are Standalone. No game INI is written by that request.

## User workflow and remaining limits

1. Open **Quản Lý Instance**; choose Steam for the main profile if desired.
2. Choose Standalone and an explicit EXE path for each additional profile.
3. Click **Lưu profile trong phiên**. Steam/Epic are opened manually.
4. Graphics preferences, if edited, remain unapplied drafts.

Account profiles are persisted through `ProfileStore`; runtime instances are
deliberately never persisted. A process discovered outside the launcher is
auto-bound in deterministic start order, and its runtime record is removed when
the verified PID/start token disappears. Controller pairs are allocated and
released with that same runtime lifecycle.

The live reader remains single-process by design; this runtime refactor does not
claim multi-process memory reading. Profile-to-PID attachment, launch routing,
and per-runtime controller ownership are implemented and authenticated, while
game login remains a separate explicit workflow.
The mock adapter no longer fabricates connected states and CPU/RAM/FPS for all
profiles from one detected process. Its telemetry is explicitly unbound with
`metrics_available: false`; the dashboard displays `--` for unmeasured metrics.

Separate black-screen rendering / per-PID FPS control is **not implemented**.
Using Steam as main is a supported profile selection, not a guarantee that game
configuration files are isolated from another installation.

## Verification

- Reproduced the missing instance API before implementing it (regression failed
  with HTTP 400 where the new contract requires 200).
- `cargo test --workspace`: **all tests passed** (one live Trade2 test is ignored
  by design because it calls the external GGG endpoint).
- `cargo fmt --check --all`: passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: passed.
- `cargo build --release --locked`: passed.
- Headless Chromium UI test: same-platform profile isolation, reordered fixture
  IDs, dirty edits across polling, explicit command IDs, error feedback, page
  reload, safe label rendering, and graphics warnings all passed.
- The UI test uses a mock server; Rust tests separately exercise the real Axum
  router/runtime. These are not live-game / native WebView2 / controller tests.
- Tests did not launch a game or run the external sidecar. Existing smoother
  utility tests modify their temporary test INIs only.

Re-run UI verification on this machine:

```powershell
& 'C:/Users/caoth/AppData/Local/Programs/Python/Python313/python.exe' review-tools/run_dashboard_review.py
```

The local runner owns and closes its HTTP server directly, avoiding Windows
orphaned child processes from the generic shell-based server helper.
