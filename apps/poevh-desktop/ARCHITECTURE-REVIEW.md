# POE2 MultiPilot — Software Architecture & Debug Review

Review scope: `D:\code\poe2-bot`
Review date: 2026-09-02
Method: static review, dependency/reference tracing, build/test baseline, feature
path mapping (`UI -> API -> runtime -> adapter/output`). The executable was not
launched because it installs a global keyboard hook and attempts live process
attachment automatically.

## Executive verdict

**Current maturity: prototype/demo, not production-ready. Do not distribute the
current executable as a completed product.**

The workspace compiles, but the pasted description substantially overstates its
capabilities:

- `cargo test --workspace --all-targets` passes with **0 tests** across every
  crate.
- `cargo fmt --check` fails across the source tree.
- strict `cargo clippy --workspace --all-targets -- -D warnings` fails with at
  least 12 errors before reaching the whole workspace.
- the root manifest contains no `[profile.release]`, so the claimed strip/LTO
  settings do not exist.
- the binary is not zero-dependency: WebView2 and the ViGEmBus driver are runtime
  requirements.
- many dashboard features only change a Boolean/config value; they have no
  service or executor behind them.
- several real integration paths are unsafe or internally inconsistent.

The modular Cargo workspace is a reasonable starting shape, but the crate names
currently imply stronger separation than the code actually provides.

## Highest-priority findings

### P0 — Local HTTP API can expose credentials and accept commands from arbitrary origins

Evidence:

- `ClientAccountProfile` stores `email` and `password` as ordinary serializable
  strings (`poe2-types/src/lib.rs:356-369`).
- `ApiSnapshot` serializes the entire `BotSettings` tree
  (`poe2-engine/src/runtime.rs:318-355`).
- the server enables `CorsLayer` with any origin, method and header
  (`poe2-overlay/src/server.rs:26-38`).
- the desktop process requests administrator privileges
  (`poe2-bot/app.manifest:11-17`).

Impact: a browser origin able to reach loopback could read state and issue
commands to an elevated process. If credentials are ever populated, `/api/state`
would serialize them.

Required correction:

1. Never put credentials in domain state or API DTOs.
2. Use Windows Credential Manager/DPAPI behind a `CredentialVault` port; expose
   only `has_credentials: bool` to UI.
3. Remove wildcard CORS. The embedded same-origin dashboard needs no CORS.
4. Add a per-launch unguessable API token or use WebView IPC instead of HTTP.
5. Remove administrator elevation unless a narrowly documented operation truly
   needs it; isolate that operation into a short-lived privileged helper.

### P0 — Stored XSS in the desktop WebView event feed

Evidence: `dashboard.html:1437-1447` inserts event actor/action/detail through
`innerHTML`. Those strings can originate from command payload fields such as
`target` and `button` (`server.rs:105-114`).

Impact: crafted data can execute markup/script in the app WebView, which is much
more serious when the host is elevated.

Required correction: build DOM nodes and assign `textContent`; never interpolate
runtime strings into `innerHTML`. Validate command enums server-side.

### P0 — Global keyboard capture is armed without a foreground/process safety gate

Evidence: `kbm_bridge.rs:68-103` installs `WH_KEYBOARD_LL` globally. Dispatching
at `kbm_bridge.rs:107-255` checks only a global enabled flag, not whether the
target game/window is foreground, connected, or in a safe state.

Impact: typing in another application can move/activate virtual controllers.
The app also maps plain `G` to broadcast-A globally.

Additional defect: the dashboard toggle does not actually update the hook's
`HOOK_ENABLED`. `start_worker` copies the value once (`kbm_bridge.rs:72-73`), while
the main loop later updates a different `Arc<AtomicBool>` (`main.rs:151-152`).

Required correction: explicit armed-state state machine, foreground HWND allow
list, connection health gate, key-state reset and controller neutralization on
disable/focus loss/shutdown.

### P0 — Product claims do not match executable behavior

Examples:

- `cmd_launch_clients()` only writes success-looking events; it never starts a
  process (`runtime.rs:191-203`).
