# POEVH monorepo import — 2026-09-09

## Source and destination

- Imported from `D:\code\poe2-bot`.
- Canonical monorepo location: `apps/poevh-desktop`.
- The source directory had no Git metadata, so there was no independent commit
  history to preserve.
- The original directory was retained as a local safety copy after verification.

## Deliberately excluded

- Rust `target/` build cache (approximately 35.5 GB).
- .NET `bin/`, `obj/` and published binaries.
- Executables, DLLs, PDBs, Python bytecode and fixture log output.
- Runtime settings, Windows Vault secrets and `%LOCALAPPDATA%` logs.

## Validation in the imported location

- Rust formatting check: passed.
- Rust workspace tests: 130 passed, 0 failed, 2 ignored live checks.
- Strict Rust clippy: passed with warnings denied.
- Existing web production build: passed.
- Existing web test baseline: 258 passed and 14 failed. The failures are in the
  pre-existing web application (shell/theme assertions, translation data, PoB
  conversion, asset-loading assertions and Build Planner assertions); no web
  application source was changed by the POEVH import.

## Root commands

```bash
npm run poevh:check
npm run poevh:test
npm run poevh:clippy
npm run poevh:build
```

See `apps/poevh-desktop/AUDIT-2026-09-09.md` for product-level findings that
still block live multi-client acceptance.
