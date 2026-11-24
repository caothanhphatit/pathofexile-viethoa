// Compare the PoB-generated gem and unique records with the site's current (poe2db-crawled) data.
//
//   node scripts/pob-data/compare.mjs [--dir data/pob-extract] [--game-extract <dir with gems.json>]
//
// Reads  public/data/skill-gems-data.js, public/data/items-data.js (never written),
//        <dir>/skill-gems.generated.json, <dir>/uniques.generated.json (scripts/pob-data/generate.mjs),
//        data/game-extract/ggpk/gems.json and base-items.json when present (referee for disagreements).
// Writes <dir>/compare.json (everything) and docs/pob-data-pilot-numbers.md (tables and examples).
// Every number quoted in docs/pob-data-pilot.md comes from that generated file.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUT_DIR, ROOT_DIR, sortKeys } from "./dump.mjs";

const require = createRequire(import.meta.url);
const EXAMPLES = 10;

// ── Normalisation ───────────────────────────────────────────────────────────
/** Case, dash style, whitespace, trailing punctuation and plural weapon names do not count as differences. */
export const normText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();

const normList = (list) => (list || []).map(normText).filter(Boolean).sort();
// Object key order is not a difference ({ title, lines } vs { lines, title }).
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const isEmpty = (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

/**
 * Classify one field of one matched record.
 *   exact       identical values
 *   normalised  identical after `normalise`
 *   differ      both sides have a value and they disagree
 *   site_only   only the site has a value        pob_only  only PoB has a value
 *   both_empty  neither side has a value
 */
export const classify = (site, pob, normalise = (value) => (Array.isArray(value) ? normList(value) : normText(value))) => {
  const siteEmpty = isEmpty(site);
  const pobEmpty = isEmpty(pob);
  if (siteEmpty && pobEmpty) return "both_empty";
  if (siteEmpty) return "pob_only";
  if (pobEmpty) return "site_only";
  if (same(site, pob)) return "exact";
  return same(normalise(site), normalise(pob)) ? "normalised" : "differ";
};

export const newTally = () => ({ exact: 0, normalised: 0, differ: 0, site_only: 0, pob_only: 0, both_empty: 0, examples: { normalised: [], differ: [], site_only: [], pob_only: [] } });

export const tally = (table, field, kind, example) => {
  const row = (table[field] ||= newTally());
  row[kind] += 1;
  if (row.examples[kind] && row.examples[kind].length < EXAMPLES) row.examples[kind].push(example);
};

// ── Loading ─────────────────────────────────────────────────────────────────
export const loadSiteData = (rootDir = ROOT_DIR) => {
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    for (const file of ["skill-gems-data.js", "items-data.js"]) {
      const full = path.join(rootDir, "public", "data", file);
      delete require.cache[require.resolve(full)];
      require(full);
    }
    const { POE2_SKILL_GEMS: gemData, POE2_ITEMS: itemData } = globalThis.window;
    return { gems: gemData.gems, items: itemData.items, gems_generated_at: gemData.generated_at || null, items_generated_at: itemData.generated_at || null };
  } finally {
    globalThis.window = previous;
  }
};

const findGameExtract = (explicit) => {
  const candidates = [explicit, path.join(ROOT_DIR, "data", "game-extract", "ggpk")];
  // A git worktree has no data/ of its own; the main checkout (three levels up) does.
  for (let dir = ROOT_DIR, i = 0; i < 5; i += 1, dir = path.dirname(dir)) candidates.push(path.join(dir, "data", "game-extract", "ggpk"));
  return candidates.filter(Boolean).find((dir) => fs.existsSync(path.join(dir, "gems.json"))) || null;
};

// ── Matching ────────────────────────────────────────────────────────────────
/**
 * Pair site rows with PoB rows: same name (and the same game id when a name occurs more than
 * once), then same game id under a different name, then same normalised name.
 */
export const matchRecords = (siteRows, pobRows, { siteId = () => null, pobId = () => null } = {}) => {
  const pairs = [];
  const usedSite = new Set();
  const usedPob = new Set();
  const take = (site, pob, how) => {
    usedSite.add(site);
    usedPob.add(pob);
    pairs.push({ site, pob, how });
  };
  const pass = (how, keyOfSite, keyOfPob) => {
    const index = new Map();
    for (const pob of pobRows) {
      if (usedPob.has(pob)) continue;
      const key = keyOfPob(pob);
      if (key) (index.get(key) || index.set(key, []).get(key)).push(pob);
    }
    for (const site of siteRows) {
      if (usedSite.has(site)) continue;
      const list = index.get(keyOfSite(site));
      const pob = list?.find((row) => !usedPob.has(row));
      if (pob) take(site, pob, how);
    }
  };
  pass("name+id", (row) => (siteId(row) ? `${row.name}|${siteId(row)}` : null), (row) => (pobId(row) ? `${row.name}|${pobId(row)}` : null));
  pass("name", (row) => row.name, (row) => row.name);
  pass("id", siteId, pobId);
  pass("normalised name", (row) => normText(row.name).replace(/[^a-z0-9]/g, ""), (row) => normText(row.name).replace(/[^a-z0-9]/g, ""));
  return {
    pairs,
    siteOnly: siteRows.filter((row) => !usedSite.has(row)),
    pobOnly: pobRows.filter((row) => !usedPob.has(row))
  };
};

