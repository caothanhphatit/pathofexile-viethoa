# Phase 3 Milestones

## Milestone 3.1 - Web Planner Data

- Export passive tree and asset payloads from extractor DB.
- Replace existing passive tree source in a controlled branch.
- Verify UI renders with extractor-produced data.
- Status: Phase 3 P0 exports planner JSON from extractor snapshots with
  passive nodes, edges, stats, and sanitized asset paths. Replacing the
  existing app passive-tree payload remains a controlled follow-up.

## Milestone 3.2 - ModCache-Style Data

- Generate parsed mod cache equivalents.
- Compare against PoB ModCache output.
- Record unsupported or special-case mods.
- Status: P0 calculator seed output includes ModCache-style `by_id`,
  `by_group`, `by_tag`, spawn weights, parsed stat templates, and explicit
  parser failure reporting. Full PoB ModCache golden parity remains pending.

## Milestone 3.3 - PoB Web Lite Seeds

- Export enough data for stat aggregation.
- Support items, gems, passives, and basic config.
- Keep calculator logic separate from extractor logic.
- Status: `npm run extract:web` writes `planner.json`, `items.json`,
  `skills.json`, `mods.json`, `calculator-seeds.json`, and `manifest.json`
  from an extractor snapshot or fixture.

## Exit Criteria

- Extractor data can power PoB Web Lite P0 views.
- PoB parity gaps are documented and measurable.
- Current app can consume extractor exports without local GGPK access.
