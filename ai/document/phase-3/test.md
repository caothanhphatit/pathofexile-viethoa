# Phase 3 Test Plan

## Data Product Tests

- Passive tree export contains classes, ascendancies, nodes, edges, and assets.
- Item export contains bases, requirements, properties, mods, and relations.
- Skill export contains gem levels, supports, stats, and descriptions.
- Mod export contains parsed stat lines and unresolved parser failures.
- Current coverage: `tests/game-extract-web.test.mjs` verifies planner, item,
  skill, mod, calculator, manifest, writer, and CLI outputs against the fixture
  extractor snapshot.

## Parity Tests

- Generated planner data matches PoB counts and known hashes for selected patch.
- ModCache-style output matches PoB output for enabled domains.
- Known special cases are listed with explicit status.
- Current coverage: generated products include per-product parity metadata,
  hashes, and explicit gap labels. Full PoB golden parity is intentionally still
  marked pending.

## Frontend Contract Tests

- App-facing exports load without local GGPK.
- Missing optional assets degrade gracefully.
- No frontend payload references absolute local filesystem paths.
- Current coverage: product serialization is checked for Windows absolute path
  leaks and generated output paths are written as app-facing JSON files.
