# Pilot: GGPK as the data source for currency, misc items, and item icons

Question: can `Content.ggpk` replace the poe2db crawl for `public/data/currency-data.js`,
the non-equipment menus of `public/data/items-data.js` (omens, essences, catalysts, augments,
waystones, tablets, fragments, keys, relics), and self-hosted item icons (replacing hotlinks to
`cdn.poe2db.tw`)?

This is a feasibility pilot. Nothing under `public/` was changed and the site was not switched over.

Every comparison number below comes from `node scripts/ggpk/compare-misc-items.mjs`, which writes
[`docs/ggpk-misc-items-pilot-numbers.md`](ggpk-misc-items-pilot-numbers.md).

## Verdict

| Area | Verdict | Short reason |
|---|---|---|
| Currency & misc items | **Yes** | 175 / 182 `currency-data.js` rows match (6 are legacy PoE1/no-release-evidence items, 1 is `Vaal Infuser` not in `BaseItemTypes`). Stack sizes match 100% where present; icon paths match 100%; omens (42/43), essences (81/81), catalysts (12/12), splinters (4/4), pinnacle keys (10/10), trial coins (5/5), tablets (8/8 base types) all extract cleanly. |
| Item icons (DDS -> PNG/WebP) | **Yes** | 100% of Omen (49/49) and Currency-on-site (225/225) icons extract cleanly as uncompressed `R8G8B8A8_UNORM`. Across the **entire site** (`site-all`: 2,457 distinct icons), **2,378 (96.8%)** extract in 31.8 s with **0 decode failures** — every single one is `R8G8B8A8_UNORM` or `BC1_UNORM`, both decoded in pure JS. |
| Cross-version durability | **Safe with schema updates + guards** | `.datc64` tables have no embedded column headers, so major patches still need an updated community schema. The new width/FK/anchor guards (`checkRowWidths`, `checkForeignKeys`, `checkAnchors`, `checkModsAnchor`) halt loudly instead of writing shifted garbage. |

## What was built

| File | Purpose |
|---|---|
| `scripts/ggpk/extract-misc-items.mjs` | Reads `Content.ggpk` (read-only via `PoevhGgpkPatcher.exe --extract`), joins `BaseItemTypes`, `ItemClasses`, `CurrencyItems`, `ItemVisualIdentity`, `FlavourText`, `Essences`, `EssenceMods`, `SoulCores`, `SoulCoreStats`, `EndgameMapTablets`, `MapFragmentMods`, `LiquidEmotionOutcomes`, `CurrencyExchange`, and stash layouts. Filters out PoE1/unreleased/placeholder rows via release-evidence rules and writes `data/game-extract/ggpk/misc-items.json` + `misc-items-rejected.json` with `ggpk_size`, `ggpk_modified_at`, `data_fingerprint`, and `tables_fingerprint`. |
| `scripts/ggpk/stat-descriptions.mjs` | Parses UTF-16LE `.csd` stat description files from GGPK and renders English mod/effect text with ranges, signs, and handlers (reporting unresolved stats rather than guessing). |
| `scripts/ggpk/check-schema-widths.mjs` | Audits all 1,286 tables in the schema against live `Content.ggpk` row widths (`schema-widths.json`). |
| `scripts/ggpk/extract-icons.mjs` | Extracts `.dds` item icons from `Content.ggpk`, parses DX10/legacy DDS headers, decodes `R8G8B8A8_UNORM`, `B8G8R8A8_UNORM`, and `BC1_UNORM` (DXT1) in pure JS, and writes PNG (or WebP via `ffmpeg`). Never writes into `public/`. |
| `scripts/ggpk/compare-misc-items.mjs` | Compares `misc-items.json` against `currency-data.js` and the 16 non-equipment menus of `items-data.js`, writing `misc-items-compare.json` and `docs/ggpk-misc-items-pilot-numbers.md`. |
| `tests/ggpk-misc-items.test.mjs` | 24 unit tests covering markup decoding, placeholder/release filtering, schema width & anchor guards, `.csd` stat rendering, DDS/BC1 decoding, PNG encoding, and comparison grading. |
| `docs/pilot-icons/` | 5 decoded sample PNGs (`CurrencyRerollRare`, `CurrencyVaal`, `LifeEssence`, `OmenOnExaltConsumeQuality`, `VoodooOmens1Dark`). |

## Key findings

### 1. Currency & misc items coverage

