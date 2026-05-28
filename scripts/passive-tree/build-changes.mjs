import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { passiveIconAssetPath } from "./passive-tree-lib.mjs";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const DEFAULT_PREV = "https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/0.4.0/data.json";
const DEFAULT_NEXT = "https://raw.githubusercontent.com/grindinggear/poe2-skilltree-export/0.5.0/data.json";
const DEFAULT_OUT = resolve(repoRoot, "public/data/passive-tree-changes.js");

const STATUS_ORDER = { added: 0, stats: 1, renamed: 2, removed: 3 };
const KIND_ORDER = { keystone: 0, notable: 1, ascendancy_notable: 2, ascendancy: 3, jewel: 4, mastery: 5, small: 6 };
const HIDDEN_PASSIVE_CLASSES = new Set(["Marauder"]);

export function buildPassiveTreeChanges(prevRaw, nextRaw, options = {}) {
  const prevNodes = new Map(Object.entries(prevRaw?.nodes ?? {}).map(([key, node]) => [String(key), node]));
  const nextNodes = new Map(Object.entries(nextRaw?.nodes ?? {}).map(([key, node]) => [String(key), node]));
  const nextAsc = ascendancyLookup(nextRaw);
  const prevAsc = ascendancyLookup(prevRaw);
  const byId = new Map();
  const counts = { added: 0, removed: 0, stats: 0, renamed: 0 };

  for (const [id, next] of nextNodes) {
    const prev = prevNodes.get(id);
    if (!prev) {
      if (isMeaningful(next)) addEntry("added", id, null, next, nextRaw, nextAsc, byId, counts);
      continue;
    }

    const statsChanged = !sameStats(rawStats(prev), rawStats(next));
    const nameChanged = nodeName(prev) !== nodeName(next) && isReal(nodeName(prev)) && isReal(nodeName(next));
    if (statsChanged && (isMeaningful(prev) || isMeaningful(next))) {
      addEntry("stats", id, prev, next, nextRaw, nextAsc, byId, counts);
    } else if (nameChanged) {
      addEntry("renamed", id, prev, next, nextRaw, nextAsc, byId, counts);
    }
  }

  for (const [id, prev] of prevNodes) {
    if (!nextNodes.has(id) && isMeaningful(prev)) addEntry("removed", id, prev, null, prevRaw, prevAsc, byId, counts);
  }

  for (const entry of overrideDiffs(prevRaw, nextRaw, prevAsc, nextAsc, byId)) {
    byId.set(entry.id, entry);
    counts[entry.status]++;
  }

  const entries = [...byId.values()].sort((a, b) => {
    const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (status) return status;
    const kind = (KIND_ORDER[a.type] ?? 9) - (KIND_ORDER[b.type] ?? 9);
    if (kind) return kind;
    return a.name.localeCompare(b.name);
  });

  return {
    generated_at: new Date().toISOString(),
    base_version: options.baseVersion ?? "0.4.0",
    target_version: options.targetVersion ?? "0.5.0",
    source_url: options.sourceUrl ?? "https://github.com/grindinggear/poe2-skilltree-export",
    compare_url: options.compareUrl ?? "https://github.com/grindinggear/poe2-skilltree-export/compare/0.4.0...0.5.0",
    counts,
    entries
  };
}

function addEntry(status, id, prev, next, raw, ascLookup, byId, counts) {
  const source = next ?? prev;
  if (!source || byId.has(id) || !isMeaningful(source)) return;
  const asc = ascLookup.get(String(source.ascendancyId ?? "")) ?? null;
  byId.set(id, {
    id,
    status,
    name: cleanName(nodeName(next) || nodeName(prev) || `Node ${id}`),
    oldName: cleanName(nodeName(prev)),
    newName: cleanName(nodeName(next)),
    oldStats: cleanStats(prev),
    newStats: cleanStats(next),
    x: finite(source.x),
    y: finite(source.y),
    type: nodeType(source),
    iconPath: passiveIconAssetPath(source.icon),
    className: asc?.className ?? classNameForStart(raw, source),
    ascendancyName: asc?.ascendancyName ?? ""
  });
  counts[status]++;
}

