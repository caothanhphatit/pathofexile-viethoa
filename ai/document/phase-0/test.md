# Phase 0 Test Plan

## Static Checks

- Parse every file in `ai/coding_convention/*.json`.
- Verify phase folders exist for `phase-0`, `phase-1`, `phase-2`, and `phase-3`.
- Verify each phase folder contains `process.md`, `milestone.md`, `design.md`,
  and `test.md`.

## Manual Review

- Confirm the rules keep extractor work separate from the current app.
- Confirm phase docs mention PoB upstream and Rust porting strategy.
- Confirm no rule depends on POE2DB as source of truth.

## Future Automation

Add a small Node test that validates `/ai` structure once implementation starts
touching extractor code regularly.
