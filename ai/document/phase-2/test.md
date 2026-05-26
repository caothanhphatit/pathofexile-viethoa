# Phase 2 Test Plan

## Parser Tests

- Primitive values match known fixture bytes.
- Strings decode consistently.
- List and reference columns round-trip to canonical JSON.
- Unknown or changed specs produce actionable errors.
- Current coverage: `tests/game-extract-native.test.mjs` verifies string, int,
  bool, and string-list DAT64 fixture parsing through the native harness.

## Golden Diff Tests

- Base item Rust output equals PoB output.
- Skill gem Rust output equals PoB output for selected active and support gems.
- Mod/stat Rust output equals PoB output for representative mods.
- Current coverage: PoB `spec.lua` conversion is tested for `baseitemtypes`,
  `skillgems`, and `mods`. Full Rust mapper golden diff starts after native
  domain mappers are ported.

## Performance Tests

- Large table parsing uses bounded memory.
- Batch import throughput is measured.
- Parallel extraction preserves deterministic hashes.
- Current coverage: native fixture output includes a stable hash for repeated
  parser runs, and the Rust crate fixture parser compiles and passes tests.

## Regression Tests

- A mapper failure does not delete or corrupt raw rows.
- Rust-native disabled domains still use PoB-backed output.
- Current coverage: Phase 1 extractor tests continue to pass with the native
  module present.
