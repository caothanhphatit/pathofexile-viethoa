// Passive node preview for the Build Planner tree ("what does this node change").
//
// POST /api/builds/node-deltas sends a build plus node ids. nodeDeltasXml() puts a
//   <PlannerNodeDeltas nodes="123,456"/>
// element in the build XML, and the "PASSIVE NODE DELTAS" block of
// scripts/pob-calculate.lua answers it in the same PoB run: for each node, how the
// main stats change if it is allocated (or removed when already allocated), using
// PoB's fast misc calculator like PoB's own tree tooltip. The PC calculator's
// /calculate runs the same calculate.lua, so remote mode needs no extra path.

import { buildPobXml } from "./pob-build-xml.mjs";

/** Stats a node preview reports (same list as DELTA_STATS in scripts/pob-calculate.lua). */
export const NODE_DELTA_STATS = [
  "CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Armour", "Evasion",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP", "Str", "Dex", "Int"
];

/** Most nodes priced by one request (calculate.lua stops at 120). */
export const NODE_DELTAS_MAX_NODES = 60;

/** Positive integer node ids, deduplicated, in order. */
export const nodeDeltaIds = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map((id) => Number.parseInt(id, 10))
  .filter((id) => Number.isInteger(id) && id > 0))];

/** The build XML (without any stat breakdown request) with a node-delta request for `ids`. */
export function nodeDeltasXml(build, ids) {
  const { analysis: _analysis, ...rest } = build || {};
  const nodes = nodeDeltaIds(ids).slice(0, NODE_DELTAS_MAX_NODES);
  const xml = buildPobXml(rest);
  if (!nodes.length) return xml;
  return xml.replace(/<\/PathOfBuilding2>\s*$/, `\t<PlannerNodeDeltas nodes="${nodes.join(",")}"/>\n</PathOfBuilding2>\n`);
}

/**
 * The node preview part of a calculate.lua answer: the build's own numbers for the
 * preview stats and, per node id, what allocating (or removing) it changes.
 */
export function nodeDeltasFromOutput(output) {
  const base = {};
  for (const stat of NODE_DELTA_STATS) {
    if (typeof output?.[stat] === "number") base[stat] = output[stat];
  }
  const raw = output?.NodeDeltas;
  const nodes = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  // dkjson writes an empty Lua table as [], so "no change" comes back as an array.
  const stats = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  for (const entry of Object.values(nodes)) {
    if (!entry || typeof entry !== "object") continue;
    entry.node = stats(entry.node);
    if ("path" in entry) entry.path = stats(entry.path);
  }
  return { base, nodes };
}

/** Prices a batch of passive nodes with one PoB run (local or remote runner). */
export async function runNodeDeltas(runner, xml) {
  return nodeDeltasFromOutput(await runner.run(xml));
}
