// Sync public/data/passive-tree-data.js directly from PathOfBuilding-PoE2's
// src/TreeData/<latest>/tree.json (GGG's official passive tree JSON bundled in PoB),
// preserving existing Vietnamese stat translations and self-hosted /assets/passive-tree/
// icon paths. No network or Postgres required.
//
//   node scripts/sot/sync-passive-tree.mjs [--pob=<pob-core dir>] [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePassiveTree, translatePassiveStatLine } from "../passive-tree/passive-tree-lib.mjs";
import { EXPORT_PATH, passiveTreeExportPayload, writePassiveTreeExportData } from "../passive-tree/runtime.mjs";
import { decodeDds, extractDds } from "../ggpk/extract-icons.mjs";
import { DEFAULT_HELPER, resolveGameDir } from "../ggpk/reader.mjs";
import { encodeDdsFallbackToWebp, encodeRgbaToWebp } from "../ggpk/sync-site-icons.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

const defaultPobDir = () =>
  process.env.POB_CORE_DIR ? path.resolve(process.env.POB_CORE_DIR, "..") : path.resolve(ROOT_DIR, "..", "pob-core");

const normKey = (text) => String(text ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/** Compare version folder names like "0_4", "0_5", "0_10", "1_0". */
export function compareTreeVersionDirs(a, b) {
  const pa = String(a).split("_").map(Number);
  const pb = String(b).split("_").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return String(a).localeCompare(String(b));
}

/** Pick the newest TreeData/<version>/tree.json inside a pob-core checkout. */
export function findLatestPobTreeJson(pobDir = defaultPobDir()) {
  const treeDataDir = path.join(pobDir, "src", "TreeData");
  if (!fs.existsSync(treeDataDir)) {
    throw new Error(`PoB TreeData directory not found: ${treeDataDir}`);
  }
  const versions = fs.readdirSync(treeDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_\d+/.test(entry.name))
    .map((entry) => entry.name)
    .filter((ver) => fs.existsSync(path.join(treeDataDir, ver, "tree.json")))
    .sort(compareTreeVersionDirs);
  if (!versions.length) {
    throw new Error(`No tree.json found under ${treeDataDir}`);
  }
  const version = versions[versions.length - 1];
  return {
    version,
    jsonPath: path.join(treeDataDir, version, "tree.json"),
    relPath: `src/TreeData/${version}/tree.json`
  };
}

function readExistingPassiveTree() {
  if (!fs.existsSync(EXPORT_PATH)) return null;
  const sandbox = {};
  new Function("window", fs.readFileSync(EXPORT_PATH, "utf8"))(sandbox);
  return sandbox.POE2_PASSIVE_TREE || null;
}

async function extractMissingPassiveIconsFromGgpk(rawTree, missingIconPaths, { gameDir, helper = DEFAULT_HELPER } = {}) {
  if (!missingIconPaths.length) return { extracted: 0, remaining: [] };
  let ggpk = "";
  try {
    ggpk = path.join(resolveGameDir(gameDir), "Content.ggpk");
  } catch {
    return { extracted: 0, remaining: missingIconPaths };
  }
  if (!fs.existsSync(ggpk) || !fs.existsSync(helper)) {
    return { extracted: 0, remaining: missingIconPaths };
  }

  const missingSet = new Set(missingIconPaths);
  const byRel = new Map();
  for (const rawNode of Object.values(rawTree?.nodes || {})) {
    if (!rawNode?.icon) continue;
    const rel = "/assets/passive-tree/icons/" + String(rawNode.icon)
      .replace(/^Art\/2DArt\/SkillIcons\/passives\//i, "")
      .replace(/\.dds$/i, ".webp");
    if (missingSet.has(rel) && !byRel.has(rel)) {
      byRel.set(rel, { rel, ddsPath: String(rawNode.icon), outPath: path.join(PUBLIC_DIR, rel.replace(/^\/+/, "")) });
    }
  }
  const items = [...byRel.values()];
  if (!items.length) return { extracted: 0, remaining: missingIconPaths };

  const result = extractDds(ggpk, items.map((i) => i.ddsPath), helper, 180);
  let extracted = 0;
  for (const item of items) {
    const buf = result.files.get(item.ddsPath);
    if (!buf) continue;
    try {
      const img = decodeDds(buf);
      await encodeRgbaToWebp(img.rgba, img.width, img.height, item.outPath, 88);
      extracted += 1;
    } catch {
      try {
        await encodeDdsFallbackToWebp(buf, item.outPath, 88);
        extracted += 1;
      } catch {
        // leave in remaining
      }
    }
  }
  const remaining = missingIconPaths.filter((rel) => !fs.existsSync(path.join(PUBLIC_DIR, rel.replace(/^\/+/, ""))));
  return { extracted, remaining };
}

export async function syncPassiveTreeFromPob({ pobDir = defaultPobDir(), dryRun = false, gameDir } = {}) {
  const latest = findLatestPobTreeJson(pobDir);
  const raw = JSON.parse(fs.readFileSync(latest.jsonPath, "utf8"));
  const existing = readExistingPassiveTree();

  // Build translation memory + existing local icon lookup from current passive-tree-data.js.
  const statViMemory = new Map();
  const existingNodeById = new Map();
  for (const node of existing?.nodes || []) {
    existingNodeById.set(String(node.id), node);
    const enStats = Array.isArray(node.stats) ? node.stats : [];
    const viStats = Array.isArray(node.stats_vi) ? node.stats_vi : [];
    for (let i = 0; i < enStats.length; i += 1) {
      const e = String(enStats[i] || "").trim();
      const v = String(viStats[i] || "").trim();
      if (e && v && e !== v && !statViMemory.has(normKey(e))) statViMemory.set(normKey(e), v);
    }
  }

  const normalized = normalizePassiveTree(raw, {
    treeVersion: latest.version,
    sourceUrl: `local:${latest.relPath}`,
    sourceRef: "local-pob"
  });
  // Match Postgres export semantics: path_edges uses the playable graph edges (not
  // visual-only class-to-ascendancy helper links), sorted deterministically by (from, to).
  const sortedEdges = [...(normalized.edges || [])].sort((a, b) =>
    String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to))
  );
  const payload = passiveTreeExportPayload(
    { ...normalized, edges: sortedEdges, path_edges: sortedEdges },
    { sourcePath: latest.relPath }
  );

  let preservedStatLines = 0;
  let translatedStatLines = 0;
  let fallbackEnglishLines = 0;
  let preservedIcons = 0;
  const missingIcons = [];

  for (const node of payload.nodes || []) {
    const prev = existingNodeById.get(String(node.id));
    const currentExists = node.icon_path && fs.existsSync(path.join(PUBLIC_DIR, node.icon_path.replace(/^\/+/, "")));
    if (!currentExists && prev?.icon_path) {
      const localFile = path.join(PUBLIC_DIR, prev.icon_path.replace(/^\/+/, ""));
      if (fs.existsSync(localFile)) {
        node.icon_path = prev.icon_path;
        preservedIcons += 1;
      }
    }
    if (node.icon_path) {
      const localFile = path.join(PUBLIC_DIR, node.icon_path.replace(/^\/+/, ""));
      if (!fs.existsSync(localFile)) missingIcons.push(node.icon_path);
    }

    const stats = Array.isArray(node.stats) ? node.stats : [];
    const prevStats = Array.isArray(prev?.stats) ? prev.stats : [];
    const prevVi = Array.isArray(prev?.stats_vi) ? prev.stats_vi : [];
    const prevLocal = new Map();
    for (let i = 0; i < prevStats.length; i += 1) {
      const e = String(prevStats[i] || "").trim();
      const v = String(prevVi[i] || "").trim();
      if (e && v) prevLocal.set(normKey(e), v);
    }

    node.stats_vi = stats.map((line) => {
      const key = normKey(line);
      if (prevLocal.has(key)) {
        preservedStatLines += 1;
        return prevLocal.get(key);
      }
      if (statViMemory.has(key)) {
        preservedStatLines += 1;
        return statViMemory.get(key);
      }
      const auto = translatePassiveStatLine(line);
      if (auto && auto !== line) {
        translatedStatLines += 1;
        return auto;
      }
      fallbackEnglishLines += 1;
      return line;
    });
    if (node.i18n && Array.isArray(node.i18n.stats)) {
      node.i18n.stats = stats.map((en, i) => ({ en, vi: node.stats_vi[i] || en }));
    }
  }

  const uniqueMissing = [...new Set(missingIcons)];
  let extractedGgpkIcons = 0;
  let remainingMissing = uniqueMissing;
  if (!dryRun && uniqueMissing.length > 0) {
    const res = await extractMissingPassiveIconsFromGgpk(raw, uniqueMissing, { gameDir });
    extractedGgpkIcons = res.extracted;
    remainingMissing = res.remaining;
  }

  if (!dryRun) {
    writePassiveTreeExportData(payload);
  }

  return {
    applied: !dryRun,
    version: payload.version,
    source: latest.relPath,
    nodes: payload.nodes.length,
    classes: payload.classes.length,
    preserved_stat_lines: preservedStatLines,
    auto_translated_stat_lines: translatedStatLines,
    fallback_english_lines: fallbackEnglishLines,
    preserved_icons: preservedIcons,
    extracted_ggpk_icons: extractedGgpkIcons,
    missing_local_icons: remainingMissing.length
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [k, ...rest] = arg.split("=");
    return [k.replace(/^--/, ""), rest.join("=") || "true"];
  }));
  try {
    const summary = await syncPassiveTreeFromPob({
      pobDir: args.get("pob") || defaultPobDir(),
      dryRun: args.has("dry-run"),
      gameDir: args.get("game")
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
