import crypto from "node:crypto";

const normalizeText = (value = "") => String(value)
  .replace(/\u00a0/g, " ")
  .replace(/[ \t\r\n]+/g, " ")
  .trim();

const roundCoord = (value) => Number(Number(value || 0).toFixed(4));
const finiteNumber = (value) => Number.isFinite(Number(value));
const hiddenPassiveClasses = new Set(["Marauder"]);
const isVisiblePassiveClass = (name = "") => !hiddenPassiveClasses.has(normalizeText(name));
const passiveRawStats = (node = {}) => (node.stats || []).map(normalizeText).filter(Boolean);
const isPassiveMasteryNode = (node = {}) => Boolean(node.isMastery || /mastery/i.test(node.name || ""));

const shouldDropPassiveTreeNode = (node = {}) => {
  const stats = passiveRawStats(node);
  if (isPassiveMasteryNode(node) && !stats.length) return true;
  return !normalizeText(node.name) && !stats.length && !normalizeText(node.icon);
};

export const passiveSourceHash = (value) =>
  crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const treePathMatch = (path = "") => String(path).match(/^src\/TreeData\/(\d+(?:_\d+)*)\/tree\.json$/i);
const versionScore = (version = "") => String(version).split("_").map((part) => Number(part || 0));

export const selectLatestPassiveTreePath = (paths = []) => {
  const rows = paths
    .map((path) => {
      const match = treePathMatch(path);
      return match ? { version: match[1], path } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const left = versionScore(a.version);
      const right = versionScore(b.version);
      const max = Math.max(left.length, right.length);
      for (let index = 0; index < max; index += 1) {
        const delta = (right[index] || 0) - (left[index] || 0);
        if (delta !== 0) return delta;
      }
      return a.path.localeCompare(b.path);
    });
  if (!rows[0]) throw new Error("No passive tree data path found under src/TreeData/*/tree.json");
  return rows[0];
};

const sortedJson = (value) => {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
};

const nodeHash = (node) => passiveSourceHash(sortedJson({
  id: node.id,
  name: node.name,
  type: node.type,
  stats: node.stats,
  group: node.group,
  orbit: node.orbit,
  orbit_index: node.orbit_index,
  arc: node.arc,
  icon_path: node.icon_path,
  classes_start: node.classes_start,
  is_class_start: node.is_class_start,
  is_ascendancy_start: node.is_ascendancy_start,
  is_mastery: node.is_mastery,
  ascendancy_name: node.ascendancy_name,
  connections: node.connections
}));

const normalizeId = (value) => String(value ?? "").trim();

const normalizeRenderMetadata = (value) => {
  if (Array.isArray(value)) return value.map(normalizeRenderMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [
      key,
      typeof entry === "number" ? roundCoord(entry) : normalizeRenderMetadata(entry)
    ]));
};

const passiveType = (node = {}, jewelSlots = new Set()) => {
  const id = normalizeId(node.skill ?? node.id);
  if (node.isKeystone) return "keystone";
  if (node.isJewelSocket || jewelSlots.has(id)) return "jewel";
  if (node.isOnlyImage) return "only_image";
  if (node.isMastery || /mastery/i.test(node.name || "")) return "mastery";
  if (node.ascendancyName || node.ascendancyId) return node.isAscendancyStart ? "ascendancy_start" : node.isNotable ? "ascendancy_notable" : "ascendancy";
  if (node.isNotable) return "notable";
  return "small";
};

const buildAscendancyLookup = (classes = []) => {
  const byId = new Map();
  const byName = new Map();
  for (const row of classes || []) {
    for (const ascendancy of row.ascendancies || []) {
      const meta = {
        className: normalizeText(row.name),
        ascendancyName: normalizeText(ascendancy.name || ascendancy.id || ""),
        ascendancyId: normalizeId(ascendancy.id || ascendancy.internalId || ascendancy.name)
      };
      if (meta.ascendancyId) byId.set(meta.ascendancyId, meta);
      if (meta.ascendancyName) byName.set(meta.ascendancyName, meta);
    }
  }
  return { byId, byName };
};

const buildStartNodeLookups = (classes = [], nodes = {}) => {
  const classStarts = new Map();
  const ascendancyStarts = new Map();
  const { byId: ascendancyById } = buildAscendancyLookup(classes);
  for (const rawNode of Object.values(nodes || {})) {
    const id = normalizeId(rawNode.skill ?? rawNode.id);
    for (const className of rawNode.classesStart || []) {
      const normalized = normalizeText(className);
      if (isVisiblePassiveClass(normalized)) classStarts.set(normalized, id);
    }
    for (const classIndex of rawNode.classStartIndex || []) {
      const className = normalizeText(classes?.[Number(classIndex)]?.name);
      if (className && isVisiblePassiveClass(className)) classStarts.set(className, id);
    }
    if (rawNode.isAscendancyStart && rawNode.ascendancyName) {
      ascendancyStarts.set(normalizeText(rawNode.ascendancyName), id);
    }
    if (rawNode.isAscendancyStart && rawNode.ascendancyId) {
      const asc = ascendancyById.get(normalizeId(rawNode.ascendancyId));
      if (asc?.ascendancyName) ascendancyStarts.set(asc.ascendancyName, id);
    }
    if (rawNode.isSwitchable && rawNode.options && typeof rawNode.options === "object") {
      for (const ascendancyName of Object.keys(rawNode.options)) {
        ascendancyStarts.set(normalizeText(ascendancyName), id);
      }
    }
  }
  return { classStarts, ascendancyStarts };
};

const buildClassRows = (classes = [], nodes = {}) => {
  const { classStarts, ascendancyStarts } = buildStartNodeLookups(classes, nodes);
  return classes.filter((row) => isVisiblePassiveClass(row.name)).map((row) => ({
    id: String(row.integerId ?? row.name),
    name: row.name || "",
    base_str: Number(row.base_str || 0),
    base_dex: Number(row.base_dex || 0),
    base_int: Number(row.base_int || 0),
    start_node_id: classStarts.get(normalizeText(row.name)) || "",
    ...(row.background ? { background: normalizeRenderMetadata(row.background) } : {}),
    ascendancies: (row.ascendancies || []).map((asc) => ({
      id: asc.id || asc.internalId || asc.name,
      internal_id: asc.internalId || "",
      name: asc.name || asc.id || "",
      start_node_id: ascendancyStarts.get(normalizeText(asc.name || asc.id || "")) || "",
      ...(asc.background ? { background: normalizeRenderMetadata(asc.background) } : {}),
      ...(asc.replace ? { replace: normalizeRenderMetadata(asc.replace) } : {}),
      ...(asc.replaceBy ? { replace_by: normalizeRenderMetadata(asc.replaceBy) } : {})
    }))
  }));
};

const buildGroupRows = (groups = {}, nodeIds = null) => Object.entries(groups)
  .filter(([, group]) => group && typeof group === "object")
  .map(([id, group]) => ({
    id: normalizeId(id),
    x: roundCoord(group.x),
    y: roundCoord(group.y),
    orbits: group.orbits || [],
    nodes: (group.nodes || []).map(normalizeId).filter((nodeId) => !nodeIds || nodeIds.has(nodeId)),
    ...(group.background ? { background: normalizeRenderMetadata(group.background) } : {})
  }));

const buildNodeGroupLookup = (groups = {}) => {
  const lookup = new Map();
  for (const [groupId, group] of Object.entries(groups)) {
    if (!group || typeof group !== "object") continue;
    for (const nodeId of group.nodes || []) {
      lookup.set(normalizeId(nodeId), normalizeId(groupId));
    }
  }
  return lookup;
};

const sourceNodeGroup = (rawNode = {}, rawTree = {}, nodeGroupLookup = new Map()) => {
  const id = normalizeId(rawNode.skill ?? rawNode.id);
  const groupId = nodeGroupLookup.get(id) || normalizeId(rawNode.group);
  const group = rawTree.groups?.[groupId] || rawTree.groups?.[rawNode.group] || null;
  return { groupId, group };
};

const shouldExportPassiveTreeNode = (rawNode = {}, rawTree = {}, nodeGroupLookup = new Map()) => {
  const { group, groupId } = sourceNodeGroup(rawNode, rawTree, nodeGroupLookup);
  if (!groupId || !group || typeof group !== "object") return false;
  if (rawNode.isProxy || group.isProxy) return false;
  if (rawNode.expansionJewel?.parent) return false;
  if (rawNode.isOnlyImage) return false;
  if (shouldDropPassiveTreeNode(rawNode)) return false;
  return true;
};

export const passiveIconAssetPath = (icon = "") => {
  const clean = normalizeText(icon).replace(/\\/g, "/");
  const match = clean.match(/^Art\/2DArt\/SkillIcons\/(?:passives\/)?(.+?)\.(?:dds|png)$/i);
  if (!match) return "";
  return `/assets/passive-tree/icons/${match[1]}.webp`;
};

const buildTreeConstants = (constants = {}) => ({
  orbitAnglesByOrbit: (constants.orbitAnglesByOrbit || []).map((rows) => (rows || []).map(Number)),
  orbitRadii: (constants.orbitRadii || []).map(Number),
  skillsPerOrbit: (constants.skillsPerOrbit || []).map(Number)
});

const passiveTreeScaleImage = (rawTree = {}) => {
  const value = Number(rawTree.scaleImage ?? rawTree.scale_image ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const passiveTreeSize = (rawTree = {}, scaleImage = passiveTreeScaleImage(rawTree)) => {
  const explicitSize = Number(rawTree.size ?? rawTree.tree_size ?? 0);
  if (Number.isFinite(explicitSize) && explicitSize > 0) return roundCoord(explicitSize);
  const width = Number(rawTree.max_x || 0) - Number(rawTree.min_x || 0);
  const height = Number(rawTree.max_y || 0) - Number(rawTree.min_y || 0);
  const smallerAxis = Math.min(Math.abs(width), Math.abs(height));
  return smallerAxis > 0 ? roundCoord(smallerAxis * scaleImage * 1.1) : 0;
};

const nodeCoordinates = (node, group, constants = {}, scaleImage = 1) => {
  const hasExplicitCoords = finiteNumber(node.x) && finiteNumber(node.y);
  const orbit = Number(node.orbit || 0);
  const orbitIndex = Number(node.orbitIndex || 0);
  const radius = Number(constants.orbitRadii?.[orbit] || 0) * scaleImage;
  const dataAngle = Number(constants.orbitAnglesByOrbit?.[orbit]?.[orbitIndex]);
  const skillsPerOrbit = Number(constants.skillsPerOrbit?.[orbit] || constants.orbitAnglesByOrbit?.[orbit]?.length || 1);
  const angle = Number.isFinite(dataAngle)
    ? dataAngle
    : skillsPerOrbit > 0
      ? (Math.PI * 2 * orbitIndex) / skillsPerOrbit
      : 0;
  if (hasExplicitCoords) {
    return {
      x: roundCoord(node.x),
      y: roundCoord(node.y),
      arc: roundCoord(Number(node.arc ?? angle))
    };
  }
  return {
    x: roundCoord((Number(group?.x || 0) * scaleImage) + Math.sin(angle) * radius),
    y: roundCoord((Number(group?.y || 0) * scaleImage) - Math.cos(angle) * radius),
    arc: roundCoord(angle)
  };
};

const normalizeNode = (rawNode, rawTree, treeVersion, nodeGroupLookup = new Map(), ascendancyById = new Map()) => {
  const id = normalizeId(rawNode.skill ?? rawNode.id);
  const groupId = nodeGroupLookup.get(id) || normalizeId(rawNode.group);
  const group = rawTree.groups?.[groupId] || rawTree.groups?.[rawNode.group] || {};
  const coords = nodeCoordinates(rawNode, group, rawTree.constants || {}, passiveTreeScaleImage(rawTree));
  const jewelSlots = new Set((rawTree.jewelSlots || []).map(normalizeId));
  const stats = passiveRawStats(rawNode);
  const statsVi = stats.map(translatePassiveStatLine);
  const classesStart = [
    ...(rawNode.classesStart || []).map(normalizeText),
    ...(rawNode.classStartIndex || []).map((classIndex) => normalizeText(rawTree.classes?.[Number(classIndex)]?.name))
  ].filter((name) => name && isVisiblePassiveClass(name));
  const asc = ascendancyById.get(normalizeId(rawNode.ascendancyId)) || null;
  const connections = [
    ...(rawNode.connections || []).map((conn) => ({
      id: normalizeId(conn.id),
      orbit: Number(conn.orbit || 0)
    })),
    ...(rawNode.out || []).map((targetId) => ({
      id: normalizeId(targetId),
      orbit: 0
    }))
  ].filter((conn) => conn.id);
  const node = {
    id,
    tree_version: treeVersion,
    name: normalizeText(rawNode.name),
    type: passiveType(rawNode, jewelSlots),
    group: groupId,
    orbit: Number(rawNode.orbit || 0),
    orbit_index: Number(rawNode.orbitIndex || 0),
    x: coords.x,
    y: coords.y,
    arc: coords.arc,
    icon: rawNode.icon || "",
    icon_path: passiveIconAssetPath(rawNode.icon),
    classes_start: classesStart,
    is_class_start: classesStart.length > 0,
    ascendancy_name: rawNode.ascendancyName || asc?.ascendancyName || "",
    is_ascendancy_start: Boolean(rawNode.isAscendancyStart),
    is_mastery: Boolean(rawNode.isMastery),
    stats,
    stats_vi: statsVi,
    recipe: rawNode.recipe || [],
    connections,
    raw: {
      ...rawNode,
      normalized: {
        arc: coords.arc,
        icon_path: passiveIconAssetPath(rawNode.icon),
        classes_start: classesStart,
        is_class_start: classesStart.length > 0,
        is_ascendancy_start: Boolean(rawNode.isAscendancyStart),
        is_mastery: Boolean(rawNode.isMastery)
      }
    }
  };
  return {
    ...node,
    source_hash: nodeHash(node)
  };
};

const nodeAscendancyLayer = (node = {}) => normalizeText(node.ascendancy_name || node.ascendancyName);

const nodeIsClassStart = (node = {}) =>
  Boolean(node.is_class_start || node.classesStart || node.classes_start?.length);

const shouldRenderPassiveTreeEdge = (fromNode = null, toNode = null) => {
  if (!fromNode || !toNode) return false;
  if (nodeAscendancyLayer(fromNode) !== nodeAscendancyLayer(toNode)) return false;
  if (nodeIsClassStart(fromNode) || nodeIsClassStart(toNode)) return false;
  return true;
};

const buildEdgeRows = (nodes = [], { renderOnly = false } = {}) => {
  const edges = new Map();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const conn of node.connections || []) {
      const otherNode = nodesById.get(conn.id);
      if (!otherNode || node.id === conn.id) continue;
      if (renderOnly && !shouldRenderPassiveTreeEdge(node, otherNode)) continue;
      const [from, to] = [node.id, conn.id].sort((a, b) => Number(a) - Number(b));
      const key = `${from}:${to}`;
      if (!edges.has(key)) edges.set(key, { from: node.id, to: conn.id, orbit: Number(conn.orbit || 0) });
    }
  }
  return [...edges.values()].sort((a, b) => Number(a.from) - Number(b.from) || Number(a.to) - Number(b.to));
};

const normalizeEdgeRow = (edge = {}, nodesById = new Map()) => {
  const from = normalizeId(edge.from ?? edge.fromKey);
  const to = normalizeId(edge.to ?? edge.toKey);
  if (!from || !to || from === to || !nodesById.has(from) || !nodesById.has(to)) return null;
  const row = {
    from,
    to,
    orbit: Number(edge.orbit || 0)
  };
  if (finiteNumber(edge.orbitX)) row.orbit_x = roundCoord(edge.orbitX);
  if (finiteNumber(edge.orbitY)) row.orbit_y = roundCoord(edge.orbitY);
  return row;
};

const edgeKey = (edge) => {
  const [from, to] = [edge.from, edge.to].sort((a, b) => Number(a) - Number(b));
  return `${from}:${to}`;
};

const buildRawEdgeRows = (rawTree = {}, nodes = [], { renderOnly = false } = {}) => {
  if (!Array.isArray(rawTree.edges) || !rawTree.edges.length) return null;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = new Map();
  for (const rawEdge of rawTree.edges) {
    const edge = normalizeEdgeRow(rawEdge, nodesById);
    if (!edge) continue;
    if (renderOnly && !shouldRenderPassiveTreeEdge(nodesById.get(edge.from), nodesById.get(edge.to))) continue;
    const key = edgeKey(edge);
    if (!edges.has(key)) edges.set(key, edge);
  }
  return [...edges.values()].sort((a, b) => Number(a.from) - Number(b.from) || Number(a.to) - Number(b.to));
};

export const normalizePassiveTree = (rawTree = {}, {
  treeVersion = rawTree.version || rawTree.tree || "unknown",
  sourceUrl = "",
  sourceRef = "dev"
} = {}) => {
  const scaleImage = passiveTreeScaleImage(rawTree);
  const nodeGroupLookup = buildNodeGroupLookup(rawTree.groups || {});
  const sourceNodes = Object.values(rawTree.nodes || {})
    .filter((node) => shouldExportPassiveTreeNode(node, rawTree, nodeGroupLookup));
  const sourceNodeIds = new Set(sourceNodes.map((node) => normalizeId(node.skill ?? node.id)));
  const classes = buildClassRows(rawTree.classes || [], rawTree.nodes || {});
  const groups = buildGroupRows(rawTree.groups || {}, sourceNodeIds);
  const constants = buildTreeConstants(rawTree.constants || {});
  const { byId: ascendancyById } = buildAscendancyLookup(rawTree.classes || []);
  const nodes = sourceNodes
    .map((node) => normalizeNode(node, rawTree, treeVersion, nodeGroupLookup, ascendancyById))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const pathEdges = buildRawEdgeRows(rawTree, nodes) || buildEdgeRows(nodes);
  const edges = buildRawEdgeRows(rawTree, nodes, { renderOnly: true }) || buildEdgeRows(nodes, { renderOnly: true });
  return {
    version: treeVersion,
    tree: rawTree.tree || "Default",
    scale_image: scaleImage,
    tree_size: passiveTreeSize(rawTree, scaleImage),
    source_url: sourceUrl,
    source_ref: sourceRef,
    source_hash: passiveSourceHash(sortedJson({
      tree: rawTree.tree,
      scaleImage,
      min_x: rawTree.min_x,
      max_x: rawTree.max_x,
      min_y: rawTree.min_y,
      max_y: rawTree.max_y,
      classes: rawTree.classes,
      constants: rawTree.constants,
      groups: rawTree.groups,
      nodes: rawTree.nodes
    })),
    bounds: {
      min_x: Number(rawTree.min_x || 0),
      max_x: Number(rawTree.max_x || 0),
      min_y: Number(rawTree.min_y || 0),
      max_y: Number(rawTree.max_y || 0)
    },
    counts: {
      classes: classes.length,
      groups: groups.length,
      nodes: nodes.length,
      edges: edges.length,
      path_edges: pathEdges.length
    },
    constants,
    classes,
    groups,
    nodes,
    edges,
    path_edges: pathEdges
  };
};

