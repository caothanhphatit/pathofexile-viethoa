# Instance services — implementation status, 2026-09-03

The subsequent experimental Standalone login implementation and its unverified
end-to-end limitations are documented in [STANDALONE-LOGIN.md](STANDALONE-LOGIN.md).
Descriptions below reflect the earlier instance-services release.

## Scope and completion boundary

Implemented persistent instance profiles and OS-level process management. This is
**not a complete per-instance game automation/rendering implementation**. Binding
a PID proves the identity of a Windows process, not successful reads of character
state, per-PID gamepad routing, automatic login, or renderer integration.

## Implemented

- Profiles survive app restart in `%LOCALAPPDATA%/POE2MultiPilot/profiles.json`.
  Schema version 1, bounded input size, validation, a last-good `.bak`, synced
  temporary writes and atomic replacement. An OS file lock prevents simultaneous
  writes and releases automatically after a crash. Corrupt/unknown-schema files
  are preserved and rejected. Failed writes do not commit changes in memory.
- Add/remove profiles, stable IDs with a persisted high-water mark, and main
  profile selection. Limit: 16 profiles; this does not increase the existing
  controller/game-character capacity. Removing the main profile requires choosing
  another main first. Reset resets the simulated world, not saved profiles.
- Enumerate supported executable-name candidates across Steam/Standalone/Epic.
  Show executable paths so users can verify the intended installation; names
  alone are not proof of game version/authenticity.
- Bind/unbind each profile independently using PID + creation-time token + EXE
  path. Duplicate assignment, mismatched platform/path, disabled profiles, and
  stale identities are rejected. Editing the platform/path or disabling a bound
  profile unbinds it. Renaming a profile preserves its binding.
- Bindings are never persisted or automatically restored after restart. PID reuse
  never silently attaches a different process. Exit/inaccessible/scan-error states
  are explicit. A background worker scans every two seconds outside the tick mutex.
- CPU is calculated from two process-time samples and normalized against logical
  processor count. RAM is the OS working set, not a synthetic constant. Missing
  data stays unknown. FPS remains unknown because no measurement backend exists.
- Focus and minimize requests target a freshly validated process and a window
  whose owner PID is checked. Windows may refuse focus; errors are returned.
  Minimize is not advertised as black-screen rendering or a guaranteed GPU saving.
- Standalone launch uses the profile's explicit executable. Duplicate in-progress
  launch requests are rejected. Discovery attempts to bind the launched PID if
  identity validation succeeds; otherwise the user must scan/bind explicitly.
  Steam/Epic remain manual launcher flows. Normal launch does not promise game
  readiness or that a particular game build permits simultaneous sessions.
- The new launch API does not invoke the old third-party mutex/probe sidecar.
  Legacy bulk launch and flavor/global graphics commands are rejected.
- UI supports the lifecycle above, process selection, validation/error feedback,
  persistent-store status, CPU/RAM readings and explicit unsupported graphics.
  Profile text uses safe DOM APIs; dirty edits survive normal polling.

## Important remaining work

1. **Per-process graphics:** no verified renderer backend exists in this source.
   `black_screen` and `bg_fps` are saved preferences only. `apply_instance_graphics`
   returns HTTP 501 and does not write any game INI. No black cover window is used
   as a substitute for actually reducing rendering work.
2. **Game data and input routing:** the legacy memory adapter / gamepad pipeline
   remains separate and single-source. `main_instance_id` selects the main profile
   in the instance manager; it does NOT switch that legacy memory reader or
   dispatch bot/gamepad actions into the selected PID. The UI states this limit.
   Multiple bound OS processes therefore do not establish working multi-game bots.
3. **Live game validation:** no installed game or third-party sidecar was launched
   during this implementation. In-game behavior, successful launch/login, native
   WebView2 interaction, and focus/minimize on a real game remain unverified.
4. **Operational limitations:** storage locks serialize writes, but do not merge
   independent stale edits made by separate application processes. Use one app
   process per profile store. No automatic recovery overwrites corrupt data; close
   the app and explicitly restore a reviewed backup if recovery is needed.

To finish the rendering work, a defined backend/API (or source) and live validation
are needed. To finish per-PID bot routing, the memory adapter/input pipeline needs
a separate integration and tests; it is not made functional merely by adding PID
fields to an API response.

## API additions

All commands below use the authenticated `/api/command` endpoint.

| Command | Required input | Effect |
| --- | --- | --- |
| `update_instance` | `instance_id`, whitelisted `value` patch | Validate and save profile |
| `add_instance` | none | Add a fresh stable profile ID |
| `remove_instance` | `instance_id` | Remove profile, not the game process |
| `set_main_instance` | `instance_id` | Select main profile, not a memory source |
| `scan_instances` | none | Refresh OS process catalog |
| `bind_instance` | `instance_id`, `value: {pid, started_at, exe_path}` | Bind an exact process identity |
| `unbind_instance` | `instance_id` | Forget binding; do not kill process |
| `instance_window` | `instance_id`, `value: "focus"` or `"minimize"` | Explicit OS window request |
| `launch_instance` | `instance_id` | Normal Standalone launch, no sidecar |
| `apply_instance_graphics` | `instance_id` | Unsupported (501), no game writes |

`/api/state.instance_services` reports store status, process candidates, exact
bindings, availability, metrics and graphics capability. The original
`settings.multi_client.clients` schema container remains for compatibility.

## Verification

- 39 Rust tests passed, including actual Windows process discovery and a full
  native-process → real Axum scan/bind/unbind → exit detection test.
- Native tests use renamed test-harness executables in dedicated temporary
  directories, not the installed game. Owned child processes and files are cleaned
  up by the tests. No third-party hooks or sidecars are executed.
- Registry tests cover two same-executable processes, duplicate assignment,
  PID reuse, platform/path mismatch, disable, scan failure and CPU sampling.
- Persistence tests cover reload/restart, reset preservation, monotonic IDs,
  invalid/future files, backups, writer-lock failures and memory rollback.
- Headless Chromium tests cover profile CRUD, same-platform isolation, PID
  selection/binding/conflicts, main selection, OS metrics presentation, page
  reload, XSS labels, dirty edits, error feedback and graphics disclaimers.
  Browser tests use a clearly defined HTTP fixture; Rust tests exercise the real
  API and native process paths separately.
- `cargo fmt --check --all`, strict workspace Clippy and release build verified.

Build environment: Rust 1.98 GNU toolchain with `C:/msys64/mingw64/bin` on PATH.
UI tests: `Python313/python.exe review-tools/run_dashboard_review.py`.

## API reference used

Process creation/CPU times use Windows `GetProcessTimes`; FILETIME values are
100-nanosecond counters. The creation token is serialized as a hexadecimal string
to avoid JavaScript integer precision loss. [Microsoft GetProcessTimes documentation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes).