// ── Gems ────────────────────────────────────────────────────────────────────
const isRawStatLine = (line) => /\[-?[\d.]+(?:\u2014-?[\d.]+)?\]$/.test(line) && /^[a-z0-9]/.test(line);
const isInfoLine = (line) => /^(Cost|Cooldown Time|Cast Time|Critical Hit Chance|Attack Damage|Attack Speed|Attack Time|Reservation|Use Time|Projectile Speed|Duration): /.test(line);
const propertyKey = (line, index) => (line.includes(": ") ? line.split(": ")[0] : index === 0 ? "(tag line)" : "(other)");
const requirementKey = (line) => (/^Support Requirements/.test(line) ? "support attribute" : /^Requires: Level/.test(line) ? "level and attributes" : "weapon");
const slugNorm = (slug) => normText(slug).replace(/__\d+$/, "");
const pluralNorm = (line) => normText(line).replace(/\b(\w+?)s\b/g, "$1");

const keyed = (lines, keyOf) => {
  const out = new Map();
  (lines || []).forEach((line, index) => {
    const key = keyOf(line, index);
    out.set(key, out.has(key) ? `${out.get(key)} | ${line}` : line);
  });
  return out;
};

const refereeGem = (extract, field, site, pob) => {
  if (!extract) return null;
  if (field === "tier") return site === pob ? "both" : site === (extract.tier ?? null) ? "site" : pob === (extract.tier ?? null) ? "pob" : "neither";
  const truth = {
    color: extract.color,
    tags: extract.tags,
    summary_en: extract.active_skill?.description || extract.support_text || ""
  }[field];
  if (truth === undefined || isEmpty(truth)) return null;
  const norm = (value) => (Array.isArray(value) ? normList(value) : normText(value));
  const siteOk = same(norm(site), norm(truth));
  const pobOk = same(norm(pob), norm(truth));
  return siteOk && pobOk ? "both" : siteOk ? "site" : pobOk ? "pob" : "neither";
};

