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