const phraseReplacements = [
  [/\bOne[- ]Handed (?:Melee|Martial) Weapons?\b/gi, "vũ khí cận chiến 1 tay"],
  [/\bTwo[- ]Handed Melee Weapons?\b/gi, "vũ khí cận chiến 2 tay"],
  [/\bEquipped (Body Armour|Armour Items|Helmet|Shield|Focus|Boots|Gloves)\b/gi, "$1 đang trang bị"],
  [/\bAttack Area Damage\b/gi, "Damage đánh lan"],
  [/\bSpell Area Damage\b/gi, "Damage phép lan"],
  [/\bArea Damage\b/gi, "Damage lan"],
  [/\bMelee Damage\b/gi, "sát thương đánh gần"],
  [/\bArea of Effect\b/gi, "khu vực đánh lan"],
  [/\bCritical Hit Chance\b/gi, "cơ hội Critical Hit"],
  [/\bBase Chance to Block\b/gi, "Base cơ hội Block"],
  [/\bChance to Block\b/gi, "cơ hội Block"],
  [/\bChance to Hit\b/gi, "cơ hội Hit"],
  [/\bHazard Damage\b/gi, "Damage của Hazard"],
  [/\bHazard Durations?\b/gi, "thời lượng Hazard"],
  [/\bIgnite Magnitude\b/gi, "Magnitude của bỏng"],
  [/\bIgnite Durations?\b/gi, "thời lượng bỏng"],
  [/\bMagnitude of Ignite\b/gi, "Magnitude của bỏng"],
  [/\bDuration of Ignite\b/gi, "thời lượng bỏng"],
  [/\bBleeding Durations?\b/gi, "thời lượng Bleeding (chảy máu)"],
  [/\bMagnitude of Bleeding\b/gi, "Magnitude của Bleeding (chảy máu)"],
  [/\bDuration of Bleeding\b/gi, "thời lượng Bleeding (chảy máu)"],
  [/\bItem Evasion Rating\b/gi, "chỉ số né tránh từ Item"],
  [/\bEvasion Rating\b/gi, "chỉ số né tránh"],
  [/\bDamage reduction\b/gi, "Damage Reduction"],
  [/\bMagnitudes\b/gi, "Magnitude"],
  [/\bDeflected Hits?\b/gi, "Hit bị Deflect"],
  [/\bto Pierce an Enemy\b/gi, "xuyên kẻ địch"],
  [/\bto Pierce kẻ địch\b/gi, "xuyên kẻ địch"],
  [/\bPierce an Enemy\b/gi, "xuyên kẻ địch"],
  [/\bPierce Enemies\b/gi, "xuyên kẻ địch"],
  [/\bPierce enemies\b/gi, "xuyên kẻ địch"],
  [/\bPierce\b/gi, "xuyên"],
  [/\b(Skill|Flask|Charm) Effect Durations?\b/gi, "thời lượng hiệu ứng $1"],
  [/\bduring any (Life |Mana )?Flask Effect\b/gi, "trong thời gian hiệu ứng $1Flask bất kỳ"],
  [/\bduring (Life |Mana )?Flask Effect\b/gi, "trong thời gian hiệu ứng $1Flask"],
  [/\b(Skill|Flask|Charm|Exposure|Blind|Wither|Aura|Curse|Presence|Buff|Debuff|Poison|Ignite|Shock|Chill|Freeze|Ailment|Elemental Ailment) Effects?\b/gi, "hiệu ứng $1"],
  [/\bwhile stationary\b/gi, "khi đứng yên"],
  [/\bwhile moving\b/gi, "khi di chuyển"],
  [/\bwhile holding a Shield\b/gi, "khi đang cầm Shield"],
  [/\bholding a Shield\b/gi, "đang cầm Shield"],
  [/\bstationary\b/gi, "đứng yên"],
  [/\bNon-Instant (Spell|Attack)s\b/gi, "$1 không tức thời"],
  [/\bNon-Instant (Spell|Attack)\b/gi, "$1 không tức thời"],
  [/\bNon-Instant\b/gi, "không tức thời"],
  [/\bis Instant\b/gi, "là tức thời"],
  [/\bis instant\b/gi, "là tức thời"],
  [/\bLife Leech\b/gi, "hút máu"],
  [/\bMana Leech\b/gi, "hút mana"],
  [/\bLife Leeched\b/gi, "máu hút được"],
  [/\bMana Leeched\b/gi, "mana hút được"],
  [/\bLeeching Mana\b/gi, "đang hút mana"],
  [/\bLeeching Life\b/gi, "đang hút máu"],
  [/\bLeeching\b/gi, "đang hút"],
  [/\bof Leech is Instant\b/gi, "lượng hút là tức thời"],
  [/\bstanding on\b/gi, "đứng trên"],
  [/\bwhile on (Full|Low) Life\b/gi, "khi đang $1 Life"],
  [/\bwhen on (Full|Low) Life\b/gi, "khi đang $1 Life"],
  [/\bwhile on\b/gi, "khi ở trên"],
  [/\bwhen on\b/gi, "khi ở trên"],
  [/\bon (.+? Ground)\b/gi, "trên $1"],
  [/\bof (.+?) on you\b/gi, "của $1 lên bạn"],
  [/\bof (.+?) on You\b/gi, "của $1 lên bạn"],
  [/\bon You\b/gi, "lên bạn"],
  [/\bon you\b/gi, "lên bạn"],
  [/\bon bạn\b/gi, "lên bạn"],
  [/\bon Bạn\b/gi, "lên bạn"],
  [/\bduring Effect of any\b/gi, "trong thời gian hiệu ứng của bất kỳ"],
  [/\bduring Effect of\b/gi, "trong thời gian hiệu ứng của"],
  [/\bduring any\b/gi, "trong bất kỳ"],
  [/\bduring\b/gi, "trong thời gian"],
  [/\bEffect of\b/gi, "hiệu ứng của"],
  [/\bEffect\b/gi, "hiệu ứng"],
  [/\beffect\b/gi, "hiệu ứng"],
  [/\bDuration of\b/gi, "thời lượng của"],
  [/\bduration of\b/gi, "thời lượng của"],
  [/\bDuration\b/gi, "thời lượng"],
  [/\bduration\b/gi, "thời lượng"],
  [/\bmaximum Life\b/gi, "Life tối đa"],
  [/\bmaximum Mana\b/gi, "Mana tối đa"],
  [/\bmaximum Energy Shield\b/gi, "Energy Shield tối đa"],
  [/\bMaximum Life\b/g, "Life tối đa"],
  [/\bMaximum Mana\b/g, "Mana tối đa"],
  [/\bMaximum Energy Shield\b/g, "Energy Shield tối đa"],
  [/\bMaximum Spirit\b/g, "Spirit tối đa"],
  [/\bMaximum Darkness\b/g, "Darkness tối đa"],
  [/\bMaximum Rage\b/g, "Rage tối đa"],
  [/\bMaximum (Fire|Cold|Lightning|Chaos|Physical) Damage\b/g, "$1 Damage tối đa"],
  [/\bEnemy Elemental Resistances\b/gi, "Elemental Resistance của kẻ địch"],
  [/\bEnemy (Fire|Cold|Lightning|Chaos|Physical) Resistances\b/gi, "$1 Resistance của kẻ địch"],
  [/\ball Maximum Elemental Resistances\b/gi, "toàn bộ Maximum Elemental Resistance"],
  [/\ball Elemental Resistances\b/gi, "toàn bộ Elemental Resistance"],
  [/\bElemental Resistances\b/gi, "Elemental Resistance"],
  [/\ball Attributes\b/gi, "toàn bộ Attribute"],
  [/\bany Attribute\b/gi, "bất kỳ Attribute nào"],
  [/\bAttributes\b/gi, "Attribute"],
  [/\bDamaging Ailments\b/gi, "Ailment gây damage"],
  [/\bDamaging Ailment\b/gi, "Ailment gây damage"],
  [/\b(Ignited|Chilled|Shocked|Frozen|Poisoned|Bleeding|Cursed|Withered|Blinded|Burning|Hindered|Maimed|Exposed|Stunned|Pinned|Marked|Petrified|Terrorised|Terrorized) Enemies?\b/gi, "kẻ địch đang bị $1"],
  [/\bEnemies?\b/gi, "kẻ địch"],
  [/\bEnemy\b/gi, "kẻ địch"],
  [/\bon kẻ địch\b/gi, "lên kẻ địch"],
  [/\bin your Presence\b/gi, "trong Presence của bạn"],
  [/\byour Presence\b/gi, "Presence của bạn"],
  [/\byour tree\b/gi, "tree của bạn"],
  [/\byour highest Attribute\b/gi, "Attribute cao nhất của bạn"],
  [/\byour maximum Rage\b/gi, "Rage tối đa của bạn"],
  [/\byour maximum (Life|Mana|Energy Shield|Spirit|Rage|Darkness)\b/gi, "$1 tối đa của bạn"],
  [/\byou've successfully Parried Recently\b/gi, "gần đây bạn Parry thành công"],
  [/\byou have not been Hit Recently\b/gi, "gần đây bạn chưa bị Hit"],
  [/\byou've consumed a Power Charge Recently\b/gi, "gần đây bạn đã Consume Power Charge"],
  [/\byour\b/gi, "của bạn"],
  [/\bYou\b/g, "Bạn"],
  [/\byou\b/g, "bạn"],
  [/\bwhile Shapeshifted\b/gi, "khi đang biến hình"],
  [/\bbeing Shapeshifted\b/gi, "đang biến hình"],
  [/\bwere Shapeshifted\b/gi, "đã biến hình"],
  [/\bShapeshifted\b/gi, "biến hình"],
  [/\bShapeshifting\b/gi, "biến hình"],
  [/\bShapeshift\b/gi, "biến hình"],
  [/\bwhile Dual Wielding\b/gi, "khi cầm hai vũ khí"],
  [/\bwhile wielding an? (.+?)$/gi, "khi đang cầm $1"],
  [/\bwhile wielding\b/gi, "khi đang cầm"],
  [/\bwielding\b/gi, "đang cầm"],
  [/\bwhen you use\b/gi, "khi bạn dùng"],
  [/\bper Enemy in Close Range\b/gi, "mỗi kẻ địch ở Close Range"],
  [/\bper second\b/gi, "mỗi giây"],
  [/\bper Level\b/gi, "mỗi Level"],
  [/\bper ten percent missing Mana\b/gi, "mỗi 10% Mana đang thiếu"],
  [/\bper 100 maximum Mana\b/gi, "mỗi 100 Mana tối đa"],
  [/\bper 1% Chaos Resistance\b/gi, "mỗi 1% Chaos Resistance"],
  [/\bper\b/gi, "mỗi"],
  [/\bDuration of Ignite, Shock and Chill on kẻ địch\b/gi, "thời lượng Ignite, Shock và Chill lên kẻ địch"],
  [/\bchance to inflict Bleeding on Hit\b/gi, "chance gây Bleeding khi Hit"],
  [/\bchance to Shock\b/gi, "chance gây Shock"],
  [/\bchance to Avoid\b/gi, "chance Avoid"],
  [/\bchance to gain\b/gi, "chance nhận"],
  [/\bwhen bạn gain\b/gi, "khi bạn nhận"],
  [/\bto gain\b/gi, "để nhận"],
  [/\bGain\b/g, "Nhận"],
  [/\bgain\b/g, "nhận"],
  [/\bPhysical Damage Reduction\b/gi, "Physical Damage Reduction"],
  [/\bSlowing Potency of Debuffs\b/gi, "Slowing Potency của Debuff"],
  [/\bAura Skills\b/gi, "Aura Skill"],
  [/\bBanner Skills\b/gi, "Banner Skill"],
  [/\bSlam Skills\b/gi, "Slam Skill"],
  [/\bMark Skills\b/gi, "Mark Skill"],
  [/\bSkill Gems\b/gi, "Skill Gem"],
  [/\bAttribute Requirements\b/gi, "Attribute Requirement"],
  [/\bGems\b/gi, "Gem"],
  [/\bEquipment\b/gi, "Trang bị"],
  [/\bAllies\b/gi, "Allies"],
  [/\bCosts?\b/gi, "Cost"],
  [/\bcosts?\b/gi, "Cost"],
  [/\bPassives\b/gi, "Passive"],
  [/\bRemnants\b/gi, "Remnant"],
  [/\bMinions\b/gi, "Minion"],
  [/\bTotems\b/gi, "Totem"],
  [/\bCurses\b/gi, "Curse"],
  [/\bAilments\b/gi, "Ailment"],
  [/\bPoisons\b/gi, "Poison"],
  [/\bBanners\b/gi, "Banner"],
  [/\bCharms\b/gi, "Charm"],
  [/\bFlasks\b/gi, "Flask"],
  [/\bHazards\b/gi, "Hazard"],
  [/\bHits\b/gi, "Hit"],
  [/\bProjectiles\b/gi, "Projectile"],
  [/\bSpells\b/gi, "Spell"],
  [/\bAttacks\b/gi, "Attack"],
  [/\bWeapons\b/gi, "Weapon"],
  [/\bAxes\b/gi, "Axe"],
  [/\bMaces\b/gi, "Mace"],
  [/\bSwords\b/gi, "Sword"],
  [/\bBows\b/gi, "Bow"],
  [/\bSkills\b/gi, "Skill"],
  [/\bDebuffs\b/gi, "Debuff"],
  [/\bBuffs\b/gi, "Buff"],
  [/\bFreeze Buildup\b/gi, "Freeze Buildup (đóng băng)"],
  [/\bdeals\b/gi, "gây"],
  [/\bdeal\b/gi, "gây"],
  [/\bcauses\b/gi, "gây"],
  [/\bcause\b/gi, "gây"]
];

const cleanPassiveTranslation = (value = "") => normalizeText(value)
  .replace(/\bLife Flasks? Charges?\b/gi, "Charge bình máu")
  .replace(/\bLife Flasks? Effects?\b/gi, "hiệu ứng bình máu")
  .replace(/\bLife Flasks?\b/gi, "bình máu")
  .replace(/\bLife Recovery\b/gi, "hồi máu")
  .replace(/\bLife Regeneration\b/gi, "hồi máu")
  .replace(/\bBase Life Cost\b/gi, "Base Cost máu")
  .replace(/\bLife Costs?\b/gi, "Cost máu")
  .replace(/\bUnreserved Life\b/gi, "máu chưa reserve")
  .replace(/\bFull Life\b/gi, "đầy máu")
  .replace(/\bLow Life\b/gi, "Low máu")
  .replace(/\bMaximum Life\b/gi, "máu tối đa")
  .replace(/\bmaximum Life\b/gi, "máu tối đa")
  .replace(/\bLife\b/gi, "máu")
  .replace(/\bgần đây bạn đã bị Hit\b/gi, "bạn bị đánh trúng gần đây")
  .replace(/\bgần đây bạn bị Hit\b/gi, "bạn bị đánh trúng gần đây")
  .replace(/\bgần đây bạn chưa bị Hit\b/gi, "bạn chưa bị đánh trúng gần đây")
  .replace(/\bbị kẻ địch Hit\b/gi, "bị kẻ địch đánh trúng")
  .replace(/\bCritical Hit Chance\b/gi, "cơ hội Critical Hit")
  .replace(/\bBase Chance to Block\b/gi, "Base cơ hội Block")
  .replace(/\bChance to Block\b/gi, "cơ hội Block")
  .replace(/\bChance to Hit\b/gi, "cơ hội đánh trúng")
  .replace(/\bProjectile Attack Hit\b/g, "đòn đánh từ Projectile Attack")
  .replace(/\bProjectile Hit\b/g, "đòn đánh từ Projectile")
  .replace(/\bMelee Axe Hit\b/g, "đòn đánh cận chiến bằng Axe")
  .replace(/\bMelee Hit\b/g, "đòn đánh cận chiến")
  .replace(/\bSpell Hit\b/g, "đòn đánh từ Spell")
  .replace(/\bShocking Hit\b/g, "đòn đánh gây Shock")
  .replace(/\bAttack Hits?\b/g, "đòn đánh từ Attack")
  .replace(/\bCritically Hit\b/g, "Critical Hit")
  .replace(/\bBlocked Hit\b/g, "đòn đánh bị Block")
  .replace(/\bDeflected Hit\b/g, "đòn đánh bị Deflect")
  .replace(/\bHit Damage\b/g, "Damage từ đòn đánh")
  .replace(/\bHit damage\b/g, "Damage từ đòn đánh")
  .replace(/^Hit lên bạn\b/g, "Đòn đánh vào bạn")
  .replace(/\bHit lên bạn\b/g, "đòn đánh vào bạn")
  .replace(/^Hit Break\b/g, "Đòn đánh Break")
  .replace(/^Hit bỏ qua\b/g, "Đòn đánh bỏ qua")
  .replace(/^Hit gây\b/g, "Đòn đánh gây")
  .replace(/^Hit có/g, "Đòn đánh có")
  .replace(/^Hit của bạn\b/g, "Đòn đánh của bạn")
  .replace(/\bHit của bạn\b/g, "đòn đánh của bạn")
  .replace(/\bHit bị/g, "đòn đánh bị")
  .replace(/\bHit nhận vào\b/g, "đòn đánh nhận vào")
  .replace(/\bHit bạn nhận\b/g, "đòn đánh bạn nhận")
  .replace(/\bHit từ/g, "đòn đánh từ")
  .replace(/\btừ Hit\b/g, "từ đòn đánh")
  .replace(/\bbằng Hit\b/g, "bằng đòn đánh")
  .replace(/\bvới Hit\b/g, "với đòn đánh")
  .replace(/\bkhi bị Hit\b/g, "khi bị đánh trúng")
  .replace(/\bkhi Hit bằng\b/g, "khi đánh trúng bằng")
  .replace(/\bkhi Hit\b/g, "khi đánh trúng")
  .replace(/đã Hit kẻ địch với/g, "đã đánh trúng kẻ địch bằng")
  .replace(/đã Hit kẻ địch/g, "đã đánh trúng kẻ địch")
  .replace(/đã Hit/g, "đã đánh trúng")
  .replace(/bạn Hit bằng/g, "bạn đánh trúng bằng")
  .replace(/bạn Hit/g, "bạn đánh trúng")
  .replace(/\bHit kẻ địch với/g, "đánh trúng kẻ địch bằng")
  .replace(/\bHit kẻ địch\b/g, "đánh trúng kẻ địch")
  .replace(/kẻ địch Hit bạn/g, "kẻ địch đánh trúng bạn")
  .replace(/\bchance to inflict\b/gi, "cơ hội gây")
  .replace(/\bchance\b/gi, "cơ hội")
  .replace(/\bto Pierce an Enemy\b/gi, "xuyên kẻ địch")
  .replace(/\bto Pierce kẻ địch\b/gi, "xuyên kẻ địch")
  .replace(/\bPierce an Enemy\b/gi, "xuyên kẻ địch")
  .replace(/\bPierce Enemies\b/gi, "xuyên kẻ địch")
  .replace(/\bPierce enemies\b/gi, "xuyên kẻ địch")
  .replace(/\bPierce\b/gi, "xuyên")
  .replace(/\bIgnited\b/gi, "bỏng")
  .replace(/\bIgnites\b/gi, "bỏng")
  .replace(/\bIgnite\b/gi, "bỏng")
  .replace(/\bbị bạn bỏng\b/gi, "bị bạn gây bỏng")
  .replace(/\bbạn đã bỏng\b/gi, "bạn đã gây bỏng")
  .replace(/\bBleeding\b(?!\s*\(chảy máu\))/gi, "Bleeding (chảy máu)")
  .replace(/(^|[^\p{L}\p{N}_])(?:a|an)(?=$|[^\p{L}\p{N}_])/giu, "$1")
  .replace(/\s+([,.;:])/g, "$1")
  .replace(/\s+/g, " ")
  .trim();

const translatePassivePhrase = (value = "") => {
  let text = normalizeText(value);
  for (const [pattern, replacement] of phraseReplacements) {
    text = text.replace(pattern, replacement);
  }
  return cleanPassiveTranslation(text
    .replace(/\band\b/gi, "và")
    .replace(/\bor\b/gi, "hoặc")
    .replace(/\bwith\b/gi, "với")
    .replace(/\bfrom\b/gi, "từ")
    .replace(/\bfor\b/gi, "cho")
    .replace(/\bif\b/gi, "nếu")
    .replace(/\bwhen\b/gi, "khi")
    .replace(/\bwhile\b/gi, "khi")
    .replace(/\bagainst\b/gi, "lên")
    .replace(/\btargets\b/gi, "mục tiêu")
    .replace(/\btarget\b/gi, "mục tiêu")
    .replace(/\bRecently\b/g, "gần đây")
    .replace(/\brecently\b/g, "gần đây")
    .replace(/\s+/g, " ")
    .trim());
};

const translateRecentAction = (value = "") => {
  const clean = normalizeText(value).replace(/^an?\s+/i, "");
  const actionPatterns = [
    [/^successfully Parried$/i, () => "Parry thành công"],
    [/^Killed$/i, () => "giết kẻ địch"],
    [/^killed$/i, () => "giết kẻ địch"],
    [/^Attacked$/i, () => "tấn công"],
    [/^been Hit$/i, () => "bị Hit"],
    [/^been Stunned$/i, () => "bị Stunned"],
    [/^been Heavy Stunned$/i, () => "bị Heavy Stunned"],
    [/^Hit an Enemy$/i, () => "Hit kẻ địch"],
    [/^Hit$/i, () => "Hit"],
    [/^dealt (?:a )?Critical Hit$/i, () => "gây Critical Hit"],
    [/^dealt (?:a )?Non-Critical Hit$/i, () => "gây Non-Critical Hit"],
    [/^dealt (?:a )?Projectile Attack Hit$/i, () => "gây Projectile Attack Hit"],
    [/^dealt (?:a )?Melee Hit$/i, () => "gây Melee Hit"],
    [/^Triggered a Skill$/i, () => "Trigger Skill"],
    [/^summoned a Totem$/i, () => "triệu hồi Totem"],
    [/^gained a (Power|Frenzy|Endurance) Charge$/i, ([, charge]) => `nhận ${charge} Charge`],
    [/^Chilled an Enemy$/i, () => "Chill kẻ địch"],
    [/^Shocked an Enemy$/i, () => "Shock kẻ địch"],
    [/^Ignited an Enemy$/i, () => "Ignite kẻ địch"],
    [/^Frozen an Enemy$/i, () => "Freeze kẻ địch"],
    [/^Reloaded$/i, () => "Reload"],
    [/^Blocked$/i, () => "Block"],
    [/^Warcried$/i, () => "Warcry"],
    [/^used a Life Flask$/i, () => "dùng Life Flask"],
    [/^used a Mark$/i, () => "dùng Mark"]
  ];

  for (const [pattern, render] of actionPatterns) {
    const match = clean.match(pattern);
    if (match) return render(match);
  }
  return translatePassivePhrase(clean);
};

const translateScale = (scale = "", amount = "") => {
  const lowered = String(scale).toLowerCase();
  if (lowered === "increased") return `Tăng ${amount}`;
  if (lowered === "reduced") return `Giảm ${amount}`;
  return `${amount} ${lowered}`;
};

const numberWords = new Map([
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
  ["ten", "10"]
]);

const translatePastWindow = (value = "") => normalizeText(value)
  .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (word) => numberWords.get(word.toLowerCase()) || word)
  .replace(/\bseconds?\b/gi, "giây")
  .replace(/\s+/g, " ")
  .trim();

const passiveColorTranslations = new Map([
  ["purple", "tím"],
  ["blue", "xanh dương"],
  ["red", "đỏ"],
  ["green", "xanh lá"]
]);

const translatePassiveColor = (value = "") =>
  passiveColorTranslations.get(String(value).toLowerCase()) || value;

const translateEnemyTarget = (value = "") => {
  const clean = normalizeText(value);
  if (/^Rare (?:or|and) Unique Enemies$/i.test(clean)) return "kẻ địch Rare và Unique";
  let match = clean.match(/^Enemies within (.+)$/i);
  if (match) return `kẻ địch trong phạm vi ${match[1]}`;
  match = clean.match(/^Enemies further than (.+)$/i);
  if (match) return `kẻ địch cách xa hơn ${match[1]}`;
  match = clean.match(/^Enemies that are on (Low|Full) Life$/i);
  if (match) return `kẻ địch đang ${match[1]} Life`;
  match = clean.match(/^Enemies affected by (.+)$/i);
  if (match) return `kẻ địch đang chịu ${translatePassivePhrase(match[1])}`;
  match = clean.match(/^(.+?) Enemies$/i);
  if (match) return `kẻ địch bị ${translatePassivePhrase(match[1])}`;
  return translatePassivePhrase(clean);
};

const translateEquippedSource = (value = "") => {
  const clean = normalizeText(value);
  if (/^Rings and Amulets$/i.test(clean)) return "Ring và Amulet đang trang bị";
  return `${translatePassivePhrase(clean)} đang trang bị`;
};

const translateChargeSubject = (value = "") => {
  const clean = normalizeText(value);
  if (/^Flask and Charm$/i.test(clean)) return "Flask Charge và Charm Charge";
  if (/^Life Flask$/i.test(clean)) return "Charge bình máu";
  return `${translatePassivePhrase(clean)} Charge`;
};

const translateLeechResource = (value = "") => {
  const clean = normalizeText(value);
  if (/^Life and Mana$/i.test(clean)) return "máu và mana";
  if (/^Life$/i.test(clean)) return "máu";
  if (/^Mana$/i.test(clean)) return "mana";
  return translatePassivePhrase(clean);
};

const translateLeechCondition = (value = "") => {
  const clean = normalizeText(value);
  if (!clean) return "";
  if (/^Shapeshifted$/i.test(clean)) return "khi đang biến hình";
  return `khi ${translatePassivePhrase(clean)}`;
};

const translatePassiveCondition = (value = "") => {
  const clean = normalizeText(value);
  if (!clean) return "";
  let match = clean.match(/^affected by (?:an? )?(.+)$/i);
  if (match) return `đang chịu ảnh hưởng của ${translatePassivePhrase(match[1])}`;
  if (/^Shapeshifted$/i.test(clean)) return "đang biến hình";
  match = clean.match(/^not on (.+)$/i);
  if (match) return `không ở ${translatePassivePhrase(match[1])}`;
  match = clean.match(/^on (.+)$/i);
  if (match) return `đang ${translatePassivePhrase(match[1])}`;
  return translatePassivePhrase(clean);
};

const translateSubjectIncrease = (subject = "", amount = "", stat = "") =>
  `${translatePassivePhrase(subject)} được tăng ${amount} ${translatePassivePhrase(stat)}`;

const translateSubjectReduction = (subject = "", amount = "", stat = "") =>
  `${translatePassivePhrase(subject)} bị giảm ${amount} ${translatePassivePhrase(stat)}`;

const translateSubjectMore = (subject = "", amount = "", stat = "") =>
  `${translatePassivePhrase(subject)} có ${amount} more ${translatePassivePhrase(stat)}`;

const translateSubjectLess = (subject = "", amount = "", stat = "") =>
  `${translatePassivePhrase(subject)} có ${amount} less ${translatePassivePhrase(stat)}`;

const translateGrantClause = (subject = "", value = "", { also = false } = {}) => {
  const cleanSubject = translatePassivePhrase(subject);
  const granted = translateGrantedValue(value);
  const connector = also ? " cũng" : "";
  if (/^(?:tăng|giảm)\b/i.test(granted)) return `${cleanSubject}${connector} ${granted}`;
  return `${cleanSubject}${connector} cấp ${granted}`;
};

const passiveStatPatterns = [
  [/^Buffs on you expire (.+?) slower$/i, ([, amount]) => `Các Buff trên bạn hết hạn chậm hơn ${amount}`],
  [/^Debuffs on you expire (.+?) (faster|slower)$/i, ([, amount, speed]) => `Các Debuff trên bạn hết hạn ${speed === "faster" ? "nhanh hơn" : "chậm hơn"} ${amount}`],
  [/^(.+?) increased (.+?) while you have no (.+?) uses left$/i, ([, amount, stat, flask]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi bạn không còn lượt dùng ${translatePassivePhrase(flask)}`],
  [/^while you have no (.+?) uses left$/i, ([, flask]) => `khi bạn không còn lượt dùng ${translatePassivePhrase(flask)}`],
  [/^Grants Skill: (.+)$/i, ([, skill]) => `Cấp Skill: ${skill}`],
  [/^Grants (.+?) Passive Skill Point$/i, ([, amount]) => `Cấp ${amount} Passive Skill Point`],
  [/^Grants (.+)$/i, ([, value]) => `Cấp ${translatePassivePhrase(value)}`],
  [/^(Red|Green|Blue): (.+)$/i, ([, prefix, rest]) => `${prefix}: ${translatePassiveStatLine(rest)}`],
  [/^All Flames of Chayula that you manifest are (.+)$/i, ([, color]) => `Toàn bộ Flame of Chayula bạn tạo ra là màu ${translatePassiveColor(color)}`],
  [/^Walk the Paths Not Taken$/i, () => "Bước trên những con đường chưa chọn"],
  [/^Damage Penetrates ([+-]?\d+(?:\.\d+)?%) ((?:Fire|Cold|Lightning|Chaos|Physical|Elemental) Resistances?)(?: if on (.+))?$/i, ([, amount, stat, condition]) => `Damage xuyên ${amount} ${translatePassivePhrase(stat)}${condition ? ` nếu đang ${translatePassivePhrase(condition)}` : ""}`],
  [/^Gain (.+?) Rage on (Melee(?: Axe)? Hit)$/i, ([, amount, hit]) => `Nhận ${amount} Rage khi ${translatePassivePhrase(hit)}`],
  [/^Gain (.+?) Volatility on inflicting an? (.+)$/i, ([, amount, ailment]) => `Nhận ${amount} Volatility khi gây ${translatePassivePhrase(ailment)}`],
  [/^Gain a Power Charge when you consume an Elemental Infusion$/i, () => "Nhận Power Charge khi bạn Consume Elemental Infusion"],
  [/^(.+?) chance to gain (.+?) on Kill$/i, ([, chance, value]) => `${chance} cơ hội nhận ${translatePassivePhrase(value)} khi Kill`],
  [/^(.+?) chance to gain (.+?) on Killing Blow with (.+)$/i, ([, chance, value, source]) => `${chance} cơ hội nhận ${translatePassivePhrase(value)} khi Killing Blow bằng ${translatePassivePhrase(source)}`],
  [/^(.+?) chance to (Poison|Impale) on (Spell )?Hit$/i, ([, chance, effect, hitSource]) => `${chance} cơ hội ${effect} khi ${hitSource ? `${translatePassivePhrase(hitSource.trim())} ` : ""}Hit`],
  [/^(.+?) chance to Hinder Enemies on Hit with (.+)$/i, ([, chance, source]) => `${chance} cơ hội Hinder kẻ địch khi Hit bằng ${translatePassivePhrase(source)}`],
  [/^(.+?) chance to Knock Enemies Back with Hits at Close Range$/i, ([, chance]) => `${chance} cơ hội Knock Back kẻ địch bằng Hit ở Close Range`],
  [/^(.+?) chance to Daze Enemies whose Hits you Block with a raised Shield$/i, ([, chance]) => `${chance} cơ hội Daze kẻ địch có Hit bị bạn Block bằng Shield đang giơ`],
  [/^Immune to (Poison|Corrupted Blood|Hinder|Maim)$/i, ([, value]) => `Miễn nhiễm ${translatePassivePhrase(value)}`],
  [/^Energy Shield does not Recharge$/i, () => "Energy Shield không Recharge"],
  [/^Inherent Rage loss starts (.+?) second(?:s)? later$/i, ([, amount]) => `Rage bắt đầu mất tự nhiên trễ hơn ${amount} giây`],
  [/^No inherent Mana Regeneration$/i, () => "Không có Mana Regeneration tự nhiên"],
  [/^Projectile Damage builds Pin$/i, () => "Projectile Damage gây tích lũy Pin"],
  [/^Sacrificing Energy Shield does not interrupt Recharge$/i, () => "Hi sinh Energy Shield không ngắt Recharge"],
  [/^Invoked Spells consume (.+?) less Energy$/i, ([, amount]) => `Invoked Spell Consume ít hơn ${amount} Energy`],
  [/^cost (.+?) less$/i, ([, amount]) => `Cost ít hơn ${amount}`],
  [/^Unaffected by (.+?) during (.+)$/i, ([, effect, condition]) => `Không bị ${translatePassivePhrase(effect)} ảnh hưởng trong thời gian ${translatePassivePhrase(condition)}`],
  [/^Take no Damage from (.+)$/i, ([, source]) => `Không nhận Damage từ ${translatePassivePhrase(source)}`],
  [/^(.+?) (increased|reduced) penalty to (.+?) at range$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} penalty ${translatePassivePhrase(stat)} ở tầm xa`],
  [/^(.+?) increased (.+?) at Close Range$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} ở Close Range`],
  [/^(.+?) chance for (.+?) Skills you use yourself to cause an additional Aftershock$/i, ([, chance, skill]) => `${chance} cơ hội để ${translatePassivePhrase(`${skill} Skills`)} bạn tự dùng gây thêm Aftershock`],
  [/^(.+?) chance for (Flasks|Charms) you use to not consume Charges$/i, ([, chance, subject]) => `${chance} cơ hội ${translatePassivePhrase(subject)} bạn dùng không Consume Charge`],
  [/^(.+?) chance to not destroy Corpses when Consuming Corpses$/i, ([, chance]) => `${chance} cơ hội không phá hủy Corpse khi Consume Corpse`],
  [/^(.+?) chance when you gain an? (.+?) Charge to gain an additional (.+?) Charge$/i, ([, chance, charge, extra]) => `${chance} cơ hội khi nhận ${charge} Charge để nhận thêm 1 ${extra} Charge`],
  [/^(.+?) chance for (Lightning Skills) to Chain an additional time$/i, ([, chance, skill]) => `${chance} cơ hội để ${translatePassivePhrase(skill)} Chain thêm một lần`],
  [/^(.+?) chance for Trigger skills to refund half of Energy Spent$/i, ([, chance]) => `${chance} cơ hội để Trigger Skill hoàn lại một nửa Energy đã tiêu`],
  [/^(.+?) chance for Attacks to Maim on Hit against (.+)$/i, ([, chance, target]) => `${chance} cơ hội để Attack Maim khi Hit lên ${translateEnemyTarget(target)}`],
  [/^(.+?) chance when you Reload a Crossbow to be immediate$/i, ([, chance]) => `${chance} cơ hội Crossbow Reload ngay lập tức khi bạn Reload`],
  [/^Lose all (.+?) on reaching maximum (.+)$/i, ([, value, resource]) => `Mất toàn bộ ${translatePassivePhrase(value)} khi ${translatePassivePhrase(resource)} đạt tối đa`],
  [/^Lose (.+?) on reaching maximum (.+)$/i, ([, value, resource]) => `Mất ${translatePassivePhrase(value)} khi ${translatePassivePhrase(resource)} đạt tối đa`],
  [/^(.+?) gain \+(.+?) to all Maximum Elemental Resistances$/i, ([, subject, amount]) => `${translatePassivePhrase(subject)} nhận +${amount} toàn bộ Maximum Elemental Resistance`],
  [/^(.+?) gain \+(.+?) to all Elemental Resistances$/i, ([, subject, amount]) => `${translatePassivePhrase(subject)} nhận +${amount} toàn bộ Elemental Resistance`],
  [/^Hits Break (.+?) increased Armour on targets with Ailments$/i, ([, amount]) => `Hit Break Armour nhiều hơn ${amount} lên mục tiêu có Ailment`],
  [/^(.+?) chance on Shocking Enemies to created Shocked Ground$/i, ([, chance]) => `${chance} cơ hội tạo Shocked Ground khi Shock kẻ địch`],
  [/^Gain additional Critical Hit Chance equal to (.+?) of excess chance to Hit with Attacks$/i, ([, amount]) => `Nhận thêm cơ hội Critical Hit bằng ${amount} cơ hội Hit dư bằng Attack`],
  [/^(.+?) of (.+?) taken from (.+?) Recouped as (.+)$/i, ([, amount, source, from, target]) => `Recoup ${amount} ${translatePassivePhrase(source)} nhận từ ${translatePassivePhrase(from)} dưới dạng ${translatePassivePhrase(target)}`],
  [/^(.+?) Recoup (.+?) of Damage taken as (.+)$/i, ([, subject, amount, target]) => `${translatePassivePhrase(subject)} Recoup ${amount} Damage nhận vào dưới dạng ${translatePassivePhrase(target)}`],
  [/^(.+?) of (.+?) prevented Recouped as (.+?)(?: per enemy Power)?$/i, ([, amount, source, target]) => `Recoup ${amount} ${translatePassivePhrase(source)} đã ngăn dưới dạng ${translatePassivePhrase(target)}`],
  [/^Body Armour grants (.+?) of (.+?) from Hits taken as (.+)$/i, ([, amount, source, target]) => `Body Armour cấp ${amount} ${translatePassivePhrase(source)} từ Hit nhận vào dưới dạng ${translatePassivePhrase(target)}`],
  [/^(.+?) increased ((?!.*\binflicted\b).+?) with (Attacks|Spells)$/i, ([, amount, stat, source]) => `Tăng ${amount} ${translatePassivePhrase(stat)} bằng ${translatePassivePhrase(source)}`],
  [/^(.+?) of Physical Damage from Hits taken as Damage of (?:a )?Random Element$/i, ([, amount]) => `${amount} Physical Damage từ Hit nhận vào dưới dạng Damage thuộc Element ngẫu nhiên`],
  [/^(.+?) of (.+?) taken as (.+)$/i, ([, amount, source, target]) => `${amount} ${translatePassivePhrase(source)} nhận vào dưới dạng ${translatePassivePhrase(target)}`],
  [/^(.+?) of Damage taken bypasses Energy Shield$/i, ([, amount]) => `${amount} Damage nhận vào bỏ qua Energy Shield`],
  [/^(.+?) of Damage Converted to (.+)$/i, ([, amount, target]) => `Chuyển ${amount} Damage thành ${translatePassivePhrase(target)}`],
  [/^(.+?) to Quality of all Skills$/i, ([, amount]) => `${amount} Quality của toàn bộ Skill`],
  [/^\+(.+?) to Level of all Skills with an? (.+?) requirement$/i, ([, amount, requirement]) => `+${amount} Level của toàn bộ Skill có ${translatePassivePhrase(requirement)} Requirement`],
  [/^\+(.+?) to Level of all (.+?) Skills(?: with an? (.+?) requirement)?$/i, ([, amount, type, requirement]) => `+${amount} Level của toàn bộ ${translatePassivePhrase(`${type} Skills`)}${requirement ? ` có ${translatePassivePhrase(requirement)} Requirement` : ""}`],
  [/^\+(.+?) to Critical Hit Chance of (.+)$/i, ([, amount, source]) => `+${amount} cơ hội Critical Hit của ${translatePassivePhrase(source)}`],
  [/^\+(.+?) to maximum Block chance$/i, ([, amount]) => `+${amount} cơ hội Block tối đa`],
  [/^additional Elemental Infusion of the same type$/i, () => "thêm Elemental Infusion cùng loại"],
  [/^(.+?) increased Damage for each type of Elemental Ailment on Enemy$/i, ([, amount]) => `Tăng ${amount} Damage cho mỗi loại Elemental Ailment trên kẻ địch`],
  [/^Trigger (.+?) on (Melee )?Critical Hit with (.+)$/i, ([, value, melee, source]) => `Trigger ${value} khi ${melee ? "Melee " : ""}Critical Hit bằng ${translatePassivePhrase(source)}`],
  [/^Trigger (.+?) on (Melee )?Critical Hit$/i, ([, value, melee]) => `Trigger ${value} khi ${melee ? "Melee " : ""}Critical Hit`],
  [/^Maximum Mana is replaced by twice as much Maximum Infernal Flame$/i, () => "Mana tối đa được thay bằng gấp đôi Infernal Flame tối đa"],
  [/^Take maximum Life and Energy Shield as Fire Damage when Infernal Flame reaches maximum$/i, () => "Nhận Life tối đa và Energy Shield dưới dạng Fire Damage khi Infernal Flame đạt tối đa"],
  [/^(.+?) increased (.+?) while not on (.+)$/i, ([, amount, stat, condition]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi không ở ${translatePassivePhrase(condition)}`],
  [/^(.+?) (increased|reduced) (Spirit Reservation Efficiency|Reservation Efficiency) of (.+)$/i, ([, amount, scale, stat, source]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} của ${translatePassivePhrase(source)}`],
  [/^(.+?) increased Effect of the Socketed Jewel$/i, ([, amount]) => `Tăng ${amount} Effect của Jewel đã Socket`],
  [/^(.+?) increased (.+?) if you have Shapeshifted to (?:an? )?(.+?) Recently$/i, ([, amount, stat, form]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã biến hình sang ${translatePassivePhrase(form)}`],
  [/^\+(.+?) to Spirit for each of your empty Charm slots$/i, ([, amount]) => `+${amount} Spirit cho mỗi ô Charm trống của bạn`],
  [/^to (.+?) of your main hand Weapon's Damage$/i, ([, amount]) => `bằng ${amount} Damage của Weapon ở Main Hand của bạn`],
  [/^to (.+?) of the Accuracy Rating on the Weapon$/i, ([, amount]) => `bằng ${amount} Accuracy Rating trên Weapon`],
  [/^Allies in your Presence gain added Attack Damage equal$/i, () => "Allies trong Presence của bạn nhận Added Attack Damage bằng"],
  [/^(.+?) increased Damage per (.+?) of your lowest Attribute$/i, ([, amount, per]) => `Tăng ${amount} Damage mỗi ${per} Attribute thấp nhất của bạn`],
  [/^(.+?) increased Attack Speed per Enemy in Close Range$/i, ([, amount]) => `Tăng ${amount} Attack Speed cho mỗi kẻ địch ở Close Range`],
  [/^([+-].+?) to all Elemental Resistances$/i, ([, amount]) => `${amount} toàn bộ Elemental Resistance`],
  [/^([+-].+?) to Chaos Resistance$/i, ([, amount]) => `${amount} Chaos Resistance`],
  [/^-(.+?) to amount of Damage Prevented by Deflection$/i, ([, amount]) => `-${amount} lượng Damage được ngăn bởi Deflection`],
  [/^contributes to Flammability and Ignite Magnitudes$/i, () => "góp vào Flammability và Magnitude của bỏng"],
  [/^All Damage from Hits Contributes to (.+)$/i, ([, target]) => `Toàn bộ Damage từ Hit góp vào ${target.toLowerCase() === "shock chance" ? "cơ hội Shock" : translatePassivePhrase(target)}`],
  [/^(?:Chaos Damage from Fire Spells )?Contributes to Flammability and Ignite Magnitudes$/i, () => "góp vào Flammability và Magnitude của bỏng"],
  [/^(.+?) from (.+?) Contributes to (.+)$/i, ([, source, from, target]) => `${translatePassivePhrase(source)} từ ${translatePassivePhrase(from)} góp vào ${translatePassivePhrase(target)}`],
  [/^Body Armour grants regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second$/i, ([, amount, resource]) => `Body Armour cấp hồi ${amount} ${resource} tối đa mỗi giây`],
  [/^(.+?) Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second$/i, ([, subject, amount, resource]) => `${translatePassivePhrase(subject)} hồi ${amount} ${resource} tối đa mỗi giây`],
  [/^Meta Skills gain (.+?) increased Energy if you've dealt a Critical Hit Recently$/i, ([, amount]) => `Meta Skill được tăng ${amount} Energy nếu gần đây bạn đã gây Critical Hit`],
  [/^Meta Skills gain (.+?) increased Energy$/i, ([, amount]) => `Meta Skill được tăng ${amount} Energy`],
  [/^Meta Skills gain (.+?) more Energy$/i, ([, amount]) => `Meta Skill có ${amount} more Energy`],
  [/^Minions gain (.+?) of Physical Damage as Chaos Damage$/i, ([, amount]) => `Minion nhận ${amount} Physical Damage dưới dạng Chaos Damage`],
  [/^(.+?) increased Damage taken while on (.+)$/i, ([, amount, condition]) => `Chịu thêm ${amount} Damage khi đang ${translatePassivePhrase(condition)}`],
  [/^Lose (.+?) of maximum Mana per Second$/i, ([, amount]) => `Mất ${amount} Mana tối đa mỗi giây`],
  [/^Lose (.+?) of maximum Life and Energy Shield when you use a Chaos Skill$/i, ([, amount]) => `Mất ${amount} Life tối đa và Energy Shield khi bạn dùng Chaos Skill`],
  [/^(.+?) of Skill Mana costs Converted to Life Costs during any Life Flask Effect$/i, ([, amount]) => `Chuyển ${amount} Mana Cost của Skill thành Life Cost trong thời gian hiệu ứng Life Flask bất kỳ`],
  [/^Defend with (.+?) of Armour against Hits from Enemies that are further than (.+?) away$/i, ([, amount, distance]) => `Defend bằng ${amount} Armour trước Hit từ kẻ địch cách xa hơn ${distance}`],
  [/^Defend with (.+?) of Armour(?: against (.+)| while not on (.+))?$/i, ([, amount, target, condition]) => `Defend bằng ${amount} Armour${target ? ` trước ${translatePassivePhrase(target)}` : ""}${condition ? ` khi ${translatePassiveCondition(`not on ${condition}`)}` : ""}`],
  [/^Thorns Damage has (.+?) chance to ignore Enemy Armour$/i, ([, chance]) => `Thorns Damage có ${chance} cơ hội bỏ qua Armour của kẻ địch`],
  [/^(.+?) chance to Defend with (.+?) of Armour$/i, ([, chance, amount]) => `${chance} cơ hội Defend bằng ${amount} Armour`],
  [/^Reserves (.+?) of Life$/i, ([, amount]) => `Reserve ${amount} Life`],
  [/^Totems reserve (.+?) Spirit each$/i, ([, amount]) => `Mỗi Totem Reserve ${amount} Spirit`],
  [/^Combo count loss occurs (.+?) slower$/i, ([, amount]) => `Combo count giảm chậm hơn ${amount}`],
  [/^Arrows Pierce an additional Target$/i, () => "Arrow xuyên thêm 1 mục tiêu"],
  [/^Skills fire an additional Projectile$/i, () => "Skill bắn thêm 1 Projectile"],
  [/^Grenade Skills Fire an additional Projectile$/i, () => "Grenade Skill bắn thêm 1 Projectile"],
  [/^\+(.+?) Surpassing chance to fire an additional (Projectile|Arrow)$/i, ([, amount, type]) => `+${amount} cơ hội Surpassing bắn thêm 1 ${translatePassivePhrase(type)}`],
  [/^(.+?) (faster|slower) start of Energy Shield Recharge(?: while (.+)| when not on (.+))?$/i, ([, amount, speed, condition, notCondition]) => `Energy Shield Recharge bắt đầu ${speed.toLowerCase() === "faster" ? "nhanh hơn" : "chậm hơn"} ${amount}${condition ? ` khi ${translatePassiveCondition(condition)}` : ""}${notCondition ? ` khi ${translatePassiveCondition(`not on ${notCondition}`)}` : ""}`],
  [/^Successfully Parrying a (Melee|Projectile) Hit grants (.+?) increased Damage to your next (Ranged|Melee) Attack$/i, ([, hit, amount, attack]) => `Parry thành công ${hit} Hit cấp ${amount} Damage tăng thêm cho ${attack} Attack tiếp theo của bạn`],
  [/^Converts all (.+?) to (.+)$/i, ([, source, target]) => `Chuyển toàn bộ ${translatePassivePhrase(source)} thành ${translatePassivePhrase(target)}`],
  [/^(Fire Spells) Convert (.+?) of (.+?) to (.+)$/i, ([, subject, amount, source, target]) => `${translatePassivePhrase(subject)} chuyển ${amount} ${translatePassivePhrase(source)} thành ${translatePassivePhrase(target)}`],
  [/^Triple Attribute requirements of Martial Weapons$/i, () => "Gấp ba Attribute Requirement của Martial Weapon"],
  [/^(.+?) increased Magnitude of Impales inflicted with (.+)$/i, ([, amount, source]) => `Tăng ${amount} Magnitude của Impale gây bằng ${translatePassivePhrase(source)}`],
  [/^(.+?) increased Magnitude of (Daze)$/i, ([, amount, effect]) => `Tăng ${amount} Magnitude của ${effect}`],
  [/^Maximum Chance to (Evade|Block) is (.+)$/i, ([, stat, amount]) => `cơ hội ${stat} tối đa là ${amount}`],
  [/^No Inherent loss of Rage$/i, () => "Không mất Rage tự nhiên"],
  [/^(.+?) faster start of inherent Rage loss$/i, ([, amount]) => `Rage bắt đầu mất tự nhiên nhanh hơn ${amount}`],
  [/^Enemies you Electrocute have (.+?) increased Damage taken$/i, ([, amount]) => `Kẻ địch bạn Electrocute chịu thêm ${amount} Damage Taken`],
  [/^Enemies Blinded by you have (.+?) reduced Critical Hit Chance$/i, ([, amount]) => `Kẻ địch bị bạn Blind bị giảm ${amount} cơ hội Critical Hit`],
  [/^Every Rage also grants you (.+?) increased Minion (Damage|Attack Speed)$/i, ([, amount, stat]) => `Mỗi Rage cũng cấp cho bạn ${amount} Minion ${stat} tăng thêm`],
  [/^(.+?) increased total Power counted by Warcries$/i, ([, amount]) => `Tăng ${amount} tổng Power được Warcry tính`],
  [/^(.+?) increased (.+?) if you haven't dealt (?:a )?(.+?) Recently$/i, ([, amount, stat, hit]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn chưa ${translateRecentAction(`dealt ${hit}`)}`],
  [/^Gain (.+?) Rage when you use a Life Flask$/i, ([, amount]) => `Nhận ${amount} Rage khi bạn dùng Life Flask`],
  [/^(.+?) increased speed of Recoup Effects$/i, ([, amount]) => `Tăng ${amount} tốc độ Recoup Effect`],
  [/^You can have two Companions of different types$/i, () => "Bạn có thể có 2 Companion khác loại"],
  [/^Gain the benefits of Bonded modifiers on Runes and Idols$/i, () => "Nhận lợi ích của Bonded modifier trên Rune và Idol"],
  [/^Unlimited number of Summoned Totems$/i, () => "Không giới hạn số lượng Summoned Totem"],
  [/^-(.+?) second to base Energy Shield Recharge delay$/i, ([, seconds]) => `Giảm ${seconds} giây base Energy Shield Recharge delay`],
  [/^Temporary Minion Skills have \+(.+?) to Limit of Minions summoned$/i, ([, amount]) => `Temporary Minion Skill có +${amount} Limit của Minion được summon`],
  [/^Modifiers to Maximum Fire Resistance also grant Maximum Cold and Lightning Resistance$/i, () => "Modifier lên Maximum Fire Resistance cũng cấp Maximum Cold và Lightning Resistance"],
  [/^Adds (.+?) to (.+?) (Fire|Cold|Lightning|Chaos|Physical) damage to Attacks$/i, ([, min, max, type]) => `Thêm ${min} đến ${max} ${type} Damage cho Attack`],
  [/^Skill Mana Costs Converted to Life Costs$/i, () => "Mana Cost của Skill chuyển thành Life Cost"],
  [/^You take (.+?) of damage from Blocked Hits$/i, ([, amount]) => `Bạn nhận ${amount} Damage từ Blocked Hit`],
  [/^Break (.+?) of Armour on Pinning an Enemy$/i, ([, amount]) => `Break ${amount} Armour khi Pin kẻ địch`],
  [/^Break (.+?) of Armour on Heavy Stunning an Enemy$/i, ([, amount]) => `Break ${amount} Armour khi Heavy Stun kẻ địch`],
  [/^Warcries Empower an additional Attack$/i, () => "Warcry Empower thêm 1 Attack"],
  [/^Totems only use Skills when you fire an Attack Projectile$/i, () => "Totem chỉ dùng Skill khi bạn bắn Attack Projectile"],
  [/^Remove a Curse when you use a Mana Flask$/i, () => "Xóa Curse khi bạn dùng Mana Flask"],
  [/^Remove Ignite when you Warcry$/i, () => "Xóa bỏng khi bạn Warcry"],
  [/^Take (.+?) less Damage from Hits while Dodge Rolling$/i, ([, amount]) => `Nhận ít hơn ${amount} Damage từ Hit khi Dodge Roll`],
  [/^Your Heavy Stun buildup empties (.+?) faster(?: if you've successfully Parried Recently)?$/i, ([, amount]) => `Heavy Stun Buildup của bạn giảm nhanh hơn ${amount}`],
  [/^Body Armour grants Unaffected by Damaging Ailments$/i, () => "Body Armour cấp miễn nhiễm ảnh hưởng bởi Ailment gây damage"],
  [/^Debuffs inflicted by Hazards have (.+?) increased Slow Magnitude$/i, ([, amount]) => `Debuff do Hazard gây được tăng ${amount} Slow Magnitude`],
  [/^All Damage from Hits Contributes to Shock Chance$/i, () => "Toàn bộ Damage từ Hit góp vào cơ hội Shock"],
  [/^Every (.+?) Rage also grants (.+?) more Spell damage$/i, ([, rage, amount]) => `Mỗi ${rage} Rage cũng cấp ${amount} more Spell Damage`],
  [/^Every Rage also grants (.+?) increased Fire Damage$/i, ([, amount]) => `Mỗi Rage cũng cấp ${amount} Fire Damage tăng thêm`],
  [/^Minions have \+(.+?) to Maximum (Fire|Cold|Lightning) Resistances$/i, ([, amount, type]) => `Minion có +${amount} Maximum ${type} Resistance`],
  [/^(.+?) less (.+?) Damage taken$/i, ([, amount, type]) => `${amount} less ${translatePassivePhrase(`${type} Damage`)} nhận vào`],
  [/^Adapt to the highest Elemental Damage Type of each Hit you take$/i, () => "Adapt theo Elemental Damage Type cao nhất của mỗi Hit bạn nhận"],
  [/^(.+?) less Damage taken of each Elemental Damage Type per matching Adaptation$/i, ([, amount]) => `${amount} less Damage nhận vào của mỗi Elemental Damage Type cho mỗi Adaptation khớp`],
  [/^(.+?) of Strength Requirements from Boots, Gloves and Helmets also added to Armour$/i, ([, amount]) => `Thêm ${amount} Strength Requirement từ Boots, Gloves và Helmet vào Armour`],
  [/^Prevent \+?(.+?) of Damage from Deflected Critical Hits$/i, ([, amount]) => `Ngăn +${amount} Damage từ Deflected Critical Hit`],
  [/^Critical Hits ignore non-negative Enemy Monster Elemental Resistances$/i, () => "Critical Hit bỏ qua Elemental Resistance không âm của monster kẻ địch"],
  [/^Non-Keystone Passive Skills in Medium Radius of allocated Keystone Passive Skills can be allocated without being connected to your tree$/i, () => "Non-Keystone Passive Skill trong Medium Radius quanh Keystone Passive Skill đã allocated có thể allocated mà không cần nối với tree của bạn"],
  [/^Cannot be Blinded while on Full Life$/i, () => "Không thể bị Blinded khi đang Full Life"],
  [/^Sacrifice (.+?) of maximum Energy Shield when you Cast a Spell$/i, ([, amount]) => `Hi sinh ${amount} Energy Shield tối đa khi bạn Cast Spell`],
  [/^Life Recovery from your Flasks also applies to your Companions$/i, () => "Life Recovery từ Flask của bạn cũng áp dụng cho Companion của bạn"],
  [/^(.+?) increased bonuses gained from Equipped (.+)$/i, ([, amount, source]) => `Tăng ${amount} bonus nhận từ ${translateEquippedSource(source)}`],
  [/^(.+?) reduced bonuses gained from Equipped (.+)$/i, ([, amount, source]) => `Giảm ${amount} bonus nhận từ ${translateEquippedSource(source)}`],
  [/^(.+?) (increased|reduced) (Flask and Charm|Life Flask|Mana Flask|Flask|Charm) Charges (gained|used)$/i, ([, amount, scale, subject, verb]) => {
    const action = verb.toLowerCase() === "gained" ? "nhận được" : "tiêu hao";
    return `${translateScale(scale, amount)} ${translateChargeSubject(subject)} ${action}`;
  }],
  [/^(.+?) more Charm Charges gained$/i, ([, amount]) => `${amount} more Charm Charge nhận được`],
  [/^Immune to (.+?) if a majority of your Socketed Support Gems are (.+)$/i, ([, immune, color]) => `Miễn nhiễm ${translatePassivePhrase(immune)} nếu phần lớn Support Gem đã Socket của bạn là màu ${color}`],
  [/^Enemies you Heavy Stun while Shapeshifted are (.+?) for (.+?) seconds$/i, ([, state, seconds]) => `Kẻ địch bạn Heavy Stun khi đang biến hình bị ${translatePassivePhrase(state)} trong ${seconds} giây`],
  [/^Base (.+?) is (.+?) seconds?$/i, ([, stat, seconds]) => `Base ${translatePassivePhrase(stat)} là ${seconds} giây`],
  [/^Base Maximum (.+?) is (.+)$/i, ([, stat, amount]) => `Base ${translatePassivePhrase(stat)} tối đa là ${amount}`],
  [/^Maximum (.+?) is (.+)$/i, ([, stat, amount]) => `${translatePassivePhrase(stat)} tối đa là ${amount}`],
  [/^(.+?) Rating is Doubled$/i, ([, stat]) => `${translatePassivePhrase(`${stat} Rating`)} được nhân đôi`],
  [/^(.+?) Resistance is doubled$/i, ([, stat]) => `${translatePassivePhrase(`${stat} Resistance`)} được nhân đôi`],
  [/^Inherent bonuses gained from Attributes are doubled$/i, () => "Inherent bonus nhận từ Attribute được nhân đôi"],
  [/^Inherent loss of Rage is (.+?) slower$/i, ([, amount]) => `Rage mất tự nhiên chậm hơn ${amount}`],
  [/^Inherent Life granted by Strength is halved$/i, () => "Life nhận tự nhiên từ Strength bị giảm một nửa"],
  [/^(.+?) has no maximum$/i, ([, subject]) => `${translatePassivePhrase(subject)} không có giới hạn tối đa`],
  [/^Every second Slam Skill you use yourself is Ancestrally Boosted$/i, () => "Mỗi Slam Skill thứ hai bạn tự dùng được Ancestrally Boosted"],
  [/^(.+?) increased (.+?) while a Rare or Unique Enemy is in your Presence$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi kẻ địch Rare hoặc Unique ở trong Presence của bạn`],
  [/^(.+?) increased (.+?) while an enemy with an Open Weakness is in your Presence$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi kẻ địch có Open Weakness ở trong Presence của bạn`],
  [/^(.+?) increased (.+?) while your Companion is in your Presence$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi Companion của bạn ở trong Presence của bạn`],
  [/^Culling Strike against Beasts while your Companion is in your Presence$/i, () => "Culling Strike lên Beast khi Companion của bạn ở trong Presence của bạn"],
  [/^Life Leech effects are not removed when Unreserved Life is Filled$/i, () => "Hiệu ứng hút máu không bị xóa khi Unreserved Life đầy"],
  [/^Life Flask Effects are not removed when Unreserved Life is Filled$/i, () => "Life Flask Effect không bị xóa khi Unreserved Life được lấp đầy"],
  [/^(.+?) increased Projectile Damage with Spears while there are no Enemies within (.+)$/i, ([, amount, distance]) => `Tăng ${amount} Projectile Damage với Spear khi không có kẻ địch trong phạm vi ${distance}`],
  [/^(.+?) increased Melee Damage with Spears while Surrounded$/i, ([, amount]) => `Tăng ${amount} sát thương đánh gần với Spear khi bị bao quanh`],
  [/^(.+?) increased Melee Damage with Hits at Close Range$/i, ([, amount]) => `Tăng ${amount} sát thương đánh gần với Hit ở Close Range`],
  [/^(.+?) increased Melee Damage against (.+?) Enemies$/i, ([, amount, state]) => `Tăng ${amount} sát thương đánh gần lên kẻ địch bị ${translatePassivePhrase(state)}`],
  [/^(.+?) increased Life Recovery from Flasks used when on Low Life$/i, ([, amount]) => `Tăng ${amount} Life Recovery từ Flask dùng khi đang Low Life`],
  [/^Quarterstaff Skills that consume Power Charges count as consuming an additional Power Charge$/i, () => "Quarterstaff Skill Consume Power Charge được tính như Consume thêm một Power Charge"],
  [/^Life Leeched from Empowered Attacks is Instant$/i, () => "Máu hút từ Empowered Attack là tức thời"],
  [/^Life Leech is Instant$/i, () => "Hút máu là tức thời"],
  [/^(.+?) increased amount of (Life and Mana|Life|Mana) Leeched(?: while (.+))?$/i, ([, amount, resource, condition]) => `Tăng ${amount} lượng ${translateLeechResource(resource)} hút được${condition ? ` ${translateLeechCondition(condition)}` : ""}`],
  [/^(.+?) of (.+?) Damage Leeched as (Life|Mana)$/i, ([, amount, source, resource]) => `${amount} ${translatePassivePhrase(`${source} Damage`)} được hút thành ${translateLeechResource(resource)}`],
  [/^Life Leech recovers based on your Elemental damage as well as Physical damage$/i, () => "Hút máu hồi phục dựa trên Elemental Damage của bạn cũng như Physical Damage"],
  [/^Leech recovers based on (.+?) as well as (.+?)$/i, ([, first, second]) => `Leech hồi phục dựa trên ${translatePassivePhrase(first)} cũng như ${translatePassivePhrase(second)}`],
  [/^Leech Life (.+?) (faster|slower)$/i, ([, amount, speed]) => `Hút máu ${speed.toLowerCase() === "faster" ? "nhanh hơn" : "chậm hơn"} ${amount}`],
  [/^(.+?) increased (.+?) while Leeching$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi đang hút`],
  [/^Unaffected by (.+?) while Leeching Mana$/i, ([, effect]) => `Không bị ${translatePassivePhrase(effect)} ảnh hưởng khi đang hút mana`],
  [/^(.+?) of Leech is Instant$/i, ([, amount]) => `${amount} lượng hút là tức thời`],
  [/^Chance to (Evade|Deflect) is (Lucky|Unlucky)$/i, ([, stat, value]) => `cơ hội ${stat} là ${value}`],
  [/^Lose all (.+?) when Hit$/i, ([, value]) => `Mất toàn bộ ${translatePassivePhrase(value)} khi bị Hit`],
  [/^(.+?) chance to Blind Enemies on Hit(?: with (.+))?$/i, ([, chance, source]) => `${chance} cơ hội Blind kẻ địch khi Hit${source ? ` bằng ${translatePassivePhrase(source)}` : ""}`],
  [/^(.+?) chance to (Daze) on Hit(?: with (.+))?$/i, ([, chance, effect, source]) => `${chance} cơ hội ${translatePassivePhrase(effect)} khi Hit${source ? ` bằng ${translatePassivePhrase(source)}` : ""}`],
  [/^(.+?) Chance to build an additional Combo on Hit$/i, ([, chance]) => `${chance} cơ hội tạo thêm Combo khi Hit`],
  [/^(.+?) (Life|Mana) gained when you Block$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} khi bạn Block`],
  [/^(.+?) reduced Flask Charges used from Mana Flasks$/i, ([, amount]) => `Giảm ${amount} Flask Charge tiêu hao từ Mana Flask`],
  [/^Base Critical Hit Chance for Spells is (.+)$/i, ([, amount]) => `Base Critical Hit Chance cho Spell là ${amount}`],
  [/^Minions Revive (.+?) faster$/i, ([, amount]) => `Minion Revive nhanh hơn ${amount}`],
  [/^Minions Revive (.+?) faster if all your Minions are Companions$/i, ([, amount]) => `Minion Revive nhanh hơn ${amount} nếu toàn bộ Minion của bạn là Companion`],
  [/^(.+?) chance when a Charm is used to use another Charm without consuming Charges$/i, ([, chance]) => `${chance} chance khi Charm được dùng để dùng thêm một Charm khác mà không Consume Charge`],
  [/^(.+?) increased Defences while your Companion is in your Presence$/i, ([, amount]) => `Tăng ${amount} Defences khi Companion của bạn ở trong Presence của bạn`],
  [/^Enemies are (.+?) for (.+?) seconds when you (.+?) them$/i, ([, state, seconds, action]) => `Kẻ địch bị ${translatePassivePhrase(state)} trong ${seconds} giây khi bạn ${translatePassivePhrase(action)} chúng`],
  [/^Enemies you Fully Armour Break are Maimed$/i, () => "Kẻ địch bị bạn Fully Armour Break sẽ bị Maimed"],
  [/^Ignites you cause are reflected back to you$/i, () => "Ignite bạn gây bị phản lại lên bạn"],
  [/^Your speed is unaffected by Slows$/i, () => "Speed của bạn không bị Slow ảnh hưởng"],
  [/^For each colour of Socketed Support Gem that is most numerous, gain:$/i, () => "Với mỗi màu Support Gem đã Socket có số lượng nhiều nhất, nhận:"],
  [/^(.+?) chance that when Volatility on you explodes, you regain an equivalent amount of Volatility$/i, ([, chance]) => `${chance} chance khi Volatility trên bạn phát nổ, bạn nhận lại lượng Volatility tương đương`],
  [/^(.+?) of your current Energy Shield is added to your Armour for$/i, ([, amount]) => `Thêm ${amount} Energy Shield hiện tại của bạn vào Armour của bạn trong`],
  [/^Hits that Heavy Stun Enemies have Culling Strike$/i, () => "Hit gây Heavy Stun lên kẻ địch có Culling Strike"],
  [/^Damage with Hits is Lucky against Heavy Stunned Enemies$/i, () => "Damage bằng Hit là Lucky lên kẻ địch bị Heavy Stunned"],
  [/^Evasion Rating from Equipped (.+?) is doubled$/i, ([, source]) => `Chỉ số né tránh từ ${translatePassivePhrase(source)} đang trang bị được nhân đôi`],
  [/^Evasion Rating from Equipped (.+?) is halved$/i, ([, source]) => `Chỉ số né tránh từ ${translatePassivePhrase(source)} đang trang bị bị giảm một nửa`],
  [/^Apply Debilitate to Enemies (.+?) Metres in front of you while your Shield is raised$/i, ([, distance]) => `Áp dụng Debilitate lên kẻ địch trong ${distance} mét trước mặt bạn khi Shield của bạn đang giơ lên`],
  [/^Apply (.+?) Critical Weakness to Enemies when Consuming a Mark on them$/i, ([, amount]) => `Áp dụng ${amount} Critical Weakness lên kẻ địch khi Consume Mark trên chúng`],
  [/^(.+?) chance for Attack Hits to apply (ten )?Incision$/i, ([, chance, ten]) => `${chance} chance để Attack Hit áp dụng ${ten ? "10 " : ""}Incision`],
  [/^(.+?) chance to Aggravate Bleeding on targets you (Hit|Critically Hit) with (.+?)$/i, ([, chance, hitType, source]) => `${chance} cơ hội Aggravate ${translatePassivePhrase("Bleeding")} trên mục tiêu bạn ${hitType === "Critically Hit" ? "Critical Hit" : "Hit"} bằng ${translatePassivePhrase(source)}`],
  [/^Attack Hits Aggravate any Bleeding on targets which is older than (.+?) seconds$/i, ([, seconds]) => `Attack Hit Aggravate Bleeding trên mục tiêu đã tồn tại hơn ${seconds} giây`],
  [/^(.+?) chance to gain Volatility when you are Stunned$/i, ([, chance]) => `${chance} chance nhận Volatility khi bạn bị Stunned`],
  [/^Enemies near Enemies you Mark are Blinded$/i, () => "Kẻ địch gần kẻ địch bạn Mark bị Blinded"],
  [/^Carry a Chest which adds (.+?) Inventory Slots$/i, ([, amount]) => `Mang theo Chest thêm ${amount} ô Inventory`],
  [/^(.+?) of Leech is Instant$/i, ([, amount]) => `${amount} Leech là Instant`],
  [/^\+(.+?) to (Strength|Dexterity|Intelligence)$/i, ([, amount, attr]) => `+${amount} ${attr}`],
  [/^\+(.+?) to Maximum (.+?) per (.+?) (.+?) on Equipped (.+)$/i, ([, amount, resource, perAmount, perStat, slot]) => `+${amount} ${translatePassivePhrase(`Maximum ${resource}`)} mỗi ${perAmount} ${translatePassivePhrase(perStat)} trên ${translatePassivePhrase(slot)} đang trang bị`],
  [/^\+(.+?) to Maximum (.+?) per (.+)$/i, ([, amount, resource, per]) => `+${amount} ${translatePassivePhrase(`Maximum ${resource}`)} mỗi ${translatePassivePhrase(per)}`],
  [/^\+(.+?) to Accuracy against (.+)$/i, ([, amount, target]) => `+${amount} Accuracy lên ${translatePassivePhrase(target)}`],
  [/^Attribute Requirements of Gems can be satisified by your highest Attribute$/i, () => "Attribute Requirement của Gem có thể được đáp ứng bằng Attribute cao nhất của bạn"],
  [/^All Damage from you and Allies in your Presence$/i, () => "Toàn bộ Damage từ bạn và Allies trong Presence của bạn"],
  [/^Modifiers to (.+?) also grant (.+?) at (.+?) of their value$/i, ([, source, granted, value]) => `Modifier lên ${translatePassivePhrase(source)} cũng cấp ${translatePassivePhrase(granted)} bằng ${value} giá trị đó`],
  [/^\+(.+?) to maximum number of Elemental Infusions$/i, ([, amount]) => `+${amount} số lượng Elemental Infusion tối đa`],
  [/^\+(.+?) to maximum number of (.+)$/i, ([, amount, subject]) => `+${amount} số lượng ${translatePassivePhrase(subject)} tối đa`],
  [/^(.+?) die (.+?) seconds after their Life is reduced to 0$/i, ([, subject, seconds]) => `${translatePassivePhrase(subject)} chết sau ${seconds} giây kể từ khi Life của chúng giảm về 0`],
  [/^Warcries Explode Corpses dealing (.+?) of their Life as (.+?)$/i, ([, amount, damageType]) => `Warcry làm Corpse Explode, gây ${translatePassivePhrase(damageType)} bằng ${amount} Life của chúng`],
  [/^Ignore (.+?) Cooldowns$/i, ([, source]) => `Bỏ qua ${translatePassivePhrase(source)} Cooldown`],
  [/^Break enemy (.+?) on Hit equal to (.+?) of Damage Dealt$/i, ([, target, amount]) => `Break ${translatePassivePhrase(target)} của kẻ địch khi Hit bằng ${amount} Damage đã gây`],
  [/^Enemies regain (.+?) of (.+?) every second if they haven't lost (.+?) in the past (.+?) seconds$/i, ([, amount, resource, lostResource, seconds]) => `Kẻ địch hồi ${amount} ${translatePassivePhrase(resource)} mỗi giây nếu chúng chưa mất ${translatePassivePhrase(lostResource)} trong ${seconds} giây trước`],
  [/^(.+?) chance for Enemies you Kill to Explode, dealing (.+)$/i, ([, chance, amount]) => `${chance} chance khiến kẻ địch bạn hạ Explode, gây ${amount}`],
  [/^of their maximum Life as (.+?)$/i, ([, damageType]) => `Life tối đa của chúng dưới dạng ${translatePassivePhrase(damageType)}`],
  [/^Enemies affected by your (.+?) Recently have (.+?) reduced (.+)$/i, ([, source, amount, stat]) => `Kẻ địch bị ${translatePassivePhrase(source)} của bạn ảnh hưởng gần đây bị giảm ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) increased Damage with Hits against Enemies affected by (.+)$/i, ([, amount, effect]) => `Tăng ${amount} Damage bằng Hit lên kẻ địch đang chịu ${translatePassivePhrase(effect)}`],
  [/^(.+?) increased (.+?) with Hits against Enemies affected by (.+)$/i, ([, amount, stat, effect]) => `Tăng ${amount} ${translatePassivePhrase(stat)} bằng Hit lên kẻ địch đang chịu ${translatePassivePhrase(effect)}`],
  [/^Projectiles deal (.+?) increased Damage with Hits against Enemies within (.+)$/i, ([, amount, distance]) => `Projectile gây Damage bằng Hit tăng ${amount} lên kẻ địch trong phạm vi ${distance}`],
  [/^Projectiles deal (.+?) increased Damage with Hits against Enemies further than (.+)$/i, ([, amount, distance]) => `Projectile gây Damage bằng Hit tăng ${amount} lên kẻ địch cách xa hơn ${distance}`],
  [/^(.+?) increased Damage with Hits against (.+)$/i, ([, amount, target]) => `Tăng ${amount} Damage bằng Hit lên ${translateEnemyTarget(target)}`],
  [/^(.+?) increased (.+?) with Hits against (.+)$/i, ([, amount, stat, target]) => `Tăng ${amount} ${translatePassivePhrase(stat)} bằng Hit lên ${translateEnemyTarget(target)}`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second while affected by any (.+)$/i, ([, amount, resource, effect]) => `Hồi ${amount} ${resource} tối đa mỗi giây khi đang chịu ảnh hưởng của bất kỳ ${translatePassivePhrase(effect)} nào`],
  [/^(.+?) increased (.+?) while affected by (?:an? )?(.+)$/i, ([, amount, stat, effect]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi đang chịu ảnh hưởng của ${translatePassivePhrase(effect)}`],
  [/^(.+?) faster start of Energy Shield Recharge while affected by (?:an? )?(.+)$/i, ([, amount, effect]) => `Energy Shield Recharge bắt đầu nhanh hơn ${amount} khi đang chịu ảnh hưởng của ${translatePassivePhrase(effect)}`],
  [/^Immune to (.+?) while affected by (?:an? )?(.+)$/i, ([, immune, effect]) => `Miễn nhiễm ${translatePassivePhrase(immune)} khi đang chịu ảnh hưởng của ${translatePassivePhrase(effect)}`],
  [/^Immune to (.+?) if Equipped (.+?) has higher (.+?) than (.+)$/i, ([, immune, slot, high, low]) => `Miễn nhiễm ${translatePassivePhrase(immune)} nếu ${translatePassivePhrase(slot)} đang trang bị có ${translatePassivePhrase(high)} cao hơn ${translatePassivePhrase(low)}`],
  [/^Immune to Bleeding if Equipped Helmet has higher Armour than Evasion Rating$/i, () => `Miễn nhiễm ${translatePassivePhrase("Bleeding")} nếu Helmet đang trang bị có Armour cao hơn ${translatePassivePhrase("Evasion Rating")}`],
  [/^Immune to Chaos Damage and Bleeding$/i, () => `Miễn nhiễm Chaos Damage và ${translatePassivePhrase("Bleeding")}`],
  [/^Unarmed Attacks that would use your Quarterstaff's damage gain:$/i, () => "Unarmed Attack lẽ ra dùng Damage từ Quarterstaff của bạn sẽ nhận:"],
  [/^Physical damage based on their Skill Level$/i, () => "Physical Damage dựa trên Skill Level của chúng"],
  [/^(.+?) more Attack Speed per (.+?) Item Evasion Rating on Equipped Armour Items$/i, ([, amount, rating]) => `${amount} more Attack Speed mỗi ${rating} chỉ số né tránh từ Item trên Armour Item đang trang bị`],
  [/^\+(.+?) to Critical Hit Chance per (.+?) Item Energy Shield on Equipped Armour Items$/i, ([, amount, rating]) => `+${amount} Critical Hit Chance mỗi ${rating} Item Energy Shield trên Armour Item đang trang bị`],
  [/^Increases and Reductions to Armour also apply to Energy Shield$/i, () => "Tăng và giảm Armour cũng áp dụng cho Energy Shield"],
  [/^Increases and Reductions to (.+?) also apply to (.+)$/i, ([, source, target]) => `Tăng và giảm ${translatePassivePhrase(source)} cũng áp dụng cho ${translatePassivePhrase(target)}`],
  [/^Fully Broken Armour you inflict increases all Damage Taken from Hits instead$/i, () => "Fully Broken Armour bạn gây sẽ làm tăng toàn bộ Damage nhận từ Hit thay thế"],
  [/^Fully Broken Armour you inflict also increases Fire Damage Taken from Hits$/i, () => "Fully Broken Armour bạn gây cũng làm tăng Fire Damage nhận từ Hit"],
  [/^(.+?) increased Damage against Enemies with Fully Broken Armour$/i, ([, amount]) => `Tăng ${amount} Damage lên kẻ địch có Fully Broken Armour`],
  [/^Projectiles Pierce enemies with Fully Broken Armour$/i, () => "Projectile Pierce kẻ địch có Fully Broken Armour"],
  [/^You can Break Enemy Armour to below 0$/i, () => "Bạn có thể Break Armour của kẻ địch xuống dưới 0"],
  [/^\+(.+?) to (Fire|Cold|Lightning|Chaos) Resistance$/i, ([, amount, type]) => `+${amount} ${type} Resistance`],
  [/^Debuffs you inflict have (.+?) increased Slow Magnitude$/i, ([, amount]) => `Debuff bạn gây được tăng ${amount} Slow Magnitude`],
  [/^(.+?) reduced effect of (.+?) on you$/i, ([, amount, effect]) => `Giảm ${amount} Effect của ${translatePassivePhrase(effect)} lên bạn`],
  [/^Attacks with One-Handed Weapons have (.+?) increased Chance to inflict Ailments$/i, ([, amount]) => `Attack với One-Handed Weapon được tăng ${amount} Chance gây Ailment`],
  [/^(.+?) increased duration of Ailments you inflict against Cursed Enemies$/i, ([, amount]) => `Tăng ${amount} Duration của Ailment bạn gây lên kẻ địch bị Cursed`],
  [/^(.+?) increased Duration of Poisons you inflict against (.+?) Enemies$/i, ([, amount, state]) => `Tăng ${amount} Duration của Poison bạn gây lên kẻ địch bị ${state}`],
  [/^(.+?) increased Critical Hit Chance against Enemies that are affected$/i, ([, amount]) => `Tăng ${amount} Critical Hit Chance lên kẻ địch đang`],
  [/^by no Elemental Ailments$/i, () => "không chịu Elemental Ailment nào"],
  [/^(.+?) increased (.+?) against Enemies that are on (Low|Full) Life$/i, ([, amount, stat, lifeState]) => `Tăng ${amount} ${translatePassivePhrase(stat)} lên kẻ địch đang ${lifeState} Life`],
  [/^(.+?) increased (.+?) against enemies within (.+?) metres?$/i, ([, amount, stat, distance]) => `Tăng ${amount} ${translatePassivePhrase(stat)} lên kẻ địch trong phạm vi ${distance} mét`],
  [/^(.+?) increased Damage with Hits against Enemies that are on Full Life$/i, ([, amount]) => `Tăng ${amount} Damage bằng Hit lên kẻ địch đang Full Life`],
  [/^(.+?) chance to Poison on Hit against Enemies that are not Poisoned$/i, ([, chance]) => `${chance} chance Poison khi Hit lên kẻ địch chưa bị Poisoned`],
  [/^(.+?) chance that if you would gain (Power|Frenzy|Endurance) Charges, you instead gain up to$/i, ([, chance, charge]) => `${chance} chance: nếu bạn sắp nhận ${charge} Charge, thay vào đó nhận tối đa`],
  [/^(.+?) chance that if you would gain (Power|Frenzy|Endurance) Charges, you instead gain up to your maximum number of \2 Charges$/i, ([, chance, charge]) => `${chance} chance: nếu bạn sắp nhận ${charge} Charge, thay vào đó nhận tối đa số ${charge} Charge của bạn`],
  [/^(.+?) chance that if you would gain (Power|Frenzy|Endurance) Charges, you instead gain up to maximum \2 Charges$/i, ([, chance, charge]) => `${chance} chance: nếu bạn sắp nhận ${charge} Charge, thay vào đó nhận tối đa ${charge} Charge`],
  [/^(.+?) chance that if you would gain Rage on Hit, you instead gain up to your maximum Rage$/i, ([, chance]) => `${chance} chance: nếu bạn sắp nhận Rage khi Hit, thay vào đó nhận tối đa Rage của bạn`],
  [/^your maximum number of (Power|Frenzy|Endurance) Charges$/i, ([, charge]) => `số ${charge} Charge tối đa của bạn`],
  [/^\+(.+?) to Maximum (Power|Frenzy|Endurance) Charges$/i, ([, amount, charge]) => `+${amount} ${charge} Charge tối đa`],
  [/^\+(.+?) to Maximum Rage$/i, ([, amount]) => `+${amount} Rage tối đa`],
  [/^\+(.+?) to maximum Rage while Shapeshifted$/i, ([, amount]) => `+${amount} Rage tối đa khi đang biến hình`],
  [/^\+(.+?) to maximum (Fire|Cold|Lightning) Infusions$/i, ([, amount, type]) => `+${amount} ${type} Infusion tối đa`],
  [/^(.+?) chance for Bleeding to be Aggravated when Inflicted against Enemies on (.+)$/i, ([, chance, ground]) => `${chance} cơ hội để ${translatePassivePhrase("Bleeding")} được Aggravated khi gây lên kẻ địch trên ${translatePassivePhrase(ground)}`],
  [/^Enemies you inflict Bleeding on cannot Regenerate Life$/i, () => "Kẻ địch bạn gây Bleeding lên không thể Regenerate Life"],
  [/^(.+?) chance to inflict (.+?) with Hits against Enemies further than (.+)$/i, ([, chance, ailment, distance]) => `${chance} chance gây ${ailment} bằng Hit lên kẻ địch cách xa hơn ${distance}`],
  [/^Warcries inflict (.+?) Critical Weakness on Enemies$/i, ([, amount]) => `Warcry gây ${amount} Critical Weakness lên kẻ địch`],
  [/^Defend with (.+?) of Armour against Hits from Enemies that are further than (.+?) away$/i, ([, amount, distance]) => `Defend bằng ${amount} Armour trước Hit từ kẻ địch cách xa hơn ${distance}`],
  [/^Bleeding you inflict on Pinned Enemies is Aggravated$/i, () => "Bleeding bạn gây lên kẻ địch bị Pinned được Aggravated"],
  [/^Damage with Hits is Lucky against Enemies that are on Low Life$/i, () => "Damage bằng Hit là Lucky lên kẻ địch đang Low Life"],
  [/^Prevent \+?(.+?) of Damage from Deflected Hits?$/i, ([, amount]) => `Ngăn +${amount} Damage từ Hit bị Deflect`],
  [/^Deflected Hits cannot inflict (.+?) on you$/i, ([, ailment]) => `Hit bị Deflect không thể gây ${translatePassivePhrase(ailment)} lên bạn`],
  [/^Elemental Damage also Contributes to Bleeding Magnitude$/i, () => `Elemental Damage cũng góp vào Magnitude của ${translatePassivePhrase("Bleeding")}`],
  [/^Exposure you inflict lowers Resistances by an additional (.+)$/i, ([, amount]) => `Exposure bạn gây giảm thêm ${amount} Resistance`],
  [/^(.+?) increased chance to inflict Elemental Ailments if you have Shapeshifted to an Animal form Recently$/i, ([, amount]) => `Tăng ${amount} chance gây Elemental Ailment nếu gần đây bạn đã biến hình sang Animal form`],
  [/^(.+?) chance to inflict (.+?) on Critical Hit with Attacks$/i, ([, chance, ailment]) => `${chance} chance gây ${translatePassivePhrase(ailment)} khi Critical Hit bằng Attack`],
  [/^(.+?) increased Magnitude of (.+?) you inflict against Enemies affected by (.+)$/i, ([, amount, ailment, effect]) => `Tăng ${amount} Magnitude của ${translatePassivePhrase(ailment)} bạn gây lên kẻ địch bị ảnh hưởng bởi ${translatePassivePhrase(effect)}`],
  [/^(.+?) increased Magnitude of (.+?) you inflict against (.+?) Enemies$/i, ([, amount, ailment, state]) => `Tăng ${amount} Magnitude của ${translatePassivePhrase(ailment)} bạn gây lên kẻ địch bị ${translatePassivePhrase(state)}`],
  [/^(.+?) chance to inflict (.+?) on Critical Hit$/i, ([, chance, ailment]) => `${chance} chance gây ${translatePassivePhrase(ailment)} khi Critical Hit`],
  [/^(.+?) (increased|more|less) Magnitude of (.+?) you inflict(?: with (.+))?$/i, ([, amount, scale, ailment, source]) => `${scale.toLowerCase() === "increased" ? `Tăng ${amount}` : `${amount} ${scale}`} Magnitude của ${translatePassivePhrase(ailment)} bạn gây${source ? ` bằng ${translatePassivePhrase(source)}` : ""}`],
  [/^Charms applied to you have (.+?) increased Effect$/i, ([, amount]) => `Charm áp dụng lên bạn được tăng ${amount} Effect`],
  [/^(.+?) have (.+?) increased effect$/i, ([, subject, amount]) => `${translatePassivePhrase(subject)} được tăng ${amount} Effect`],
  [/^(.+?) can be collected from (.+?) further away$/i, ([, subject, amount]) => `${translatePassivePhrase(subject)} có thể được thu thập từ xa hơn ${amount}`],
  [/^(.+?) increased Area of Effect of (.+)$/i, ([, amount, source]) => `Tăng ${amount} khu vực đánh lan của ${translatePassivePhrase(source)}`],
  [/^(.+?) increased Effect of your (.+)$/i, ([, amount, source]) => `Tăng ${amount} Effect của ${translatePassivePhrase(source)} của bạn`],
  [/^Can Allocate Passives from the (.+?)'s starting point$/i, ([, source]) => `Có thể Allocate Passive từ điểm bắt đầu của ${source}`],
  [/^Ritual Sacrifice can be used on yourself to remove (.+?) of maximum Life and grant a random Monster Modifier$/i, ([, amount]) => `Ritual Sacrifice có thể dùng lên bản thân để xóa ${amount} Life tối đa và cấp một Monster Modifier ngẫu nhiên`],
  [/^A maximum of one Modifer can be granted this way$/i, () => "Tối đa một Modifier có thể được cấp theo cách này"],
  [/^Double Adaptation Effect$/i, () => "Nhân đôi Adaptation Effect"],
  [/^Sorcery Ward's Barrier can also take Physical and Chaos Damage from Hits$/i, () => "Barrier của Sorcery Ward cũng có thể nhận Physical và Chaos Damage từ Hit"],
  [/^Chance to Hit with Attacks can exceed 100%$/i, () => "Chance to Hit bằng Attack có thể vượt 100%"],
  [/^(.+?) of Life Loss from Hits is prevented, then that much Life is lost over (.+?) seconds instead$/i, ([, amount, seconds]) => `Ngăn ${amount} Life Loss từ Hit, sau đó mất lượng Life đó trong ${seconds} giây thay thế`],
  [/^You can apply an additional Curse$/i, () => "Bạn có thể áp dụng thêm một Curse"],
  [/^You can equip a (.+?) while wielding a (.+)$/i, ([, item, weapon]) => `Bạn có thể trang bị ${translatePassivePhrase(item)} khi đang cầm ${translatePassivePhrase(weapon)}`],
  [/^Can instead consume (.+?) of maximum Mana to trigger Charms with insufficient charges$/i, ([, amount]) => `Có thể Consume ${amount} Mana tối đa để Trigger Charm khi không đủ Charge thay thế`],
  [/^Double the number of your Poisons that targets can be affected by at the same time$/i, () => "Nhân đôi số Poison của bạn có thể ảnh hưởng lên mục tiêu cùng lúc"],
  [/^Can only use a Normal Body Armour$/i, () => "Chỉ có thể dùng Body Armour Normal"],
  [/^(.+?) of (.+?) taken Recouped as (.+?)(?: while (.+))?$/i, ([, amount, source, target, condition]) => `Recoup ${amount} ${translatePassivePhrase(source)} nhận vào dưới dạng ${translatePassivePhrase(target)}${condition ? ` khi ${translatePassivePhrase(condition)}` : ""}`],
  [/^Recoup Effects instead occur over (.+?) seconds$/i, ([, seconds]) => `Recoup Effect diễn ra trong ${seconds} giây thay thế`],
  [/^Attribute Passive Skills can instead grant (.+?) increased (.+)$/i, ([, amount, stat]) => `Attribute Passive Skill có thể thay vào đó cấp ${amount} ${translatePassivePhrase(stat)} tăng thêm`],
  [/^There is no Limit on the number of Banners you can place$/i, () => "Không giới hạn số lượng Banner bạn có thể đặt"],
  [/^Can Socket a non-Unique Basic Jewel into the Phylactery$/i, () => "Có thể Socket một Basic Jewel không Unique vào Phylactery"],
  [/^Cannot gain (.+?) from (.+)$/i, ([, resource, source]) => `Không thể nhận ${translatePassivePhrase(resource)} từ ${translatePassivePhrase(source)}`],
  [/^Cannot use (.+)$/i, ([, value]) => `Không thể dùng ${translatePassivePhrase(value)}`],
  [/^Cannot Dodge Roll or Sprint$/i, () => "Không thể Dodge Roll hoặc Sprint"],
  [/^Pinned enemies cannot perform actions$/i, () => "Kẻ địch bị Pinned không thể thực hiện hành động"],
  [/^Dodge Roll cannot Avoid Damage$/i, () => "Dodge Roll không thể Avoid Damage"],
  [/^Invocation Skills cannot gain Energy while Triggering Spells$/i, () => "Invocation Skill không thể nhận Energy khi đang Trigger Spell"],
  [/^You cannot Recover Energy Shield from Regeneration$/i, () => "Bạn không thể hồi Energy Shield từ Regeneration"],
  [/^You cannot Recover Energy Shield to above Armour$/i, () => "Bạn không thể hồi Energy Shield vượt quá Armour"],
  [/^Enemies you Curse cannot Recharge Energy Shield$/i, () => "Kẻ địch bạn Curse không thể Recharge Energy Shield"],
  [/^Enemies you Fully Armour Break cannot Regenerate Life$/i, () => "Kẻ địch bị bạn Fully Armour Break không thể Regenerate Life"],
  [/^If you would gain a Charge, Allies in your Presence gain that Charge instead$/i, () => "Nếu bạn sắp nhận một Charge, Allies trong Presence của bạn nhận Charge đó thay thế"],
  [/^Bleeding you inflict is Aggravated$/i, () => "Bleeding bạn gây được Aggravated"],
  [/^You can wield Two-Handed Axes, Maces and Swords in one hand$/i, () => "Bạn có thể cầm Two-Handed Axe, Mace và Sword bằng một tay"],
  [/^No (.+?) effect$/i, ([, source]) => `Không có ${translatePassivePhrase(source)} Effect`],
  [/^Invocation Skills instead Trigger Spells every (.+?) seconds$/i, ([, seconds]) => `Invocation Skill Trigger Spell mỗi ${seconds} giây thay thế`],
  [/^Slam Skills you use yourself have (.+?) increased (.+)$/i, ([, amount, stat]) => `Slam Skill bạn tự dùng được tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) Slam Skills you use yourself have (?:a )?(.+?) chance to cause (?:an? )?additional (.+)$/i, ([, weapon, chance, effect]) => `${translatePassivePhrase(weapon)} Slam Skill bạn tự dùng có ${chance} chance gây thêm ${effect}`],
  [/^Slam Skills you use yourself have (?:a )?(.+?) chance to cause (?:an? )?additional (.+)$/i, ([, chance, effect]) => `Slam Skill bạn tự dùng có ${chance} chance gây thêm ${effect}`],
  [/^(.+?) Skills you use yourself (?:with (.+?) )?have (?:a )?(.+?) chance to (.+)$/i, ([, skillType, weapon, chance, action]) => `${translatePassivePhrase(skillType)} Skill bạn tự dùng${weapon ? ` bằng ${translatePassivePhrase(weapon)}` : ""} có ${chance} chance ${translatePassivePhrase(action)}`],
  [/^(.+?) Skills you use yourself have (.+?) increased (.+)$/i, ([, skillType, amount, stat]) => `${translatePassivePhrase(skillType)} Skill bạn tự dùng được tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) increased (.+?) during Effect of any (.+)$/i, ([, amount, stat, source]) => `Tăng ${amount} ${translatePassivePhrase(stat)} trong thời gian Effect của bất kỳ ${translatePassivePhrase(source)} nào`],
  [/^(.+?) increased Skill Effect Duration per Enemy you've (Frozen|Ignited) in the last (.+?) seconds, up to (.+)$/i, ([, amount, ailment, seconds, cap]) => `Tăng ${amount} Skill Effect Duration cho mỗi kẻ địch bạn đã ${ailment === "Frozen" ? "Freeze" : "Ignite"} trong ${seconds} giây gần nhất, tối đa ${cap}`],
  [/^(.+?) increased Area of Effect for Attacks per Enemy you've Ignited in the last (.+?) seconds, up to (.+)$/i, ([, amount, seconds, cap]) => `Tăng ${amount} khu vực đánh lan cho Attack mỗi kẻ địch bạn đã Ignite trong ${seconds} giây gần nhất, tối đa ${cap}`],
  [/^(.+?) increased (.+?) if you have Stunned an Enemy Recently$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã Stun một kẻ địch`],
  [/^Skills deal (.+?) increased Damage per Combo consumed, up to (.+)$/i, ([, amount, cap]) => `Skill được tăng ${amount} Damage mỗi Combo đã Consume, tối đa ${cap}`],
  [/^\+(.+?) maximum Rage for each time you've used a Skill that Requires Glory in the past (.+?) seconds, up to (.+?) times$/i, ([, amount, seconds, cap]) => `+${amount} Rage tối đa cho mỗi lần bạn đã dùng Skill yêu cầu Glory trong ${seconds} giây trước, tối đa ${cap} lần`],
  [/^(.+?) increased (.+?) if you've consumed an? (.+?) Recently$/i, ([, amount, stat, consumed]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã Consume ${translatePassivePhrase(consumed)}`],
  [/^(.+?) increased (.+?) if you have consumed an? (.+?) Recently$/i, ([, amount, stat, consumed]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã Consume ${translatePassivePhrase(consumed)}`],
  [/^(.+?) increased (.+?) if you have Consumed a Corpse Recently$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã Consume Corpse`],
  [/^(.+?) increased (.+?) if one of your Minions has died Recently$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây một Minion của bạn đã chết`],
  [/^Archon recovery period expires (.+?) (slower|faster)$/i, ([, amount, speed]) => `Thời gian hồi Archon kết thúc ${speed === "slower" ? "chậm hơn" : "nhanh hơn"} ${amount}`],
  [/^On Hitting an Enemy while a Life Flask is at full Charges, (.+?) of its Charges are consumed$/i, ([, amount]) => `Khi Hit kẻ địch trong lúc Life Flask đầy Charge, ${amount} Charge của nó bị Consume`],
  [/^Gain (.+?) of damage as Physical damage for (.+?) seconds per Charge consumed this way$/i, ([, amount, seconds]) => `Nhận ${amount} Damage dưới dạng Physical Damage trong ${seconds} giây mỗi Charge đã Consume theo cách này`],
  [/^When you Shapeshift to Human form, gain (.+?) increased Spell Damage per second you were Shapeshifted, up to a maximum of (.+?), for (.+?) seconds$/i, ([, amount, cap, seconds]) => `Khi biến hình về Human form, nhận ${amount} Spell Damage tăng thêm mỗi giây bạn đã biến hình, tối đa ${cap}, trong ${seconds} giây`],
  [/^(.+?) increased Stun Threshold for each time you've been Stunned Recently$/i, ([, amount]) => `Tăng ${amount} Stun Threshold cho mỗi lần gần đây bạn đã bị Stunned`],
  [/^Damage Penetrates (.+?) Elemental Resistances for each time you've used a Skill that Requires Glory in the past (.+?) seconds$/i, ([, amount, seconds]) => `Damage xuyên ${amount} Elemental Resistance cho mỗi lần bạn đã dùng Skill yêu cầu Glory trong ${seconds} giây trước`],
  [/^(.+?) increased Damage for each time you've Warcried Recently$/i, ([, amount]) => `Tăng ${amount} Damage cho mỗi lần gần đây bạn đã Warcry`],
  [/^Gain (.+?) of Damage as Extra (Fire|Cold|Lightning|Chaos|Physical) Damage per (.+?) Charge consumed Recently$/i, ([, amount, type, charge]) => `Nhận ${amount} Damage dưới dạng Extra ${type} Damage mỗi ${charge} Charge đã Consume gần đây`],
  [/^Recover (.+?) of maximum Life for each (.+?) Charge consumed$/i, ([, amount, charge]) => `Hồi ${amount} Life tối đa cho mỗi ${charge} Charge đã Consume`],
  [/^Recover (.+?) of maximum Life per Glory consumed$/i, ([, amount]) => `Hồi ${amount} Life tối đa mỗi Glory đã Consume`],
  [/^Consume all Rage when Shapeshifting to Human form to recover (.+?) of maximum life per Rage Consumed$/i, ([, amount]) => `Consume toàn bộ Rage khi biến hình về Human form để hồi ${amount} Life tối đa mỗi Rage đã Consume`],
  [/^(.+?) increased Movement Speed for each time you've Blocked in the past (.+?) seconds$/i, ([, amount, seconds]) => `Tăng ${amount} Movement Speed cho mỗi lần bạn đã Block trong ${seconds} giây trước`],
  [/^(Life|Mana) Flasks also recover (Life|Mana)$/i, ([, flask, resource]) => `${flask} Flask cũng hồi ${resource}`],
  [/^Damage of Enemies Hitting you is Unlucky$/i, () => "Damage của kẻ địch Hit bạn là Unlucky"],
  [/^(.+?) Skills have \+(.+?) to maximum number of (.+)$/i, ([, skillType, amount, subject]) => `${translatePassivePhrase(`${skillType} Skills`)} có +${amount} số lượng ${translatePassivePhrase(subject)} tối đa`],
  [/^Recover (.+?) of Maximum (Life|Mana) when you collect a Remnant$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa khi bạn thu thập Remnant`],
  [/^Recover (.+?) of maximum (Life|Mana) on Kill$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa khi Kill`],
  [/^Recover (.+?) (Life|Mana) when you Block$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} khi bạn Block`],
  [/^Recover (.+?) of maximum Life on Killing a Poisoned Enemy$/i, ([, amount]) => `Hồi ${amount} Life tối đa khi Kill kẻ địch bị Poisoned`],
  [/^Recover (.+?) of maximum Life when you Heavy Stun a Rare or Unique Enemy$/i, ([, amount]) => `Hồi ${amount} Life tối đa khi bạn Heavy Stun kẻ địch Rare hoặc Unique`],
  [/^Recover (.+?) of maximum Life when one of your Minions is Revived$/i, ([, amount]) => `Hồi ${amount} Life tối đa khi một Minion của bạn được Revive`],
  [/^When a Banner expires, recover (.+?) of the Glory required for that Banner$/i, ([, amount]) => `Khi Banner hết hạn, hồi ${amount} Glory cần cho Banner đó`],
  [/^(.+?) chance to Recover all Life when you Kill an Enemy$/i, ([, chance]) => `${chance} chance hồi toàn bộ Life khi bạn Kill kẻ địch`],
  [/^(.+?) chance for Damage of Enemies Hitting you to be Unlucky$/i, ([, chance]) => `${chance} chance khiến Damage của kẻ địch Hit bạn là Unlucky`],
  [/^Recover (.+?) of maximum (Life|Mana) when a Charm is used$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa khi Charm được dùng`],
  [/^Recover (.+?) of Maximum (Life|Mana) when you collect a Remnant$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa khi bạn thu thập Remnant`],
  [/^Recover (.+?) of maximum Life and Mana when you use a Warcry$/i, ([, amount]) => `Hồi ${amount} Life và Mana tối đa khi bạn dùng Warcry`],
  [/^Recover (.+?) of maximum Life when you use a Mana Flask$/i, ([, amount]) => `Hồi ${amount} Life tối đa khi bạn dùng Mana Flask`],
  [/^Recover (.+?) of maximum Mana when you consume a Power Charge$/i, ([, amount]) => `Hồi ${amount} Mana tối đa khi bạn Consume Power Charge`],
  [/^(.+?) increased (Fire|Cold|Lightning|Chaos|Physical) Damage per (.+?) Charge consumed Recently$/i, ([, amount, damageType, charge]) => `Tăng ${amount} ${damageType} Damage mỗi ${charge} Charge đã Consume gần đây`],
  [/^Projectiles have (.+?) increased (.+?) against Enemies further than (.+)$/i, ([, amount, stat, distance]) => `Projectile được tăng ${amount} ${translatePassivePhrase(stat)} lên kẻ địch cách xa hơn ${distance}`],
  [/^Projectiles deal (.+?) increased Damage with Hits against Enemies further than (.+)$/i, ([, amount, distance]) => `Projectile gây Damage bằng Hit tăng ${amount} lên kẻ địch cách xa hơn ${distance}`],
  [/^(.+?) increased Damage for each Hazard triggered Recently, up to (.+)$/i, ([, amount, cap]) => `Tăng ${amount} Damage cho mỗi Hazard đã Trigger gần đây, tối đa ${cap}`],
  [/^(.+?) increased Duration of Ailments against Enemies with Exposure$/i, ([, amount]) => `Tăng ${amount} Duration của Ailment lên kẻ địch có Exposure`],
  [/^Consuming Glory grants you (.+?) increased Attack damage per Glory consumed for (.+?) seconds, up to (.+)$/i, ([, amount, seconds, cap]) => `Consume Glory cấp cho bạn tăng ${amount} Attack Damage mỗi Glory đã Consume trong ${seconds} giây, tối đa ${cap}`],
  [/^(.+?) increased (.+?) per (.+?), up to (.+)$/i, ([, amount, stat, per, cap]) => `Tăng ${amount} ${translatePassivePhrase(stat)} mỗi ${translatePassivePhrase(per)}, tối đa ${cap}`],
  [/^(.+?) increased Duration of Ailments on Beasts$/i, ([, amount]) => `Tăng ${amount} Duration của Ailment lên Beast`],
  [/^(.+?) reduced Duration of Ailments on You$/i, ([, amount]) => `Giảm ${amount} Duration của Ailment lên bạn`],
  [/^(.+?) increased (Life and Mana Regeneration Rate|Attack Damage) for each Minion in your Presence, up to a maximum of (.+)$/i, ([, amount, stat, cap]) => `Tăng ${amount} ${translatePassivePhrase(stat)} cho mỗi Minion trong Presence của bạn, tối đa ${cap}`],
  [/^(.+?) reduced Magnitude of (.+?) you inflict$/i, ([, amount, ailment]) => `Giảm ${amount} Magnitude của ${translatePassivePhrase(ailment)} bạn gây`],
  [/^Consuming Glory grants you (.+?) increased Attack damage per Glory consumed for (.+?) seconds, up to (.+)$/i, ([, amount, seconds, cap]) => `Consume Glory cấp cho bạn tăng ${amount} Attack Damage mỗi Glory đã Consume trong ${seconds} giây, tối đa ${cap}`],
  [/^(.+?) increased Stun Threshold for each time you've been Hit by an Enemy Recently, up to (.+)$/i, ([, amount, cap]) => `Tăng ${amount} Stun Threshold cho mỗi lần bạn bị kẻ địch đánh trúng gần đây, tối đa ${cap}`],
  [/^Final Repeat of Spells has (.+?) increased (.+)$/i, ([, amount, stat]) => `Final Repeat của Spell được tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) increased chance to inflict Ailments(?: against (.+)| with (.+))?$/i, ([, amount, target, source]) => {
    const targetVi = /^Rare or Unique Enemies$/i.test(target || "")
      ? "kẻ địch Rare hoặc Unique"
      : /^Enemies with Exposure$/i.test(target || "")
        ? "kẻ địch có Exposure"
        : translatePassivePhrase(target || "");
    return `Tăng ${amount} chance gây Ailment${source ? ` bằng ${translatePassivePhrase(source)}` : ""}${target ? ` lên ${targetVi}` : ""}`;
  }],
  [/^(.+?) increased Effect of Poison you inflict on targets that are not Poisoned$/i, ([, amount]) => `Tăng ${amount} Effect của Poison bạn gây lên mục tiêu chưa bị Poisoned`],
  [/^(.+?) increased effect of (?!.* on you per ten percent missing Mana$)(.+)$/i, ([, amount, source]) => `Tăng ${amount} Effect của ${translatePassivePhrase(source)}`],
  [/^Recharge Rate at (.+?) of their value$/i, ([, amount]) => `Recharge Rate bằng ${amount} giá trị của chúng`],
  [/^Blind Enemies when they Stun you$/i, () => "Blind kẻ địch khi chúng Stun bạn"],
  [/^(.+?) chance for Remnants you create to grant their effects twice$/i, ([, chance]) => `${chance} chance để Remnant bạn tạo cấp hiệu ứng của chúng hai lần`],
  [/^(.+?) chance on Consuming a Shock on an Enemy to reapply it$/i, ([, chance]) => `${chance} chance khi Consume Shock trên kẻ địch để áp lại Shock đó`],
  [/^tenth of their maximum Life as (.+?)$/i, ([, damageType]) => `một phần mười Life tối đa của chúng dưới dạng ${translatePassivePhrase(damageType)}`],
  [/^(.+?) of Maximum Life Converted to Energy Shield$/i, ([, amount]) => `Chuyển ${amount} Life tối đa thành Energy Shield`],
  [/^Minions gain (.+?) of their maximum Life as Extra maximum Energy Shield$/i, ([, amount]) => `Minion nhận thêm Energy Shield tối đa bằng ${amount} Life tối đa của chúng`],
  [/^Life Flasks applied to you grant Guard for (.+?) seconds equal to (.+?) of the Life Recovery per Second they apply$/i, ([, seconds, amount]) => `Life Flask áp dụng lên bạn cấp Guard trong ${seconds} giây bằng ${amount} Life Recovery mỗi giây mà chúng áp dụng`],
  [/^Attacks gain increased Accuracy Rating equal to their Critical Hit Chance$/i, () => "Attack được tăng Accuracy Rating bằng Critical Hit Chance của chúng"],
  [/^Arrows gain Critical Hit Chance as they travel farther, up to$/i, () => "Arrow nhận Critical Hit Chance khi bay xa hơn, tối đa"],
  [/^(.+?) increased Critical Hit Chance after (.+?) metres$/i, ([, amount, distance]) => `Tăng ${amount} Critical Hit Chance sau ${distance} mét`],
  [/^Recoup (.+?) of damage taken by your Totems as Life$/i, ([, amount]) => `Recoup ${amount} Damage Totem của bạn nhận dưới dạng Life`],
  [/^Each Totem applies (.+?) increased Damage taken to Enemies in their Presence$/i, ([, amount]) => `Mỗi Totem khiến kẻ địch trong Presence của nó chịu thêm ${amount} Damage Taken`],
  [/^Attacks used by (Totems|Ballistas) have (.+?) increased Attack Speed(?: per (.+))?$/i, ([, owner, amount, per]) => `Attack do ${translatePassivePhrase(owner)} dùng được tăng ${amount} Attack Speed${per ? ` mỗi ${translatePassivePhrase(per)}` : ""}`],
  [/^(.+?) increased Area of Effect for Skills used by Totems$/i, ([, amount]) => `Tăng ${amount} khu vực đánh lan cho Skill do Totem dùng`],
  [/^(.+?) increased Spell Damage with Spells that cost Life$/i, ([, amount]) => `Tăng ${amount} Spell Damage với Spell tiêu tốn Life`],
  [/^Unwithered enemies are Withered for (.+?) seconds when they enter your Presence$/i, ([, seconds]) => `Kẻ địch chưa bị Withered sẽ bị Withered trong ${seconds} giây khi chúng vào Presence của bạn`],
  [/^Curse zones erupt after (.+?) reduced delay$/i, ([, amount]) => `Curse zone phun trào với delay giảm ${amount}`],
  [/^Break Armour equal to (.+?) of Hit Damage dealt$/i, ([, amount]) => `Break Armour bằng ${amount} Hit Damage đã gây`],
  [/^Gain (.+?) equal to (.+?) of Armour$/i, ([, stat, amount]) => `Nhận ${translatePassivePhrase(stat)} bằng ${amount} Armour`],
  [/^Gain (.+?) (Life|Mana) per enemy killed$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} khi giết kẻ địch`],
  [/^Gain (.+?) when Hit by an Enemy$/i, ([, value]) => `Nhận ${translatePassivePhrase(value)} khi bị kẻ địch đánh trúng`],
  [/^Gain Tailwind on Skill use$/i, () => "Nhận Tailwind khi dùng Skill"],
  [/^Gain (.+?) when an? (.+?) is Killed$/i, ([, value, subject]) => `Nhận ${translatePassivePhrase(value)} khi ${translatePassivePhrase(subject)} bị giết`],
  [/^Gain (.+?) of Damage as Extra Damage of a random Element$/i, ([, amount]) => `Nhận ${amount} Damage dưới dạng Extra Damage thuộc một Element ngẫu nhiên`],
  [/^Gain (.+?) of Damage as Extra Damage of a random Element while Shapeshifted$/i, ([, amount]) => `Nhận ${amount} Damage dưới dạng Extra Damage thuộc một Element ngẫu nhiên khi đang biến hình`],
  [/^Gain (.+?) of (.+?) Damage as Extra (.+?) Damage against (.+)$/i, ([, amount, source, extra, target]) => `Nhận ${amount} ${translatePassivePhrase(`${source} Damage`)} dưới dạng Extra ${translatePassivePhrase(`${extra} Damage`)} lên ${translateEnemyTarget(target)}`],
  [/^Gain (.+?) of (.+?) Damage as Extra (.+?) Damage(?: while (.+))?$/i, ([, amount, source, extra, condition]) => `Nhận ${amount} ${translatePassivePhrase(`${source} Damage`)} dưới dạng Extra ${translatePassivePhrase(`${extra} Damage`)}${condition ? ` khi ${translatePassivePhrase(condition)}` : ""}`],
  [/^Gain (.+?) of (.+?) Rating as extra (.+)$/i, ([, amount, source, target]) => `Nhận thêm ${translatePassivePhrase(target)} bằng ${amount} ${translatePassivePhrase(`${source} Rating`)}`],
  [/^Gain (.+?) of Damage as Extra (.+?) Damage for$/i, ([, amount, extra]) => `Nhận ${amount} Damage dưới dạng Extra ${translatePassivePhrase(`${extra} Damage`)} cho`],
  [/^Gain (.+?) of Damage as Extra (.+?) Damage(?: while (.+)| against (.+))?$/i, ([, amount, extra, condition, target]) => `Nhận ${amount} Damage dưới dạng Extra ${translatePassivePhrase(`${extra} Damage`)}${condition ? ` khi ${translatePassivePhrase(condition)}` : ""}${target ? ` lên ${translateEnemyTarget(target)}` : ""}`],
  [/^Skills gain a Base Life Cost equal to Base Mana Cost$/i, () => "Skill nhận Base Life Cost bằng Base Mana Cost"],
  [/^(.+?) of (.+?) lost per second if none was gained in the past (.+?)$/i, ([, amount, resource, window]) => `Mất ${amount} ${translatePassivePhrase(resource)} mỗi giây nếu trong ${translatePastWindow(window)} trước không nhận thêm ${translatePassivePhrase(resource)}`],
  [/^(.+?) increased Evasion Rating if Energy Shield Recharge has started in the past (.+?)$/i, ([, amount, window]) => `Tăng ${amount} chỉ số né tránh nếu Energy Shield Recharge đã bắt đầu trong ${translatePastWindow(window)} trước`],
  [/^(.+?) increased Damage with Crossbows for each type of (.+?) fired in the past (.+?)$/i, ([, amount, subject, window]) => `Tăng ${amount} Damage với Crossbow cho mỗi loại ${translatePassivePhrase(subject)} đã bắn trong ${translatePastWindow(window)} trước`],
  [/^every different (.+?) fired in the past (.+?)$/i, ([, subject, window]) => `mỗi ${translatePassivePhrase(subject)} khác nhau đã bắn trong ${translatePastWindow(window)} trước`],
  [/^Minions deal (.+?) increased Damage with Command Skills for each different type of (.+?) in your Presence$/i, ([, amount, subject]) => `Minion được tăng ${amount} Damage bằng Command Skill cho mỗi loại ${translatePassivePhrase(subject)} khác nhau trong Presence của bạn`],
  [/^(Spells|Attacks|Empowered Attacks|Minions) Gain (.+?) of Damage as extra (.+?) Damage$/i, ([, subject, amount, extra]) => `${translatePassivePhrase(subject)} nhận ${amount} Damage dưới dạng Extra ${translatePassivePhrase(`${extra} Damage`)}`],
  [/^(Spells|Attacks|Empowered Attacks|Minions) Gain (.+?) of (.+?) Damage as Extra (.+?) damage$/i, ([, subject, amount, source, extra]) => `${translatePassivePhrase(subject)} nhận ${amount} ${translatePassivePhrase(`${source} Damage`)} dưới dạng Extra ${translatePassivePhrase(`${extra} Damage`)}`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second while stationary$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa mỗi giây khi đứng yên`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second while Surrounded$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa mỗi giây khi bị bao quanh`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second while on (.+)$/i, ([, amount, resource, condition]) => `Hồi ${amount} ${resource} tối đa mỗi giây khi đang ${translatePassivePhrase(condition)}`],
  [/^Regenerate (.+?) (Life|Mana|Energy Shield|Spirit|Rage) per second per (.+?) (.+?) spent Recently$/i, ([, amount, resource, spentAmount, spentResource]) => `Hồi ${amount} ${resource} mỗi giây mỗi ${spentAmount} ${translatePassivePhrase(spentResource)} đã tiêu gần đây`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) over (.+?) when Stunned$/i, ([, amount, resource, window]) => `Hồi ${amount} ${resource} tối đa trong ${translatePastWindow(window)} khi bị Stunned`],
  [/^Regenerate Mana equal to (.+?) of maximum Life per second$/i, ([, amount]) => `Hồi Mana mỗi giây bằng ${amount} Life tối đa`],
  [/^Remnants you create reappear once, (.+?) seconds after being collected$/i, ([, seconds]) => `Remnant bạn tạo tái xuất hiện một lần, ${seconds} giây sau khi được thu thập`],
  [/^Excess Life Recovery from Regeneration is applied to Energy Shield$/i, () => "Life Recovery dư từ Regeneration được áp dụng cho Energy Shield"],
  [/^Gain Elemental Archon after spending (.+?) of your Maximum Mana$/i, ([, amount]) => `Nhận Elemental Archon sau khi tiêu ${amount} Mana tối đa của bạn`],
  [/^Banner Buffs linger on you for (.+?) seconds after you leave the Area$/i, ([, seconds]) => `Banner Buff duy trì trên bạn trong ${seconds} giây sau khi bạn rời Area`],
  [/^Break Armour on Critical Hit with Spells equal to (.+?) of Physical Damage dealt$/i, ([, amount]) => `Break Armour khi Critical Hit bằng Spell, bằng ${amount} Physical Damage đã gây`],
  [/^Remove a Curse after Channelling for (.+?) seconds$/i, ([, seconds]) => `Xóa một Curse sau khi Channeling trong ${seconds} giây`],
  [/^Gain (.+?) equal to your (.+?)$/i, ([, stat, attribute]) => `Nhận ${translatePassivePhrase(stat)} bằng ${translatePassivePhrase(attribute)} của bạn`],
  [/^Gain (.+?) equal to the lowest of Evasion and Armour on your (.+?)$/i, ([, stat, slot]) => `Nhận ${translatePassivePhrase(stat)} bằng giá trị thấp hơn giữa Evasion và Armour trên ${translatePassivePhrase(slot)} của bạn`],
  [/^Enemies are Maimed for (.+?) seconds after becoming Unpinned$/i, ([, seconds]) => `Kẻ địch bị Maimed trong ${seconds} giây sau khi trở thành Unpinned`],
  [/^Gain Physical Thorns damage equal to (.+?) of Item Armour on Equipped Body Armour$/i, ([, amount]) => `Nhận Physical Thorns Damage bằng ${amount} Item Armour trên Body Armour đang trang bị`],
  [/^Gain Physical Thorns damage equal to (.+?) of maximum Life while Shapeshifted$/i, ([, amount]) => `Nhận Physical Thorns Damage bằng ${amount} Life tối đa khi đang biến hình`],
  [/^Minions Break Armour equal to (.+?) of Physical damage dealt$/i, ([, amount]) => `Minion Break Armour bằng ${amount} Physical Damage đã gây`],
  [/^Gain Arcane Surge when you Shapeshift to Human form after$/i, () => "Nhận Arcane Surge khi bạn biến hình về Human form sau"],
  [/^being Shapeshifted for at least (.+?) seconds$/i, ([, seconds]) => `đã biến hình ít nhất ${seconds} giây`],
  [/^Charms applied to you have (.+?) increased Effect$/i, ([, amount]) => `Charm áp dụng lên bạn được tăng ${amount} Effect`],
  [/^Damage taken is Reserved from Darkness before being taken from Life or Energy Shield$/i, () => "Damage nhận vào được Reserved từ Darkness trước khi trừ vào Life hoặc Energy Shield"],
  [/^(.+?) of (.+?) is taken from Mana before Life$/i, ([, amount, damageType]) => `${amount} ${translatePassivePhrase(damageType)} được trừ từ Mana trước Life`],
  [/^Hit damage is taken from Mana before Life if your current Mana is higher than your current Life$/i, () => "Hit Damage được trừ từ Mana trước Life nếu Mana hiện tại của bạn cao hơn Life hiện tại của bạn"],
  [/^Gain (.+?) from Equipped Shield instead of the Shield's value$/i, ([, value]) => `Nhận ${translatePassivePhrase(value)} từ Shield đang trang bị thay vì giá trị của Shield`],
  [/^(.+?) of Damage from Hits is taken from your nearest Totem's Life before you$/i, ([, amount]) => `${amount} Damage từ Hit được trừ từ Life của Totem gần nhất của bạn trước khi trừ vào bạn`],
  [/^(.+?) of Damage from Hits is taken from your Damageable Companion's Life before you$/i, ([, amount]) => `${amount} Damage từ Hit được trừ từ Life của Damageable Companion của bạn trước khi trừ vào bạn`],
  [/^Life Recharges instead of Energy Shield$/i, () => "Life Recharge thay vì Energy Shield"],
  [/^All Damage is taken from Mana before Life$/i, () => "Toàn bộ Damage được trừ từ Mana trước Life"],
  [/^All bonuses from Equipped Amulet apply to your Minions instead of you$/i, () => "Toàn bộ bonus từ Amulet đang trang bị áp dụng cho Minion của bạn thay vì bạn"],
  [/^Gain (Power|Frenzy|Endurance) Charges instead of (Power|Frenzy|Endurance) Charges$/i, ([, gained, replaced]) => `Nhận ${gained} Charge thay vì ${replaced} Charge`],
  [/^Stun Threshold is based on (.+?) of your Energy Shield instead of Life$/i, ([, amount]) => `Stun Threshold dựa trên ${amount} Energy Shield của bạn thay vì Life`],
  [/^Arcane Surge grants more (.+?) instead of (.+?)$/i, ([, gained, replaced]) => `Arcane Surge cấp more ${translatePassivePhrase(gained)} thay vì ${translatePassivePhrase(replaced)}`],
  [/^Leeching Life from your Hits causes your Companion to also Leech the same amount of Life$/i, () => "Hút máu từ Hit của bạn khiến Companion của bạn cũng hút cùng lượng máu đó"],
  [/^On Freezing Enemies create Chilled Ground$/i, () => "Khi Freeze kẻ địch, tạo Chilled Ground"],
  [/^Every Third Slam skill that doesn't create Fissures which you use yourself causes (.+?) additional Aftershocks ahead and to each side of the initial area$/i, ([, count]) => `Mỗi Slam Skill thứ ba bạn tự dùng mà không tạo Fissure sẽ gây thêm ${count} Aftershock phía trước và hai bên vùng ban đầu`],
  [/^Gain Infernal Flame instead of spending Mana for Skill costs$/i, () => "Nhận Infernal Flame thay vì tiêu Mana cho Skill Cost"],
  [/^Create (.+?) Infusion Remnants instead of (.+)$/i, ([, infusion, replaced]) => `Tạo ${infusion} Infusion Remnant thay vì ${translatePassivePhrase(replaced)}`],
  [/^(.+?) increased Minion Damage while you have at least two different active Offerings$/i, ([, amount]) => `Tăng ${amount} Minion Damage khi bạn có ít nhất hai Offering đang active khác nhau`],
  [/^(.+?) chance to create an additional Remnant$/i, ([, chance]) => `${chance} chance tạo thêm một Remnant`],
  [/^Recover (.+?) of maximum Life when you create an Offering$/i, ([, amount]) => `Hồi ${amount} Life tối đa khi bạn tạo Offering`],
  [/^(.+?) increased Magnitude of Jagged Ground you create$/i, ([, amount]) => `Tăng ${amount} Magnitude của Jagged Ground bạn tạo`],
  [/^Body Armour grants (.+)$/i, ([, value]) => translateGrantClause("Body Armour", value)],
  [/^Banners also grant \+(.+?) to all Elemental Resistances to you and Allies$/i, ([, amount]) => `Banner cũng cấp +${amount} toàn bộ Elemental Resistance cho bạn và Allies`],
  [/^(.+?) of (.+?) also grants (.+)$/i, ([, amount, source, value]) => translateGrantClause(`${amount} ${translatePassivePhrase(source)}`, value, { also: true })],
  [/^Every (.+?) also grants (.+)$/i, ([, source, value]) => translateGrantClause(`Mỗi ${translatePassivePhrase(source)}`, value, { also: true })],
  [/^(.+?) also grants (.+)$/i, ([, subject, value]) => translateGrantClause(subject, value, { also: true })],
  [/^(.+?) also grant (.+)$/i, ([, subject, value]) => translateGrantClause(subject, value, { also: true })],
  [/^Every (.+?) also grants (.+)$/i, ([, source, value]) => translateGrantClause(`Mỗi ${translatePassivePhrase(source)}`, value, { also: true })],
  [/^Hits against you have (.+?) reduced (.+?)$/i, ([, amount, stat]) => `Hit lên bạn có giảm ${amount} ${translatePassivePhrase(stat)}`],
  [/^Hits against you have no (.+)$/i, ([, stat]) => `Hit lên bạn không có ${translatePassivePhrase(stat)}`],
  [/^Projectiles deal (.+?) more Hit damage to targets in the first (.+?) metres of their movement, scaling (up|down) with distance travelled to reach (.+?) after (.+?) metres$/i, ([, amount, start, direction, final, end]) => `Projectile gây ${amount} more Hit Damage lên mục tiêu trong ${start} mét đầu khi di chuyển, rồi ${direction === "up" ? "tăng dần" : "giảm dần"} theo quãng đường để đạt ${final} sau ${end} mét`],
  [/^Spells for which this Sacrifice was fully made deal (.+?) more Damage$/i, ([, amount]) => `Spell đã thực hiện đủ Sacrifice này gây ${amount} more Damage`],
  [/^(.+?) increased Damage with Hits against Enemies that are on Low Life$/i, ([, amount]) => `Tăng ${amount} Damage với Hit lên kẻ địch đang Low Life`],
  [/^(.+?) more Damage against Heavy Stunned Enemies$/i, ([, amount]) => `${amount} more Damage lên kẻ địch đang Heavy Stunned`],
  [/^(.+?) more Damage against Heavy Stunned Enemies with (.+)$/i, ([, amount, weapon]) => `${amount} more Damage lên kẻ địch bị Heavy Stunned với ${translatePassivePhrase(weapon)}`],
  [/^(.+?) more Damage against Enemies affected by (.+)$/i, ([, amount, effect]) => `${amount} more Damage lên kẻ địch bị ảnh hưởng bởi ${translatePassivePhrase(effect)}`],
  [/^(.+?) more damage against enemies with an Open Weakness$/i, ([, amount]) => `${amount} more Damage lên kẻ địch có Open Weakness`],
  [/^(.+?) increased Movement Speed while an enemy with an Open Weakness is in your Presence$/i, ([, amount]) => `Tăng ${amount} Movement Speed khi có kẻ địch mang Open Weakness trong Presence của bạn`],
  [/^Bleeding you inflict on Cursed targets is Aggravated$/i, () => "Bleeding bạn gây lên mục tiêu bị Cursed được Aggravated"],
  [/^(Bleeding|Ignites|Poisons?) you inflict deals? Damage (.+?) faster$/i, ([, ailment, amount]) => `${ailment} bạn gây sẽ gây Damage nhanh hơn ${amount}`],
  [/^Ignites you inflict deal Damage (.+?) faster$/i, ([, amount]) => `Ignite bạn gây sẽ gây Damage nhanh hơn ${amount}`],
  [/^Curses you inflict have infinite Duration$/i, () => "Curse bạn gây có Duration vô hạn"],
  [/^Targets Cursed by you have (.+?) reduced (.+)$/i, ([, amount, stat]) => `Mục tiêu bị bạn Curse có giảm ${amount} ${translatePassivePhrase(stat)}`],
  [/^Targets Cursed by you have at least (.+?) of Life Reserved$/i, ([, amount]) => `Mục tiêu bị bạn Curse có ít nhất ${amount} Life bị Reserved`],
  [/^Targets can be affected by (two|\+1) of your (.+?) at the same time$/i, ([, count, ailment]) => {
    const translatedAilment = translatePassivePhrase(ailment);
    return count.toLowerCase() === "two"
      ? `Mục tiêu có thể chịu đồng thời 2 ${translatedAilment} của bạn`
      : `Mục tiêu có thể chịu thêm 1 ${translatedAilment} của bạn cùng lúc`;
  }],
  [/^Your (.+?) can Slow targets by up to a maximum of (.+)$/i, ([, source, amount]) => `${translatePassivePhrase(source)} của bạn có thể Slow mục tiêu tối đa ${amount}`],
  [/^Enemies have an Accuracy Penalty against you based on Distance$/i, () => "Kẻ địch bị Accuracy Penalty lên bạn dựa theo khoảng cách"],
  [/^Enemy Critical Hit Chance against you is Unlucky$/i, () => "Critical Hit Chance của kẻ địch lên bạn là Unlucky"],
  [/^Enemies in your Presence have Exposure$/i, () => "Kẻ địch trong Presence của bạn có Exposure"],
  [/^Enemies have Maximum Concentration equal to (.+?) of their Maximum Life$/i, ([, amount]) => `Kẻ địch có Concentration tối đa bằng ${amount} Life tối đa của chúng`],
  [/^Reveal Weaknesses against Rare and Unique enemies$/i, () => "Reveal Weakness lên kẻ địch Rare và Unique"],
  [/^Chance is doubled against (.+)$/i, ([, target]) => `Chance được nhân đôi lên ${translatePassivePhrase(target)}`],
  [/^Deal up to (.+?) more Damage to Enemies based on their missing Concentration$/i, ([, amount]) => `Gây tối đa ${amount} more Damage lên kẻ địch dựa trên Concentration đang thiếu của chúng`],
  [/^While you are not on Low Mana, you and Allies in your Presence have Unholy Might$/i, () => "Khi bạn không ở Low Mana, bạn và Allies trong Presence của bạn có Unholy Might"],
  [/^(.+?) more Mana Cost of Skills if you have no Energy Shield$/i, ([, amount]) => `${amount} more Mana Cost của Skill nếu bạn không có Energy Shield`],
  [/^Take (.+?) (less|more) Damage over Time if you've started taking Damage over Time in the past second$/i, ([, amount, scale]) => `Nhận ${amount} ${scale} Damage over Time nếu bạn đã bắt đầu nhận Damage over Time trong 1 giây trước`],
  [/^Take (.+?) (less|more) Damage over Time if you haven't started taking Damage over Time in the past second$/i, ([, amount, scale]) => `Nhận ${amount} ${scale} Damage over Time nếu bạn chưa bắt đầu nhận Damage over Time trong 1 giây trước`],
  [/^Become Ignited when you deal a Critical Hit, taking (.+?) of your maximum Life and Energy Shield as Fire Damage per second$/i, ([, amount]) => `Bị Ignited khi bạn gây Critical Hit, nhận ${amount} Life tối đa và Energy Shield của bạn dưới dạng Fire Damage mỗi giây`],
  [/^Can Attack as though using a Quarterstaff while both of your hand slots are empty$/i, () => "Có thể Attack như đang dùng Quarterstaff khi cả hai ô tay của bạn đang trống"],
  [/^\+1% to Maximum Resistances of each Elemental Damage Type you have been Hit with Recently$/i, () => "+1% Maximum Resistance cho mỗi Elemental Damage Type gần đây đã Hit bạn"],
  [/^(.+?) chance to Gain (.+?) when you deal a Critical Hit$/i, ([, chance, value]) => `${chance} chance nhận ${translatePassivePhrase(value)} khi bạn gây Critical Hit`],
  [/^Enemies Ignited by you permanently take (.+?) increased Fire Damage for each second they have ever been Ignited by you, up to a maximum of (.+)$/i, ([, amount, cap]) => `Kẻ địch bị bạn gây bỏng vĩnh viễn chịu thêm ${amount} Fire Damage cho mỗi giây chúng từng bị bạn gây bỏng, tối đa ${cap}`],
  [/^Enemies (Frozen|Ignited) by you (?:permanently )?take (.+?) increased (.+)$/i, ([, ailment, amount, stat]) => {
    const action = ailment === "Frozen" ? "Freeze" : "gây bỏng";
    return `Kẻ địch bị bạn ${action} chịu thêm ${amount} ${translatePassivePhrase(stat)}`;
  }],
  [/^Enemies (Frozen|Ignited) by you have (.+?) to (.+?) Resistance$/i, ([, ailment, amount, type]) => `Kẻ địch bị bạn ${ailment} có ${amount} ${type} Resistance`],
  [/^(.+?) chance for Projectiles to Pierce Enemies within (.+?) distance of you$/i, ([, chance, distance]) => `${chance} chance để Projectile Pierce kẻ địch trong khoảng cách ${distance} từ bạn`],
  [/^(.+?) chance for Damage with Hits to be Lucky$/i, ([, chance]) => `${chance} chance để Damage bằng Hit là Lucky`],
  [/^Critical Hits with Daggers have a (.+?) chance to Poison the Enemy$/i, ([, chance]) => `Critical Hit với Dagger có ${chance} chance Poison kẻ địch`],
  [/^(.+?) increased (Maximum Life|Maximum Mana|Movement Speed) if you have at least (.+?) (Red|Blue|Green) Support Gems Socketed$/i, ([, amount, stat, count, color]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu bạn có ít nhất ${count} ${color} Support Gem đã Socket`],
  [/^least (.+?) (.+?) Support Gems Socketed$/i, ([, count, colors]) => `ít nhất ${count} ${colors.replace(/\band\b/i, "và")} Support Gem đã Socket`],
  [/^Damaging Ailments Cannot Be inflicted on you while you already have one$/i, () => "Damaging Ailment không thể bị gây lên bạn khi bạn đã có một Damaging Ailment"],
  [/^Hazards have (.+?) chance to rearm after they are triggered$/i, ([, chance]) => `Hazard có ${chance} chance tự rearm sau khi được trigger`],
  [/^Damaging Ailments deal damage (.+?) faster$/i, ([, amount]) => `Damaging Ailment gây Damage nhanh hơn ${amount}`],
  [/^Skills have a? ?(.+?) chance to not consume (Glory|a Cooldown) when used$/i, ([, chance, resource]) => `Skill có ${chance} chance không Consume ${resource} khi dùng`],
  [/^(.+?) have (.+?) chance to (Maim|Poison) on Hit$/i, ([, subject, chance, effect]) => `${translatePassivePhrase(subject)} có ${chance} chance ${effect} khi Hit`],
  [/^(.+?) have (.+?) chance to Empower (.+?) additional Attacks$/i, ([, subject, chance, count]) => `${translatePassivePhrase(subject)} có ${chance} chance Empower thêm ${count} Attack`],
  [/^Deal no (.+)$/i, ([, value]) => `Không gây ${translatePassivePhrase(value)}`],
  [/^Never deal (.+)$/i, ([, value]) => `Không bao giờ gây ${translatePassivePhrase(value)}`],
  [/^Cannot be (.+?) if you haven't been Hit Recently$/i, ([, state]) => `Không thể bị ${translatePassivePhrase(state)} nếu bạn chưa bị đánh trúng gần đây`],
  [/^Cannot be (.+?)(?: while (.+))?$/i, ([, state, condition]) => `Không thể bị ${translatePassivePhrase(state)}${condition ? ` khi ${translatePassivePhrase(condition)}` : ""}`],
  [/^(.+?) cannot deal (.+)$/i, ([, subject, value]) => `${translatePassivePhrase(subject)} không thể gây ${translatePassivePhrase(value)}`],
  [/^Your Hits cannot be Evaded by (.+)$/i, ([, target]) => `Hit của bạn không thể bị Evade bởi ${translateEnemyTarget(target)}`],
  [/^You can have (.+)$/i, ([, value]) => `Bạn có thể có ${translatePassivePhrase(value)}`],
  [/^Companions have \+1 to each Defence for every 2 of that Defence you have$/i, () => "Companion có +1 cho mỗi Defence với mỗi 2 điểm Defence đó bạn đang có"],
  [/^deal (.+?) more damage$/i, ([, amount]) => `Gây ${amount} more Damage`],
  [/^have (.+?) less duration$/i, ([, amount]) => `Có ${amount} less Duration`],
  [/^Defend with (.+?) of Armour against Critical Hits$/i, ([, amount]) => `Defend với ${amount} Armour trước Critical Hit`],
  [/^Enemies you Mark take (.+?) increased Damage$/i, ([, amount]) => `Kẻ địch bạn Mark chịu thêm ${amount} Damage`],
  [/^Enemies in Jagged Ground you create take (.+?) increased Damage$/i, ([, amount]) => `Kẻ địch trong Jagged Ground bạn tạo chịu thêm ${amount} Damage`],
  [/^(.+?) increased Critical Damage Bonus against Enemies that have exited your Presence Recently$/i, ([, amount]) => `Tăng ${amount} Critical Damage Bonus lên kẻ địch gần đây đã rời Presence của bạn`],
  [/^(.+?) increased Poison Duration for each Poison you have inflicted Recently, up to a maximum of (.+)$/i, ([, amount, cap]) => `Tăng ${amount} Poison Duration cho mỗi Poison bạn đã gây gần đây, tối đa ${cap}`],
  [/^When you Shapeshift to Human form, gain (.+?) increased Spell Damage per second you were Shapeshifted, up to a maximum of (.+?), for (.+?) seconds$/i, ([, amount, cap, seconds]) => `Khi biến hình về Human form, nhận ${amount} Spell Damage tăng thêm mỗi giây bạn đã biến hình, tối đa ${cap}, trong ${seconds} giây`],
  [/^Ignore all Movement Penalties from Armour$/i, () => "Bỏ qua toàn bộ Movement Penalty từ Armour"],
  [/^Attacks using your Weapons have Added Physical Damage equal$/i, () => "Attack dùng Weapon của bạn có Added Physical Damage bằng"],
  [/^Cursed Enemies killed by you, or by Allies in your Presence, have a (.+?) chance to explode, dealing a quarter of their maximum Life as Chaos damage$/i, ([, chance]) => `Kẻ địch bị Cursed do bạn hoặc Allies trong Presence của bạn hạ gục có ${chance} chance phát nổ, gây Chaos Damage bằng một phần tư Life tối đa của chúng`],
  [/^Benefits from consuming Frenzy Charges for your Skills have (.+?) chance to be doubled$/i, ([, chance]) => `Lợi ích từ việc Consume Frenzy Charge cho Skill của bạn có ${chance} chance được nhân đôi`],
  [/^100 Passive Skill Points become Weapon Set Skill Points$/i, () => "100 Passive Skill Point trở thành Weapon Set Skill Point"],
  [/^Ignite inflicted with Fire Spells deals Chaos Damage instead of Fire Damage$/i, () => "Ignite gây bằng Fire Spell sẽ gây Chaos Damage thay vì Fire Damage"],
  [/^(.+?) more Skill Speed while Off Hand is empty and you have$/i, ([, amount]) => `${amount} more Skill Speed khi Off Hand trống và bạn đáp ứng điều kiện`],
  [/^Plants have a (.+?) chance to immediately Overgrow$/i, ([, chance]) => `Plant có ${chance} chance Overgrow ngay lập tức`],
  [/^On Heavy Stunning a Rare or Unique Enemy, your next Attack within (.+?) seconds will be Ancestrally Boosted$/i, ([, seconds]) => `Khi Heavy Stun kẻ địch Rare hoặc Unique, Attack tiếp theo của bạn trong ${seconds} giây sẽ được Ancestrally Boosted`],
  [/^Gain a stack of Jade every second$/i, () => "Nhận 1 stack Jade mỗi giây"],
  [/^a One-Handed Martial Weapon equipped in your Main Hand$/i, () => "vũ khí cận chiến 1 tay đang trang bị ở Main Hand của bạn"],
  [/^(.+?) chance for (.+?) Damage with Hits to be Lucky$/i, ([, chance, damageType]) => `${chance} chance để ${translatePassivePhrase(`${damageType} Damage`)} bằng Hit là Lucky`],
  [/^Double (.+?) of (.+)$/i, ([, stat, subject]) => `Nhân đôi ${translatePassivePhrase(stat)} của ${translatePassivePhrase(subject)}`],
  [/^Skills gain 1 Glory every 2 seconds for each Rare or Unique monster in your Presence$/i, () => "Skill nhận 1 Glory mỗi 2 giây cho mỗi monster Rare hoặc Unique trong Presence của bạn"],
  [/^Skills Supported by Unleash have (.+?) increased Seal gain frequency$/i, ([, amount]) => `Skill được Support bởi Unleash được tăng ${amount} tần suất nhận Seal`],
  [/^Attack Skills deal (.+?) increased Damage while holding a Shield$/i, ([, amount]) => `Attack Skill được tăng ${amount} Damage khi đang cầm Shield`],
  [/^Your Curses have (.+?) increased Magnitudes if (.+?) of Curse Duration expired$/i, ([, amount, expired]) => `Curse của bạn được tăng ${amount} Magnitude nếu ${expired} thời lượng Curse đã hết`],
  [/^\+(.+?) to Maximum (Fire|Cold|Lightning) Resistance if you have at least (.+?) (Red|Blue|Green) Support Gems Socketed$/i, ([, amount, type, count, color]) => `+${amount} Maximum ${type} Resistance nếu bạn có ít nhất ${count} ${color} Support Gem đã Socket`],
  [/^\+(.+?) to all Maximum Elemental Resistances if you have at$/i, ([, amount]) => `+${amount} toàn bộ Maximum Elemental Resistance nếu đáp ứng điều kiện Support Gem`],
  [/^Enemies you kill with Empowered Attacks have a (.+?) chance to Explode, dealing a tenth of their maximum Life as Fire Damage$/i, ([, chance]) => `Kẻ địch bạn hạ bằng Empowered Attack có ${chance} chance Explode, gây Fire Damage bằng một phần mười Life tối đa của chúng`],
  [/^Burning Enemies you kill have a (.+?) chance to Explode, dealing a$/i, ([, chance]) => `Kẻ địch đang Burning bị bạn hạ có ${chance} chance Explode, gây`],
  [/^Regenerate (.+?) of maximum Life per second if you have been Hit Recently$/i, ([, amount]) => `Hồi ${amount} Life tối đa mỗi giây nếu bạn bị đánh trúng gần đây`],
  [/^Invocated Spells have (.+?) chance to consume half as much Energy$/i, ([, chance]) => `Invocated Spell có ${chance} chance chỉ Consume một nửa Energy`],
  [/^Companions in your Presence have Onslaught while you are Shapeshifted$/i, () => "Companion trong Presence của bạn có Onslaught khi bạn đang biến hình"],
  [/^Area Skills have (.+?) chance to Knock Enemies Back on Hit$/i, ([, chance]) => `Area Skill có ${chance} chance Knock Back kẻ địch khi Hit`],
  [/^Bolts fired by Crossbow Attacks have (.+?) chance to not$/i, ([, chance]) => `Bolt bắn từ Crossbow Attack có ${chance} chance không bị tiêu hao theo mô tả`],
  [/^Strike Skills you use yourself with Maces have (.+?) chance to deal Splash Damage$/i, ([, chance]) => `Strike Skill bạn tự dùng bằng Mace có ${chance} chance gây Splash Damage`],
  [/^Skills which create Fissures have a (.+?) chance to create an additional Fissure$/i, ([, chance]) => `Skill tạo Fissure có ${chance} chance tạo thêm một Fissure`],
  [/^Shocking Hits have a (.+?) chance to also Shock enemies in a (.+?) metre radius$/i, ([, chance, radius]) => `Shocking Hit có ${chance} chance Shock thêm kẻ địch trong bán kính ${radius} mét`],
  [/^You cannot be Light Stunned if you've been Stunned Recently$/i, () => "Bạn không thể bị Light Stunned nếu gần đây đã bị Stunned"],
  [/^Enemies you apply Incision to take (.+?) increased Physical Damage per Incision$/i, ([, amount]) => `Kẻ địch bị bạn áp Incision chịu thêm ${amount} Physical Damage mỗi Incision`],
  [/^Strikes deal Splash Damage$/i, () => "Strike gây Splash Damage"],
  [/^Offerings cannot be damaged if they have been created Recently$/i, () => "Offering không thể bị Damage nếu vừa được tạo gần đây"],
  [/^Enemies you Curse have (.+?) to Chaos Resistance$/i, ([, amount]) => `Kẻ địch bạn Curse có ${amount} Chaos Resistance`],
  [/^Allies in your Presence Regenerate (.+?) Rage per second if you have gained Rage Recently$/i, ([, amount]) => `Allies trong Presence của bạn hồi ${amount} Rage mỗi giây nếu gần đây bạn đã nhận Rage`],
  [/^Enemies you Curse are Hindered, with (.+?) reduced Movement Speed$/i, ([, amount]) => `Kẻ địch bạn Curse bị Hindered, giảm ${amount} Movement Speed`],
  [/^(.+?) increased Critical Hit Chance against Enemies that have entered your Presence Recently$/i, ([, amount]) => `Tăng ${amount} Critical Hit Chance lên kẻ địch gần đây đã vào Presence của bạn`],
  [/^Projectiles have (.+?) increased (.+?) against Enemies within (.+)$/i, ([, amount, stat, distance]) => `Projectile được tăng ${amount} ${translatePassivePhrase(stat)} lên kẻ địch trong phạm vi ${distance}`],
  [/^Projectiles deal (.+?) increased Damage with Hits against Enemies within (.+)$/i, ([, amount, distance]) => `Projectile gây Damage bằng Hit tăng ${amount} lên kẻ địch trong phạm vi ${distance}`],
  [/^Projectiles have (.+?) increased Critical Hit Chance against Enemies further than (.+)$/i, ([, amount, distance]) => `Projectile được tăng ${amount} Critical Hit Chance lên kẻ địch cách xa hơn ${distance}`],
  [/^Projectiles deal (.+?) increased Damage with Hits against Enemies further than (.+)$/i, ([, amount, distance]) => `Projectile gây Damage bằng Hit tăng ${amount} lên kẻ địch cách xa hơn ${distance}`],
  [/^Projectiles deal (.+?) increased Damage against (.+)$/i, ([, amount, target]) => `Projectile được tăng ${amount} Damage lên ${translateEnemyTarget(target)}`],
  [/^Minions deal (.+?) increased Damage if you've (.+?) Recently$/i, ([, amount, action]) => `Minion được tăng ${amount} Damage nếu gần đây bạn đã ${translateRecentAction(action)}`],
  [/^Minions have (.+?) reduced (.+?)$/i, ([, amount, stat]) => `Minion bị giảm ${amount} ${translatePassivePhrase(stat)}`],
  [/^Minions deal (.+?) increased Damage with Command Skills$/i, ([, amount]) => `Minion được tăng ${amount} Damage bằng Command Skill`],
  [/^Minions deal (.+?) increased Damage$/i, ([, amount]) => `Minion được tăng ${amount} Damage`],
  [/^(.+?) deal (.+?) increased (.+?)$/i, ([, subject, amount, stat]) => translateSubjectIncrease(subject, amount, stat)],
  [/^(.+?) deals (.+?) increased (.+?)$/i, ([, subject, amount, stat]) => translateSubjectIncrease(subject, amount, stat)],
  [/^Spells consume a Power Charge if able to deal (.+?) more Damage$/i, ([, amount]) => `Spell Consume Power Charge nếu có thể để gây ${amount} more Damage`],
  [/^(.+?) deal (.+?) more (.+?)$/i, ([, subject, amount, stat]) => `${translatePassivePhrase(subject)} gây ${amount} more ${translatePassivePhrase(stat)}`],
  [/^(.+?) deals (.+?) more (.+?)$/i, ([, subject, amount, stat]) => `${translatePassivePhrase(subject)} gây ${amount} more ${translatePassivePhrase(stat)}`],
  [/^(.+?) Cast by (.+?) have (.+?) increased (.+?)$/i, ([, subject, owner, amount, stat]) => `${translatePassivePhrase(subject)} do ${translatePassivePhrase(owner)} Cast được tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) Skills have (.+?) increased (.+?)$/i, ([, subject, amount, stat]) => translateSubjectIncrease(`${subject} Skills`, amount, stat)],
  [/^(.+?) have (.+?) increased (.+?)$/i, ([, subject, amount, stat]) => translateSubjectIncrease(subject, amount, stat)],
  [/^(.+?) have (.+?) reduced (.+?)$/i, ([, subject, amount, stat]) => translateSubjectReduction(subject, amount, stat)],
  [/^(.+?) have (.+?) less (.+?)$/i, ([, subject, amount, stat]) => translateSubjectLess(subject, amount, stat)],
  [/^(.+?) used by (.+?) have (.+?) increased (.+?)$/i, ([, subject, owner, amount, stat]) => `${translatePassivePhrase(subject)} do ${translatePassivePhrase(owner)} dùng được tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) used by (.+?) have (.+?) more (.+?)$/i, ([, subject, owner, amount, stat]) => `${translatePassivePhrase(subject)} được ${translatePassivePhrase(owner)} dùng có ${amount} more ${translatePassivePhrase(stat)}`],
  [/^(.+?) Cast by (.+?) have (.+?) increased (.+?)$/i, ([, subject, owner, amount, stat]) => `${translatePassivePhrase(subject)} do ${translatePassivePhrase(owner)} Cast được tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^Damage Penetrates (.+?) of Enemy (.+?) while Shapeshifted$/i, ([, amount, target]) => `Damage xuyên ${amount} ${translatePassivePhrase(`Enemy ${target}`)} khi đang biến hình`],
  [/^(Attack Damage|Damage) Penetrates (.+?) of Enemy (.+?)$/i, ([, subject, amount, target]) => `${translatePassivePhrase(subject)} xuyên ${amount} ${translatePassivePhrase(target)} của kẻ địch`],
  [/^Gain (.+?) of Damage as Extra (Physical|Fire|Cold|Lightning|Chaos) Damage$/i, ([, amount, type]) => `Nhận ${amount} Damage dưới dạng Extra ${type} Damage`],
  [/^Gain additional (.+?) equal to (.+?) of maximum (.+)$/i, ([, stat, amount, resource]) => `Nhận thêm ${translatePassivePhrase(stat)} bằng ${amount} ${translatePassivePhrase(resource)} tối đa`],
  [/^Gain additional (.+?) equal to (.+?) of (?:the )?(.+?) on Equipped (.+)$/i, ([, stat, amount, source, slot]) => `Nhận thêm ${translatePassivePhrase(stat)} bằng ${amount} ${translatePassivePhrase(source)} trên ${translatePassivePhrase(slot).replace(/\bArmour Items\b/i, "Armour Item")} đang trang bị`],
  [/^Gain additional (.+?) equal to (.+)$/i, ([, stat, basis]) => `Nhận thêm ${translatePassivePhrase(stat)} bằng ${translatePassivePhrase(basis)}`],
  [/^Gain (.+?) of maximum (.+?) as additional (.+)$/i, ([, amount, resource, stat]) => `Nhận thêm ${translatePassivePhrase(stat)} bằng ${amount} ${translatePassivePhrase(resource)} tối đa`],
  [/^Gain (.+?) Rating equal to (.+?) of (.+?) Rating$/i, ([, gained, amount, source]) => `Nhận ${gained} Rating bằng ${amount} ${source} Rating`],
  [/^Regenerate (.+?) of (?:your )?maximum (Life|Mana|Energy Shield|Spirit|Rage) per second$/i, ([, amount, resource]) => `Hồi ${amount} ${resource} tối đa mỗi giây`],
  [/^Allies in your Presence Regenerate (.+?) of your Maximum Life per second$/i, ([, amount]) => `Allies trong Presence của bạn hồi ${amount} Life tối đa của bạn mỗi giây`],
  [/^Enemies in your Presence are Slowed by (.+)$/i, ([, amount]) => `Kẻ địch trong Presence của bạn bị Slowed ${amount}`],
  [/^Totems you place grant (.+?) Auras$/i, ([, aura]) => `Totem bạn đặt cấp ${translatePassivePhrase(aura)} Aura`],
  [/^(.+?) grants (.+)$/i, ([, subject, value]) => translateGrantClause(subject, value)],
  [/^Hits ignore non-negative (.+?) of (.+)$/i, ([, stat, target]) => `Hit bỏ qua ${translatePassivePhrase(stat)} không âm của ${translateEnemyTarget(target)}`],
  [/^When you Consume a Charge, Trigger (.+?) to gain (.+)$/i, ([, trigger, value]) => `Khi bạn Consume Charge, Trigger ${trigger} để nhận ${translatePassivePhrase(value)}`],
  [/^You have no (.+)$/i, ([, value]) => `Bạn không có ${translatePassivePhrase(value)}`],
  [/^You have (.+)$/i, ([, value]) => `Bạn có ${translatePassivePhrase(value)}`],
  [/^Your (.+?) are (.+)$/i, ([, subject, value]) => `${translatePassivePhrase(subject)} của bạn là ${translatePassivePhrase(value)}`],
  [/^Your (.+?) cannot change while you have (.+)$/i, ([, subject, condition]) => `${translatePassivePhrase(subject)} của bạn không thể thay đổi khi bạn có ${translatePassivePhrase(condition)}`],
  [/^(.+?) have a duration of (.+)$/i, ([, subject, duration]) => `${translatePassivePhrase(subject)} có thời lượng ${duration}`],
  [/^(.+?) have \+(.+?) to (.+)$/i, ([, subject, amount, stat]) => `${translatePassivePhrase(subject)} có +${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) have \+(.+?) (.+)$/i, ([, subject, amount, stat]) => `${translatePassivePhrase(subject)} có +${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) have (.+?) chance to not consume a Cooldown when used$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance không Consume Cooldown khi dùng`],
  [/^(.+?) have a? ?(.+?) chance to not consume (.+)$/i, ([, subject, chance, resource]) => `${translatePassivePhrase(subject)} có ${chance} chance không Consume ${translatePassivePhrase(resource)}`],
  [/^(.+?) have (.+?) chance to not remove Elemental Infusions but still count as consuming them$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance không xóa Elemental Infusion nhưng vẫn tính là đã Consume`],
  [/^(.+?) have (.+?) chance to not remove Charges but still count as consuming them$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance không xóa Charge nhưng vẫn tính là đã Consume`],
  [/^(.+?) have (.+?) chance to inflict (.+?) on Hit$/i, ([, subject, chance, effect]) => `${translatePassivePhrase(subject)} có ${chance} chance gây ${translatePassivePhrase(effect)} khi Hit`],
  [/^(.+?) have (.+?) chance to Chain an additional time from terrain$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance Chain thêm một lần từ terrain`],
  [/^(.+?) have (.+?) chance for an additional Projectile when Forking$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance bắn thêm Projectile khi Forking`],
  [/^(.+?) have a? ?(.+?) chance to fire two additional Projectiles while moving$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance bắn thêm 2 Projectile khi di chuyển`],
  [/^(.+?) have (.+?) additional Physical Damage Reduction$/i, ([, subject, amount]) => `${translatePassivePhrase(subject)} có thêm ${amount} Physical Damage Reduction`],
  [/^(.+?) have (Culling Strike|Onslaught)$/i, ([, subject, value]) => `${translatePassivePhrase(subject)} có ${value}`],
  [/^(.+?) have a minimum of (.+)$/i, ([, subject, value]) => `${translatePassivePhrase(subject)} có tối thiểu ${translatePassivePhrase(value)}`],
  [/^(.+?) have (.+?) chance to treat Enemy Monster Elemental Resistance values as inverted$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance xem Elemental Resistance của monster kẻ địch như giá trị đảo ngược`],
  [/^(.+?) have (.+?) chance to rearm after they are triggered$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance tự rearm sau khi được Trigger`],
  [/^(.+?) have (.+?) chance to activate a second time$/i, ([, subject, chance]) => `${translatePassivePhrase(subject)} có ${chance} chance kích hoạt lần thứ hai`],
  [/^Bolts fired by Crossbow Attacks have (.+?) chance to not$/i, ([, chance]) => `Bolt bắn từ Crossbow Attack có ${chance} chance không`],
  [/^expend Ammunition if you've Reloaded Recently$/i, () => "tiêu hao Ammunition nếu gần đây bạn đã Reload"],
  [/^Projectiles have (.+?) chance to Fork if you've dealt a Melee Hit in the past eight seconds$/i, ([, chance]) => `Projectile có ${chance} chance Fork nếu bạn đã gây Melee Hit trong 8 giây trước`],
  [/^(.+?) increased (.+?) for each different (.+?) you've (used|Cast) Recently$/i, ([, amount, stat, source, action]) => `Tăng ${amount} ${translatePassivePhrase(stat)} cho mỗi ${translatePassivePhrase(source)} khác nhau bạn đã ${action.toLowerCase() === "used" ? "dùng" : "Cast"} gần đây`],
  [/^(.+?) increased (.+?) for each different (.+?) you've used in the past (.+?)$/i, ([, amount, stat, source, window]) => `Tăng ${amount} ${translatePassivePhrase(stat)} cho mỗi ${translatePassivePhrase(source)} khác nhau bạn đã dùng trong ${translatePastWindow(window)} trước`],
  [/^(.+?) increased (.+?) if you've dealt (.+?) in the past (.+?)$/i, ([, amount, stat, action, window]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu bạn đã ${translateRecentAction(`dealt ${action}`)} trong ${translatePastWindow(window)} trước`],
  [/^\+(.+?) to (.+?) if you've dealt (.+?) in the past (.+?)$/i, ([, amount, stat, action, window]) => `+${amount} ${translatePassivePhrase(stat)} nếu bạn đã ${translateRecentAction(`dealt ${action}`)} trong ${translatePastWindow(window)} trước`],
  [/^(.+?) increased (.+?) if you've successfully Parried Recently$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn Parry thành công`],
  [/^(.+?) faster start of Energy Shield Recharge if you've been Stunned Recently$/i, ([, amount]) => `Energy Shield Recharge bắt đầu nhanh hơn ${amount} nếu gần đây bạn đã bị Stunned`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per Second if you've used a Life Flask in the past (.+?)$/i, ([, amount, resource, window]) => `Hồi ${amount} ${resource} tối đa mỗi giây nếu bạn đã dùng Life Flask trong ${translatePastWindow(window)} trước`],
  [/^(.+?) (increased|reduced) (.+?) if you have been Hit Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu bạn bị đánh trúng gần đây`],
  [/^(.+?) (increased|reduced) (.+?) if you've been Hit Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu bạn bị đánh trúng gần đây`],
  [/^(.+?) (increased|reduced) (.+?) if you haven't been Stunned Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu gần đây bạn chưa bị Stunned`],
  [/^(.+?) (increased|reduced) (.+?) if you have not been Hit Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu bạn chưa bị đánh trúng gần đây`],
  [/^(.+?) (increased|reduced) (.+?) if you haven't been Hit Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu bạn chưa bị đánh trúng gần đây`],
  [/^(.+?) (increased|reduced) (.+?) if you haven't dealt (.+?) Recently$/i, ([, amount, scale, stat, action]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu gần đây bạn chưa ${translateRecentAction(`dealt a ${action}`)}`],
  [/^(.+?) (increased|reduced) (.+?) if you have not Attacked Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu gần đây bạn chưa tấn công`],
  [/^(.+?) (increased|reduced) (.+?) if you haven't Attacked Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu gần đây bạn chưa tấn công`],
  [/^(.+?) (increased|reduced) (.+?) if (?:you've|you have) killed Recently$/i, ([, amount, scale, stat]) => `${translateScale(scale, amount)} ${translatePassivePhrase(stat)} nếu gần đây bạn đã giết kẻ địch`],
  [/^(.+?) increased Armour while Bleeding$/i, ([, amount]) => `Tăng ${amount} Armour khi đang bị ${translatePassivePhrase("Bleeding")}`],
  [/^(.+?) chance to Knock Back Bleeding Enemies with Hits$/i, ([, chance]) => `${chance} cơ hội Knock Back kẻ địch đang bị ${translatePassivePhrase("Bleeding")} bằng Hit`],
  [/^(.+?) increased (.+?) if you've (.+?) Recently$/i, ([, amount, stat, condition]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã ${translateRecentAction(condition)}`],
  [/^(.+?) increased (.+?) if you have (.+?) Recently$/i, ([, amount, stat, condition]) => `Tăng ${amount} ${translatePassivePhrase(stat)} nếu gần đây bạn đã ${translateRecentAction(condition)}`],
  [/^(.+?) increased (.+?) while you have (.+)$/i, ([, amount, stat, condition]) => `Tăng ${amount} ${translatePassivePhrase(stat)} khi bạn có ${translatePassivePhrase(condition)}`],
  [/^(.+?) increased (Reservation Efficiency|Mana Cost Efficiency|Cost Efficiency|Life Cost|Mana Cost) of (.+)$/i, ([, amount, stat, source]) => `Tăng ${amount} ${translatePassivePhrase(stat)} của ${translatePassivePhrase(source)}`],
  [/^(.+?) reduced (.+?) from using Skills while moving$/i, ([, amount, stat]) => `Giảm ${amount} ${translatePassivePhrase(stat)} khi dùng Skill trong lúc di chuyển`],
  [/^(.+?) less (.+?) from using Skills while Moving$/i, ([, amount, stat]) => `${amount} less ${translatePassivePhrase(stat)} khi dùng Skill trong lúc di chuyển`],
  [/^Regenerate (.+?) of maximum (Life|Mana|Energy Shield|Spirit|Rage) per second while you have (.+)$/i, ([, amount, resource, condition]) => `Hồi ${amount} ${resource} tối đa mỗi giây khi bạn có ${translatePassivePhrase(condition)}`],
  [/^(.+?) can be allocated without being connected to your tree$/i, ([, subject]) => `${translatePassivePhrase(subject)} có thể allocated mà không cần nối với tree của bạn`],
  [/^(.+?) in Medium Radius of allocated Keystone Passive Skills can be allocated without being connected to your tree$/i, ([, subject]) => `${translatePassivePhrase(subject)} trong Medium Radius quanh Keystone Passive Skill đã allocated có thể allocated mà không cần nối với tree của bạn`],
  [/^(.+?) chance when you gain a (.+?) Charge to gain an additional (.+?) Charge$/i, ([, chance, charge, extra]) => `${chance} khi bạn nhận ${charge} Charge sẽ nhận thêm ${extra} Charge`],
  [/^(.+?) increased Effect of (.+?) on you per ten percent missing Mana$/i, ([, amount, effect]) => `Tăng ${amount} Effect của ${effect} lên bạn mỗi 10% Mana đang thiếu`],
  [/^(.+?) increased Magnitude of (.+?) Buffs you grant per (.+)$/i, ([, amount, buff, per]) => `Tăng ${amount} Magnitude của ${buff} Buff bạn cấp mỗi ${translatePassivePhrase(per)}`],
  [/^(.+?) faster start of Energy Shield Recharge$/i, ([, amount]) => `Energy Shield Recharge bắt đầu nhanh hơn ${amount}`],
  [/^(.+?) increased maximum (Life|Mana|Energy Shield)$/i, ([, amount, target]) => `Tăng ${amount} ${target} tối đa`],
  [/^(.+?) increased Armour Break Duration$/i, ([, amount]) => `Tăng ${amount} Duration của Armour Break`],
  [/^Overgrown Plant Skills Break (.+?) increased Armour$/i, ([, amount]) => `Overgrown Plant Skill Break Armour nhiều hơn ${amount}`],
  [/^Break (.+?) increased Armour$/i, ([, amount]) => `Break Armour nhiều hơn ${amount}`],
  [/^(.+?) chance to inflict Bleeding on Hit$/i, ([, amount]) => `${amount} chance gây Bleeding khi Hit`],
  [/^(.+?) chance for (.+?) Skills to fire (.+?) additional Projectiles$/i, ([, chance, skillType, count]) => `${chance} chance để ${skillType} Skill bắn thêm ${count} Projectile`],
  [/^(.+?) is based on your combined (.+?)$/i, ([, subject, target]) => `${translatePassivePhrase(subject)} dựa trên tổng ${translatePassivePhrase(target)} của bạn`],
  [/^(.+?) of (.+?) Mana Costs? Converted to Life Costs?$/i, ([, amount, source]) => `Chuyển ${amount} Mana Cost của ${translatePassivePhrase(source)} thành Life Cost`],
  [/^(.+?) of (.+?) Costs? Converted to (.+?) Costs?$/i, ([, amount, source, target]) => `Chuyển ${amount} Cost của ${translatePassivePhrase(source)} thành ${translatePassivePhrase(target)} Cost`],
  [/^\+(.+?) of (.+?) also applies to (.+)$/i, ([, amount, source, target]) => `+${amount} ${translatePassivePhrase(source)} cũng áp dụng lên ${translatePassivePhrase(target)}`],
  [/^\+(.+?) to (.+?) for every (.+?) (.+?) on Equipped (.+)$/i, ([, amount, stat, perAmount, perStat, slot]) => `+${amount} ${translatePassivePhrase(stat)} mỗi ${perAmount} ${translatePassivePhrase(perStat)} trên ${translatePassivePhrase(slot)} đang trang bị`],
  [/^\+(.+?) to (.+?) per (.+?) (.+?) on Equipped (.+)$/i, ([, amount, stat, perAmount, perStat, slot]) => `+${amount} ${translatePassivePhrase(stat)} mỗi ${perAmount} ${translatePassivePhrase(perStat)} trên ${translatePassivePhrase(slot)} đang trang bị`],
  [/^(.+?) increased (.+?) per (.+?) (.+?) on Equipped (.+)$/i, ([, amount, stat, perAmount, perStat, slot]) => `Tăng ${amount} ${translatePassivePhrase(stat)} mỗi ${perAmount} ${translatePassivePhrase(perStat)} trên ${translatePassivePhrase(slot)} đang trang bị`],
  [/^(.+?) more (.+?) from Equipped (.+)$/i, ([, amount, stat, slot]) => `${amount} more ${translatePassivePhrase(stat)} từ ${translatePassivePhrase(slot)} đang trang bị`],
  [/^Gain additional (.+?) equal to (.+?) of (?:the )?(.+?) on Equipped (.+)$/i, ([, stat, amount, source, slot]) => `Nhận thêm ${translatePassivePhrase(stat)} bằng ${amount} ${translatePassivePhrase(source)} trên ${translatePassivePhrase(slot)} đang trang bị`],
  [/^\+(.+?) to any Attribute$/i, ([, amount]) => `+${amount} bất kỳ Attribute nào`],
  [/^\+(.+?) to all Attributes$/i, ([, amount]) => `+${amount} toàn bộ Attribute`],
  [/^\+(.+?) to Armour for each Connected Notable Passive Skill Allocated$/i, ([, amount]) => `+${amount} Armour cho mỗi Connected Notable Passive Skill đã allocated`],
  [/^\+(.+?) to ((?:Strength|Dexterity|Intelligence|All Attributes)(?:(?: and | or )(?:Strength|Dexterity|Intelligence|All Attributes))*)$/i, ([, amount, attrs]) => `+${amount} ${translatePassivePhrase(attrs)}`],
  [/^\+(.+?) to (Strength|Dexterity|Intelligence|All Attributes)$/i, ([, amount, attr]) => `+${amount} ${translatePassivePhrase(attr)}`],
  [/^\+(.+?) to (.+)$/i, ([, amount, stat]) => `+${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) has (.+?) increased (.+?)$/i, ([, subject, amount, stat]) => translateSubjectIncrease(subject, amount, stat)],
  [/^(.+?) (faster|slower) (.+)$/i, ([, amount, speed, stat]) => `${translatePassivePhrase(stat)} ${speed.toLowerCase() === "faster" ? "nhanh hơn" : "chậm hơn"} ${amount}`],
  [/^(.+?) increased (.+?)$/i, ([, amount, stat]) => `Tăng ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) reduced (.+?)$/i, ([, amount, stat]) => `Giảm ${amount} ${translatePassivePhrase(stat)}`],
  [/^(.+?) less (.+?)$/i, ([, amount, stat]) => `${amount} less ${translatePassivePhrase(stat)}`],
  [/^(.+?) more (.+?)$/i, ([, amount, stat]) => `${amount} more ${translatePassivePhrase(stat)}`]
];

export const translatePassiveStatLine = (line = "") => {
  const clean = normalizeText(line);
  if (!clean) return "";
  for (const [pattern, render] of passiveStatPatterns) {
    const match = clean.match(pattern);
    if (match) return cleanPassiveTranslation(render(match));
  }
  return translatePassivePhrase(clean);
};

function translateGrantedValue(value = "") {
  const clean = normalizeText(value);
  if (!clean) return "";
  const translated = translatePassiveStatLine(clean);
  return (translated || translatePassivePhrase(clean))
    .replace(/^Tăng\b/, "tăng")
    .replace(/^Giảm\b/, "giảm")
    .replace(/^Nhận\b/, "nhận")
    .replace(/^Cấp\b/, "cấp")
    .replace(/^Đòn\b/, "đòn");
}
