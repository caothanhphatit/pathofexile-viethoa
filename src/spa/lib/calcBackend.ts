// Unified calculation backend for the Build Planner: routes build calculations,
// what-if comparisons (items, jewels, support suggestions), and passive node previews
// through either the default server API or the optional in-browser PoB WASM Web Worker.
//
// Visible to everyone (default stays "server"; nothing is fetched or initialized until
// the user explicitly opts in). `?localcalc=0` acts as a kill switch that hides the
// switch and forces server mode.
import {
  formatCalculateResponse,
  formatNodeDeltasResponse,
  prepareCalculateRequest,
  prepareNodeDeltasRequest
} from "../../shared/build-calculation.mjs";
import {
  assessDeviceCapabilities,
  classifyLocalFailure,
  ESTIMATED_ENGINE_RAM_MB,
  evaluateBundleVersion,
  evaluateEnableLocalClick,
  formatDownloadSize,
  isValidPobManifest,
  manifestAssetUrls,
  manifestDownloadBytes,
  resolveLocalCalcVisibility,
  staleCacheUrls,
  type DeviceCapabilityAssessment,
  type LocalizedMessage
} from "../../shared/local-calc-policy.mjs";
import { ensureBrowserModPool } from "./modPool";
import type { NodeDeltaBatch } from "./nodePreview";

export { ESTIMATED_ENGINE_RAM_MB, formatDownloadSize };

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
  /** Pre-download device warnings (low RAM, mobile browser, missing Cache Storage). */
  deviceWarnings: LocalizedMessage[];
  /** Milliseconds: totalMs is from the user's click (or page load on a remembered choice) to ready. */
  timings: { vmInitMs: number; pobLoadMs: number; decompressMs: number; downloadMs?: number; totalMs?: number; fromCache?: boolean; lastCalcMs?: number } | null;
  memory: { luaMemoryKB: number; wasmMemoryBytes: number | null } | null;
  /** True when the deployed site has a newer bundle than the cached one. */
  updateAvailable: boolean;
}

export interface BuildCalcResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  item_errors?: Array<{ messages?: string[] }>;
  equipment_dropped?: unknown[];
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

/**
 * Visible by default for everyone; `?localcalc=0` (or `false`) acts as a kill switch
 * that hides the switch and forces server mode (`?localcalc=1` re-enables it).
 */
export function isLocalCalcFlagEnabled(): boolean {
  if (typeof window === "undefined") return true;
  let queryParam: string | null = null;
  try {
    queryParam = new URLSearchParams(window.location.search).get("localcalc");
  } catch { /* ignore */ }
  const storedKillSwitch = readStorage(FLAG_STORAGE_KEY);
  const { visible, persistKillSwitch } = resolveLocalCalcVisibility({
    queryParam,
    storedKillSwitch,
    defaultVisible: true
  });
  if (persistKillSwitch !== undefined) {
    writeStorage(FLAG_STORAGE_KEY, persistKillSwitch);
  }
  if (!visible) {
    writeStorage(MODE_STORAGE_KEY, "server");
  }
  return visible;
}

/** Checks browser primitives and device memory / mobile hints before any download. */
export function assessLocalCalcDevice(): DeviceCapabilityAssessment {
  if (typeof window === "undefined") {
    return assessDeviceCapabilities({ inBrowser: false });
  }
  const nav = typeof navigator !== "undefined"
    ? (navigator as Navigator & { deviceMemory?: number })
    : undefined;
  return assessDeviceCapabilities({
    inBrowser: true,
    hasWebAssembly: typeof WebAssembly !== "undefined",
    hasWorker: typeof Worker !== "undefined",
    hasDecompressionStream: typeof DecompressionStream !== "undefined",
    hasCacheStorage: typeof caches !== "undefined",
    deviceMemory: nav?.deviceMemory,
    userAgent: nav?.userAgent ?? ""
  });
}

