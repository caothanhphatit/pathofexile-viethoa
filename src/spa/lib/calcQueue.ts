// "What if" calculations for the Build Planner: equipping an inventory item,
// swapping a gem, trying a suggested support. Each one is a full Path of Building
// run (~5 s on the calculator), so they go through one queue that runs a few at
// a time (default 1), never repeats a build it already knows (cache keyed by a
// hash of the request body) and lets the item under the mouse jump the line.

export type CalcStatus = "queued" | "running" | "done" | "error";

export interface CalcEntry<T> {
  status: CalcStatus;
  result?: T;
  error?: string;
}

/** FNV-1a 32-bit over the string, as 8 hex chars (plus length to make collisions rarer). */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}-${value.length.toString(36)}`;
}

/** Cache key of a calculation request body. */
export const calcKey = (body: unknown): string => hashString(JSON.stringify(body));

interface Job {
  key: string;
  body: unknown;
  priority: number;
  order: number;
}

export class CalcQueue<T> {
  private readonly entries = new Map<string, CalcEntry<T>>();
  private readonly pending: Job[] = [];
  private readonly listeners = new Set<() => void>();
  private running = 0;
  private order = 0;
  private version = 0;
  private paused = false;

  constructor(
    private readonly run: (body: unknown) => Promise<T>,
    private readonly options: { concurrency?: number; maxEntries?: number } = {}
  ) {}

  /** Changes on every update; handy as a React useSyncExternalStore snapshot. */
  get snapshot(): number {
    return this.version;
  }

  get(key: string): CalcEntry<T> | undefined {
    return this.entries.get(key);
  }

  /** Stores a result computed elsewhere (the page's own calculation). */
  seed(key: string, result: T): void {
    this.entries.set(key, { status: "done", result });
    this.dropPending((job) => job.key === key);
    this.trim();
    this.changed();
  }

  /** Queues a calculation unless it is known, queued or running. Higher priority runs first. */
  request(body: unknown, priority = 0): string {
    const key = calcKey(body);
    const entry = this.entries.get(key);
    if (entry && entry.status !== "error") {
      if (entry.status === "queued") this.prioritize(key, priority);
      return key;
    }
    this.entries.set(key, { status: "queued" });
    this.pending.push({ key, body, priority, order: this.order++ });
    this.changed();
    this.pump();
    return key;
  }

  /** Raises a queued job (e.g. the item now under the mouse). */
  prioritize(key: string, priority: number): void {
    const job = this.pending.find((row) => row.key === key);
    if (job && priority > job.priority) {
      job.priority = priority;
      job.order = this.order++;
    }
  }

  /** Forgets queued (not running) jobs, e.g. after the build changed. */
  dropPending(predicate: (job: { key: string; priority: number }) => boolean = () => true): void {
    let dropped = false;
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (predicate(this.pending[index])) {
        this.entries.delete(this.pending[index].key);
        this.pending.splice(index, 1);
        dropped = true;
      }
    }
    if (dropped) this.changed();
  }

  /** Holds queued jobs (running ones finish), e.g. while the page's own calculation runs. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.pump();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get queuedCount(): number {
    return this.pending.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private next(): Job | undefined {
    if (!this.pending.length) return undefined;
    let best = 0;
    for (let index = 1; index < this.pending.length; index += 1) {
      const job = this.pending[index];
      const top = this.pending[best];
      // Highest priority first; among equals the most recently raised / oldest queued.
      if (job.priority > top.priority || (job.priority === top.priority && job.priority > 0 && job.order > top.order)
        || (job.priority === top.priority && job.priority <= 0 && job.order < top.order)) best = index;
    }
    return this.pending.splice(best, 1)[0];
  }

  private pump(): void {
    const concurrency = Math.max(1, this.options.concurrency ?? 1);
    while (!this.paused && this.running < concurrency) {
      const job = this.next();
      if (!job) return;
      this.running += 1;
      this.entries.set(job.key, { status: "running" });
      this.changed();
      this.run(job.body)
        .then((result) => {
          this.entries.set(job.key, { status: "done", result });
        })
        .catch((error: unknown) => {
          this.entries.set(job.key, { status: "error", error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          this.running -= 1;
          this.trim();
          this.changed();
          this.pump();
        });
    }
  }

  private trim(): void {
    const max = this.options.maxEntries ?? 300;
    if (this.entries.size <= max) return;
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= max) break;
      if (entry.status === "done" || entry.status === "error") this.entries.delete(key);
    }
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
