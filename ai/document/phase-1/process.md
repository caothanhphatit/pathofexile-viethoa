# Phase 1 Process

## Purpose

Phase 1 is P0 implementation: use PoB-PoE2 as upstream reference to extract
usable game data, store it in a new extractor schema, and produce compare-able
versions.

## Process

1. Pin a PoB upstream path or commit.
2. Check required extractor binaries are present.
3. Run PoB-backed extraction against local `Content.ggpk`.
4. Import raw table/spec/row data into PostgreSQL.
5. Import PoB-generated data where available for parity.
6. Normalize P0 entities: items, currency, waystones, skills, gems, mods, stats,
   passive tree, and referenced assets.
7. Build entity relationships.
8. Generate diff against previous extract version.
9. Export app-facing JSON only after raw and normalized import succeed.

## Failure Policy

- Raw import failure fails the run.
- Mapper failure marks the domain as failed but preserves raw snapshot.
- Asset extraction failure records unresolved asset rows and continues unless the
  asset is required for an exported payload.
