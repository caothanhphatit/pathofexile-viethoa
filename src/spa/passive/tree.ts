import type { Bounds } from "./camera";

export interface PassiveNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  stats: string[];
  classNames: string[];
  ascendancyName: string;
  iconPath: string;
  isClassStart: boolean;
  isAscendancyStart: boolean;
}

export interface PassiveEdge {
  from: string;
  to: string;
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
const normalizeTreeLocale = (value: unknown): "vi" | "en" => String(value || "").toLowerCase().slice(0, 2) === "en" ? "en" : "vi";

export function parsePassiveTree(raw: any, locale: "vi" | "en" = "vi"): PassiveTreeModel {
  const activeLocale = normalizeTreeLocale(locale);
  const sourceNodes = Array.isArray(raw?.nodes) ? raw.nodes : Object.values(raw?.nodes ?? {});
  const nodes: PassiveNode[] = (sourceNodes as any[]).map((node: any) => {
    const rawStats = Array.isArray(node.stats) ? node.stats.map(String) : [];
    const translatedStats = Array.isArray(node.stats_vi) && node.stats_vi.length ? node.stats_vi.map(String) : rawStats;
    return {
      id: String(node.id ?? node.skill ?? ""),
      name: String(node.name ?? ""),
      type: String(node.type ?? "small"),
      x: finite(node.x),
      y: finite(node.y),
      stats: activeLocale === "en" ? rawStats : translatedStats,
      classNames: Array.isArray(node.classes_start) ? node.classes_start : [],
      ascendancyName: String(node.ascendancy_name ?? node.ascendancyName ?? ""),
      iconPath: String(node.icon_path ?? ""),
      isClassStart: Boolean(node.is_class_start || (Array.isArray(node.classes_start) && node.classes_start.length)),
      isAscendancyStart: Boolean(node.is_ascendancy_start || node.isAscendancyStart)
    };
  }).filter((node) => node.id && Number.isFinite(node.x) && Number.isFinite(node.y));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceEdges = Array.isArray(raw?.path_edges) ? raw.path_edges : Array.isArray(raw?.edges) ? raw.edges : [];
  const edges: PassiveEdge[] = (sourceEdges as any[]).map((edge: any) => ({
    from: String(edge.from ?? edge.fromKey ?? ""),
    to: String(edge.to ?? edge.toKey ?? "")
  })).filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to));

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

  const classRows = Array.isArray(raw?.classes) ? raw.classes : [];
  const classMetas: PassiveClassMeta[] = classRows.map((row: any) => ({
    name: String(row.name ?? ""),
    background: row.background ?? null,
    ascendancies: (Array.isArray(row.ascendancies) ? row.ascendancies : []).map((asc: any) => ({
      name: String(asc.name ?? asc.id ?? ""),
      background: asc.background ?? null
    })).filter((asc: PassiveAscendancyRow) => asc.name)
  })).filter((row: PassiveClassMeta) => row.name);
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

  return { nodes, edges, nodeById, bounds, classes, ascendancies, classByName, ascendancyByName };
}

export function nodeRadius(node: PassiveNode): number {
  if (node.type.includes("keystone")) return 92;
  if (node.type.includes("notable")) return 72;
  if (node.type.includes("jewel")) return 62;
  if (node.type.includes("ascend")) return 54;
  return 38;
}

export function nodeMatchesFilters(node: PassiveNode, classFilter = "", ascendancyFilter = ""): boolean {
  if (ascendancyFilter) {
    if (node.ascendancyName && node.ascendancyName !== ascendancyFilter) return false;
  } else if (node.ascendancyName) {
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
  const sx = Number(source.x);
  const sy = Number(source.y);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return node;
  return {
    ...node,
    x: node.x + finite(target.x) - sx,
    y: node.y + finite(target.y) - sy
  };
}

export function projectNodeForView(tree: PassiveTreeModel, node: PassiveNode, classFilter = "", ascendancyFilter = ""): PassiveNode {
  const ascMeta = ascendancyFilter ? tree.ascendancyByName.get(ascendancyFilter) : undefined;
  const className = classFilter || ascMeta?.className || "";
  const classBackground = className ? tree.classByName.get(className)?.background : null;
  return projectAscendancyNode(projectClassStartNode(node, classBackground), ascMeta, ascendancyFilter);
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

export function hitTestNode(nodes: PassiveNode[], x: number, y: number, maxDistance = 80): PassiveNode | null {
  let best: PassiveNode | null = null;
  let bestD = maxDistance * maxDistance;
  for (const node of nodes) {
    const radius = Math.max(nodeRadius(node), maxDistance);
    const d = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (d <= radius * radius && d < bestD) {
      best = node;
      bestD = d;
    }
  }
  return best;
}
