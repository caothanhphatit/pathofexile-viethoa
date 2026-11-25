export interface PobWebManifestLike {
  version: string;
  baseUrl: string;
  gzipBytes: number;
  wasmBytes: number;
  totalDownloadBytes?: number;
  files: {
    vfs: string;
    wasm: string;
    license?: string;
  };
}

export interface LocalizedMessage {
  code?: string;
  vi: string;
  en: string;
}

export interface BundleVersionDecision {
  action: "stay_server" | "boot_cache" | "prompt_update";
  reason: "manifest_unavailable" | "up_to_date" | "cached_not_active" | "update_available" | "not_cached";
  updateAvailable: boolean;
  canUseCache: boolean;
  downloadBytes: number;
}

export interface EnableLocalDecision {
  action: "error" | "boot_cache" | "confirm_download";
  reason: "invalid_manifest" | "cache_hit" | "update_available" | "not_cached";
  updateAvailable: boolean;
  downloadBytes: number;
}

export interface DeviceCapabilityInput {
  inBrowser?: boolean;
  hasWebAssembly?: boolean;
  hasWorker?: boolean;
  hasDecompressionStream?: boolean;
  hasCacheStorage?: boolean;
  deviceMemory?: number;
  userAgent?: string;
}

export interface DeviceCapabilityAssessment {
  supported: boolean;
  blocker: LocalizedMessage | null;
  warnings: LocalizedMessage[];
  isLowMemory?: boolean;
  isMobile?: boolean;
  hasCacheStorage?: boolean;
}

export interface LocalFailureDecision {
  action: "fallback_silent" | "fallback_and_switch";
  kind: "cancelled" | "rejected_build" | "oom" | "timeout" | "worker_crash" | "fatal";
  switchToServer: boolean;
  notifyUser: boolean;
  notice: LocalizedMessage | null;
}

export declare const LOW_MEMORY_GB_THRESHOLD: number;
export declare const ESTIMATED_ENGINE_RAM_MB: number;
export declare function formatDownloadSize(bytes: number): string;
export declare function isValidPobManifest(manifest: unknown): manifest is PobWebManifestLike;
export declare function manifestDownloadBytes(manifest: unknown): number;
export declare function manifestAssetUrls(manifest: PobWebManifestLike): { vfsUrl: string; wasmUrl: string };
export declare function isManifestMatchingCache(manifest: unknown, cachedVersion: string | null | undefined): boolean;
export declare function evaluateBundleVersion(input: {
  manifest: unknown;
  cachedVersion: string | null | undefined;
  rememberedMode: string | null | undefined;
}): BundleVersionDecision;
export declare function evaluateEnableLocalClick(input: {
  manifest: unknown;
  cachedVersion: string | null | undefined;
  hasCachedAssetsForManifest: boolean;
}): EnableLocalDecision;
export declare function staleCacheUrls(existingUrls: string[], manifest: unknown): string[];
export declare function isMobileUserAgent(userAgent: unknown): boolean;
export declare function assessDeviceCapabilities(
  env?: DeviceCapabilityInput,
  options?: { estimatedRamMb?: number; lowMemoryGbThreshold?: number }
): DeviceCapabilityAssessment;
export declare function classifyLocalFailure(
  error: unknown,
  options?: { alreadyFailed?: boolean }
): LocalFailureDecision;
export declare function resolveLocalCalcVisibility(options?: {
  queryParam?: string | null;
  storedKillSwitch?: string | null;
  defaultVisible?: boolean;
}): { visible: boolean; persistKillSwitch: string | null | undefined };
