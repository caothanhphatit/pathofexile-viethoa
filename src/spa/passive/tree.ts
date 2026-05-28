import type { Bounds } from "./camera";

export interface PassiveNode {
  id: string;
  name: string;
  type: string;
  groupId: string;
  orbit: number;
  orbitIndex: number;
  arc: number;
  x: number;
  y: number;
  stats: string[];
  classNames: string[];
  ascendancyName: string;
  iconPath: string;
  isClassStart: boolean;
  isAscendancyStart: boolean;
  viewProjection?: PassiveViewProjection;
}

export interface PassiveViewProjection {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  scale: number;
}

export interface PassiveEdge {
  from: string;
  to: string;
  orbit: number;
  orbitX?: number;
  orbitY?: number;
  arc?: PassiveEdgeArc;
}

export interface PassiveEdgeArc {
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  ccw: boolean;
}

export interface PassiveGroup {
  id: string;
  x: number;
  y: number;
}

export interface PassiveTreeModel {
  nodes: PassiveNode[];
  edges: PassiveEdge[];
  nodeById: Map<string, PassiveNode>;
  bounds: Bounds;
  classes: string[];
  ascendancies: string[];
  classByName: Map<string, PassiveClassMeta>;
  ascendancyByName: Map<string, PassiveAscendancyMeta>;
  groupById: Map<string, PassiveGroup>;
  scaleImage: number;
  orbitRadii: number[];
}

export interface PassiveClassMeta {
  name: string;
  background: any;
  ascendancies: PassiveAscendancyRow[];
}

export interface PassiveAscendancyRow {
  name: string;
  background: any;
}

export interface PassiveAscendancyMeta {
  className: string;
  classBackground: any;
  ascendancy: PassiveAscendancyRow;
}

const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const finiteOptional = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const normalizeTreeLocale = (value: unknown): "vi" | "en" => String(value || "").toLowerCase().slice(0, 2) === "en" ? "en" : "vi";
const hiddenPassiveClasses = new Set(["Marauder"]);
const isVisiblePassiveClass = (name: unknown) => !hiddenPassiveClasses.has(String(name ?? ""));

function canvasAngleFromPassiveAngle(angle: number): number {
  return angle - Math.PI / 2;
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function passiveEdgeArc(edge: PassiveEdge, from: PassiveNode | undefined, to: PassiveNode | undefined, groupById: Map<string, PassiveGroup>, orbitRadii: number[], scaleImage: number): PassiveEdgeArc | undefined {
  if (!from || !to) return undefined;
  const orbit = Number(edge.orbit || 0);
  const explicitCx = finiteOptional(edge.orbitX);
  const explicitCy = finiteOptional(edge.orbitY);
  if (orbit && explicitCx !== undefined && explicitCy !== undefined) {
    const r0 = Math.hypot(from.x - explicitCx, from.y - explicitCy);
    const r1 = Math.hypot(to.x - explicitCx, to.y - explicitCy);
    const radius = (r0 + r1) / 2;
    const drift = Math.abs(r0 - r1) / Math.max(radius, 1);
    if (radius > 1 && drift < 0.16) {
      const a0 = Math.atan2(from.y - explicitCy, from.x - explicitCx);
      const delta = shortestAngleDelta(a0, Math.atan2(to.y - explicitCy, to.x - explicitCx));
      if (Number.isFinite(delta) && Math.abs(delta) > 0.001) {
        return { cx: explicitCx, cy: explicitCy, r: radius, a0, a1: a0 + delta, ccw: delta < 0 };
      }
    }
  }
  const radius = Number(orbitRadii[Math.abs(orbit)] || 0) * scaleImage;
  if (orbit && Number.isFinite(radius) && radius > 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0 && distance < radius * 2.02) {
      const half = distance / 2;
      const height = Math.sqrt(Math.max(0, radius * radius - half * half));
      const ux = -dy / distance;
      const uy = dx / distance;
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const side = orbit < 0 ? 1 : -1;
      const cx = mx + ux * height * side;
      const cy = my + uy * height * side;
      const a0 = Math.atan2(from.y - cy, from.x - cx);
      const delta = shortestAngleDelta(a0, Math.atan2(to.y - cy, to.x - cx));
      if (Number.isFinite(delta) && Math.abs(delta) > 0.001) {
        return { cx, cy, r: radius, a0, a1: a0 + delta, ccw: delta < 0 };
      }
    }
  }

  if (!from.groupId || from.groupId !== to.groupId) return undefined;
  if (!from.orbit || from.orbit !== to.orbit) return undefined;
  const group = groupById.get(from.groupId);
  const groupRadius = Number(orbitRadii[from.orbit] || 0) * scaleImage;
  if (!group || !Number.isFinite(groupRadius) || groupRadius <= 0) return undefined;
  const a0 = canvasAngleFromPassiveAngle(from.arc);
  const delta = shortestAngleDelta(a0, canvasAngleFromPassiveAngle(to.arc));
  return Number.isFinite(delta) && Math.abs(delta) > 0.001
    ? { cx: group.x * scaleImage, cy: group.y * scaleImage, r: groupRadius, a0, a1: a0 + delta, ccw: delta < 0 }
    : undefined;
}

