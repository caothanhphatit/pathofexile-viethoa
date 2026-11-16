import type { PassiveTreeModel } from "./tree";

export function allStartNodeIds(tree: Pick<PassiveTreeModel, "nodes">): Set<string> {
  return new Set(tree.nodes.filter((node) => node.isClassStart || node.isAscendancyStart).map((node) => node.id));
}

export function selectedStartNodeIds(tree: Pick<PassiveTreeModel, "nodes">, className = "", ascendancyName = ""): Set<string> {
  const starts = new Set<string>();
  for (const node of tree.nodes) {
    if (node.isClassStart && (!className || !node.classNames.length || node.classNames.includes(className))) starts.add(node.id);
    if (ascendancyName && node.isAscendancyStart && node.ascendancyName === ascendancyName) starts.add(node.id);
  }
  return starts;
}

export function syncSelectedStartNodeIds(current: Iterable<string>, selectedStarts: Iterable<string>, allStarts: Iterable<string>): Set<string> {
  const selected = new Set([...selectedStarts].map(String));
  const startIds = new Set([...allStarts].map(String));
  const next = new Set([...current].map(String).filter((id) => !startIds.has(id) || selected.has(id)));
  for (const id of selected) next.add(id);
  return next;
}

export function buildPassiveGraph(tree: Pick<PassiveTreeModel, "edges" | "nodeById">): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const row = graph.get(from) ?? [];
    row.push(to);
    graph.set(from, row);
  };

  for (const edge of tree.edges) {
    const from = tree.nodeById.get(String(edge.from));
    const to = tree.nodeById.get(String(edge.to));
    if (!from || !to) continue;
    if (from.ascendancyName !== to.ascendancyName) continue;
    add(from.id, to.id);
    add(to.id, from.id);
  }
  // The exported tree leaves out the class start's own edges. In PoB each start links
  // to the two main-tree nodes right next to it (~250 units away; the next ones sit
  // 480+ away), so a start without edges gets those back. Without them a fresh tree
  // has no way out of the start and a refund drops every node.
  const nodes = [...tree.nodeById.values()];
  for (const start of nodes) {
    if (!start.isClassStart || graph.has(start.id) || !Number.isFinite(start.x) || !Number.isFinite(start.y)) continue;
    for (const node of nodes) {
      if (node === start || node.isClassStart || node.ascendancyName) continue;
      if (Math.hypot(node.x - start.x, node.y - start.y) > CLASS_START_LINK_RADIUS) continue;
      add(start.id, node.id);
      add(node.id, start.id);
    }
  }
  return graph;
}

const CLASS_START_LINK_RADIUS = 320;

export function computePathToNode({
  targetId,
  allocatedIds = [],
  startNodeIds = [],
  graphByNodeId = new Map(),
  visibleNodeIds = []
}: {
  targetId: string;
  allocatedIds?: Iterable<string>;
  startNodeIds?: Iterable<string>;
  graphByNodeId?: Map<string, string[]>;
  visibleNodeIds?: Iterable<string>;
}): string[] {
  const target = String(targetId);
  const visible = new Set([...visibleNodeIds].map(String));
  if (!target || !visible.has(target)) return [];

  const anchors = [...new Set([...allocatedIds, ...startNodeIds].map(String))].filter((id) => visible.has(id));
  if (!anchors.length || anchors.includes(target)) return [target];

  const queue = [...anchors];
  const visited = new Set(queue);
  const previous = new Map<string, string>();
  let cursor = 0;
  while (cursor < queue.length) {
    const nodeId = queue[cursor];
    cursor += 1;
    for (const nextId of graphByNodeId.get(nodeId) ?? []) {
      if (!visible.has(nextId) || visited.has(nextId)) continue;
      visited.add(nextId);
      previous.set(nextId, nodeId);
      if (nextId === target) {
        cursor = queue.length;
        break;
      }
      queue.push(nextId);
    }
  }

  if (!visited.has(target)) return [target];
  const path = [target];
  let current = target;
  while (previous.has(current)) {
    const from = previous.get(current);
    if (!from) break;
    path.push(from);
    current = from;
  }
  return path.reverse();
}

export function allocatePathToNode({
  targetId,
  allocatedIds = [],
  startNodeIds = [],
  graphByNodeId = new Map(),
  visibleNodeIds = []
}: {
  targetId: string;
  allocatedIds?: Iterable<string>;
  startNodeIds?: Iterable<string>;
  graphByNodeId?: Map<string, string[]>;
  visibleNodeIds?: Iterable<string>;
}): Set<string> {
  const next = new Set([...allocatedIds].map(String));
  const path = computePathToNode({ targetId, allocatedIds: next, startNodeIds, graphByNodeId, visibleNodeIds });
  for (const id of path) next.add(id);
  return next;
}

export function refundAllocatedNodeIds({
  targetId,
  allocatedIds = [],
  startNodeIds = [],
  graphByNodeId = new Map(),
  visibleNodeIds = []
}: {
  targetId: string;
  allocatedIds?: Iterable<string>;
  startNodeIds?: Iterable<string>;
  graphByNodeId?: Map<string, string[]>;
  visibleNodeIds?: Iterable<string>;
}): Set<string> {
  const target = String(targetId);
  const allocated = new Set([...allocatedIds].map(String));
  const starts = new Set([...startNodeIds].map(String));
  if (!target || starts.has(target) || !allocated.has(target)) return allocated;

  const visible = new Set([...visibleNodeIds].map(String));
  const keep = new Set([...starts].filter((id) => allocated.has(id) && visible.has(id)));
  const queue = [...keep];
  let cursor = 0;
  while (cursor < queue.length) {
    const nodeId = queue[cursor];
    cursor += 1;
    for (const nextId of graphByNodeId.get(nodeId) ?? []) {
      if (nextId === target || keep.has(nextId) || !allocated.has(nextId) || !visible.has(nextId)) continue;
      keep.add(nextId);
      queue.push(nextId);
    }
  }
  return keep;
}

