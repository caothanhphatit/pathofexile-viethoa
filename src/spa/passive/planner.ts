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
  return graph;
}

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
