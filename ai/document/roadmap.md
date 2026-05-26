# Extractor Roadmap

## Goal

Build an independent GGPK-backed source of truth for POE2 data. The current app
stays intact while the extractor grows beside it.

## Phase Summary

| Phase | Name | Outcome |
| --- | --- | --- |
| 0 | Project control plane | Rules, architecture, process, milestones, and test standards are defined. |
| 1 | P0 data foundation | PoB upstream adapter produces raw/generated data, DB stores raw rows, normalized P0 entities, relations, assets, and diffs. |
| 2 | Rust native core | Rust parses high-value raw data natively, imports faster, and owns stable mappers for items, skills, mods, stats, and passives. |
| 3 | PoB parity layer | Data outputs support PoB Web Lite and parity checks for ModCache-style and planner data. |
| 4 | Full GGPK source of truth | Full client inventory, raw DAT fingerprints, schema-gap reports, domain coverage, and schema overrides close the gap toward PoE2DB-like coverage. |

## Source Of Truth Strategy

GGPK/game client data is the primary source. PoB-PoE2 is not a source of truth;
it is only an optional bootstrap/reference for schema behavior while app-owned
extractors and mappers mature. POE2DB is not a source of truth; it can be used
later only for optional QA comparisons.

Current full GGPK status is split intentionally:

- Raw source-of-truth coverage: every discovered `data/balance/*.datc64` file is
  extracted and raw-indexed for hashing and update diffs.
- Semantic coverage: only tables with a usable schema are decoded to named JSON
  rows. Tables with missing or empty schema remain raw-indexed and reported as
  schema gaps until an app-owned override is added.
- Normalized DB coverage: `npm run import:ggpk-full` imports the GGPK catalog as
  a `ggpk_full` extract version, maps decoded GGPK tables into app-owned
  entities/relations/assets, and records schema gaps separately.

## Milestone Gate Rule

No phase is considered complete without:

- JSON/rule docs updated if architecture changes.
- Fresh tests or verification command run.
- Diff output reviewed for added, changed, removed, and unresolved data.
- Known gaps documented in the phase milestone file.