- **`currency-data.js` (182 rows)**:
  - `Essence`: **81 / 81** matched (81/81 stack size, 81/81 description, 81/81 icon path).
  - `CatalystItem`: **12 / 12** matched (12/12 stack size, 11/12 description, 12/12 icon path).
  - `SplinterItem`: **4 / 4** matched (4/4 stack size, 4/4 icon path).
  - `StackableCurrencyItem`: **78 / 85** matched (78/78 stack size, 78/78 icon path). The 7 unmatched are 6 PoE1/no-release-evidence items (Albino Rhoa Feather, Expedition artifacts, Exotic Coinage) and `Vaal Infuser`.
- **`items-data.js` non-equipment menus**:
  - `omen`: **42 / 43** matched (1 site-only is an Atlas passive node scraped onto the poe2db page); 41/41 non-empty mods match word for word.
  - `augment` (runes & soul cores): **306 / 315** matched (8 site-only are `[DNT-Unused]` placeholder runes, 1 is an Atlas passive node). Game actually has **more** effect lines than poe2db on 240 augments (full per-slot breakdown from `SoulCoreStats`).
  - `tablet`: **8 / 8** base types match (9 site-only are unique tablets, which belong in the uniques pipeline).
  - `waystones`: **22 / 66** matched (37 site-only are map/area names, 7 are Atlas passive nodes — poe2db mixes map nodes onto the waystone page).
  - `essence`: **97 / 126** matched (all 29 site-only are Atlas passive nodes scraped from poe2db).
  - `pinnacle-keys` (10/10), `trial-coins` (5/5), `inscribed-ultimatum` (1/1), `relics` (7/7 base types; 6 site-only are unique relics).
  - `liquid-emotions`: **13 / 15** matched; poe2db shows the Delirium-area stats while `CurrencyItems` carries the crafting description (`LiquidEmotionOutcomes` has the Delirium stats and needs to be rendered alongside if we replace this menu).

### 2. Icon extraction (`Content.ggpk` -> PNG)

Surveyed directly against `D:\Grinding Gear Games\Path of Exile 2\Content.ggpk` (2026-11-05):

| Set | Rows | Distinct icons | Extracted | Missing from GGPK | Failed decode | Formats |
|---|---:|---:|---:|---:|---:|---|
| `omen` | 50 | 49 | 49 (100%) | 0 | 0 | 49× `R8G8B8A8_UNORM` |
| `currency-on-site` | 250 | 225 | 225 (100%) | 0 | 0 | 225× `R8G8B8A8_UNORM` |
| `site-all` | 4,061 | 2,457 | 2,378 (96.8%) | 79 | 0 | 2,052× `R8G8B8A8_UNORM`, 326× `BC1_UNORM` |

- Zero `BC3`, `BC7`, or unknown DDS formats appeared across all 2,378 extracted site icons.
- The 79 missing icons are mostly Hideout MTX/decorations (`Art/2DItems/Hideout/...`) and a few legacy/unreleased paths.
- Self-hosting all ~2,378 item icons as WebP (or PNG) eliminates the `cdn.poe2db.tw` dependency completely for gameplay items.

### 3. Schema durability across game versions

Audit of all **1,286 tables** in schema v7 (`2026-11-05`) against `Content.ggpk` (`schema-widths.json`):

- **918** exact width match, **91** empty tables, **272** PoE1-only tables not present in PoE2.
- **5** tables wider in game than schema (`Mods` +32B, `AlternatePassiveSkills` +28B, `AlternatePassiveAdditions` +12B, `AlternateTreeVersions` +12B, `EndgameMapContentVisualIdentity` +3B) — trailing columns added at the end; existing columns remain readable.
- **0** narrower, **0** unreadable, **0** unknown types.
- **Safety guards**: every extraction checks row widths (`checkRowWidths`), foreign key bounds (`checkForeignKeys`), and known anchor records (`Vaal Orb` stack 20 + "Corrupt", `Mods` `Strength1` min <= max). If a major patch inserts/removes a middle column before the schema updates, extraction fails loudly instead of silently corrupting site data.

## Commands

```bash
node scripts/ggpk/check-schema-widths.mjs
node scripts/ggpk/extract-misc-items.mjs
node scripts/ggpk/compare-misc-items.mjs --md=docs/ggpk-misc-items-pilot-numbers.md
node scripts/ggpk/extract-icons.mjs --set=omen,currency-on-site --survey
node --test tests/ggpk-misc-items.test.mjs
```
