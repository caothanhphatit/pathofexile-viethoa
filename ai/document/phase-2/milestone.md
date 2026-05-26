# Phase 2 Milestones

## Milestone 2.1 - Rust DAT64 Reader

- Load converted table specs.
- Read primitive types, lists, refs, and strings.
- Produce canonical raw row JSON.
- Status: Node native harness implemented for fixture DAT64 parsing; Rust crate
  source added under `tools/game-extractor-rs`; `cargo test` passes for the
  fixture parser when the local Rust toolchain is on PATH. Local GGPK sweep
  output was also smoke-tested against real `baseitemtypes.datc64`.

## Milestone 2.2 - Native P0 Mappers

- Port base item mapper.
- Port currency/waystone mapper.
- Port skill gem mapper.
- Port mod/stat mapper.
- Status: PoB `spec.lua` converter implemented for Rust-readable JSON specs.
  Domain mapper replacement remains gated by golden parity tests.

## Milestone 2.3 - Performance Baseline

- Benchmark fixture import.
- Benchmark local GGPK import where available.
- Compare PoB-backed and Rust-native runtime.
- Status: fixture parse summary is available through `npm run extract:native`.
  Rust compilation is verified with the isolated crate test suite. A local
  Node-native parse smoke test read 196 of 212 swept `.datc64` files, covering
  250,431 rows; 16 row-size/spec failures remain for parity hardening.

## Exit Criteria

- Rust-native output matches PoB-backed output for enabled domains.
- Rust importer is faster or more memory-stable on large snapshots.
- PoB fallback remains available.