// ── Weapon-set passives (PoB's allocMode) ──────────────────────────────────
// PoE2 has a point pool per weapon set: a node can belong to the main tree
// (mode 0) or to weapon set 1 / 2. PoB's rules (PassiveSpec:AllocNode):
// - allocating in a set paths from main-tree nodes and that set's nodes only, and
//   the new nodes join that set; keystones, jewel sockets and ascendancy nodes stay
//   on the main tree and cannot be taken while a set is selected;
// - allocating on the main tree may run through a set's branch, which then
//   becomes main tree;
// - a set node only stays allocated while it connects to the start through
//   main-tree nodes and nodes of its own set.

export type AllocMode = 0 | 1 | 2;

interface ModeInput {
  targetId: string;
  allocatedIds?: Iterable<string>;
  startNodeIds?: Iterable<string>;
  graphByNodeId?: Map<string, string[]>;
  visibleNodeIds?: Iterable<string>;
  weaponSets?: Record<string, 1 | 2>;
}

export interface ModeAllocation {
  allocated: Set<string>;
  weaponSets: Record<string, 1 | 2>;
  /** Why nothing changed ("global": keystone/socket while a set is selected). */
  blocked?: "global";
}

const modeOf = (weaponSets: Record<string, 1 | 2>, id: string): AllocMode => weaponSets[id] ?? 0;

export function allocatePathInMode({
  targetId,
  allocatedIds = [],
  startNodeIds = [],
  graphByNodeId = new Map(),
  visibleNodeIds = [],
  weaponSets = {},
  mode = 0,
  isMainTreeOnly = () => false
}: ModeInput & { mode?: AllocMode; isMainTreeOnly?: (id: string) => boolean }): ModeAllocation {
  const target = String(targetId);
  const allocated = new Set([...allocatedIds].map(String));
  const sets = { ...weaponSets };
  const visible = new Set([...visibleNodeIds].map(String));
  if (!target || !visible.has(target) || allocated.has(target)) return { allocated, weaponSets: sets };
  if (mode > 0 && isMainTreeOnly(target)) return { allocated, weaponSets: sets, blocked: "global" };

  const usable = (id: string) => {
    const nodeMode = modeOf(sets, id);
    return nodeMode === 0 || nodeMode === mode;
  };
  const anchors = [...new Set([...allocated, ...[...startNodeIds].map(String)])]
    .filter((id) => visible.has(id) && (mode === 0 ? modeOf(sets, id) === 0 : usable(id)));
  // Main tree: may run through a set's allocated branch (it becomes main tree).
  const passable = (id: string) => !allocated.has(id) || (mode === 0 ? true : usable(id));

  const queue = [...anchors];
  const visited = new Set(queue);
  const previous = new Map<string, string>();
  for (let cursor = 0; cursor < queue.length && !visited.has(target); cursor += 1) {
    for (const nextId of graphByNodeId.get(queue[cursor]) ?? []) {
      if (!visible.has(nextId) || visited.has(nextId) || !passable(nextId)) continue;
      visited.add(nextId);
      previous.set(nextId, queue[cursor]);
      queue.push(nextId);
      if (nextId === target) break;
    }
  }
  // No way there from the nodes this mode may use (PoB does nothing either).
  if (anchors.length && !visited.has(target)) return { allocated, weaponSets: sets };
  const path = [target];
  if (anchors.length) {
    for (let current = target; previous.has(current);) {
      current = previous.get(current)!;
      path.push(current);
    }
  }
  if (mode > 0 && path.some((id) => !allocated.has(id) && isMainTreeOnly(id))) return { allocated, weaponSets: sets, blocked: "global" };
  for (const id of path) {
    if (allocated.has(id)) {
      if (mode === 0 && modeOf(sets, id) !== 0) delete sets[id];
      continue;
    }
    allocated.add(id);
    if (mode > 0 && !isMainTreeOnly(id)) sets[id] = mode as 1 | 2;
    else delete sets[id];
  }
  return { allocated, weaponSets: sets };
}

export function refundInMode({
  targetId,
  allocatedIds = [],
  startNodeIds = [],
  graphByNodeId = new Map(),
  visibleNodeIds = [],
  weaponSets = {}
}: ModeInput): ModeAllocation {
  const target = String(targetId);
  const allocated = new Set([...allocatedIds].map(String));
  const starts = new Set([...startNodeIds].map(String));
  if (!target || starts.has(target) || !allocated.has(target)) return { allocated, weaponSets: { ...weaponSets } };
  const visible = new Set([...visibleNodeIds].map(String));

  const grow = (seed: Iterable<string>, mode: AllocMode) => {
    const keep = new Set(seed);
    const queue = [...keep];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const nextId of graphByNodeId.get(queue[cursor]) ?? []) {
        if (nextId === target || keep.has(nextId) || !allocated.has(nextId) || !visible.has(nextId)) continue;
        if (modeOf(weaponSets, nextId) !== mode) continue;
        keep.add(nextId);
        queue.push(nextId);
      }
    }
    return keep;
  };
  const main = grow([...starts].filter((id) => allocated.has(id) && visible.has(id)), 0);
  const keep = new Set(main);
  for (const mode of [1, 2] as const) for (const id of grow(main, mode)) keep.add(id);
  const sets: Record<string, 1 | 2> = {};
  for (const [id, set] of Object.entries(weaponSets)) if (keep.has(id)) sets[id] = set;
  return { allocated: keep, weaponSets: sets };
}
