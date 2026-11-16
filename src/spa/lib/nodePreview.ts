// Passive node preview for the Build Planner tree: hovering a node shows what
// allocating it (or, for an allocated node, removing it) changes, as PoB's own tree
// tooltip does. The server prices a batch of nodes with one PoB run
// (POST /api/builds/node-deltas, ~5 s for the build load + a few ms per node), so the
// planner asks for the nodes next to the allocated ones in batches, notables and
// keystones first, and keeps the answers per build: any change to the build (tree,
// items, gems, config) has a new key and starts empty, while going back to an
// earlier build finds its answers again.

import type { PassiveTreeModel } from "../passive/tree";
import { hashString } from "./calcQueue";

export type NodeDeltaStats = Partial<Record<NodeDeltaStat, number>>;

export const NODE_DELTA_STATS = [
  "CombinedDPS", "Life", "EnergyShield", "Mana", "Spirit", "Armour", "Evasion",
  "FireResist", "ColdResist", "LightningResist", "ChaosResist", "TotalEHP", "Str", "Dex", "Int"
] as const;
export type NodeDeltaStat = typeof NODE_DELTA_STATS[number];

/** One node's answer from calculate.lua (see NodeDeltas in scripts/pob-calculate.lua). */
export interface NodeDelta {
  allocated: boolean;
  /** Allocating / removing just this node. */
  node: NodeDeltaStats;
  /** With the path to it (allocating) or the nodes hanging on it (removing), when longer than 1. */
  path?: NodeDeltaStats;
  pathLength?: number;
  /** The weapon set PoB allocates it in (reached only through that set's nodes). */
  weaponSet?: number;
}

export interface NodeDeltaBatch {
  base: NodeDeltaStats;
  nodes: Record<string, NodeDelta>;
}

export type NodePreviewEntry =
  | { status: "pending" }
  | { status: "done"; delta: NodeDelta; base: NodeDeltaStats }
  | { status: "error"; error: string };

const RANK: Record<string, number> = { keystone: 0, notable: 1, ascendancy_notable: 1, small: 2, ascendancy: 2 };
/** Node types worth pricing: masteries, starts and empty jewel sockets change nothing by themselves. */
export const previewableNode = (type: string): boolean => type in RANK;

/**
 * Nodes to price for a tree: unallocated nodes next to an allocated one (what the
 * player can take next), keystones and notables first; then, if `includeAllocated`,
 * the allocated ones (what removing them costs). Ids keep the tree's order within a rank.
 */
export function nodePreviewCandidates(
  tree: Pick<PassiveTreeModel, "edges" | "nodeById">,
  allocatedIds: Iterable<string>,
  { includeAllocated = true }: { includeAllocated?: boolean } = {}
): string[] {
  const allocated = new Set(Array.from(allocatedIds, String));
  const next = new Set<string>();
  for (const edge of tree.edges) {
    const from = String(edge.from);
    const to = String(edge.to);
    if (allocated.has(from) && !allocated.has(to)) next.add(to);
    if (allocated.has(to) && !allocated.has(from)) next.add(from);
  }
  const rank = (id: string) => RANK[tree.nodeById.get(id)?.type ?? ""] ?? 9;
  const usable = (id: string) => {
    const node = tree.nodeById.get(id);
    return Boolean(node && previewableNode(node.type));
  };
  const byRank = (ids: Iterable<string>) => [...ids].filter(usable).sort((a, b) => rank(a) - rank(b));
  return [...byRank(next), ...(includeAllocated ? byRank(allocated) : [])];
}

/** Cache key of a build: the calculation body without what does not change the numbers. */
export function nodePreviewBuildKey(body: Record<string, unknown>): string {
  const { calc_priority: _priority, analysis: _analysis, node_ids: _ids, ...rest } = body;
  return hashString(JSON.stringify(rest));
}

interface BuildCache {
  key: string;
  body: Record<string, unknown>;
  entries: Map<string, NodePreviewEntry>;
  /** Wanted but not sent yet, most urgent first. */
  queue: string[];
  base: NodeDeltaStats | null;
}

/**
 * Batches node preview requests for the current build and keeps answers per build key.
 * One batch in flight at a time; a batch whose build is no longer current is still
 * stored under its own key (cheap, and right if the player goes back to that build).
 */
