# Phase 1 Test Plan

## Unit Tests

- CLI argument parsing accepts `--game-path`, `--pob-path`, `--output-dir`, and
  `--fixture`.
- Hashing produces stable row hashes for identical payloads.
- Mapper registry records mapper failures with table/entity context.
- Asset manifest rejects duplicate asset hashes with conflicting paths.

## Integration Tests

- Fixture extract imports raw rows into test PostgreSQL or a mocked importer.
- Fixture extract maps at least one item, skill, mod, stat, passive node, and
  asset relation.
- Re-running the same fixture reports unchanged rows.
- Mutating fixture data reports added, removed, and changed rows.

## Golden Tests

- Compare Phase 1 normalized output against PoB-generated files for a pinned
  fixture.
- Fail if counts or canonical hashes diverge for enabled domains.

## Local Manual Test

Run extractor against:

```powershell
npm run extract:game -- --game-path="C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2"
```

Expected result: one completed extract version, imported raw rows, normalized P0
entities, copied referenced assets, and a diff summary.

Run the direct GGPK PoB sweep against:

```powershell
npm run extract:ggpk-sweep -- --pob-path=scratch/PathOfBuilding-PoE2 --tools-dir=.codex_tmp/ooz/release --output-dir=data/game-extract/ggpk/pob-sweep --list-files=true
```

Expected result: a sweep manifest, direct/regex extract lists, GGPK file list,
and extracted PoB-scope files under ignored local data storage.

Run the full DATC64 catalog against already extracted GGPK data:

```powershell
npm run extract:ggpk-full -- --parse=true --file-list=data/game-extract/ggpk/pob-sweep/ggpk-file-list.log --output-dir=data/game-extract/ggpk/full-datc64 --pob-path=scratch/PathOfBuilding-PoE2
```

Expected result for the current local install:

- `full-datc64-manifest.json` lists 2,779 DATC64 candidates.
- `ggpk-file-inventory.json` reports 3,492,310 client files and writes asset
  bucket path lists under `asset-buckets/`.
- `catalog/catalog-manifest.json` raw-indexes all 2,779 DATC64 tables.
- `catalog/tables/` contains 740 semantically decoded table JSON files covering
  951,580 rows.
- `catalog/relationships.json` contains schema `ref_to` edges.
- `catalog/domain-coverage.json` summarizes parsed/raw/missing coverage by app
  domain.
- `catalog/schema-gaps.json` records missing schemas and parse failures that
  require app-owned schema overrides before the data is PoE2DB-like clean.

Run the GGPK-only normalizer/importer:

```powershell
npm run import:ggpk-full
```

Expected result for the current local install:

- A new or updated `game_extract_versions.source_kind = 'ggpk_full'` row.
- `game_dat_tables` contains 2,779 table metadata rows for the GGPK version.
- `game_entities` contains 81,246 normalized entities across tags, stats, item
  classes, item visuals, item bases, mods, passive nodes, active skills, granted
  effects, world areas, monster varieties, crafting recipes, and endgame maps.
- `game_entity_relations` contains 113,768 relations.
- `game_assets` contains 12,609 referenced assets, including image and video
  paths.
- `game_extractor_failures` contains schema-gap records instead of hiding
  missing decode coverage.