- it announces six pads and a full party even when no pad/client operation was
  attempted or verified.
- client telemetry CPU/RAM/FPS values are hard-coded (`poe2-world/src/lib.rs:67-98`).
- system CPU/RAM/GPU/latency in the dashboard are hard-coded
  (`dashboard.html:1419-1423`).
- the game-path “save” button only shows `alert('Đã lưu đường dẫn game!')`
  (`dashboard.html:1024-1025`).

Required correction: represent capability as `Unavailable`, `Configured`,
`Starting`, `Ready`, `Degraded`, or `Failed`. UI must not report success before
receiving verified output from an executor.

## Feature-by-feature debug matrix

| Feature | Status | Evidence / root cause |
| --- | --- | --- |
| Smart Follow | Partial prototype | Pure distance state machine exists, but it mutates observed positions as if movement already happened (`engine.rs:48-85`). On live frames this mixes prediction with observation and can neutralize output early. |
| Stop/Catch-up | Partial | `stop_distance` and `catch_up_distance` are used. `prioritize_catchup`, `classic_roll_sprint`, and `mirror_attack_dir` are UI/config-only. |
| Warp | Mock/unsafe assumption | Engine teleports the follower state to leader immediately, before any external confirmation (`engine.rs:50-62`). Event logs `area_match` after overwriting the area, so it always reports true. |
| Loot gate | Defective | Auto-pickup happens inside each follower loop before the party-wide catch-up gate is committed. A near follower may pick while another follower is sprinting. `prioritize_catchup` is ignored. |
| Auto Pickup | Mostly simulated | Live memory adapter never populates loot; classification is substring matching on item names. `currency_tier`, allocation ownership, shards, exceptional bases, auto-run and vacuum settings have no decision implementation. |
| Currency Tracker | Demo only | Hard-coded Divine conversion rates; no price service or persistence. Session time assumes five ticks equal one second (`engine.rs:30-36`) even though tick interval is configurable. |
| Smart Flask | Partial and timing-broken | HP/mana thresholds and cooldowns exist. Waste/recoverable/reserved-mana flags are unused. Button press can be overwritten immediately by `ActionMapper`, making pulse duration unreliable (`main.rs:160-175`). Errors are discarded. |
| Party Combat | Config only | No combat engine. Dashboard toggles `party_combat.enabled`; `settings.combat` is a separate unused flag. |
| Auto Stash | Config only | Only `stash.enabled` mutation exists; no planner/executor/state machine. |
| Auto Party | Config only | Only `party.enabled` mutation exists. “launch/full party” actions are event text only. |
| Waystone Crafting | Config only | No executor. Master UI key `waystones_enabled` is not recognized by `cmd_toggle`, yet API still returns success. |
| Shared Controls | Config only | `sync_dodge`, direction sharing and approach delay are stored but never consumed. |
| Timed Actions | Config only | Two flags can be toggled; no scheduler reads cooldowns or emits actions. |
| Core Smoother | Config only | Black screen, FPS, particles, sound and zoom values have no process/renderer executor. UI labels client numbers as Steam/Standalone/Epic configuration buckets, which is not a stable client identity model. |
| Multi-client Manager | UI/event mock | No process launcher, window manager, profile persistence, login workflow or readiness verification. Connector finds only the first matching process. |
| Client detection | Partial | Detects the first matching executable and parses limited log strings. It cannot model three simultaneous clients. All three telemetry cards mirror a single connection. |
| Virtual controllers | Partial | ViGEm target creation exists, but missing targets and update failures can silently return success. Several broadcasts discard errors. |
| Focus switch | Broken | `cmd_set_focus_slot` queues `{target:"FOCUS", button:"<slot>"}`, but the worker matches on `button`; therefore the `"FOCUS"` branch cannot be reached (`runtime.rs:302-309`, `main.rs:88-109`). |
| Couch join | Behavior mismatch | UI queues P1 and P2, but worker holds each sequentially for 2.5 seconds. It does not hold all pads simultaneously as the event claims, and blocks the entire decision/input loop for about five seconds. |
| KBM bridge | Unsafe partial | Real global hook, no safe lifecycle, foreground gate or reliable runtime toggle. Focus switch state and held-key state are global process statics. |
| HTTP/dashboard | Functional demo with security defects | Basic GET/POST works; wildcard CORS, no auth, XSS sink, silent browser errors, untyped string commands and fake telemetry prevent production use. |
| Desktop lifecycle | Incomplete | Server startup races WebView navigation. Worker/hotkey threads have no cancellation or join; controller neutralization on exit is not guaranteed. |
| Memory adapter | Experimental skeleton | Automatically attaches on startup, uses unverified/static offsets and approximate scan size. No freshness timestamp, build compatibility gate, schema validation or fail-closed runtime state. |

