// Shared request validation, sanitization, XML preparation and response formatting
// for build calculations and passive node deltas. Used by both the Fastify server
// routes (src/server/routes/public.mjs) and the browser local PoB backend
// (src/spa/lib/calcBackend.ts) so both paths produce identical responses.
import { dropImpossibleOffHands } from "./equipment-rules.mjs";
import { calculationRowItem, dropInvalidItemRows } from "./item-validation.mjs";
import { buildPobXml } from "../server/pob-build-xml.mjs";
import { NODE_DELTAS_MAX_NODES, nodeDeltaIds, nodeDeltasFromOutput, nodeDeltasXml } from "../server/pob-node-deltas.mjs";

/**
 * Validates and sanitizes a POST /api/builds/calculate body and generates its PoB XML.
 * Does not mutate `buildData`.
 */
export function prepareCalculateRequest(buildData, { modPool = null } = {}) {
  if (!buildData || typeof buildData !== "object") {
    return { ok: false, statusCode: 400, error: "Missing build data" };
  }
  const build = { ...buildData };
  // Edited or pasted items that break the rules are left out (and reported), not the whole build.
  const checked = dropInvalidItemRows(build.inventory_slots, calculationRowItem, modPool);
  const itemErrors = checked.problems;
  if (itemErrors.length) build.inventory_slots = checked.rows;
  // An off-hand that cannot be held with its main hand (bow + shield, staff + focus...)
  // is left out as well: PoB loads the pair from XML without checking it.
  const weaponSets = dropImpossibleOffHands(build.inventory_slots, build.passives);
  const equipmentDropped = weaponSets.dropped;
  if (equipmentDropped.length) build.inventory_slots = weaponSets.rows;
  const xml = buildPobXml(build);
  return { ok: true, build, xml, itemErrors, equipmentDropped };
}

/** Formats a successful build calculation response with the exact route shape. */
export function formatCalculateResponse(stats, { itemErrors = [], equipmentDropped = [] } = {}) {
  return {
    ok: true,
    data: stats,
    ...(itemErrors.length ? { item_errors: itemErrors } : {}),
    ...(equipmentDropped.length ? { equipment_dropped: equipmentDropped } : {})
  };
}

/**
 * Validates and sanitizes a POST /api/builds/node-deltas body and generates its PoB XML.
 * Does not mutate `buildData`.
 */
export function prepareNodeDeltasRequest(buildData, { modPool = null } = {}) {
  if (!buildData || typeof buildData !== "object") {
    return { ok: false, statusCode: 400, error: "Missing build data" };
  }
  const nodeIds = nodeDeltaIds(buildData.node_ids);
  if (!nodeIds.length) {
    return { ok: false, statusCode: 400, error: "node_ids must list passive node ids" };
  }
  if (nodeIds.length > NODE_DELTAS_MAX_NODES) {
    return { ok: false, statusCode: 400, error: `At most ${NODE_DELTAS_MAX_NODES} node_ids per request` };
  }
  const { node_ids: _ids, analysis: _analysis, calc_priority: _priority, ...build } = buildData;
  const checked = dropInvalidItemRows(build.inventory_slots, calculationRowItem, modPool);
  build.inventory_slots = dropImpossibleOffHands(checked.rows, build.passives).rows;
  const xml = nodeDeltasXml(build, nodeIds);
  return { ok: true, build, nodeIds, xml };
}

/** Formats a successful node-deltas response with the exact route shape. */
export function formatNodeDeltasResponse(output) {
  return { ok: true, data: nodeDeltasFromOutput(output) };
}

/** Runs a full build calculation request through any PoB executor (`runPob(xml) -> output`). */
export async function runCalculateRequest(buildData, { runPob, modPool = null } = {}) {
  const prep = prepareCalculateRequest(buildData, { modPool });
  if (!prep.ok) return { ok: false, error: prep.error };
  const stats = await runPob(prep.xml, prep);
  return formatCalculateResponse(stats, prep);
}

/** Runs a full node-deltas request through any PoB executor (`runPob(xml) -> output`). */
export async function runNodeDeltasRequest(buildData, { runPob, modPool = null } = {}) {
  const prep = prepareNodeDeltasRequest(buildData, { modPool });
  if (!prep.ok) return { ok: false, error: prep.error };
  const output = await runPob(prep.xml, prep);
  return formatNodeDeltasResponse(output);
}
