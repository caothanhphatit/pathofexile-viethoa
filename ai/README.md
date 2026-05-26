# AI Project Control Plane

This folder defines the working rules for the POE2 game-data extractor module.
The extractor is developed in the same repository as the current app, but it is
architecturally separate from the existing web pages, crawlers, and exports.

## Module Boundary

- Current app: `public/`, `src/server/`, existing `scripts/crawl-*`, and current
  PostgreSQL content tables.
- Extractor module: future `tools/game-extractor-rs/`, PoB upstream adapter,
  extractor migrations, raw snapshots, normalized game data, relationships, and
  local extracted assets.
- Shared only by contract: PostgreSQL, generated export files, and docs.

## Source Strategy

The extractor treats `PathOfBuildingCommunity/PathOfBuilding-PoE2` as the
initial upstream reference for GGPK/DAT reading and generated data parity. Rust
owns long-term ingestion, hashing, diffing, asset copying, and high-volume DB
import. Lua/PoB logic is gradually ported module by module only after golden
diff tests prove parity.

## Phase Index

- `phase-0`: conventions, architecture rules, process, and testing standards.
- `phase-1`: P0 data foundation, PoB upstream adapter, DB schema, raw/diff data.
- `phase-2`: Rust native parser, domain mappers, and relationship enrichment.
- `phase-3`: PoB parity data layer, ModCache-style outputs, and web planner data.

## Coding Rules

Machine-readable rules live in `ai/coding_convention/*.json`. Human process docs
live in `ai/document/<phase>/`.