export function parsePassiveTree(raw: any, locale: "vi" | "en" = "vi"): PassiveTreeModel {
  const activeLocale = normalizeTreeLocale(locale);
  const scaleImage = finite(raw?.scale_image ?? raw?.constants?.scaleImage, 1) || 1;
  const orbitRadii = (Array.isArray(raw?.constants?.orbitRadii) ? raw.constants.orbitRadii : []).map((value: unknown) => finite(value));
  const groups: PassiveGroup[] = (Array.isArray(raw?.groups) ? raw.groups : []).map((group: any) => ({
    id: String(group.id ?? ""),
    x: finite(group.x),
    y: finite(group.y)
  })).filter((group: PassiveGroup) => group.id);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const sourceNodes = Array.isArray(raw?.nodes) ? raw.nodes : Object.values(raw?.nodes ?? {});
  const nodes: PassiveNode[] = (sourceNodes as any[]).map((node: any) => {
    const rawStats = Array.isArray(node.stats) ? node.stats.map(String) : [];
    const translatedStats = Array.isArray(node.stats_vi) && node.stats_vi.length ? node.stats_vi.map(String) : rawStats;
    const classNames = Array.isArray(node.classes_start) ? node.classes_start.map(String).filter(isVisiblePassiveClass) : [];
    const rawName = String(node.name ?? "");
    return {
      id: String(node.id ?? node.skill ?? ""),
      name: rawName.toLowerCase() === "marauder" && classNames.length === 1 ? classNames[0].toUpperCase() : rawName,
      type: String(node.type ?? "small"),
      groupId: String(node.group ?? node.group_id ?? ""),
      orbit: finite(node.orbit),
      orbitIndex: finite(node.orbit_index ?? node.orbitIndex),
      arc: finite(node.arc),
      x: finite(node.x),
      y: finite(node.y),
      stats: activeLocale === "en" ? rawStats : translatedStats,
      classNames,
      ascendancyName: String(node.ascendancy_name ?? node.ascendancyName ?? ""),
      iconPath: String(node.icon_path ?? ""),
      isClassStart: Boolean(classNames.length),
      isAscendancyStart: Boolean(node.is_ascendancy_start || node.isAscendancyStart)
    };
  }).filter((node) => node.id && Number.isFinite(node.x) && Number.isFinite(node.y));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceEdges = Array.isArray(raw?.path_edges) ? raw.path_edges : Array.isArray(raw?.edges) ? raw.edges : [];
  const edges: PassiveEdge[] = (sourceEdges as any[]).map((edge: any) => ({
    from: String(edge.from ?? edge.fromKey ?? ""),
    to: String(edge.to ?? edge.toKey ?? ""),
    orbit: finite(edge.orbit),
    orbitX: finiteOptional(edge.orbit_x ?? edge.orbitX),
    orbitY: finiteOptional(edge.orbit_y ?? edge.orbitY)
  })).filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to)).map((edge) => ({
    ...edge,
    arc: passiveEdgeArc(edge, nodeById.get(edge.from), nodeById.get(edge.to), groupById, orbitRadii, scaleImage)
  }));

  const computed = nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x),
    minY: Math.min(acc.minY, node.y),
    maxX: Math.max(acc.maxX, node.x),
    maxY: Math.max(acc.maxY, node.y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const bounds = raw?.bounds ? {
    minX: finite(raw.bounds.min_x ?? raw.bounds.minX, computed.minX),
    minY: finite(raw.bounds.min_y ?? raw.bounds.minY, computed.minY),
    maxX: finite(raw.bounds.max_x ?? raw.bounds.maxX, computed.maxX),
    maxY: finite(raw.bounds.max_y ?? raw.bounds.maxY, computed.maxY)
  } : computed;

  const classRows = Array.isArray(raw?.classes) ? raw.classes.filter((row: any) => isVisiblePassiveClass(row?.name)) : [];
  const classMetas: PassiveClassMeta[] = classRows.map((row: any) => ({
    name: String(row.name ?? ""),
    background: row.background ?? null,
    ascendancies: (Array.isArray(row.ascendancies) ? row.ascendancies : []).map((asc: any) => ({
      name: String(asc.name ?? asc.id ?? ""),
      background: asc.background ?? null
    })).filter((asc: PassiveAscendancyRow) => asc.name)
  })).filter((row: PassiveClassMeta) => row.name)
    .sort((a: PassiveClassMeta, b: PassiveClassMeta) => a.name === "Warrior" ? -1 : b.name === "Warrior" ? 1 : 0);
  const classByName = new Map(classMetas.map((row) => [row.name, row]));
  const ascendancyByName = new Map<string, PassiveAscendancyMeta>();
  for (const row of classMetas) {
    for (const ascendancy of row.ascendancies) {
      ascendancyByName.set(ascendancy.name, {
        className: row.name,
        classBackground: row.background,
        ascendancy
      });
    }
  }

  const classes = classMetas.map((row) => row.name);
  const ascendancies = [...ascendancyByName.keys()];

  return { nodes, edges, nodeById, bounds, classes, ascendancies, classByName, ascendancyByName, groupById, scaleImage, orbitRadii };
}

