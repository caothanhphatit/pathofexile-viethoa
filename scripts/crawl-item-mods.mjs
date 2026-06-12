// Crawl modifier pool (per item class) from poe2db ModifiersCalc data.
// Source of truth = poe2db embedded JSON ("normal" array per class page).
// Each entry is one tier: { Name, Level(ilvl), ModGenerationTypeID(1=Prefix,2=Suffix),
//   ModFamilyList(group), DropChance(weight), str(text+range), fossil_no(tags), spawn_no(classes), hover(key) }.
// Output: public/data/craft-data.js (window.POE2_CRAFT), grouped by item class -> family -> tiers.
// Self-contained: no DB, no cross-source join (robust against schema drift).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data", "craft-data.js");
const ITEMS_DATA = path.join(ROOT, "public", "data", "items-data.js");

const GEN = { "1": "prefix", "2": "suffix" };
const CONCURRENCY = 5;
const STAMP = process.env.CRAFT_STAMP || new Date().toISOString();

// Non-gear classes (no craftable affix pool) — skipped if they yield no mods anyway,
// but listed to avoid wasted fetches.
const SKIP_KEYS = new Set([
  "stackable-currency", "omen", "essence", "incubators", "liquid-emotions",
  "splinter", "augment", "tattoo", "scarab", "delirium-orb", "catalyst",
  "oils", "fossil", "resonator", "vault-keys", "misc-map-items", "maps",
  "waystones", "tablet", "breachstone", "expedition", "fragments"
]);

// Armour classes split their mod pool by attribute base; poe2db hosts them as
// <Category>_<attr> pages. Expand these into per-attribute sub-class pages.
const ARMOUR_VARIANTS = {
  "body-armours": { base: "Body_Armours", attrs: ["str", "dex", "int", "str_dex", "str_int", "dex_int", "str_dex_int"] },
  gloves: { base: "Gloves", attrs: ["str", "dex", "int", "str_dex", "str_int", "dex_int"] },
  boots: { base: "Boots", attrs: ["str", "dex", "int", "str_dex", "str_int", "dex_int"] },
  helmets: { base: "Helmets", attrs: ["str", "dex", "int", "str_dex", "str_int", "dex_int"] },
  shields: { base: "Shields", attrs: ["str", "dex", "int", "str_dex", "str_int", "dex_int"] }
};
const ATTR_LABEL = { str: "Str", dex: "Dex", int: "Int", str_dex: "Str/Dex", str_int: "Str/Int", dex_int: "Dex/Int", str_dex_int: "Str/Dex/Int" };

const loadClasses = () => {
  const code = fs.readFileSync(ITEMS_DATA, "utf8");
  const win = {};
  new Function("window", code)(win);
  const menus = (win.POE2_ITEMS?.menus || []).filter((m) => !SKIP_KEYS.has(m.key));
  const work = [];
  for (const m of menus) {
    const variant = ARMOUR_VARIANTS[m.key];
    if (variant) {
      for (const a of variant.attrs) {
        work.push({
          key: `${m.key}-${a}`,
          label: `${m.label} (${ATTR_LABEL[a]})`,
          attr: ATTR_LABEL[a],
          url: `https://poe2db.tw/us/${variant.base}_${a}`
        });
      }
    } else {
      work.push({ key: m.key, label: m.label, url: m.source_url, attr: null });
    }
  }
  return work;
};

// Extract a balanced JSON array starting at the first '[' after `fromIndex`.
const sliceArray = (html, fromIndex) => {
  let i = html.indexOf("[", fromIndex);
  if (i < 0) return null;
  const start = i;
  let depth = 0, inStr = false, esc = false;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  return html.slice(start, i);
};

const stripTags = (s = "") => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Pull a numeric value range like "+(6—10)%" -> { min, max, text }
const parseRange = (str = "") => {
  const text = stripTags(str.replace(/<span class="ndash">—<\/span>/g, "—"));
  const m = text.match(/\(?\s*([\d.]+)\s*[—–-]\s*([\d.]+)\s*\)?/);
  return { text, min: m ? Number(m[1]) : null, max: m ? Number(m[2]) : null };
};

const extractMods = (html) => {
  const optI = html.indexOf("\"opt\":{");
  let itemClass = null;
  if (optI >= 0) {
    const opt = html.slice(optI, html.indexOf("}", optI) + 1);
    itemClass = opt.match(/"ItemClassesCode":"([^"]*)"/)?.[1] || null;
  }
  const key = html.indexOf("\"normal\":[");
  if (key < 0) return null;
  const raw = sliceArray(html, key);
  if (!raw) return null;
  let arr;
  try { arr = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(arr) || !arr.length) return null;

  // family -> { name, gen, family, tags, spawn, tiers:[{ilvl,weight,name,text,min,max}] }
  const families = new Map();
  for (const e of arr) {
    const gen = GEN[e.ModGenerationTypeID];
    if (!gen) continue;
    const family = (e.ModFamilyList || []).join("/") || "Unknown";
    const fkey = `${gen}:${family}`;
    if (!families.has(fkey)) {
      families.set(fkey, {
        family, gen,
        tags: e.fossil_no || [],
        spawn: e.spawn_no || [],
        tiers: []
      });
    }
    const r = parseRange(e.str);
    families.get(fkey).tiers.push({
      name: e.Name || null,
      ilvl: Number(e.Level) || 0,
      weight: Number(e.DropChance) || 0,
      min: r.min, max: r.max, text: r.text
    });
  }
  for (const f of families.values()) f.tiers.sort((a, b) => a.ilvl - b.ilvl);
  return { itemClass, mods: [...families.values()] };
};

const fetchPage = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 poe2viethoa-craft-crawl" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const run = async () => {
  const classes = loadClasses();
  const out = {};
  let done = 0, modTotal = 0;
  const queue = [...classes];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      try {
        const html = await fetchPage(c.url);
        const parsed = extractMods(html);
        if (parsed && parsed.mods.length) {
          // Use the (attr-qualified) label as key so armour variants don't collapse
          // under a shared ItemClassesCode like "Body Armour".
          const cls = c.label;
          out[cls] = {
            class_key: c.key,
            label: c.label,
            item_class: parsed.itemClass || null,
            attr: c.attr || null,
            source_url: c.url,
            prefixes: parsed.mods.filter((m) => m.gen === "prefix"),
            suffixes: parsed.mods.filter((m) => m.gen === "suffix")
          };
          const n = parsed.mods.length;
          modTotal += n;
          console.log(`✓ ${cls.padEnd(18)} ${n} nhóm mod (P:${out[cls].prefixes.length}/S:${out[cls].suffixes.length})`);
        } else {
          console.log(`· ${c.label.padEnd(18)} (không có mod pool — bỏ qua)`);
        }
      } catch (err) {
        console.log(`✗ ${c.label.padEnd(18)} ${err.message}`);
      }
      done += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const payload = {
    generated_at: STAMP,
    source: "poe2db.tw ModifiersCalc",
    note: "weight (DropChance) là community-estimate của poe2db, không phải từ file game.",
    class_count: Object.keys(out).length,
    classes: out
  };
  fs.writeFileSync(OUT, `window.POE2_CRAFT = ${JSON.stringify(payload)};\n`);
  console.log(`\n✓ Xong ${done} class, ${Object.keys(out).length} class có mod, tổng ${modTotal} nhóm mod.`);
  console.log(`→ ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
};

run().catch((e) => { console.error(e); process.exitCode = 1; });