function overrideDiffs(prevRaw, nextRaw, prevAsc, nextAsc, byId) {
  const prevOverrides = classOverrides(prevRaw);
  const nextOverrides = classOverrides(nextRaw);
  const out = [];
  const classNames = new Set([...prevOverrides.keys(), ...nextOverrides.keys()]);
  for (const className of classNames) {
    const prevMap = prevOverrides.get(className) ?? new Map();
    const nextMap = nextOverrides.get(className) ?? new Map();
    const nodeIds = new Set([...prevMap.keys(), ...nextMap.keys()]);
    for (const id of nodeIds) {
      if (byId.has(id)) continue;
      const prev = prevMap.get(id);
      const next = nextMap.get(id);
      if (!isMeaningful(prev) && !isMeaningful(next)) continue;
      const statsChanged = !sameStats(rawStats(prev), rawStats(next));
      const nameChanged = nodeName(prev) !== nodeName(next) && isReal(nodeName(prev)) && isReal(nodeName(next));
      if (!statsChanged && !nameChanged) continue;
      const source = nextRaw.nodes?.[id] ?? prevRaw.nodes?.[id] ?? {};
      const asc = nextAsc.get(String(source.ascendancyId ?? "")) ?? prevAsc.get(String(source.ascendancyId ?? "")) ?? null;
      out.push({
        id,
        status: statsChanged ? "stats" : "renamed",
        name: cleanName(nodeName(next) || nodeName(prev) || `Node ${id}`),
        oldName: cleanName(nodeName(prev)),
        newName: cleanName(nodeName(next)),
        oldStats: cleanStats(prev),
        newStats: cleanStats(next),
        x: finite(source.x),
        y: finite(source.y),
        type: nodeType(source),
        iconPath: passiveIconAssetPath(source.icon),
        className,
        ascendancyName: asc?.ascendancyName ?? ""
      });
    }
  }
  return out;
}

function classOverrides(raw) {
  const out = new Map();
  const skillOverrides = raw?.skillOverrides ?? {};
  for (const row of raw?.classes ?? []) {
    const pairs = row?.overridePairs ?? null;
    if (!pairs) continue;
    const map = new Map();
    for (const [nodeId, overrideId] of Object.entries(pairs)) {
      const override = skillOverrides[String(overrideId)];
      const pick = Array.isArray(override)
        ? override.find((entry) => String(entry?.id ?? "").toLowerCase().startsWith(String(row.name ?? "").toLowerCase())) ?? override[0]
        : override;
      if (pick) map.set(String(nodeId), pick);
    }
    if (map.size) out.set(String(row.name ?? ""), map);
  }
  return out;
}

function ascendancyLookup(raw) {
  const out = new Map();
  for (const row of raw?.classes ?? []) {
    for (const ascendancy of row?.ascendancies ?? []) {
      if (!ascendancy?.id || !ascendancy?.name) continue;
      out.set(String(ascendancy.id), {
        className: String(row.name ?? ""),
        ascendancyName: String(ascendancy.name ?? "")
      });
    }
  }
  return out;
}

function classNameForStart(raw, node) {
  const indexes = Array.isArray(node?.classStartIndex) ? node.classStartIndex : [];
  const first = indexes.find((value) => {
    if (!Number.isInteger(Number(value))) return false;
    return !HIDDEN_PASSIVE_CLASSES.has(String(raw?.classes?.[Number(value)]?.name ?? ""));
  });
  return first == null ? "" : String(raw?.classes?.[Number(first)]?.name ?? "");
}

function nodeType(node) {
  if (node?.isKeystone) return "keystone";
  if (node?.isJewelSocket) return "jewel";
  if (node?.isMastery) return "mastery";
  if (node?.ascendancyId && node?.isAscendancyStart) return "ascendancy_start";
  if (node?.ascendancyId && node?.isNotable) return "ascendancy_notable";
  if (node?.ascendancyId) return "ascendancy";
  if (node?.isNotable) return "notable";
  return "small";
}

function nodeName(node) {
  return String(node?.name ?? "");
}

function rawStats(node) {
  return Array.isArray(node?.stats) ? node.stats.map(String) : [];
}

function cleanStats(node) {
  return rawStats(node).map(cleanMarkup).filter(Boolean);
}

function cleanName(value) {
  return cleanMarkup(String(value ?? ""));
}

function cleanMarkup(value) {
  return value
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function sameStats(a, b) {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

function isReal(name) {
  return Boolean(name) && !String(name).startsWith("[DNT");
}

function isMeaningful(node) {
  if (!node) return false;
  const stats = rawStats(node);
  if (node?.isMastery && !stats.length) return false;
  return isReal(nodeName(node)) || stats.length > 0 || Boolean(String(node?.icon ?? "").trim());
}

function finite(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

async function readJson(input) {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { headers: { "user-agent": "poe2-vietnamese-passive-tree-changes/1.0" } });
    if (!response.ok) throw new Error(`Failed to fetch ${input}: ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(resolve(process.cwd(), input), "utf8"));
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  const prevPath = argValue("--prev", DEFAULT_PREV);
  const nextPath = argValue("--next", DEFAULT_NEXT);
  const outPath = resolve(process.cwd(), argValue("--out", DEFAULT_OUT));
  const [prev, next] = await Promise.all([readJson(prevPath), readJson(nextPath)]);
  const payload = buildPassiveTreeChanges(prev, next);
  const js = `window.POE2_PASSIVE_TREE_CHANGES=${JSON.stringify(payload)};\n`;
  await writeFile(outPath, js);
  console.log(`wrote ${payload.entries.length} passive tree changes to ${outPath}`);
}