export function nodeRadius(node: PassiveNode): number {
  if (node.type.includes("keystone")) return 92;
  if (node.type.includes("notable")) return 72;
  if (node.type.includes("jewel")) return 62;
  if (node.type.includes("ascend")) return 54;
  return 38;
}

export function nodeMatchesFilters(node: PassiveNode, classFilter = "", ascendancyFilter = ""): boolean {
  const isAscendancyNode = node.type.toLowerCase().includes("ascend");
  if (ascendancyFilter) {
    if (isAscendancyNode || node.ascendancyName) return node.ascendancyName === ascendancyFilter;
  } else if (isAscendancyNode || node.ascendancyName) {
    return false;
  }
  if (classFilter && node.isClassStart && node.classNames.length && !node.classNames.includes(classFilter)) return false;
  return true;
}

export function filteredTreeNodes(tree: PassiveTreeModel, classFilter = "", ascendancyFilter = ""): PassiveNode[] {
  return tree.nodes.filter((node) => nodeMatchesFilters(node, classFilter, ascendancyFilter)).map((node) => projectNodeForView(tree, node, classFilter, ascendancyFilter));
}

const CLASS_DISC_RADIUS_SCALE = 0.91;
const CLASS_DISC_STROKE_RATIO = 0.82;
const ASCENDANCY_FRAME_GAP = 14;
const ascendancyProjectionCache = new WeakMap<PassiveTreeModel, Map<string, PassiveViewProjection>>();

function passiveTreeBackgroundRadius(background: any): number {
  const candidates = [
    background?.width,
    background?.height,
    background?.active?.width,
    background?.active?.height,
    background?.bg?.width,
    background?.bg?.height
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return Math.max(...candidates, 1200);
}

function classDiscStrokeRadius(background: any): number {
  return passiveTreeBackgroundRadius(background) * CLASS_DISC_RADIUS_SCALE * CLASS_DISC_STROKE_RATIO;
}

function projectClassStartNode(node: PassiveNode, classBackground: any): PassiveNode {
  if (!node.isClassStart || !classBackground) return node;
  const centerX = finite(classBackground.x);
  const centerY = finite(classBackground.y);
  const dx = node.x - centerX;
  const dy = node.y - centerY;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 0) return node;
  const radius = classDiscStrokeRadius(classBackground);
  return {
    ...node,
    x: centerX + (dx / distance) * radius,
    y: centerY + (dy / distance) * radius
  };
}

