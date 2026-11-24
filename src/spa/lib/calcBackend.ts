// Unified calculation backend for the Build Planner: routes build calculations,
// what-if comparisons (items, jewels, support suggestions), and passive node previews
// through either the default server API or the optional in-browser PoB WASM Web Worker.
//
// Behind a feature flag (off by default: `?localcalc=1` or localStorage `poevh_local_calc_flag=1`).
// Nothing is fetched or initialized until the user explicitly opts in.
import { buildPobXml } from "../../server/pob-build-xml.mjs";
import { nodeDeltasFromOutput, nodeDeltasXml } from "../../server/pob-node-deltas.mjs";
import { dropImpossibleOffHands } from "../../shared/equipment-rules.mjs";
import type { NodeDeltaBatch } from "./nodePreview";

export type CalcEngineMode = "server" | "local";

export type LocalEnginePhase =
  | "idle"
  | "checking"
  | "confirm"
  | "downloading"
  | "decompressing"
  | "loading_pob"
  | "ready"
  | "unsupported"
  | "error";

export interface PobWebManifest {
  version: string;
  commit: string;
  pobVersion: string;
  builtAt: string;
  baseUrl: string;
  treeVersions: string[];
  fileCount: number;
  rawBytes: number;
  packBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  wasmBytes: number;
  wasmGzipBytes: number;
  totalDownloadBytes: number;
  totalGzipDownloadBytes: number;
  sha256: string;
  files: {
    vfs: string;
    wasm: string;
    license: string;
  };
}

export interface LocalizedNotice {
  vi: string;
  en: string;
}

export interface CalcBackendState {
  flagEnabled: boolean;
  mode: CalcEngineMode;
  phase: LocalEnginePhase;
  manifest: PobWebManifest | null;
  cachedVersion: string | null;
  cachedBytes: number;
  progress: { received: number; total: number; percent: number } | null;
  fallbackNotice: LocalizedNotice | null;
  errorNotice: LocalizedNotice | null;
  timings: { vmInitMs: number; pobLoadMs: number; decompressMs: number; lastCalcMs?: number } | null;
  memory: { luaMemoryKB: number; wasmMemoryBytes: number | null } | null;
}

export interface BuildCalcResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  item_errors?: Array<{ messages?: string[] }>;
}

const FLAG_STORAGE_KEY = "poevh_local_calc_flag";
const MODE_STORAGE_KEY = "poevh_calc_mode";
const CACHED_META_KEY = "poevh_pob_cached_meta";
const CACHE_NAME = "poevh-pob-local-v1";
const MANIFEST_URL = "/pob-web/manifest.json";

function readStorage(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private browsing / quota */ }
}

/** Reads the pilot feature flag (`?localcalc=1` / `?localcalc=0` or localStorage `poevh_local_calc_flag=1`). */
export function isLocalCalcFlagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const param = params.get("localcalc");
    if (param === "1" || param === "true") return true;
    if (param === "0" || param === "false") return false;
  } catch { /* ignore */ }
  return readStorage(FLAG_STORAGE_KEY) === "1";
}

/** Checks browser primitives required to run the local PoB WASM worker. */
export function localCalcSupportError(): LocalizedNotice | null {
  if (typeof window === "undefined") {
    return { vi: "Không chạy trong trình duyệt.", en: "Not running in a browser." };
  }
  if (typeof WebAssembly === "undefined") {
    return {
      vi: "Trình duyệt không hỗ trợ WebAssembly — đã tự chuyển sang tính trên server.",
      en: "This browser does not support WebAssembly — switched back to server calculation."
    };
  }
  if (typeof Worker === "undefined") {
    return {
      vi: "Trình duyệt không hỗ trợ Web Worker — đã tự chuyển sang tính trên server.",
      en: "This browser does not support Web Workers — switched back to server calculation."
    };
  }
  if (typeof DecompressionStream === "undefined") {
    return {
      vi: "Trình duyệt chưa hỗ trợ giải nén gzip (DecompressionStream) — đã tự chuyển sang tính trên server.",
      en: "This browser does not support gzip DecompressionStream — switched back to server calculation."
    };
  }
  return null;
}

export function formatDownloadSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Server backend (default path — unchanged behavior) ──────────────────────

