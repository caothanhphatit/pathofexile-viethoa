# Phase 3 Design

## Generated Data Layer

Phase 3 adds generated outputs derived from raw and normalized data. These
outputs are optimized for web planner and calculator consumers, not for archival
storage.

The P0 implementation reads extractor snapshots and writes isolated web data
products. It does not couple the current app to local GGPK files or Rust-native
extractor internals.

## Parity Contract

Generated outputs must include source version, generation hash, and parity status
against PoB where a PoB equivalent exists.

## Manual Overrides

Manual overrides are allowed only as versioned data with source notes. They must
not be hidden inside code branches.

## Consumer Contract

Frontend and planner modules consume generated JSON/JS payloads. They must not
read raw DAT rows or local assets directly.

Current product files are:

- `planner.json`
- `items.json`
- `skills.json`
- `mods.json`
- `calculator-seeds.json`
- `manifest.json`
