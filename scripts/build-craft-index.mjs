// Build the craft category tree + base->craft-pool index by joining
// items-data.js (category tree + bases) with craft-data.js (mod pools).
// Output: public/data/craft-index.js (window.POE2_CRAFT_INDEX).
// Build-time join with a coverage report (no fragile runtime matching).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (f, g) => { const w = {}; new Function("window", fs.readFileSync(path.join(ROOT, "public/data", f), "utf8"))(w); return w[g]; };

const items = load("items-data.js", "POE2_ITEMS");
const craft = load("craft-data.js", "POE2_CRAFT");
const STAMP = process.env.CRAFT_STAMP || new Date().toISOString();

// Groups that can be crafted on (gear). Order = display order in the tree.
const CRAFT_GROUPS = ["Armour", "Off-hand", "One Handed Weapons", "Two Handed Weapons", "Jewellery", "Belt", "Flasks", "Jewels"];
// Menu labels whose pool is split by attribute (poe2db <Cat>_<attr> pages).
const ATTR_SPLIT = new Set(["Body Armours", "Gloves", "Boots", "Helmets", "Shields"]);

const craftKeys = Object.keys(craft.classes);
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
const craftByNorm = new Map();
for (const k of craftKeys) if (!/\(/.test(k)) craftByNorm.set(norm(k), k);

// Resolve a base's defence attribute from its properties (Str=Armour, Dex=Evasion, Int=Energy Shield).
const attrOf = (base) => {
  const props = (base.properties || []).join(" ");
  const parts = [];
  if (/\bArmour\b/i.test(props)) parts.push("Str");
  if (/\bEvasion\b/i.test(props)) parts.push("Dex");
  if (/Energy Shield/i.test(props)) parts.push("Int");
  return parts.length ? parts.join("/") : null;
};

const craftKeyFor = (menuLabel, base) => {
  if (ATTR_SPLIT.has(menuLabel)) {
    const attr = attrOf(base);
    if (!attr) return null;
    const key = `${menuLabel} (${attr})`;
    return craft.classes[key] ? key : null;
  }
  if (craft.classes[menuLabel]) return menuLabel;
  return craftByNorm.get(norm(menuLabel)) || null;
};

// Keep only true craftable base types. poe2db lists three kinds of entry under
// the same equipment menu, and only the first is a real base you can craft on:
//   • base types       → icon under .../2DItems/...          (KEEP)
//   • skill gems /      → icon under .../2DArt/SkillIcons/... (DROP — these share
//     passive notables    a weapon/armour tag and leak into the gear category)
//   • unique items      → icon under .../Uniques/... or a named unique icon      (DROP — fixed-mod items)
// Dropping them stops skill gems and uniques from being mixed into the gear
// categories of the craft base picker.
const NON_BASE_ICON = /\/2DArt\/|\/Uniques\/|\/Gems\/|Demigod|BreachlordRing|MirrorRing|BlackFlame|StormBlade|HandCannon/i;
const isCraftableBase = (b) => {
  const u = b.icon_url || "";
  return /\/2DItems\//i.test(u) && !NON_BASE_ICON.test(u);
};

// Group menus, build tree + bases keyed by craft pool.
const itemsByMenu = new Map();
for (const it of items.items) (itemsByMenu.get(it.menu_key) || itemsByMenu.set(it.menu_key, []).get(it.menu_key)).push(it);

const tree = [];
const report = { matched: 0, unmatched: 0, droppedNonBase: 0, unmatchedSamples: [] };

for (const group of CRAFT_GROUPS) {
  const menus = items.menus.filter((m) => m.group_label === group);
  if (!menus.length) continue;
  const classes = [];
  for (const m of menus) {
    const all = itemsByMenu.get(m.key) || [];
    const baseItems = all.filter(isCraftableBase);
    report.droppedNonBase += all.length - baseItems.length;
    const bases = baseItems.map((b) => {
      const ck = craftKeyFor(m.label, b);
      if (ck) report.matched += 1;
      else { report.unmatched += 1; if (report.unmatchedSamples.length < 15) report.unmatchedSamples.push(`${m.label}/${b.name}`); }
      const reqLevel = Number((b.requirements || []).join(" ").match(/Level\s+(\d+)/i)?.[1]) || 0;
      return { name: b.name, slug: b.slug, icon: b.icon_url || null, attr: attrOf(b), req_level: reqLevel, craft_key: ck };
    }).filter((b) => b.craft_key); // chỉ giữ base craft được
    if (bases.length) classes.push({ label: m.label, attr_split: ATTR_SPLIT.has(m.label), base_count: bases.length, bases });
  }
  if (classes.length) tree.push({ group, classes });
}

const payload = {
  generated_at: STAMP,
  group_count: tree.length,
  class_count: tree.reduce((s, g) => s + g.classes.length, 0),
  base_count: tree.reduce((s, g) => s + g.classes.reduce((a, c) => a + c.base_count, 0), 0),
  tree
};
fs.writeFileSync(path.join(ROOT, "public/data/craft-index.js"), `window.POE2_CRAFT_INDEX = ${JSON.stringify(payload)};\n`);

console.log(`✓ Tree: ${payload.group_count} group, ${payload.class_count} class, ${payload.base_count} base craft được.`);
console.log(`  Khớp pool: ${report.matched} | Không khớp (bỏ): ${report.unmatched} | Loại skillgem/unique (bỏ): ${report.droppedNonBase}`);
if (report.unmatchedSamples.length) console.log("  Mẫu không khớp:", report.unmatchedSamples.join(", "));
console.log("→ public/data/craft-index.js");