export async function serverCalculateBuild(
  body: Record<string, unknown>,
  { priority = "main", maxRetries = 3, isStale }: { priority?: "main" | "compare"; maxRetries?: number; isStale?: () => boolean } = {}
): Promise<BuildCalcResult> {
  const payload = priority === "compare"
    ? { ...body, calc_priority: "compare", full_dps: false }
    : body;
  const serialized = JSON.stringify(payload);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch("/api/builds/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized
    });
    const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (isStale?.()) return { ok: false, error: "stale" };
    if (response.status === 503 && attempt < maxRetries) {
      const base = Math.min(Number(response.headers.get("retry-after")) || 2, 10) * 1000;
      const wait = priority === "compare" ? base * (attempt + 1) : base;
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      if (isStale?.()) return { ok: false, error: "stale" };
      continue;
    }
    if (!response.ok || !json?.ok || !json.data) {
      return { ok: false, error: String(json?.error || `HTTP ${response.status}`) };
    }
    return json as BuildCalcResult;
  }
}

export async function serverCalculateNodeDeltas(
  body: Record<string, unknown>,
  nodeIds: string[]
): Promise<NodeDeltaBatch> {
  const request = JSON.stringify({ ...body, node_ids: nodeIds });
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch("/api/builds/node-deltas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: request
    });
    const json = await response.json().catch(() => null);
    if (response.status === 503 && attempt < 5) {
      const wait = Math.min(Number(response.headers.get("retry-after")) || 2, 10) * 1000 * (attempt + 1);
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      continue;
    }
    if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || `HTTP ${response.status}`);
    return json.data as NodeDeltaBatch;
  }
}

// ── Cache Storage helpers (keyed by bundle version URL) ─────────────────────

function assetUrls(manifest: PobWebManifest) {
  const base = manifest.baseUrl.endsWith("/") ? manifest.baseUrl : `${manifest.baseUrl}/`;
  return {
    vfsUrl: `${base}${manifest.files.vfs}`,
    wasmUrl: `${base}${manifest.files.wasm}`
  };
}

async function openBundleCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function readCachedAssets(manifest: PobWebManifest): Promise<{ vfsGzip: ArrayBuffer; wasmBytes: ArrayBuffer } | null> {
  const cache = await openBundleCache();
  if (!cache) return null;
  const { vfsUrl, wasmUrl } = assetUrls(manifest);
  const [vfsResp, wasmResp] = await Promise.all([cache.match(vfsUrl), cache.match(wasmUrl)]);
  if (!vfsResp || !wasmResp) return null;
  const [vfsGzip, wasmBytes] = await Promise.all([vfsResp.arrayBuffer(), wasmResp.arrayBuffer()]);
  if (!vfsGzip.byteLength || !wasmBytes.byteLength) return null;
  return { vfsGzip, wasmBytes };
}

async function storeCachedAssets(manifest: PobWebManifest, vfsGzip: ArrayBuffer, wasmBytes: ArrayBuffer): Promise<void> {
  const cache = await openBundleCache();
  if (!cache) return;
  const { vfsUrl, wasmUrl } = assetUrls(manifest);
  await Promise.all([
    cache.put(vfsUrl, new Response(vfsGzip.slice(0), { headers: { "Content-Type": "application/octet-stream" } })),
    cache.put(wasmUrl, new Response(wasmBytes.slice(0), { headers: { "Content-Type": "application/wasm" } }))
  ]);
  // Prune older PoB bundle versions so storage doesn't grow across league updates.
  try {
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((req) => !req.url.endsWith(vfsUrl) && !req.url.endsWith(wasmUrl))
        .map((req) => cache.delete(req))
    );
  } catch { /* ignore */ }
  writeStorage(CACHED_META_KEY, JSON.stringify({
    version: manifest.version,
    bytes: vfsGzip.byteLength + wasmBytes.byteLength,
    manifest
  }));
}