export const compareGems = (siteGems, pobGems, extractGems = []) => {
  const extractById = new Map(extractGems.map((gem) => [gem.id, gem]));
  const extractByName = new Map();
  for (const gem of extractGems) (extractByName.get(gem.name) || extractByName.set(gem.name, []).get(gem.name)).push(gem);
  const { pairs, siteOnly, pobOnly } = matchRecords(siteGems, pobGems, { siteId: (row) => row.official_id || null, pobId: (row) => row.official_id || null });
  const fields = {};
  const properties = {};
  const requirements = {};
  const referee = {};
  const text = {
    gems: pairs.length,
    site_described_lines: 0, described_exact: 0, described_normalised: 0, described_missing: 0,
    site_raw_lines: 0, raw_exact: 0, raw_missing: 0,
    site_info_lines: 0, info_exact: 0, info_missing_examples: [],
    pob_described_lines: 0, pob_described_not_on_site: 0,
    gems_sections_exact: 0, gems_sections_normalised: 0,
    gems_all_described_exact: 0, gems_all_described_normalised: 0, gems_all_lines_exact: 0,
    gems_no_site_lines: 0, gems_pob_no_described: 0,
    by_type: {},
    missing_examples: [], pob_extra_examples: [], partial_gems: []
  };

  for (const { site, pob } of pairs) {
    const label = site.name === pob.name ? site.name : `${site.name} / ${pob.name}`;
    const extract = extractById.get(site.official_id) || extractById.get(pob.official_id) || null;
    const cmp = (field, siteValue, pobValue, normalise) => {
      const kind = classify(siteValue, pobValue, normalise);
      tally(fields, field, kind, { gem: label, site: siteValue, pob: pobValue });
      if (kind !== "exact" && kind !== "both_empty") {
        const verdict = refereeGem(extract, field, siteValue, pobValue);
        if (verdict) ((referee[field] ||= { both: 0, site: 0, pob: 0, neither: 0 })[verdict] += 1);
      }
      return kind;
    };
    cmp("name", site.name, pob.name);
    cmp("slug", site.slug, pob.slug, slugNorm);
    cmp("gem_type", site.gem_type, pob.gem_type);
    cmp("tier", site.tier, pob.tier);
    cmp("color", site.color, pob.color);
    cmp("official_id", site.official_id, pob.official_id);
    cmp("tags", site.tags, pob.tags);
    cmp("summary_en", site.summary_en, pob.summary_en);
    cmp("properties (whole list)", site.properties, pob.properties);
    cmp("requirements (whole list)", site.requirements, pob.requirements, (list) => (list || []).map(pluralNorm).sort());
    cmp("mods", site.mods, pob.mods);
    cmp("sections: count", site.sections.length, pob.sections.length);
    cmp("sections: titles", site.sections.map((section) => section.title), pob.sections.map((section) => section.title));
    const sectionsKind = cmp("sections (titles + lines)", site.sections, pob.sections, (sections) => sections.map((section) => [normText(section.title), normList(section.lines)]));

    // Header block, one row per property kind ("Cost", "Cast Time"...).
    const siteProps = keyed(site.properties, propertyKey);
    const pobProps = keyed(pob.properties, propertyKey);
    for (const key of new Set([...siteProps.keys(), ...pobProps.keys()])) {
      tally(properties, key, classify(siteProps.get(key), pobProps.get(key)), { gem: label, site: siteProps.get(key) ?? null, pob: pobProps.get(key) ?? null });
    }
    const siteReqs = keyed(site.requirements, requirementKey);
    const pobReqs = keyed(pob.requirements, requirementKey);
    for (const key of new Set([...siteReqs.keys(), ...pobReqs.keys()])) {
      tally(requirements, key, classify(siteReqs.get(key), pobReqs.get(key), pluralNorm), { gem: label, site: siteReqs.get(key) ?? null, pob: pobReqs.get(key) ?? null });
    }

    // Stat text: can every line the site shows be produced from PoB?
    const siteLines = site.sections.flatMap((section) => section.lines);
    const pobLines = pob.sections.flatMap((section) => section.lines);
    const pobExact = new Set(pobLines);
    const pobNorm = new Set(pobLines.map(normText));
    const siteNorm = new Set(siteLines.map(normText));
    let missing = 0;
    let missingNorm = 0;
    let rawMissing = 0;
    let described = 0;
    let infoMissing = 0;
    for (const line of siteLines) {
      if (isRawStatLine(line)) {
        text.site_raw_lines += 1;
        if (pobExact.has(line)) text.raw_exact += 1;
        else { text.raw_missing += 1; rawMissing += 1; }
        continue;
      }
      if (isInfoLine(line)) {
        text.site_info_lines += 1;
        if (pobExact.has(line)) text.info_exact += 1;
        else { infoMissing += 1; if (text.info_missing_examples.length < 20) text.info_missing_examples.push({ gem: label, line }); }
        continue;
      }
      described += 1;
      text.site_described_lines += 1;
      if (pobExact.has(line)) text.described_exact += 1;
      else if (pobNorm.has(normText(line))) { text.described_normalised += 1; missing += 1; }
      else {
        text.described_missing += 1; missing += 1; missingNorm += 1;
        if (text.missing_examples.length < 40) text.missing_examples.push({ gem: label, line });
      }
    }
    const pobDescribed = pobLines.filter((line) => !isRawStatLine(line) && !isInfoLine(line));
    text.pob_described_lines += pobDescribed.length;
    for (const line of pobDescribed) {
      if (!siteNorm.has(normText(line))) {
        text.pob_described_not_on_site += 1;
        if (text.pob_extra_examples.length < 40) text.pob_extra_examples.push({ gem: label, line });
      }
    }
    const type = (text.by_type[pob.gem_type === "support" ? "support" : pob.tags[0]] ||= { gems: 0, sections_exact: 0, all_described_exact: 0, all_described_normalised: 0 });
    type.gems += 1;
    if (sectionsKind === "exact" || sectionsKind === "both_empty") { text.gems_sections_exact += 1; type.sections_exact += 1; }
    if (sectionsKind === "normalised") text.gems_sections_normalised += 1;
    if (!siteLines.length) text.gems_no_site_lines += 1;
    if (!pobDescribed.length) text.gems_pob_no_described += 1;
    if (missing === 0) { text.gems_all_described_exact += 1; type.all_described_exact += 1; }
    if (missingNorm === 0) { text.gems_all_described_normalised += 1; type.all_described_normalised += 1; }
    if (missing === 0 && rawMissing === 0 && infoMissing === 0) text.gems_all_lines_exact += 1;
    if (missingNorm > 0 && text.partial_gems.length < 400) text.partial_gems.push({ gem: label, type: pob.tags[0], site_described: described, missing: missingNorm });
  }

  // Leftovers: why is a row on one side only?
  const pobNames = new Set(pobGems.map((gem) => gem.name));
  const siteNameCount = new Map();
  for (const gem of siteGems) siteNameCount.set(gem.name, (siteNameCount.get(gem.name) || 0) + 1);
  const describeSiteOnly = (gem) => {
    const extract = extractById.get(gem.official_id) || null;
    const reasons = [];
    if (pobNames.has(gem.name)) {
      const sameId = pairs.some((pair) => pair.site.name === gem.name && pair.site.official_id === gem.official_id);
      reasons.push(`extra site row: the site has ${siteNameCount.get(gem.name)} rows named "${gem.name}"${sameId ? " with the same official_id" : ""}, PoB has ${pobGems.filter((row) => row.name === gem.name).length}`);
    }
    if (!gem.official_id) reasons.push("no official_id on the site row");
    if (gem.source) reasons.push(`site source: ${gem.source}`);
    if (/^Metadata\/Items\/Gem\/SkillGem(Ascendancy|PlayerDefault)/.test(gem.official_id || "")) reasons.push("ascendancy-granted or default-attack skill id");
    if (extract) reasons.push(`in game extract as ${extract.gem_kind}${extract.excluded ? `, excluded there (${extract.excluded})` : ""}, tier ${extract.tier ?? "none"}`);
    else if (extractGems.length) reasons.push(extractByName.has(gem.name) ? "game extract has the name under another id" : "not in game extract");
    return { name: gem.name, slug: gem.slug, gem_type: gem.gem_type, official_id: gem.official_id || null, tags: gem.tags, reasons };
  };
  const siteNames = new Set(siteGems.map((gem) => gem.name));
  const describePobOnly = (gem) => {
    const extract = extractById.get(gem.official_id) || null;
    const reasons = [];
    if (siteNames.has(gem.name)) reasons.push("duplicate PoB row (same name already paired with a site row)");
    if (extract) reasons.push(`in game extract as "${extract.name}" (${extract.gem_kind}${extract.excluded ? `, excluded: ${extract.excluded}` : ""})`);
    else if (extractGems.length) reasons.push("game id not in game extract");
    return { name: gem.name, pob_id: gem.pob.id, official_id: gem.official_id, granted_effects: gem.pob.granted_effects, reasons };
  };

  return {
    counts: { site: siteGems.length, pob: pobGems.length, matched: pairs.length, site_only: siteOnly.length, pob_only: pobOnly.length },
    matched_by: pairs.reduce((acc, pair) => ((acc[pair.how] = (acc[pair.how] || 0) + 1), acc), {}),
    renamed: pairs.filter((pair) => pair.site.name !== pair.pob.name).map((pair) => ({ site: pair.site.name, pob: pair.pob.name, how: pair.how })),
    fields, properties, requirements, referee, text,
    site_only: siteOnly.map(describeSiteOnly),
    pob_only: pobOnly.map(describePobOnly)
  };
};