## Core correctness defects

### Tick interval changes do not take effect

`main.rs:76` reads `tick_ms` once before the infinite loop. The API can later
change `state.config.tick_ms`, but the worker never reads it again. Setting it to
zero is accepted and could create a hot loop on the next restart/config load.

Use a validated `Duration` newtype and a Tokio interval/watch channel. Do not
cast arbitrary `f32` API values directly to integer fields.

### Command validation is absent

`cmd_toggle` and `cmd_set_param` silently return for unknown keys, while the HTTP
handler responds `200 OK`. Numeric values are not range-checked. Target and
button are arbitrary strings.

Replace string switches with tagged enums:

```text
Command
  Run { enabled }
  SetFollowPolicy { stop_distance, catch_up_distance }
  SetFeature { feature, enabled }
  Pulse { player_id, control, duration }
```

Each command should return `Result<CommandReceipt, CommandError>` and include a
correlation ID and resulting state revision.

### Action output is not edge/pulse safe

`press_button` sends a report with a button held. Release timing is spread across
the main loop, flask controller, keyboard worker and broadcast threads. Some
paths never schedule an explicit release. `ManualControl` emits no neutral
report, so the previous virtual state may remain active.

The correct abstraction is one `ActionSink` owning the complete current report
per pad and a non-blocking pulse scheduler. Every transition to stopped,
disconnected, stale or manual state must atomically neutralize affected pads.

### Observation and prediction are mixed

The memory adapter reads a position, `FollowEngine` mutates it via
`move_toward`, then the mapper calculates input from the already-predicted
position. Domain decisions should never overwrite observed coordinates.

Use immutable `WorldFrame` input and produce `Vec<ActionIntent>` output. A
separate optional predictor can estimate movement, but the next authoritative
frame must come from the source adapter.

### Snapshot has hidden I/O side effects

`WorldAdapter::snapshot(&self)` polls processes and reads logs in the mock
adapter. API reads and event creation therefore trigger external I/O and return
different states depending on who asks for a snapshot.

Split this into:

- `WorldFrameSource::poll(&mut self) -> Result<WorldFrame>`
- `StateStore::current(&self) -> Arc<AppSnapshot>`
- `ActionSink::submit(Vec<ActionIntent>)`

## Memory/process integration review

This component should be treated as unsupported/experimental until independently
validated. Specific engineering concerns:

- `ProcessHandle::read<T>` accepts any `Copy + Default`, although byte-wise
  overwrite is only valid for plain-data types.
- snapshot handles can leak on early error paths.
- process matching uses substring matching, which can select an unintended
  process.
- scanner excludes the last legal match position in a chunk and assumes a
  fixed 64 MB scan range rather than reading PE section boundaries.
- a failed signature scan falls back to a static offset without verifying game
  build compatibility.
- entity-list structure, component hashes and offsets have no fixtures or
  recorded-frame tests.
- failed reads return old state indefinitely with no timestamp. The engine can
  continue acting on stale data.

For safety and maintainability, compile this adapter behind an explicit Cargo
feature, disable it by default, and require a supported-build manifest plus
freshness fail-closed policy. This review does not validate or endorse live game
integration.

## Architecture assessment

### What is good

- Cargo workspace and domain crate provide an understandable starting layout.
- `WorldAdapter` shows the correct instinct toward dependency inversion.
- serializable state and an embedded dashboard make mock/replay testing possible.
- the event ring buffer is bounded.
- the executable binds HTTP to loopback rather than all interfaces.

