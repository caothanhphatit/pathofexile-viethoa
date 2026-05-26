# Phase 1 Milestones

## Milestone 1.1 - PoB Upstream Adapter

- Configure `POB_REPO_PATH`.
- Locate local game path and `Content.ggpk`.
- Run or wrap PoB exporter without requiring frontend interaction.
- Capture generated output and logs.
- Status: GGPK PoB sweep is wired through `npm run extract:ggpk-sweep`.
  It uses the `zao/ooz` `bun_extract_file` release to extract the same
  `.datc64`, `.it`, `.ot`, and `.csd` scope that PoB requests in
  `GGPKData.lua`.
- Status: full DATC64 extraction is wired through `npm run extract:ggpk-full`.
  The current local GGPK file list contains 2,779 `data/balance/*.datc64`
  tables, and all 2,779 were extracted to ignored local storage.
- Status: full DATC64 catalog now raw-indexes all 2,779 tables, semantically
  decodes 740 tables / 951,580 rows where PoB has usable schema, emits 2,568
  schema relationship edges, and writes explicit domain coverage plus schema-gap
  reports for the remaining 271 missing specs and 1,768 parse/schema failures.
- Status: full client inventory is generated from the GGPK file list. The
  current local install reports 3,492,310 client files, including 142,442 image
  assets, 40,065 audio assets, 176 video/cinematic-like paths, 502
  stat-description files, and 644,585 metadata template-like files as path
  buckets.
- Status: GGPK-only normalization/import is wired through
  `npm run import:ggpk-full`. It imports a `ggpk_full` extract version without
  using PoB as data source, covering 2,779 DAT table metadata rows, 81,246
  normalized entities, 113,768 relations, 12,609 referenced assets, and 2,039
  schema-gap failure records in Postgres.

## Milestone 1.2 - Extractor Schema

- Add extractor migrations separate from existing POE2DB-derived tables.
- Store extract versions, raw tables, columns, rows, entities, relations, assets,
  and diffs.
- Add indexes for version, entity type, source id, relation type, and asset hash.

## Milestone 1.3 - P0 Domain Coverage

- Normalize skill gems and support gems.
- Normalize base items, currency, and waystones.
- Normalize mods, stats, and stat descriptions.
- Normalize passive tree nodes, edges, classes, and ascendancies.
- Copy referenced icons/backgrounds into local ignored storage.

## Milestone 1.4 - Compare

- Compare current extract against previous version.
- Report added, removed, changed, unchanged, mapper failures, and unresolved
  references.

## Exit Criteria

- A fixture run works without local GGPK.
- A local GGPK sweep produces a manifest and extracted PoB-scope files.
- A full DATC64 run produces raw table files, parsed clean tables where schema
  exists, and explicit missing-spec/failure reports for the rest.
- A full client inventory produces bucket path lists for DAT tables, images,
  image headers, audio, videos/cinematic paths, stat descriptions, metadata
  templates, UI metadata, and shader cache.
- A GGPK import run creates a `ggpk_full` DB version and keeps PoB-generated
  versions separate.
- Re-running the same patch produces stable hashes.
- Generated P0 export can replace current POE2DB-derived data in a later phase.