// ── Uniques ─────────────────────────────────────────────────────────────────
const modsNorm = (mods) => normList((mods || []).filter((line) => !isRawStatLine(line)));
/**
 * Mods without what only one side can know: poe2db placeholders ("Has 6 Augment Sockets (Hidden)",
 * "[2 Random Jewel Modifiers]") and the level of a granted skill (the site has the item's fixed
 * level, PoB writes "Level (1—20)").
 */
const coreMods = (mods) =>
  normList(
    (mods || [])
      .filter((line) => !isRawStatLine(line) && !/\(hidden\)$/i.test(line) && !/^\[.*\]$/.test(line))
      .map((line) => line.replace(/^(Grants Skill:) Level \S+ /, "$1 "))
  );
const joinedNorm = (mods) => normText((mods || []).filter((line) => !isRawStatLine(line)).join(" ")).replace(/[^a-z0-9%()+.-]+/g, " ");

export const compareUniques = (siteItems, pobItems, extractBases = []) => {
  const siteUniques = siteItems.filter((item) => item.rarity === "unique");
  const baseByName = new Map(extractBases.map((base) => [base.name, base]));
  const { pairs, siteOnly, pobOnly } = matchRecords(siteUniques, pobItems);
  const fields = {};
  const mods = { exact: 0, normalised: 0, same_text_other_line_breaks: 0, same_except_skill_level_and_hidden_lines: 0, site_matches_older_pob_variant: 0, site_matches_other_pob_option: 0, pob_subset_of_site: 0, site_subset_of_pob: 0, differ: 0, examples: {} };
  const variants = { none: 0, versioned: 0, options: 0 };
  const lineStats = { site_lines: 0, site_lines_in_pob: 0, pob_lines: 0, pob_lines_on_site: 0, site_raw_stat_lines: 0 };
  const requirementReferee = { both: 0, site: 0, pob: 0, neither: 0, no_base: 0, examples: [] };
  const extras = { with_league: 0, with_source: 0, with_grants_skill: 0, with_flavour: 0, base_unknown: [] };

  for (const { site, pob } of pairs) {
    const cmp = (field, siteValue, pobValue, normalise) => {
      const kind = classify(siteValue, pobValue, normalise);
      tally(fields, field, kind, { item: site.name, site: siteValue, pob: pobValue });
      return kind;
    };
    cmp("name", site.name, pob.name);
    cmp("slug", site.slug, pob.slug, slugNorm);
    cmp("menu_key", site.menu_key, pob.menu_key);
    cmp("base type (properties[0])", site.properties[0], pob.properties[0]);
    cmp("properties (whole list)", site.properties, pob.properties);
    const reqKind = cmp("requirements", site.requirements, pob.requirements);
    cmp("flavour_text", site.flavour_text, pob.flavour_text);

    variants[pob.pob.variant_kind] += 1;
    if (pob.pob.league) extras.with_league += 1;
    if (pob.pob.source) extras.with_source += 1;
    if (pob.pob.grants_skills.length) extras.with_grants_skill += 1;
    if (pob.flavour_text) extras.with_flavour += 1;
    if (!pob.pob.base_known) extras.base_unknown.push({ item: pob.name, base: pob.properties[0] });

    // Requirements disagreements: the game's own base item table decides when the unique has no level override.
    if (reqKind === "differ" || reqKind === "site_only" || reqKind === "pob_only") {
      const base = baseByName.get(pob.properties[0]);
      if (!base) requirementReferee.no_base += 1;
      else {
        const digits = (lines) => (lines || []).join(" ").match(/\d+/g)?.map(Number).sort((a, b) => a - b) || [];
        const truth = Object.values(base.requirements || {}).filter(Boolean).sort((a, b) => a - b);
        const siteOk = same(digits(site.requirements), truth);
        const pobOk = same(digits(pob.requirements), truth);
        const verdict = siteOk && pobOk ? "both" : siteOk ? "site" : pobOk ? "pob" : "neither";
        requirementReferee[verdict] += 1;
        if (requirementReferee.examples.length < EXAMPLES) requirementReferee.examples.push({ item: site.name, site: site.requirements, pob: pob.requirements, game_base: base.requirements, agrees_with_game_base: verdict });
      }
    }

    // Mods.
    const siteMods = site.mods || [];
    const pobMods = pob.mods || [];
    const siteSet = modsNorm(siteMods);
    const pobSet = modsNorm(pobMods);
    lineStats.site_raw_stat_lines += siteMods.filter(isRawStatLine).length;
    lineStats.site_lines += siteSet.length;
    lineStats.pob_lines += pobSet.length;
    lineStats.site_lines_in_pob += siteSet.filter((line) => pobSet.includes(line)).length;
    lineStats.pob_lines_on_site += pobSet.filter((line) => siteSet.includes(line)).length;
    let kind;
    if (same(siteMods, pobMods)) kind = "exact";
    else if (same(siteSet, pobSet)) kind = "normalised";
    else if (joinedNorm(siteMods.slice().sort()) === joinedNorm(pobMods.slice().sort()) || same(siteSet.join(" ").split(" ").sort(), pobSet.join(" ").split(" ").sort())) kind = "same_text_other_line_breaks";
    else if (same(coreMods(siteMods), coreMods(pobMods))) kind = "same_except_skill_level_and_hidden_lines";
    else {
      const siteCore = coreMods(siteMods);
      const pobCore = coreMods(pobMods);
      const other = (pob.pob.variant_mods || []).find((variant) => same(coreMods(variant.mods), siteCore));
      if (other) kind = pob.pob.variant_kind === "versioned" ? "site_matches_older_pob_variant" : "site_matches_other_pob_option";
      else if (pobCore.length && pobCore.every((line) => siteCore.includes(line))) kind = "pob_subset_of_site";
      else if (siteCore.length && siteCore.every((line) => pobCore.includes(line))) kind = "site_subset_of_pob";
      else kind = "differ";
      if (other) (mods.examples[kind] ||= []).length < EXAMPLES && mods.examples[kind].push({ item: site.name, site_shows_pob_variant: other.name, pob_current: pob.pob.shown_variant, site: siteMods, pob: pobMods });
    }
    mods[kind] += 1;
    if (kind !== "exact" && !kind.startsWith("site_matches")) {
      const list = (mods.examples[kind] ||= []);
      if (list.length < EXAMPLES) {
        list.push({
          item: site.name,
          variant_kind: pob.pob.variant_kind,
          only_site: siteMods.filter((line) => !pobSet.includes(normText(line))),
          only_pob: pobMods.filter((line) => !siteSet.includes(normText(line)))
        });
      }
    }
  }

  return {
    counts: { site: siteUniques.length, pob: pobItems.length, matched: pairs.length, site_only: siteOnly.length, pob_only: pobOnly.length },
    fields, mods, variants, line_stats: lineStats, requirement_referee: requirementReferee, extras,
    site_only: siteOnly.map((item) => ({ name: item.name, menu_key: item.menu_key, base: item.properties[0] || null, source: item.source || null })),
    pob_only: pobOnly.map((item) => ({ name: item.name, group: item.pob.group, base: item.properties[0], league: item.pob.league, source: item.pob.source }))
  };
};