/** Checks browser primitives required to run the local PoB WASM worker. */
export function localCalcSupportError(): LocalizedNotice | null {
  return assessLocalCalcDevice().blocker;
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
    // The build's own calculation gets the server's answer untouched, as before this module.
    if (priority !== "compare") return json as BuildCalcResult;
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
  return manifestAssetUrls(manifest);
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
}

/** Deletes any Cache Storage entries that do not belong to `manifest` (called only after a successful update). */
async function pruneStaleCachedAssets(manifest: PobWebManifest): Promise<void> {
  const cache = await openBundleCache();
  if (!cache) return;
  try {
    const keys = await cache.keys();
    const stale = new Set(staleCacheUrls(keys.map((req) => req.url), manifest));
    await Promise.all(
      keys
        .filter((req) => stale.has(req.url))
        .map((req) => cache.delete(req))
    );
  } catch { /* ignore */ }
}

/** Removes only the specified manifest's cache entries (e.g. if a downloaded update fails to boot). */
async function deleteCachedAssetsForManifest(manifest: PobWebManifest): Promise<void> {
  const cache = await openBundleCache();
  if (!cache) return;
  const { vfsUrl, wasmUrl } = assetUrls(manifest);
  try {
    await Promise.all([cache.delete(vfsUrl), cache.delete(wasmUrl)]);
  } catch { /* ignore */ }
}

/**
 * The download must be the bundle the manifest describes (a proxy or an SPA fallback can
 * answer 200 with something else): sizes always, SHA-256 where the browser offers it.
 */
