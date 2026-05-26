# Phase 0 Process

## Purpose

Phase 0 creates the operating rules for the extractor before implementation.
This prevents the PoB/Lua/Rust hybrid from becoming tangled with the current app.

## Working Process

1. Keep extractor changes separate from current app runtime code.
2. Add or update machine-readable rules in `ai/coding_convention/` when an
   architectural decision becomes durable.
3. Document each implementation phase with `process.md`, `milestone.md`,
   `design.md`, and `test.md`.
4. Use PoB output as the reference when porting extraction logic.
5. Treat every game patch as a new extract version, not as an in-place update.
6. Record unresolved references and mapper failures instead of silently dropping
   data.

## Decision Order

1. Correctness against PoB/reference output.
2. Patch resilience and compare-ability.
3. Extract/import speed.
4. App-facing convenience.

## Deliverables

- Coding convention JSON files.
- Phase documentation.
- Roadmap and milestone gates.