async function fetchWithProgress(
  url: string,
  onChunk: (chunkBytes: number) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  if (!response.body) {
    const buf = await response.arrayBuffer();
    onChunk(buf.byteLength);
    return buf;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      onChunk(value.byteLength);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

// ── Worker RPC + priority queue ─────────────────────────────────────────────

interface WorkerJob {
  id: number;
  priority: number; // higher runs first (main=10, compare=1)
  xml: string;
  resolve: (value: { data: Record<string, unknown>; ms: number }) => void;
  reject: (reason: Error) => void;
}

function readCachedMeta(): { version: string; bytes: number; manifest?: PobWebManifest } | null {
  try {
    const raw = readStorage(CACHED_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.version === "string") return parsed;
  } catch { /* ignore */ }
  return null;
}

function sanitizeBuildBodyForLocal(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  if (Array.isArray(copy.inventory_slots)) {
    const weaponSets = dropImpossibleOffHands(copy.inventory_slots, Array.isArray(copy.passives) ? copy.passives : []);
    if (weaponSets.dropped.length) copy.inventory_slots = weaponSets.rows;
  }
  return copy;
}

class CalcBackendController {
  private state: CalcBackendState;
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private nextMsgId = 1;
  private pendingRpc = new Map<number, { resolve: (msg: Record<string, unknown>) => void; reject: (err: Error) => void }>();
  private jobQueue: WorkerJob[] = [];
  private jobRunning = false;
  private autoResumed = false;

  constructor() {
    const flagEnabled = isLocalCalcFlagEnabled();
    const cached = flagEnabled ? readCachedMeta() : null;
    this.state = {
      flagEnabled,
      mode: "server",
      phase: "idle",
      manifest: cached?.manifest ?? null,
      cachedVersion: cached?.version ?? null,
      cachedBytes: cached?.bytes ?? 0,
      progress: null,
      fallbackNotice: null,
      errorNotice: null,
      timings: null,
      memory: null
    };
  }

  getSnapshot = (): CalcBackendState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private setState(patch: Partial<CalcBackendState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * Called once when the planner mounts: if the pilot flag is on AND the user
   * previously chose local mode AND the bundle is already in Cache Storage,
   * silently warm-starts the worker from cache (zero network download).
   */
  async restoreIfRemembered(): Promise<void> {
    if (this.autoResumed) return;
    this.autoResumed = true;
    const flagEnabled = isLocalCalcFlagEnabled();
    if (flagEnabled !== this.state.flagEnabled) {
      this.setState({ flagEnabled });
    }
    if (!flagEnabled) return;
    if (readStorage(MODE_STORAGE_KEY) !== "local") return;

    const cached = readCachedMeta();
    if (!cached?.manifest) return;

    const supportErr = localCalcSupportError();
    if (supportErr) {
      writeStorage(MODE_STORAGE_KEY, "server");
      this.setState({ mode: "server", phase: "unsupported", fallbackNotice: supportErr });
      return;
    }

    const assets = await readCachedAssets(cached.manifest);
    if (!assets) {
      // Cache was cleared by the browser; stay on server until user confirms a new download.
      writeStorage(CACHED_META_KEY, null);
      writeStorage(MODE_STORAGE_KEY, "server");
      this.setState({ mode: "server", phase: "idle", cachedVersion: null, cachedBytes: 0 });
      return;
    }

    try {
      await this.bootWorkerFromAssets(cached.manifest, assets.vfsGzip, assets.wasmBytes);
      this.setState({ mode: "local", phase: "ready", fallbackNotice: null, errorNotice: null });
    } catch (error) {
      this.failToServer(error);
    }
  }

  /** User clicked "Tính trên máy này": checks cache, shows size prompt before any download. */
  async requestLocalMode(): Promise<void> {
    const supportErr = localCalcSupportError();
    if (supportErr) {
      this.setState({ mode: "server", phase: "unsupported", fallbackNotice: supportErr, errorNotice: null });
      return;
    }

    if (this.worker && this.state.phase === "ready") {
      writeStorage(MODE_STORAGE_KEY, "local");
      this.setState({ mode: "local", fallbackNotice: null, errorNotice: null });
      return;
    }

    if (this.state.phase === "downloading" || this.state.phase === "decompressing" || this.state.phase === "loading_pob") {
      return;
    }

    this.setState({ phase: "checking", errorNotice: null, fallbackNotice: null });
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 404
          ? "Chưa dựng gói tính cục bộ (npm run build:pob-web)."
          : `HTTP ${response.status}`);
      }
      const manifest = (await response.json()) as PobWebManifest;
      if (!manifest?.version || !manifest?.files?.vfs || !manifest?.files?.wasm) {
        throw new Error("Manifest gói tính cục bộ không hợp lệ.");
      }

      // Check Cache Storage first: if this version is already cached, start immediately with zero download.
      const cachedAssets = await readCachedAssets(manifest);
      if (cachedAssets) {
        this.setState({
          manifest,
          cachedVersion: manifest.version,
          cachedBytes: cachedAssets.vfsGzip.byteLength + cachedAssets.wasmBytes.byteLength
        });
        await this.bootWorkerFromAssets(manifest, cachedAssets.vfsGzip, cachedAssets.wasmBytes);
        writeStorage(MODE_STORAGE_KEY, "local");
        this.setState({ mode: "local", phase: "ready", fallbackNotice: null, errorNotice: null });
        return;
      }

      // Not cached yet: show download size confirmation and wait for user click.
      this.setState({ manifest, phase: "confirm", progress: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.setState({
        mode: "server",
        phase: "error",
        errorNotice: {
          vi: `Không chuẩn bị được chế độ tính trên máy (${detail}). Đang dùng server.`,
          en: `Could not prepare local mode (${detail}). Using server.`
        }
      });
    }
  }

  cancelConfirm(): void {
    if (this.state.phase === "confirm" || this.state.phase === "error" || this.state.phase === "unsupported") {
      this.setState({ phase: "idle", errorNotice: null });
    }
  }

  /** User clicked "Bắt đầu tải": downloads bundle with live progress, caches, starts worker, flips switch. */
  async confirmDownloadAndEnable(): Promise<void> {
    const manifest = this.state.manifest;
    if (!manifest) return;
    if (this.state.phase === "downloading" || this.state.phase === "decompressing" || this.state.phase === "loading_pob") {
      return;
    }

    const total = manifest.totalDownloadBytes || (manifest.gzipBytes + manifest.wasmBytes);
    let received = 0;
    this.setState({
      phase: "downloading",
      progress: { received: 0, total, percent: 0 },
      errorNotice: null,
      fallbackNotice: null
    });

    const reportProgress = (chunkBytes: number) => {
      received += chunkBytes;
      const denom = Math.max(total, received, 1);
      const percent = Math.min(100, Math.round((received / denom) * 100));
      this.setState({ progress: { received, total: denom, percent } });
    };

    try {
      const { vfsUrl, wasmUrl } = assetUrls(manifest);
      const [vfsGzip, wasmBytes] = await Promise.all([
        fetchWithProgress(vfsUrl, reportProgress),
        fetchWithProgress(wasmUrl, reportProgress)
      ]);
      await storeCachedAssets(manifest, vfsGzip, wasmBytes);
      this.setState({
        cachedVersion: manifest.version,
        cachedBytes: vfsGzip.byteLength + wasmBytes.byteLength,
        progress: { received: total, total, percent: 100 }
      });

      await this.bootWorkerFromAssets(manifest, vfsGzip, wasmBytes);
      writeStorage(MODE_STORAGE_KEY, "local");
      this.setState({ mode: "local", phase: "ready", progress: null, fallbackNotice: null, errorNotice: null });
    } catch (error) {
      this.failToServer(error);
    }
  }

  switchToServer(): void {
    writeStorage(MODE_STORAGE_KEY, "server");
    this.terminateWorker();
    this.setState({ mode: "server", phase: "idle", progress: null, errorNotice: null });
  }

  async deleteCachedData(): Promise<void> {
    writeStorage(MODE_STORAGE_KEY, "server");
    writeStorage(CACHED_META_KEY, null);
    this.terminateWorker();
    if (typeof caches !== "undefined") {
      try { await caches.delete(CACHE_NAME); } catch { /* ignore */ }
    }
    this.setState({
      mode: "server",
      phase: "idle",
      cachedVersion: null,
      cachedBytes: 0,
      progress: null,
      timings: null,
      memory: null,
      errorNotice: null,
      fallbackNotice: null
    });
  }

  dismissFallbackNotice(): void {
    this.setState({ fallbackNotice: null, errorNotice: null });
  }

  private terminateWorker(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
    this.initPromise = null;
    this.jobRunning = false;
    const err = new Error("Local PoB worker terminated");
    for (const pending of this.pendingRpc.values()) pending.reject(err);
    this.pendingRpc.clear();
    while (this.jobQueue.length) this.jobQueue.shift()!.reject(err);
  }

  private failToServer(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("[calcBackend] Local PoB failed, falling back to server:", error);
    this.terminateWorker();
    writeStorage(MODE_STORAGE_KEY, "server");
    this.setState({
      mode: "server",
      phase: "error",
      progress: null,
      fallbackNotice: {
        vi: `Tính trên máy gặp lỗi (${detail}) — đã tự chuyển sang tính trên server.`,
        en: `Local calculation failed (${detail}) — automatically switched back to server.`
      }
    });
  }

  private bootWorkerFromAssets(
    manifest: PobWebManifest,
    vfsGzip: ArrayBuffer,
    wasmBytes: ArrayBuffer
  ): Promise<void> {
    this.terminateWorker();
    this.setState({ manifest, phase: "decompressing" });

    const worker = new Worker(new URL("./pobLocalWorker.ts", import.meta.url), { type: "module" });
    this.worker = worker;

    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const msg = event.data;
      if (!msg || typeof msg.id !== "number") return;
      if (msg.type === "phase" && (msg.phase === "decompressing" || msg.phase === "loading_pob")) {
        this.setState({ phase: msg.phase });
        return;
      }
      const pending = this.pendingRpc.get(msg.id);
      if (!pending) return;
      this.pendingRpc.delete(msg.id);
      if (msg.ok) pending.resolve(msg);
      else pending.reject(new Error(String(msg.error || "Local worker error")));
    };

    worker.onerror = (event: ErrorEvent) => {
      this.failToServer(event.message || "Worker crashed");
    };

    const id = this.nextMsgId++;
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.pendingRpc.set(id, {
        resolve: (msg) => {
          this.setState({
            timings: (msg.timings as CalcBackendState["timings"]) ?? null,
            memory: (msg.memory as CalcBackendState["memory"]) ?? null
          });
          resolve();
        },
        reject
      });
      // Transfer copies so Cache Storage buffers remain intact if needed.
      const vfsCopy = vfsGzip.slice(0);
      const wasmCopy = wasmBytes.slice(0);
      worker.postMessage({ id, type: "init", vfsGzip: vfsCopy, wasmBytes: wasmCopy }, [vfsCopy, wasmCopy]);
    });

    return this.initPromise;
  }

  private enqueueLocalXml(xml: string, priority: number): Promise<{ data: Record<string, unknown>; ms: number }> {
    return new Promise((resolve, reject) => {
      this.jobQueue.push({ id: this.nextMsgId++, priority, xml, resolve, reject });
      this.pumpWorkerQueue();
    });
  }

  private pumpWorkerQueue(): void {
    if (this.jobRunning || !this.worker || !this.jobQueue.length) return;
    // Highest priority first (main calculation jumps ahead of compare / node previews).
    let bestIdx = 0;
    for (let i = 1; i < this.jobQueue.length; i += 1) {
      if (this.jobQueue[i].priority > this.jobQueue[bestIdx].priority) bestIdx = i;
    }
    const job = this.jobQueue.splice(bestIdx, 1)[0];
    this.jobRunning = true;

    this.pendingRpc.set(job.id, {
      resolve: (msg) => {
        this.jobRunning = false;
        const ms = Number(msg.ms || 0);
        if (this.state.timings) {
          this.setState({ timings: { ...this.state.timings, lastCalcMs: ms } });
        }
        job.resolve({ data: msg.data as Record<string, unknown>, ms });
        this.pumpWorkerQueue();
      },
      reject: (err) => {
        this.jobRunning = false;
        job.reject(err);
        this.pumpWorkerQueue();
      }
    });

    this.worker.postMessage({ id: job.id, type: "calculate", xml: job.xml });
  }

  /** Calculates a build using local WASM if enabled and ready, otherwise server (with automatic fallback). */
  async calculateBuild(
    body: Record<string, unknown>,
    options: { priority?: "main" | "compare"; maxRetries?: number; isStale?: () => boolean } = {}
  ): Promise<BuildCalcResult> {
    if (this.state.mode === "local" && this.worker) {
      try {
        if (this.initPromise) await this.initPromise;
        if (options.isStale?.()) return { ok: false, error: "stale" };
        const cleanBody = sanitizeBuildBodyForLocal(
          options.priority === "compare" ? { ...body, full_dps: false } : body
        );
        const xml = buildPobXml(cleanBody);
        const { data } = await this.enqueueLocalXml(xml, options.priority === "compare" ? 1 : 10);
        if (options.isStale?.()) return { ok: false, error: "stale" };
        return { ok: true, data };
      } catch (error) {
        if (options.isStale?.()) return { ok: false, error: "stale" };
        this.failToServer(error);
        // Transparent fallback to server so the user still gets their build stats.
      }
    }
    return serverCalculateBuild(body, options);
  }

  /** Calculates passive node deltas locally if enabled, otherwise via `/api/builds/node-deltas`. */
  async calculateNodeDeltas(body: Record<string, unknown>, nodeIds: string[]): Promise<NodeDeltaBatch> {
    if (this.state.mode === "local" && this.worker) {
      try {
        if (this.initPromise) await this.initPromise;
        const cleanBody = sanitizeBuildBodyForLocal(body);
        const xml = nodeDeltasXml(cleanBody, nodeIds);
        const { data } = await this.enqueueLocalXml(xml, 2);
        return nodeDeltasFromOutput(data);
      } catch (error) {
        this.failToServer(error);
      }
    }
    return serverCalculateNodeDeltas(body, nodeIds);
  }
}

export const calcBackend = new CalcBackendController();