async function verifyDownload(manifest: PobWebManifest, vfsGzip: ArrayBuffer, wasmBytes: ArrayBuffer): Promise<void> {
  const damaged = new Error("the downloaded data is incomplete or damaged");
  if (vfsGzip.byteLength !== manifest.gzipBytes || wasmBytes.byteLength !== manifest.wasmBytes) throw damaged;
  if (!manifest.sha256 || typeof crypto === "undefined" || !crypto.subtle) return;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", vfsGzip));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== manifest.sha256) throw damaged;
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

function hasItemTextToValidate(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const slots = (body as { inventory_slots?: unknown }).inventory_slots;
  return Array.isArray(slots) && slots.some((row) => Boolean(row && typeof row === "object" && typeof (row as { raw_text?: unknown }).raw_text === "string" && (row as { raw_text: string }).raw_text));
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
  private restorePromise: Promise<void> | null = null;
  private failureNotifiedForWorker = false;
  /** How long one local calculation may take before the server is used instead. */
  localJobTimeoutMs = 60_000;
  /** How long worker startup may take before assuming silent OOM/crash and falling back. */
  localInitTimeoutMs = 45_000;

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
      deviceWarnings: [],
      timings: null,
      memory: null,
      updateAvailable: false
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
   * Called when the planner mounts: checks the deployed site's manifest if the user
   * has a cached bundle or previously chose local mode.
   * - If a newer bundle shipped: stays on server and flags `updateAvailable` so the UI
   *   shows "Có bản dữ liệu mới (x MB)" with an update button.
   * - If the manifest matches the cache and local mode was remembered: warm-starts the worker.
   * - Never calculates with a bundle whose version does not match the deployed manifest.
   */
  restoreIfRemembered(): Promise<void> {
    // One restore per page; calculations asked for meanwhile wait for it (see calculateBuild).
    this.restorePromise ??= this.restoreRemembered().catch((error) => this.failToServer(error));
    return this.restorePromise;
  }

  private async restoreRemembered(): Promise<void> {
    const flagEnabled = isLocalCalcFlagEnabled();
    if (flagEnabled !== this.state.flagEnabled) {
      this.setState({ flagEnabled });
    }
    if (!flagEnabled) {
      this.terminateWorker();
      this.setState({ mode: "server", phase: "idle", updateAvailable: false });
      return;
    }

    const rememberedMode = readStorage(MODE_STORAGE_KEY);
    const cached = readCachedMeta();
    if (rememberedMode !== "local" && !cached?.version) return;

    // Always verify against the deployed site's manifest: never run an unverified cache.
    let latest: PobWebManifest | null = null;
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const parsed = (await response.json()) as unknown;
        if (isValidPobManifest(parsed)) latest = parsed as PobWebManifest;
      }
    } catch {
      latest = null;
    }

    const decision = evaluateBundleVersion({
      manifest: latest,
      cachedVersion: cached?.version ?? null,
      rememberedMode
    });

    if (decision.action === "prompt_update" && latest) {
      const device = assessLocalCalcDevice();
      this.setState({
        mode: "server",
        phase: rememberedMode === "local" ? "confirm" : "idle",
        manifest: latest,
        updateAvailable: true,
        deviceWarnings: device.warnings,
        progress: null
      });
      return;
    }

    if (decision.action !== "boot_cache" || !latest) {
      // Manifest unavailable or cache not active: stay safely on server.
      this.setState({ mode: "server", updateAvailable: false });
      return;
    }

    const device = assessLocalCalcDevice();
    if (!device.supported) {
      writeStorage(MODE_STORAGE_KEY, "server");
      this.setState({ mode: "server", phase: "unsupported", fallbackNotice: device.blocker, deviceWarnings: [] });
      return;
    }

    const assets = await readCachedAssets(latest);
    if (!assets) {
      // Cache was cleared by the browser; stay on server until user confirms a new download.
      writeStorage(CACHED_META_KEY, null);
      writeStorage(MODE_STORAGE_KEY, "server");
      this.setState({ mode: "server", phase: "idle", cachedVersion: null, cachedBytes: 0, updateAvailable: false });
      return;
    }

    try {
      await verifyDownload(latest, assets.vfsGzip, assets.wasmBytes);
      const startedAt = performance.now();
      await this.bootWorkerFromAssets(latest, assets.vfsGzip, assets.wasmBytes);
      this.noteLoadTimings(startedAt, 0, true);
      this.setState({ mode: "local", phase: "ready", manifest: latest, updateAvailable: false, fallbackNotice: null, errorNotice: null });
    } catch (error) {
      await this.forgetCachedBundle();
      this.failToServer(error);
    }
  }

  /** User clicked "Tính trên máy này": checks device + manifest + cache before any download. */
  async requestLocalMode(): Promise<void> {
    const device = assessLocalCalcDevice();
    if (!device.supported) {
      this.setState({ mode: "server", phase: "unsupported", fallbackNotice: device.blocker, errorNotice: null, deviceWarnings: [] });
      return;
    }

    if (this.worker && this.state.phase === "ready" && !this.state.updateAvailable) {
      writeStorage(MODE_STORAGE_KEY, "local");
      this.setState({ mode: "local", fallbackNotice: null, errorNotice: null });
      return;
    }

    if (this.state.phase === "downloading" || this.state.phase === "decompressing" || this.state.phase === "loading_pob") {
      return;
    }

    this.setState({ phase: "checking", errorNotice: null, fallbackNotice: null, deviceWarnings: device.warnings });
    const startedAt = performance.now();
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 404
          ? "Chưa dựng gói tính cục bộ (npm run build:pob-web)."
          : `HTTP ${response.status}`);
      }
      const manifest = (await response.json()) as PobWebManifest;
      if (!isValidPobManifest(manifest)) {
        throw new Error("Manifest gói tính cục bộ không hợp lệ.");
      }

      // Check Cache Storage for this exact deployed manifest version.
      const cachedAssets = await readCachedAssets(manifest);
      const clickDecision = evaluateEnableLocalClick({
        manifest,
        cachedVersion: this.state.cachedVersion,
        hasCachedAssetsForManifest: Boolean(cachedAssets)
      });

      if (clickDecision.action === "boot_cache" && cachedAssets) {
        this.setState({
          manifest,
          cachedVersion: manifest.version,
          cachedBytes: cachedAssets.vfsGzip.byteLength + cachedAssets.wasmBytes.byteLength,
          updateAvailable: false
        });
        try {
          await verifyDownload(manifest, cachedAssets.vfsGzip, cachedAssets.wasmBytes);
          await this.bootWorkerFromAssets(manifest, cachedAssets.vfsGzip, cachedAssets.wasmBytes);
        } catch (error) {
          await this.forgetCachedBundle();
          this.failToServer(error);
          return;
        }
        writeStorage(MODE_STORAGE_KEY, "local");
        this.noteLoadTimings(startedAt, 0, true);
        this.setState({ mode: "local", phase: "ready", fallbackNotice: null, errorNotice: null, updateAvailable: false });
        return;
      }

      // Not cached yet (or cached version is older): show download size + device warnings and wait for user click.
      this.setState({
        manifest,
        phase: "confirm",
        progress: null,
        updateAvailable: clickDecision.updateAvailable,
        deviceWarnings: device.warnings
      });
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

  /** Opens the update confirm dialog (or starts downloading if already confirmed). */
  requestUpdate(): void {
    const device = assessLocalCalcDevice();
    if (!device.supported) {
      this.setState({ mode: "server", phase: "unsupported", fallbackNotice: device.blocker, errorNotice: null, deviceWarnings: [] });
      return;
    }
    if (!this.state.manifest) {
      void this.requestLocalMode();
      return;
    }
    if (device.warnings.length > 0 && this.state.phase !== "confirm") {
      this.setState({ phase: "confirm", deviceWarnings: device.warnings, errorNotice: null, fallbackNotice: null });
      return;
    }
    void this.confirmDownloadAndEnable();
  }

  cancelConfirm(): void {
    if (this.state.phase === "confirm" || this.state.phase === "error" || this.state.phase === "unsupported") {
      // Declining an update keeps mode on server, while keeping `updateAvailable` so the status bar still offers "Cập nhật".
      if (this.state.updateAvailable) writeStorage(MODE_STORAGE_KEY, "server");
      this.setState({ phase: "idle", errorNotice: null });
    }
  }

  /** User clicked Download/Update: downloads bundle with live progress, boots worker, then prunes old cache versions. */
  async confirmDownloadAndEnable(): Promise<void> {
    const manifest = this.state.manifest;
    if (!manifest) return;
    if (this.state.phase === "downloading" || this.state.phase === "decompressing" || this.state.phase === "loading_pob") {
      return;
    }

    const total = manifestDownloadBytes(manifest);
    let received = 0;
    const isUpdate = Boolean(this.state.cachedVersion && this.state.cachedVersion !== manifest.version);
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

    const startedAt = performance.now();
    try {
      const { vfsUrl, wasmUrl } = assetUrls(manifest);
      const [vfsGzip, wasmBytes] = await Promise.all([
        fetchWithProgress(vfsUrl, reportProgress),
        fetchWithProgress(wasmUrl, reportProgress)
      ]);
      const downloadMs = performance.now() - startedAt;
      await verifyDownload(manifest, vfsGzip, wasmBytes);
      await storeCachedAssets(manifest, vfsGzip, wasmBytes);
      this.setState({
        progress: { received: total, total, percent: 100 }
      });

      await this.bootWorkerFromAssets(manifest, vfsGzip, wasmBytes);

      // Update succeeded: only now delete older cached bundle versions and persist the new metadata.
      await pruneStaleCachedAssets(manifest);
      const bytes = vfsGzip.byteLength + wasmBytes.byteLength;
      writeStorage(CACHED_META_KEY, JSON.stringify({ version: manifest.version, bytes, manifest }));
      writeStorage(MODE_STORAGE_KEY, "local");
      this.noteLoadTimings(startedAt, downloadMs, false);
      this.setState({
        mode: "local",
        phase: "ready",
        cachedVersion: manifest.version,
        cachedBytes: bytes,
        progress: null,
        fallbackNotice: null,
        errorNotice: null,
        updateAvailable: false
      });
    } catch (error) {
      if (isUpdate) {
        await deleteCachedAssetsForManifest(manifest);
      } else {
        await this.forgetCachedBundle();
      }
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
      updateAvailable: false,
      progress: null,
      timings: null,
      memory: null,
      errorNotice: null,
      fallbackNotice: null
    });
  }

  /**
   * The stored bundle could not be started (damaged, or cut short by the browser): remove it,
   * so the next click offers a fresh download instead of failing the same way again.
   */
  private async forgetCachedBundle(): Promise<void> {
    writeStorage(CACHED_META_KEY, null);
    if (typeof caches !== "undefined") {
      try { await caches.delete(CACHE_NAME); } catch { /* ignore */ }
    }
    this.setState({ cachedVersion: null, cachedBytes: 0 });
  }

  dismissFallbackNotice(): void {
    this.setState({ fallbackNotice: null, errorNotice: null });
  }

  private noteLoadTimings(startedAt: number, downloadMs: number, fromCache: boolean): void {
    if (!this.state.timings) return;
    this.setState({ timings: { ...this.state.timings, downloadMs, totalMs: performance.now() - startedAt, fromCache } });
  }

  /** Lua and WebAssembly memory of the worker (pilot measurements); null when it is not running. */
  workerMemory(gc = false): Promise<CalcBackendState["memory"]> {
    if (!this.worker) return Promise.resolve(null);
    const worker = this.worker;
    const id = this.nextMsgId++;
    return new Promise((resolve, reject) => {
      this.pendingRpc.set(id, { resolve: (msg) => resolve((msg.memory as CalcBackendState["memory"]) ?? null), reject });
      worker.postMessage({ id, type: "memory", gc });
    });
  }

  private terminateWorker(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }
    this.initPromise = null;
    this.jobRunning = false;
    const err = Object.assign(new Error("Local PoB worker terminated"), { cancelled: true });
    for (const pending of this.pendingRpc.values()) pending.reject(err);
    this.pendingRpc.clear();
    while (this.jobQueue.length) this.jobQueue.shift()!.reject(err);
  }

  private failToServer(error: unknown): void {
    const decision = classifyLocalFailure(error, { alreadyFailed: this.failureNotifiedForWorker });
    if (decision.action === "fallback_silent") return;
    this.failureNotifiedForWorker = true;
    console.warn("[calcBackend] Local PoB failed, falling back to server:", error);
    this.terminateWorker();
    writeStorage(MODE_STORAGE_KEY, "server");
    this.setState({
      mode: "server",
      phase: "error",
      progress: null,
      ...(decision.notifyUser && decision.notice ? { fallbackNotice: decision.notice } : {})
    });
  }

  private bootWorkerFromAssets(
    manifest: PobWebManifest,
    vfsGzip: ArrayBuffer,
    wasmBytes: ArrayBuffer
  ): Promise<void> {
    this.terminateWorker();
    this.failureNotifiedForWorker = false;
    this.setState({ manifest, phase: "decompressing" });
    // Preload the browser item mod pool in parallel so the first local calculation does not wait for it.
    void ensureBrowserModPool();

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
      else pending.reject(Object.assign(new Error(String(msg.error || "Local worker error")), msg.fatal === false ? { rejectedBuild: true } : {}));
    };

    worker.onerror = (event: ErrorEvent) => {
      this.failToServer(event.message || "the worker script could not be loaded or crashed");
    };

    worker.onmessageerror = () => {
      this.failToServer(new Error("worker messageerror: could not decode worker response"));
    };

    const id = this.nextMsgId++;
    this.initPromise = new Promise<void>((resolve, reject) => {
      const initTimer = window.setTimeout(() => {
        const pending = this.pendingRpc.get(id);
        if (!pending) return;
        this.pendingRpc.delete(id);
        pending.reject(new Error(`no answer from the local engine after ${Math.round(this.localInitTimeoutMs / 1000)} s`));
      }, this.localInitTimeoutMs);

      this.pendingRpc.set(id, {
        resolve: (msg) => {
          window.clearTimeout(initTimer);
          this.setState({
            timings: (msg.timings as CalcBackendState["timings"]) ?? null,
            memory: (msg.memory as CalcBackendState["memory"]) ?? null
          });
          resolve();
        },
        reject: (err) => {
          window.clearTimeout(initTimer);
          reject(err);
        }
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

    // A worker the browser killed (out of memory on a phone) never answers and may not
    // raise an error either: give up after a while and let the server take over.
    const timer = window.setTimeout(() => {
      const pending = this.pendingRpc.get(job.id);
      if (!pending) return;
      this.pendingRpc.delete(job.id);
      pending.reject(new Error(`no answer from the local engine after ${Math.round(this.localJobTimeoutMs / 1000)} s`));
    }, this.localJobTimeoutMs);

    this.pendingRpc.set(job.id, {
      resolve: (msg) => {
        window.clearTimeout(timer);
        this.jobRunning = false;
        const ms = Number(msg.ms || 0);
        if (this.state.timings) {
          this.setState({ timings: { ...this.state.timings, lastCalcMs: ms } });
        }
        job.resolve({ data: msg.data as Record<string, unknown>, ms });
        this.pumpWorkerQueue();
      },
      reject: (err) => {
        window.clearTimeout(timer);
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
    // The user chose local on an earlier visit: wait for the engine to start from the
    // browser cache instead of sending this first calculation to the server.
    if (this.state.flagEnabled) {
      await this.restoreIfRemembered();
      if (options.isStale?.()) return { ok: false, error: "stale" };
    }
    if (this.state.mode === "local" && this.worker) {
      try {
        if (this.initPromise) await this.initPromise;
        if (options.isStale?.()) return { ok: false, error: "stale" };
        const payload = options.priority === "compare"
          ? { ...body, calc_priority: "compare", full_dps: false }
          : body;
        const modPool = hasItemTextToValidate(payload) ? await ensureBrowserModPool() : null;
        if (options.isStale?.()) return { ok: false, error: "stale" };
        const prep = prepareCalculateRequest(payload, { modPool });
        if (!prep.ok) return { ok: false, error: prep.error };
        const { data } = await this.enqueueLocalXml(prep.xml, options.priority === "compare" ? 1 : 10);
        if (options.isStale?.()) return { ok: false, error: "stale" };
        return formatCalculateResponse(data, prep);
      } catch (error) {
        if (options.isStale?.()) return { ok: false, error: "stale" };
        // Falls back silently if cancelled/rejectedBuild, otherwise notifies once and switches to server.
        this.failToServer(error);
        // Transparent fallback to server so the user still gets their build stats.
      }
    }
    return serverCalculateBuild(body, options);
  }

  /** Calculates passive node deltas locally if enabled, otherwise via `/api/builds/node-deltas`. */
  async calculateNodeDeltas(body: Record<string, unknown>, nodeIds: string[]): Promise<NodeDeltaBatch> {
    if (this.state.flagEnabled) await this.restoreIfRemembered();
    if (this.state.mode === "local" && this.worker) {
      const requestBody = { ...body, node_ids: nodeIds };
      const modPool = hasItemTextToValidate(requestBody) ? await ensureBrowserModPool() : null;
      const prep = prepareNodeDeltasRequest(requestBody, { modPool });
      if (!prep.ok) throw new Error(prep.error);
      try {
        if (this.initPromise) await this.initPromise;
        const { data } = await this.enqueueLocalXml(prep.xml, 2);
        return formatNodeDeltasResponse(data).data as NodeDeltaBatch;
      } catch (error) {
        this.failToServer(error);
      }
    }
    return serverCalculateNodeDeltas(body, nodeIds);
  }
}

export const calcBackend = new CalcBackendController();
