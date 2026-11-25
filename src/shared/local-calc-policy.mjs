// Pure decision logic for local PoB calculation:
//   - bundle version matching and update checks (never calculate with an unverified or stale bundle)
//   - stale Cache Storage URL pruning after a successful update
//   - browser / device capability checks and low-memory warnings
//   - worker failure classification (OOM, crash, timeout, cancelled) and once-only fallback notices

export const LOW_MEMORY_GB_THRESHOLD = 4;
export const ESTIMATED_ENGINE_RAM_MB = 300;

export function formatDownloadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when `manifest` has the required version and asset descriptors. */
export function isValidPobManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  if (typeof manifest.version !== "string" || !manifest.version.trim()) return false;
  if (typeof manifest.baseUrl !== "string" || !manifest.baseUrl.trim()) return false;
  if (!manifest.files || typeof manifest.files !== "object") return false;
  if (typeof manifest.files.vfs !== "string" || !manifest.files.vfs.trim()) return false;
  if (typeof manifest.files.wasm !== "string" || !manifest.files.wasm.trim()) return false;
  if (typeof manifest.gzipBytes !== "number" || !(manifest.gzipBytes > 0)) return false;
  if (typeof manifest.wasmBytes !== "number" || !(manifest.wasmBytes > 0)) return false;
  return true;
}

/** Expected first-download byte size reported by a manifest. */
export function manifestDownloadBytes(manifest) {
  if (!manifest || typeof manifest !== "object") return 0;
  return Number(manifest.totalDownloadBytes) || ((Number(manifest.gzipBytes) || 0) + (Number(manifest.wasmBytes) || 0));
}

/** Normalized asset paths for a valid manifest. */
export function manifestAssetUrls(manifest) {
  const base = manifest.baseUrl.endsWith("/") ? manifest.baseUrl : `${manifest.baseUrl}/`;
  return {
    vfsUrl: `${base}${manifest.files.vfs}`,
    wasmUrl: `${base}${manifest.files.wasm}`
  };
}

/** True only when the deployed manifest is valid and matches the locally cached version. */
export function isManifestMatchingCache(manifest, cachedVersion) {
  return Boolean(
    isValidPobManifest(manifest)
    && typeof cachedVersion === "string"
    && cachedVersion.length > 0
    && manifest.version === cachedVersion
  );
}

/**
 * Decides what to do on page load after checking the deployed site's manifest.
 * Never authorizes running a cached bundle unless it matches the live manifest.
 */
export function evaluateBundleVersion({ manifest, cachedVersion, rememberedMode }) {
  if (!isValidPobManifest(manifest)) {
    return {
      action: "stay_server",
      reason: "manifest_unavailable",
      updateAvailable: false,
      canUseCache: false,
      downloadBytes: 0
    };
  }
  const downloadBytes = manifestDownloadBytes(manifest);
  const hasCached = typeof cachedVersion === "string" && cachedVersion.length > 0;
  if (hasCached && manifest.version === cachedVersion) {
    if (rememberedMode === "local") {
      return {
        action: "boot_cache",
        reason: "up_to_date",
        updateAvailable: false,
        canUseCache: true,
        downloadBytes: 0
      };
    }
    return {
      action: "stay_server",
      reason: "cached_not_active",
      updateAvailable: false,
      canUseCache: true,
      downloadBytes: 0
    };
  }
  if (hasCached && manifest.version !== cachedVersion) {
    return {
      action: "prompt_update",
      reason: "update_available",
      updateAvailable: true,
      canUseCache: false,
      downloadBytes
    };
  }
  return {
    action: "stay_server",
    reason: "not_cached",
    updateAvailable: false,
    canUseCache: false,
    downloadBytes
  };
}

/**
 * Decides what to do when the user explicitly clicks "Tính trên máy này".
 */
export function evaluateEnableLocalClick({ manifest, cachedVersion, hasCachedAssetsForManifest }) {
  if (!isValidPobManifest(manifest)) {
    return { action: "error", reason: "invalid_manifest", updateAvailable: false, downloadBytes: 0 };
  }
  if (hasCachedAssetsForManifest) {
    return { action: "boot_cache", reason: "cache_hit", updateAvailable: false, downloadBytes: 0 };
  }
  const hasOldCache = typeof cachedVersion === "string" && cachedVersion.length > 0 && cachedVersion !== manifest.version;
  return {
    action: "confirm_download",
    reason: hasOldCache ? "update_available" : "not_cached",
    updateAvailable: hasOldCache,
    downloadBytes: manifestDownloadBytes(manifest)
  };
}