// ── Report ──────────────────────────────────────────────────────────────────
const cell = (value) => (value === null || value === undefined ? "_(none)_" : `\`${(typeof value === "string" ? value : JSON.stringify(value)).replace(/\|/g, "\\|").replace(/`/g, "'").slice(0, 300)}\``);
const fieldTable = (table, first) => {
  const rows = [`| ${first} | exact | after normalisation | differ | site only | PoB only | both empty |`, "|---|---:|---:|---:|---:|---:|---:|"];
  for (const [field, row] of Object.entries(table)) rows.push(`| ${field} | ${row.exact} | ${row.normalised} | ${row.differ} | ${row.site_only} | ${row.pob_only} | ${row.both_empty} |`);
  return rows.join("\n");
};
const exampleBlocks = (table, labelKey) => {
  const out = [];
  for (const [field, row] of Object.entries(table)) {
    for (const kind of ["differ", "normalised", "site_only", "pob_only"]) {
      const examples = row.examples[kind];
      if (!examples.length) continue;
      out.push(`\n**${field}: ${kind.replace("_", " ")}** (${row[kind]} records, first ${examples.length})\n`);
      out.push(`| ${labelKey} | site | PoB |`, "|---|---|---|");
      for (const example of examples) out.push(`| ${example[labelKey]} | ${cell(example.site)} | ${cell(example.pob)} |`);
    }
  }
  return out.join("\n");
};
const pct = (part, whole) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "n/a");

