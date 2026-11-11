# POEVH Desktop

Windows desktop companion for Path of Exile 2, implemented as a Rust workspace
with a small .NET GGPK helper.

## Workspace

- `crates/poe2-bot`: application entry point and orchestration.
- `crates/poe2-types`: shared configuration and API types.
- `crates/poe2-engine`: follow, pickup and runtime decisions.
- `crates/poe2-memory`: version-gated read-only game telemetry and navigation.
- `crates/poe2-input`: ViGEm controller output and optional KBM bridge.
- `crates/poe2-world`: instance discovery, trade, expedition and smoother services.
- `crates/poe2-overlay`: local authenticated API, WebView UI and overlays.
- `tools/poevh-ggpk-patcher`: .NET helper used by the smoother integration.

## Premium

The dashboard has a **Premium** page (HỆ THỐNG › Premium) where the user pastes the key
from `poeviethoa.net/premium`. `poe2_world::premium` sends it with a device id to
`POST /api/premium/verify`, checks the returned Ed25519 licence token and keeps it in
`%LOCALAPPDATA%\POE2MultiPilot\premium.json`; a worker re-verifies before the token
expires (at most 7 days) and every 12 hours. Features gate on
`poe2_world::premium::is_active()`.

- The device id is a SHA-256 of the Windows `MachineGuid` (a random id when the
  registry is unreadable), so a reinstall keeps the same device binding.
- Pin the server public key at build time with `POEVH_PREMIUM_PUBLIC_KEY=<SPKI PEM>`
  (the key printed by `node scripts/premium-keygen.mjs`). Without it the app fetches
  `GET /api/premium/public-key` once over HTTPS and remembers it.
- `POEVH_PREMIUM_API=http://127.0.0.1:3000` at runtime points the app at a local server.
- Local dashboard API: `GET /api/premium/status`, `POST /api/premium/activate` `{key}`,
  `POST /api/premium/refresh`, `POST /api/premium/deactivate` (all need the dashboard token).
- **What premium unlocks:** every page in the FOLLOW BOT group. The overlay server answers
  `402` to Follow bot commands (`run` true, `toggle` except `kbm`, `set_param`, `move`, `stash`,
  `broadcast_a`, `set_focus`, party and client-bot commands) without a licence, the hotkey
  start is refused, and a running bot pauses on the next tick if the licence lapses. Stopping
  the bot and everything outside the group stay free. The dashboard greys those pages out
  with a lock and a button to the Premium page.
- **Buying:** the Premium page shows plans and payment details from the website's
  `GET /api/premium/offer` (set them with `PREMIUM_OFFER_JSON` on the server) and opens
  `/premium` in the default browser. Payment is still manual: an admin grants the plan.
- Debug builds only: `POEVH_PREMIUM_UNLOCK=1` unlocks gated features for development.
- `node tools/premium-mock-server.mjs` stands in for the website (one accepted key, one
  device) for trying the page without PostgreSQL;
  `cargo test -p poe2-world --test premium_mock_tests -- --ignored` runs the client against it.

## Verify

Run from the monorepo root:

```bash
npm run poevh:test
npm run poevh:clippy
```

Live memory and Trade2 tests are intentionally ignored by the default suite;
they require a compatible running game or external network service.

See [AUDIT-2026-09-09.md](AUDIT-2026-09-09.md) before treating automation as
production-ready.