### What prevents scale-up

1. `poe2-types` is a “god schema”: domain, UI configuration, credentials,
   telemetry, runtime state and infrastructure DTOs are mixed together.
2. `WorldAdapter` combines observation, mutation, demo commands, connector
   polling and persistence.
3. features are Boolean fields rather than independently owned state machines.
4. commands and player/button identities are stringly typed.
5. one global mutable runtime lock serializes API, polling and decisions.
6. blocking sleeps are used inside the sole action/decision worker.
7. no config schema version, migration layer, persistence service or secret
   boundary exists.
8. no tests, CI, release checks, signed artifacts or supportability diagnostics
   exist.

## Recommended target architecture

```text
poe2-domain
  immutable WorldFrame, PlayerId, ClientId, FeatureState, ActionIntent

poe2-application
  SessionCoordinator, FollowPolicy, SafetyPolicy, command handlers

poe2-ports
  WorldFrameSource, ActionSink, ConfigStore, CredentialVault,
  ClientSupervisor, TelemetrySource, Clock

poe2-adapter-mock / poe2-adapter-replay
  deterministic fixtures and integration tests

poe2-adapter-windows (optional feature)
  process/window/controller implementations isolated from domain logic

poe2-api
  typed DTOs, validation, same-origin/session authorization, no secrets

poe2-desktop
  WebView lifecycle, startup readiness, graceful shutdown
```

Each feature should implement an explicit lifecycle:

```text
Disabled -> Configured -> Starting -> Ready -> Degraded -> Stopping -> Disabled
                                  \-> Failed
```

This prevents the UI from showing “enabled” when an executor is absent or has
failed.

## Required test strategy

### Unit tests

- geometry invariants, finite values and threshold ordering;
- follow decisions at exact stop/catch-up/warp boundaries;
- party-wide loot gate with mixed follower distances;
- stale-frame fail-closed behavior;
- flask threshold, cooldown and re-arm behavior using a fake clock;
- item classification using typed rarity/category/allocation, not names;
- command validation and config migration.

### Contract tests

- every `WorldFrameSource` must return monotonic revisions and timestamps;
- every `ActionSink` must neutralize on stop/disconnect/drop;
- API snapshots must never serialize secrets;
- unknown/out-of-range commands must return 4xx.

### Integration tests

- Axum router tested in-memory without binding a real port;
- replay fixtures drive the whole decision pipeline deterministically;
- desktop startup waits for server readiness;
- concurrent poll/command paths do not deadlock or lose state;
- shutdown cancels workers and neutralizes all outputs.

### Release gates

```powershell
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --release --locked
```

Add dependency/license audit, SBOM, binary signing and reproducible version
metadata before distribution.

## Prioritized remediation plan

### Milestone 0 — Stop unsafe distribution

- mark executable as prototype;
- remove admin requirement;
- remove credentials from serializable state;
- remove wildcard CORS and `innerHTML` event rendering;
- default live memory and global input integrations to off;
- hide/disable UI controls without a working executor.

### Milestone 1 — Establish a testable core

- split immutable frame input from action output;
- introduce typed IDs, commands and validated config newtypes;
- add a fake clock and deterministic replay adapter;
- create tests for follow, loot gate, tracker and lifecycle;
- make the project pass fmt/clippy/test in CI.

### Milestone 2 — Reliable runtime

- non-blocking action scheduler with cancellation and neutralization;
- freshness/safety supervisor;
- independent per-client state rather than mirroring one process;
- graceful startup/shutdown and health/readiness reporting;
- persistent versioned config and OS credential vault.

### Milestone 3 — Feature implementation

Implement each currently config-only feature behind its own service and feature
state. Do not expose its UI as “On” until the executor has integration tests and
observable readiness/error states.

## Final assessment

The project is useful as a UI/domain experiment, but it is not currently a
working, safe or scalable “full MultiPilot” implementation. The immediate work
is architecture, safety and truthful capability reporting—not adding more tabs
or more configuration fields.