export const renderReport = ({ meta, gems, uniques }) => {
  const t = gems.text;
  const lines = [
    "# PoB data pilot: generated numbers",
    "",
    "Generated by `node scripts/pob-data/compare.mjs`. Do not edit by hand; the analysis is in `docs/pob-data-pilot.md`.",
    "",
    `- PoB commit: \`${meta.pob_commit}\``,
    `- Site data: skill-gems-data.js generated_at ${meta.site_gems_generated_at}, items-data.js generated_at ${meta.site_items_generated_at}`,
    `- Game extract used as referee: ${meta.game_extract ? `gems.json extracted_at ${meta.game_extract_at}` : "not found"}`,
    "",
    "Columns: **exact** = identical; **after normalisation** = identical ignoring case, dash style, whitespace, trailing dots, list order (and `__N` slug suffixes, plural weapon names where noted); **differ** = both sides have a value and they disagree; **site only / PoB only** = the other side has no value.",
    "",
    "## Gems",
    "",
    `Site rows: ${gems.counts.site}. PoB gems: ${gems.counts.pob}. Matched: ${gems.counts.matched} (${Object.entries(gems.matched_by).map(([how, n]) => `${n} by ${how}`).join(", ")}). Site only: ${gems.counts.site_only}. PoB only: ${gems.counts.pob_only}.`,
    "",
    "### Per field (matched gems)",
    "",
    fieldTable(gems.fields, "field"),
    "",
    "### Header lines by kind (`properties`)",
    "",
    fieldTable(gems.properties, "property"),
    "",
    "### Requirement lines by kind (plural weapon names normalised)",
    "",
    fieldTable(gems.requirements, "requirement"),
    "",
    "### Disagreements checked against the game extract",
    "",
    "For matched gems whose field is not an exact match, which side equals `data/game-extract/ggpk/gems.json` (after normalisation).",
    "",
    "| field | both | site | PoB | neither |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(gems.referee).map(([field, row]) => `| ${field} | ${row.both} | ${row.site} | ${row.pob} | ${row.neither} |`),
    "",
    "### Stat text",
    "",
    "\"Described\" lines are real tooltip text (`Deals (1—20) to (13—386) Lightning Damage`); \"raw\" lines are poe2db's dump of stats without description (`base is projectile [1]`).",
    "",
    "| measure | count | share |",
    "|---|---:|---:|",
    `| matched gems | ${t.gems} | |`,
    `| gems whose sections are identical (titles, lines, order) | ${t.gems_sections_exact} | ${pct(t.gems_sections_exact, t.gems)} |`,
    `| ...plus identical after normalisation (order, case, dashes) | ${t.gems_sections_normalised} | ${pct(t.gems_sections_normalised, t.gems)} |`,
    `| gems where every described site line is produced by PoB, character for character | ${t.gems_all_described_exact} | ${pct(t.gems_all_described_exact, t.gems)} |`,
    `| gems where every described site line is produced by PoB after normalisation | ${t.gems_all_described_normalised} | ${pct(t.gems_all_described_normalised, t.gems)} |`,
    `| gems where every site line (described and raw) is produced by PoB exactly | ${t.gems_all_lines_exact} | ${pct(t.gems_all_lines_exact, t.gems)} |`,
    `| matched gems with no stat lines on the site | ${t.gems_no_site_lines} | |`,
    `| matched gems for which PoB yields no described line | ${t.gems_pob_no_described} | |`,
    `| described site lines | ${t.site_described_lines} | |`,
    `| ...produced by PoB exactly | ${t.described_exact} | ${pct(t.described_exact, t.site_described_lines)} |`,
    `| ...produced by PoB after normalisation only | ${t.described_normalised} | ${pct(t.described_normalised, t.site_described_lines)} |`,
    `| ...not produced by PoB | ${t.described_missing} | ${pct(t.described_missing, t.site_described_lines)} |`,
    `| cost/timing lines inside sections on the site ("Cost: 0 Mana", "Cast Time: Instant"...) | ${t.site_info_lines} | |`,
    `| ...produced by PoB exactly | ${t.info_exact} | ${pct(t.info_exact, t.site_info_lines)} |`,
    `| raw site lines | ${t.site_raw_lines} | |`,
    `| ...produced by PoB exactly | ${t.raw_exact} | ${pct(t.raw_exact, t.site_raw_lines)} |`,
    `| described PoB lines | ${t.pob_described_lines} | |`,
    `| ...that the site does not have | ${t.pob_described_not_on_site} | ${pct(t.pob_described_not_on_site, t.pob_described_lines)} |`,
    "",
    "By gem type (first PoB tag; supports grouped):",
    "",
    "| type | gems | sections identical | all described lines exact | all described lines after normalisation |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(t.by_type).sort((a, b) => b[1].gems - a[1].gems).map(([type, row]) => `| ${type} | ${row.gems} | ${row.sections_exact} (${pct(row.sections_exact, row.gems)}) | ${row.all_described_exact} (${pct(row.all_described_exact, row.gems)}) | ${row.all_described_normalised} (${pct(row.all_described_normalised, row.gems)}) |`),
    "",
    "Described site lines PoB does not produce (first 40):",
    "",
    ...t.missing_examples.map((example) => `- ${example.gem}: ${cell(example.line)}`),
    "",
    "Cost/timing section lines PoB does not produce (first 20):",
    "",
    ...t.info_missing_examples.map((example) => `- ${example.gem}: ${cell(example.line)}`),
    "",
    "Described PoB lines the site does not have (first 40):",
    "",
    ...t.pob_extra_examples.map((example) => `- ${example.gem}: ${cell(example.line)}`),
    "",
    "### Examples per field",
    exampleBlocks(gems.fields, "gem"),
    "",
    "### Examples per header line kind",
    exampleBlocks(gems.properties, "gem"),
    "",
    "### Examples per requirement kind",
    exampleBlocks(gems.requirements, "gem"),
    "",
    `### Site-only gems (${gems.site_only.length})`,
    "",
    "| name | slug | type | official_id | findings |",
    "|---|---|---|---|---|",
    ...gems.site_only.map((gem) => `| ${gem.name} | ${gem.slug} | ${gem.gem_type} | ${gem.official_id || ""} | ${gem.reasons.join("; ")} |`),
    "",
    `### PoB-only gems (${gems.pob_only.length})`,
    "",
    "| name | PoB id | game id | granted effects | findings |",
    "|---|---|---|---|---|",
    ...gems.pob_only.map((gem) => `| ${gem.name} | ${gem.pob_id} | ${gem.official_id} | ${gem.granted_effects.join(", ")} | ${gem.reasons.join("; ")} |`),
    "",
    `### Matched under different names (${gems.renamed.length})`,
    "",
    ...gems.renamed.map((pair) => `- site \`${pair.site}\` = PoB \`${pair.pob}\` (by ${pair.how})`),
    "",
    "## Uniques",
    "",
    `Site unique rows: ${uniques.counts.site}. PoB uniques: ${uniques.counts.pob}. Matched by name: ${uniques.counts.matched}. Site only: ${uniques.counts.site_only}. PoB only: ${uniques.counts.pob_only}.`,
    "",
    "### Per field (matched uniques)",
    "",
    fieldTable(uniques.fields, "field"),
    "",
    "### Mods (matched uniques)",
    "",
    "| outcome | uniques |",
    "|---|---:|",
    ...["exact", "normalised", "same_text_other_line_breaks", "same_except_skill_level_and_hidden_lines", "site_matches_older_pob_variant", "site_matches_other_pob_option", "pob_subset_of_site", "site_subset_of_pob", "differ"].map((kind) => `| ${kind.replace(/_/g, " ")} | ${uniques.mods[kind]} |`),
    "",
    `Mod lines (normalised, poe2db raw-stat lines excluded): site ${uniques.line_stats.site_lines}, of which ${uniques.line_stats.site_lines_in_pob} (${pct(uniques.line_stats.site_lines_in_pob, uniques.line_stats.site_lines)}) are in the PoB record; PoB ${uniques.line_stats.pob_lines}, of which ${uniques.line_stats.pob_lines_on_site} (${pct(uniques.line_stats.pob_lines_on_site, uniques.line_stats.pob_lines)}) are on the site. Raw-stat lines on the site side: ${uniques.line_stats.site_raw_stat_lines}.`,
    "",
    `PoB variants among matched uniques: ${uniques.variants.none} without variants, ${uniques.variants.versioned} with patch versions (a "Current" variant), ${uniques.variants.options} with option variants only.`,
    "",
    `PoB extras among matched uniques: ${uniques.extras.with_league} with a league, ${uniques.extras.with_source} with a drop source, ${uniques.extras.with_grants_skill} with a granted skill, ${uniques.extras.with_flavour} with flavour text. Base type unknown to PoB's base table: ${uniques.extras.base_unknown.length}${uniques.extras.base_unknown.length ? ` (${uniques.extras.base_unknown.map((row) => `${row.item}: ${row.base}`).join("; ")})` : ""}.`,
    "",
    `Requirement disagreements checked against the game's base item table (digits of the requirement line vs the base item's requirements): both ${uniques.requirement_referee.both}, site ${uniques.requirement_referee.site}, PoB ${uniques.requirement_referee.pob}, neither ${uniques.requirement_referee.neither}, base not in extract ${uniques.requirement_referee.no_base}.`,
    "",
    ...uniques.requirement_referee.examples.map((example) => `- ${example.item}: site ${cell(example.site)}, PoB ${cell(example.pob)}, game base ${cell(example.game_base)} -> ${example.agrees_with_game_base}`),
    "",
    "### Mod examples",
    ...Object.entries(uniques.mods.examples).flatMap(([kind, examples]) => [
      "",
      `**${kind.replace(/_/g, " ")}** (${uniques.mods[kind]} uniques, first ${examples.length})`,
      "",
      ...examples.map((example) =>
        example.site_shows_pob_variant
          ? `- ${example.item}: site shows PoB variant \`${example.site_shows_pob_variant}\`, PoB default is \`${example.pob_current}\``
          : `- ${example.item} (${example.variant_kind}): only on site ${cell(example.only_site)}; only in PoB ${cell(example.only_pob)}`
      )
    ]),
    "",
    "### Examples per field",
    exampleBlocks(uniques.fields, "item"),
    "",
    `### Site-only uniques (${uniques.site_only.length})`,
    "",
    "| name | menu | base | site source |",
    "|---|---|---|---|",
    ...uniques.site_only.map((item) => `| ${item.name} | ${item.menu_key} | ${item.base || ""} | ${item.source || ""} |`),
    "",
    `### PoB-only uniques (${uniques.pob_only.length})`,
    "",
    "| name | PoB file | base | league | source |",
    "|---|---|---|---|---|",
    ...uniques.pob_only.map((item) => `| ${item.name} | ${item.group} | ${item.base} | ${item.league || ""} | ${item.source || ""} |`),
    ""
  ];
  return lines.join("\n");
};

