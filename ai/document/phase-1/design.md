# Phase 1 Design

## Data Flow

`Content.ggpk` -> PoB upstream adapter -> raw JSON/NDJSON -> PostgreSQL raw
store -> mapper registry -> normalized domain tables -> relationship graph ->
diff tables -> app-facing exports.

## Storage Shape

- Raw layer stores table specs, columns, row payloads, source ids, and hashes.
- GGPK raw-index layer stores every DATC64 file fingerprint even when semantic
  column schema is unavailable. This keeps update diffs complete while schema
  coverage improves incrementally.
- Domain layer stores granular item, skill, mod, stat, passive, and asset data.
- Relationship layer links entities to other entities and assets.
- Diff layer compares versions at raw row, entity, relation, and asset levels.

## Full GGPK Catalog Reports

- `ggpk-file-inventory.json` summarizes the whole client file list and writes
  bucket path lists for images, audio, stat descriptions, metadata templates,
  DAT tables, UI metadata, and shader cache.
- `catalog/raw-index/*.json` stores row count, row size, file hash, row-block
  hash, and a small hex sample for every DATC64 table.
- `catalog/tables/*.json` stores named row JSON only when a usable schema is
  available.
- `catalog/relationships.json` stores schema-level `ref_to` edges.
- `catalog/domain-coverage.json` maps parsed/raw/missing status into app
  domains such as items, skills, mods/stats, passive/atlas, maps/waystones, and
  crafting/currency.
- `catalog/schema-gaps.json` is the work queue for manual or generated schema
  overrides.

## PoB Role

PoB is an upstream adapter and correctness oracle. Its generated data is imported
for parity, but the app-owned schema and relationships are maintained by this
project.

## Rust Role

Rust is introduced as a CLI module for hashing, file IO, import speed, diffing,
and later native DAT parsing. In Phase 1, Rust should not replace PoB behavior
unless a golden diff proves parity for that module.
