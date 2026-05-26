# Phase 3 Process

## Purpose

Phase 3 turns extracted data into PoB Web-ready data with stronger parity:
ModCache-style outputs, planner relationships, and calculator-facing data.

## Process

1. Identify the exact PoB data outputs required by PoB Web Lite.
2. Generate equivalent JSON from extractor DB.
3. Compare generated data against PoB-generated Lua data.
4. Add manual override tables only when game data and PoB output require
   hand-authored behavior.
5. Export compact frontend payloads.
6. Keep raw, normalized, and generated output hashes for every version.

## Data Products

- Planner data: passive tree, classes, ascendancies, edges, stats, assets.
- Item data: bases, uniques, item classes, requirements, properties, mods.
- Skill data: gems, levels, granted effects, supports, stats, descriptions.
- Mod data: mods, tags, domains, weights, parsed stat lines.
- Calculator seeds: ModCache-style mappings and known special cases.

## Current P0 Command

```powershell
npm run extract:web -- --snapshot=<extract-snapshot.json> --output-dir=<web-output-dir>
```

For fixture validation:

```powershell
npm run extract:web -- --fixture=tests/fixtures/game-extract/pob-source --output-dir=.codex_tmp/game-web
```