export const runCompare = ({ dir = DEFAULT_OUT_DIR, gameExtractDir, rootDir = ROOT_DIR } = {}) => {
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const site = loadSiteData(rootDir);
  const generatedGems = readJson(path.join(dir, "skill-gems.generated.json"));
  const generatedUniques = readJson(path.join(dir, "uniques.generated.json"));
  const extractDir = findGameExtract(gameExtractDir);
  const extract = extractDir ? readJson(path.join(extractDir, "gems.json")) : null;
  const basesFile = extractDir && path.join(extractDir, "base-items.json");
  const bases = basesFile && fs.existsSync(basesFile) ? readJson(basesFile).items : [];
  const result = {
    meta: {
      pob_commit: generatedGems.pob_commit,
      site_gems_generated_at: site.gems_generated_at,
      site_items_generated_at: site.items_generated_at,
      game_extract: Boolean(extract),
      game_extract_at: extract?.extracted_at || null
    },
    gems: compareGems(site.gems, generatedGems.gems, extract?.gems || []),
    uniques: compareUniques(site.items, generatedUniques.items, bases)
  };
  return result;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? path.resolve(args[args.indexOf(name) + 1]) : undefined);
  const dir = option("--dir") || DEFAULT_OUT_DIR;
  const started = Date.now();
  const result = runCompare({ dir, gameExtractDir: option("--game-extract") });
  fs.writeFileSync(path.join(dir, "compare.json"), JSON.stringify(result, null, 1));
  const reportFile = path.join(ROOT_DIR, "docs", "pob-data-pilot-numbers.md");
  fs.writeFileSync(reportFile, renderReport(result));
  console.log(`gems: ${JSON.stringify(result.gems.counts)}`);
  console.log(`uniques: ${JSON.stringify(result.uniques.counts)}`);
  console.log(`compared in ${Date.now() - started} ms -> ${path.relative(ROOT_DIR, reportFile)}`);
}
