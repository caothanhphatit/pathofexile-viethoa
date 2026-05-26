# POE2 Game Extractor Rust Core

This crate is Phase 2 of the extractor plan. It is intentionally isolated from
the current web app. The Node scripts still orchestrate output and PostgreSQL
imports, while this crate owns native DAT64 parsing logic.

Current scope:

- Parse DAT64 fixture bytes.
- Mirror PoB `Dat64File.lua` primitive layout for scalar and list values.
- Provide a stable contract that Node can replace module-by-module later.

When Rust is available locally, run:

```powershell
cd tools/game-extractor-rs
cargo test
```