/**
 * Returns cached request URLs that do not belong to `manifest` and should be deleted
 * after a new bundle version has been downloaded, cached, and started successfully.
 */
export function staleCacheUrls(existingUrls, manifest) {
  if (!Array.isArray(existingUrls) || !isValidPobManifest(manifest)) return [];
  const { vfsUrl, wasmUrl } = manifestAssetUrls(manifest);
  const pathOf = (raw) => {
    try {
      return new URL(String(raw), "https://local.invalid").pathname;
    } catch {
      return String(raw);
    }
  };
  const keepVfs = pathOf(vfsUrl);
  const keepWasm = pathOf(wasmUrl);
  return existingUrls.filter((raw) => {
    const pathname = pathOf(raw);
    return pathname !== keepVfs && pathname !== keepWasm;
  });
}

/** Detects mobile / tablet browsers from a user agent string. */
export function isMobileUserAgent(userAgent) {
  return /\b(?:Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini|webOS|BlackBerry)\b/i.test(String(userAgent || ""));
}

/**
 * Assesses whether a device can run the local PoB WASM worker and collects any
 * pre-download warnings (low RAM, mobile browser, missing Cache Storage).
 */
export function assessDeviceCapabilities(
  {
    inBrowser = true,
    hasWebAssembly = false,
    hasWorker = false,
    hasDecompressionStream = false,
    hasCacheStorage = false,
    deviceMemory = undefined,
    userAgent = ""
  } = {},
  { estimatedRamMb = ESTIMATED_ENGINE_RAM_MB, lowMemoryGbThreshold = LOW_MEMORY_GB_THRESHOLD } = {}
) {
  if (!inBrowser) {
    return {
      supported: false,
      blocker: {
        code: "not_browser",
        vi: "Không chạy trong trình duyệt.",
        en: "Not running in a browser."
      },
      warnings: []
    };
  }
  if (!hasWebAssembly) {
    return {
      supported: false,
      blocker: {
        code: "no_wasm",
        vi: "Trình duyệt không hỗ trợ WebAssembly — đã tự chuyển sang tính trên server.",
        en: "This browser does not support WebAssembly — switched back to server calculation."
      },
      warnings: []
    };
  }
  if (!hasWorker) {
    return {
      supported: false,
      blocker: {
        code: "no_worker",
        vi: "Trình duyệt không hỗ trợ Web Worker — đã tự chuyển sang tính trên server.",
        en: "This browser does not support Web Workers — switched back to server calculation."
      },
      warnings: []
    };
  }
  if (!hasDecompressionStream) {
    return {
      supported: false,
      blocker: {
        code: "no_decompression",
        vi: "Trình duyệt chưa hỗ trợ giải nén gzip (DecompressionStream) — đã tự chuyển sang tính trên server.",
        en: "This browser does not support gzip DecompressionStream — switched back to server calculation."
      },
      warnings: []
    };
  }

  const warnings = [];
  const reportedMem = typeof deviceMemory === "number" && Number.isFinite(deviceMemory) && deviceMemory > 0
    ? deviceMemory
    : null;
  const isLowMemory = reportedMem !== null && reportedMem <= lowMemoryGbThreshold;
  const isMobile = isMobileUserAgent(userAgent);

  if (isLowMemory && isMobile) {
    warnings.push({
      code: "low_memory_mobile",
      vi: `Thiết bị di động ít bộ nhớ (~${reportedMem} GB RAM) — bộ tính cần khoảng ${estimatedRamMb} MB RAM, trình duyệt có thể tự dừng và chuyển lại server. Bạn vẫn có thể tiếp tục.`,
      en: `Mobile device with limited memory (~${reportedMem} GB RAM) — the engine needs about ${estimatedRamMb} MB RAM and the browser may stop it and switch back to the server. You can still continue.`
    });
  } else if (isLowMemory) {
    warnings.push({
      code: "low_memory",
      vi: `Thiết bị có ít bộ nhớ (~${reportedMem} GB RAM) — bộ tính cần khoảng ${estimatedRamMb} MB RAM khi chạy. Bạn vẫn có thể tiếp tục, nếu hết bộ nhớ sẽ tự chuyển lại server.`,
      en: `This device has limited memory (~${reportedMem} GB RAM) — the engine needs about ${estimatedRamMb} MB RAM while running. You can still continue; if it runs out of memory it will switch back to the server.`
    });
  } else if (isMobile) {
    warnings.push({
      code: "mobile",
      vi: `Đang dùng trình duyệt di động — bộ tính cần khoảng ${estimatedRamMb} MB RAM và trình duyệt điện thoại có thể tự đóng nếu thiếu bộ nhớ (khi đó sẽ tự chuyển lại server). Bạn vẫn có thể tiếp tục.`,
      en: `Mobile browser detected — the engine needs about ${estimatedRamMb} MB RAM and mobile browsers may close it when memory is low (it will switch back to the server). You can still continue.`
    });
  }

  if (!hasCacheStorage) {
    warnings.push({
      code: "no_cache_storage",
      vi: "Trình duyệt không hỗ trợ Cache Storage — dữ liệu sẽ không được lưu lại và cần tải lại khi mở trang mới.",
      en: "Cache Storage is unavailable in this browser — data will not be saved and must be downloaded again on reload."
    });
  }

  return {
    supported: true,
    blocker: null,
    warnings,
    isLowMemory,
    isMobile,
    hasCacheStorage
  };
}