export class NodePreviewStore {
  private readonly builds = new Map<string, BuildCache>();
  private current: BuildCache | null = null;
  private inFlight = false;
  private paused = false;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly fetchBatch: (body: Record<string, unknown>, nodeIds: string[]) => Promise<NodeDeltaBatch>,
    private readonly options: { batchSize?: number; maxBuilds?: number } = {}
  ) {}

  get snapshot(): number {
    return this.version;
  }

  get buildKey(): string {
    return this.current?.key ?? "";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Makes `body` the current build. Unsent requests of the previous build are dropped. */
  setBuild(body: Record<string, unknown> | null): void {
    if (!body) {
      if (this.current) this.current.queue = [];
      this.current = null;
      this.changed();
      return;
    }
    const key = nodePreviewBuildKey(body);
    if (this.current?.key === key) return;
    if (this.current) {
      // Not sent: forget them so they are asked again if this build comes back.
      for (const id of this.current.queue) this.current.entries.delete(id);
      this.current.queue = [];
    }
    let cache = this.builds.get(key);
    if (!cache) {
      cache = { key, body, entries: new Map(), queue: [], base: null };
      this.builds.set(key, cache);
      const max = this.options.maxBuilds ?? 6;
      for (const oldKey of this.builds.keys()) {
        if (this.builds.size <= max) break;
        if (oldKey !== key) this.builds.delete(oldKey);
      }
    } else {
      // Refresh LRU order.
      this.builds.delete(key);
      this.builds.set(key, cache);
    }
    this.current = cache;
    this.changed();
    this.pump();
  }

  get(nodeId: string): NodePreviewEntry | undefined {
    return this.current?.entries.get(String(nodeId));
  }

  /**
   * Asks for nodes of the current build. `urgent` puts them at the front (the node
   * under the mouse); otherwise they join the back in the given order.
   */
  want(nodeIds: Iterable<string>, { urgent = false }: { urgent?: boolean } = {}): void {
    const cache = this.current;
    if (!cache) return;
    const fresh: string[] = [];
    for (const raw of nodeIds) {
      const id = String(raw);
      const entry = cache.entries.get(id);
      if (entry && entry.status !== "error") {
        if (urgent && entry.status === "pending" && cache.queue.includes(id)) {
          cache.queue = [id, ...cache.queue.filter((row) => row !== id)];
        }
        continue;
      }
      cache.entries.set(id, { status: "pending" });
      fresh.push(id);
    }
    if (!fresh.length) return;
    cache.queue = urgent ? [...fresh, ...cache.queue] : [...cache.queue, ...fresh];
    this.changed();
    this.pump();
  }

  /** Holds new batches (the one in flight finishes), e.g. while the build itself is recalculated. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.pump();
  }

  get pendingCount(): number {
    return this.current?.queue.length ?? 0;
  }

  private pump(): void {
    const cache = this.current;
    if (this.inFlight || this.paused || !cache || !cache.queue.length) return;
    const ids = cache.queue.splice(0, this.options.batchSize ?? 40);
    this.inFlight = true;
    this.fetchBatch(cache.body, ids)
      .then((batch) => {
        cache.base = batch.base;
        for (const id of ids) {
          const delta = batch.nodes?.[id];
          cache.entries.set(id, delta
            ? { status: "done", delta, base: batch.base }
            : { status: "error", error: "PoB không biết node này" });
        }
      })
      .catch((error: unknown) => {
        const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
        for (const id of ids) cache.entries.set(id, { status: "error", error: message });
      })
      .finally(() => {
        this.inFlight = false;
        this.changed();
        this.pump();
      });
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

const STAT_LABELS: Record<NodeDeltaStat, { vi: string; en: string; percent?: boolean }> = {
  CombinedDPS: { vi: "DPS", en: "DPS" },
  Life: { vi: "máu", en: "life" },
  EnergyShield: { vi: "khiên năng lượng", en: "energy shield" },
  Mana: { vi: "mana", en: "mana" },
  Spirit: { vi: "tinh thần", en: "spirit" },
  Armour: { vi: "giáp", en: "armour" },
  Evasion: { vi: "né tránh", en: "evasion" },
  FireResist: { vi: "kháng lửa", en: "fire resistance", percent: true },
  ColdResist: { vi: "kháng lạnh", en: "cold resistance", percent: true },
  LightningResist: { vi: "kháng sét", en: "lightning resistance", percent: true },
  ChaosResist: { vi: "kháng hỗn loạn", en: "chaos resistance", percent: true },
  TotalEHP: { vi: "máu hiệu dụng (EHP)", en: "effective health (EHP)" },
  Str: { vi: "sức mạnh", en: "strength" },
  Dex: { vi: "khéo léo", en: "dexterity" },
  Int: { vi: "trí tuệ", en: "intelligence" }
};

export interface NodeDeltaLine {
  stat: NodeDeltaStat;
  text: string;
  positive: boolean;
}

const signed = (value: number, digits: number, locale: "vi" | "en") => {
  const text = Math.abs(value).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: digits });
  return `${value > 0 ? "+" : "−"}${text}`;
};

/**
 * Readable lines for a delta: "+4,2% DPS", "+35 máu", "+8% kháng lửa". DPS and EHP are
 * shown as a percentage of the build's own value (plus the raw DPS when the base is 0).
 */
export function formatNodeDelta(stats: NodeDeltaStats, base: NodeDeltaStats, locale: "vi" | "en" = "vi"): NodeDeltaLine[] {
  const lines: NodeDeltaLine[] = [];
  for (const stat of NODE_DELTA_STATS) {
    const value = stats[stat];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const label = STAT_LABELS[stat][locale];
    let text = "";
    if (stat === "CombinedDPS" || stat === "TotalEHP") {
      const from = base[stat];
      if (typeof from === "number" && from > 0) {
        const percent = (value / from) * 100;
        if (Math.abs(percent) < 0.05) continue;
        text = `${signed(percent, 1, locale)}% ${label}`;
      } else {
        if (Math.abs(value) < 0.5) continue;
        text = `${signed(value, 0, locale)} ${label}`;
      }
    } else if (STAT_LABELS[stat].percent) {
      if (Math.abs(value) < 0.05) continue;
      text = `${signed(value, 1, locale)}% ${label}`;
    } else {
      if (Math.abs(value) < 0.5) continue;
      text = `${signed(value, 0, locale)} ${label}`;
    }
    lines.push({ stat, text, positive: value > 0 });
  }
  return lines;
}