function projectAscendancyNode(node: PassiveNode, meta: PassiveAscendancyMeta | undefined, ascendancyFilter = ""): PassiveNode {
  if (!meta || !ascendancyFilter || node.ascendancyName !== ascendancyFilter) return node;
  const source = meta.ascendancy.background;
  const target = meta.classBackground;
  if (!source || !target) return node;
  const sx = finiteOptional(source.x);
  const sy = finiteOptional(source.y);
  if (sx === undefined || sy === undefined) return node;
  return {
    ...node,
    x: node.x + finite(target.x) - sx,
    y: node.y + finite(target.y) - sy
  };
}

function boundsCenter(nodes: PassiveNode[]): { x: number; y: number } | null {
  if (!nodes.length) return null;
  const bounds = nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x),
    minY: Math.min(acc.minY, node.y),
    maxX: Math.max(acc.maxX, node.x),
    maxY: Math.max(acc.maxY, node.y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

function classStartRingRadius(tree: PassiveTreeModel): number {
  const radii = tree.nodes
    .filter((node) => node.isClassStart && !node.ascendancyName)
    .map((node) => Math.hypot(node.x, node.y))
    .filter((radius) => Number.isFinite(radius) && radius > 0);
  return radii.length ? Math.min(...radii) : 1450;
}

function fallbackAscendancyProjection(tree: PassiveTreeModel, ascendancyFilter = ""): PassiveViewProjection | null {
  if (!ascendancyFilter) return null;
  let rows = ascendancyProjectionCache.get(tree);
  if (!rows) {
    rows = new Map();
    ascendancyProjectionCache.set(tree, rows);
  }
  const cached = rows.get(ascendancyFilter);
  if (cached) return cached;
  const ascendancyNodes = tree.nodes.filter((node) => node.ascendancyName === ascendancyFilter);
  const source = boundsCenter(ascendancyNodes);
  if (!source) return null;
  const targetVisualRadius = Math.max(classStartRingRadius(tree) - 24, 900);
  let scale = 1;
  for (const node of ascendancyNodes) {
    const distance = Math.hypot(node.x - source.x, node.y - source.y);
    if (!Number.isFinite(distance) || distance <= 0) continue;
    const pad = nodeRadius(node) + ASCENDANCY_FRAME_GAP;
    const allowed = Math.max(targetVisualRadius - pad, 1) / distance;
    if (Number.isFinite(allowed)) scale = Math.min(scale, allowed);
  }
  const projection = {
    sourceX: source.x,
    sourceY: source.y,
    targetX: 0,
    targetY: 0,
    scale: Math.max(Math.min(scale, 1), 0.72)
  };
  rows.set(ascendancyFilter, projection);
  return projection;
}

export function projectNodeForView(tree: PassiveTreeModel, node: PassiveNode, classFilter = "", ascendancyFilter = ""): PassiveNode {
  const ascMeta = ascendancyFilter ? tree.ascendancyByName.get(ascendancyFilter) : undefined;
  const className = classFilter || ascMeta?.className || "";
  const classBackground = className ? tree.classByName.get(className)?.background : null;
  const projected = projectAscendancyNode(projectClassStartNode(node, classBackground), ascMeta, ascendancyFilter);
  if (!ascendancyFilter || node.ascendancyName !== ascendancyFilter || projected !== node) return projected;
  const fallback = fallbackAscendancyProjection(tree, ascendancyFilter);
  return fallback ? {
    ...node,
    x: fallback.targetX + (node.x - fallback.sourceX) * fallback.scale,
    y: fallback.targetY + (node.y - fallback.sourceY) * fallback.scale,
    viewProjection: fallback
  } : node;
}

export function boundsForNodes(nodes: PassiveNode[], fallback: Bounds): Bounds {
  if (!nodes.length) return fallback;
  return nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x),
    minY: Math.min(acc.minY, node.y),
    maxX: Math.max(acc.maxX, node.x),
    maxY: Math.max(acc.maxY, node.y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

export function hitTestNode(nodes: PassiveNode[], x: number, y: number, padding = 0): PassiveNode | null {
  let best: PassiveNode | null = null;
  let bestD = Infinity;
  for (const node of nodes) {
    const radius = nodeRadius(node) + Math.max(padding, 0);
    const d = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (d <= radius * radius && d < bestD) {
      best = node;
      bestD = d;
    }
  }
  return best;
}