const VI_FAILURE_DETAILS = [
  [/downloaded data is incomplete or damaged/i, "dữ liệu tải về bị thiếu hoặc hỏng"],
  [/stored PoB data could not be unpacked/i, "không giải nén được dữ liệu PoB đã lưu"],
  [/worker script could not be loaded or crashed|messageerror/i, "trình duyệt không chạy được bộ tính hoặc bộ tính bị dừng đột ngột"],
  [/no answer from the local engine|timed? ?out/i, "bộ tính trên máy không phản hồi"],
  [/out of memory|not enough memory|cannot enlarge memory|memory\.grow|allocation failed|\boom\b/i, "máy không đủ bộ nhớ"]
];

const OOM_PATTERN = /out of memory|not enough memory|cannot enlarge memory|memory\.grow|allocation failed|\boom\b|RangeError.*memory/i;
const TIMEOUT_PATTERN = /no answer from the local engine|timed? ?out/i;
const CRASH_PATTERN = /worker script could not be loaded or crashed|worker.*crash|messageerror/i;

/**
 * Decides how to handle a local engine error during startup or mid-calculation:
 *   - cancelled / rejectedBuild: fall back silently for this request (do not switch mode or show error)
 *   - OOM / crash / timeout / fatal: fall back to server for this request, switch mode back to server,
 *     and notify the user once (suppressed when `alreadyFailed` is true).
 */
export function classifyLocalFailure(error, { alreadyFailed = false } = {}) {
  const flags = error && typeof error === "object" ? error : null;
  if (flags?.cancelled) {
    return { action: "fallback_silent", kind: "cancelled", switchToServer: false, notifyUser: false, notice: null };
  }
  if (flags?.rejectedBuild) {
    return { action: "fallback_silent", kind: "rejected_build", switchToServer: false, notifyUser: false, notice: null };
  }
  const detail = error instanceof Error ? error.message : String(error || "unknown error");
  const kind = OOM_PATTERN.test(detail) ? "oom"
    : TIMEOUT_PATTERN.test(detail) ? "timeout"
    : CRASH_PATTERN.test(detail) ? "worker_crash"
    : "fatal";

  const detailVi = VI_FAILURE_DETAILS.find(([pattern]) => pattern.test(detail))?.[1] ?? detail;
  const notice = kind === "oom"
    ? {
        vi: "Thiết bị không đủ bộ nhớ để chạy bộ tính trên máy — đã tự chuyển sang tính trên server.",
        en: "Not enough memory to run local calculation — switched back to server."
      }
    : {
        vi: `Tính trên máy gặp lỗi (${detailVi}) — đã tự chuyển sang tính trên server.`,
        en: `Local calculation failed (${detail}) — automatically switched back to server.`
      };

  return {
    action: "fallback_and_switch",
    kind,
    switchToServer: true,
    notifyUser: !alreadyFailed,
    notice
  };
}

/**
 * Evaluates visibility of the local calculation switch:
 *   - Enabled by default for everyone once the flag is removed.
 *   - `?localcalc=0` (or `false`) acts as a kill switch: hides the UI and forces server mode.
 *   - `?localcalc=1` (or `true`) clears a previously remembered kill switch.
 */
export function resolveLocalCalcVisibility({ queryParam, storedKillSwitch, defaultVisible = true } = {}) {
  if (queryParam === "0" || queryParam === "false") {
    return { visible: false, persistKillSwitch: "0" };
  }
  if (queryParam === "1" || queryParam === "true") {
    return { visible: true, persistKillSwitch: defaultVisible ? null : "1" };
  }
  if (defaultVisible) {
    return { visible: storedKillSwitch !== "0", persistKillSwitch: undefined };
  }
  return { visible: storedKillSwitch === "1", persistKillSwitch: undefined };
}
