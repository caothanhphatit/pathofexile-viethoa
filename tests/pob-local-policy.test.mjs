// Unit tests for pure bundle-version, device-capability, failure-fallback,
// and visibility policies (src/shared/local-calc-policy.mjs).
import assert from "node:assert/strict";
import test from "node:test";

import {
  assessDeviceCapabilities,
  classifyLocalFailure,
  evaluateBundleVersion,
  evaluateEnableLocalClick,
  formatDownloadSize,
  isManifestMatchingCache,
  isMobileUserAgent,
  isValidPobManifest,
  resolveLocalCalcVisibility,
  staleCacheUrls
} from "../src/shared/local-calc-policy.mjs";

const MANIFEST_V1 = {
  version: "601768b-11111111",
  baseUrl: "/pob-web/601768b-11111111/",
  gzipBytes: 4_000_000,
  wasmBytes: 271_581,
  totalDownloadBytes: 4_271_581,
  files: { vfs: "pob-vfs.bin.gz", wasm: "wasmoon.wasm", license: "LICENSE.md" }
};

const MANIFEST_V2 = {
  version: "9999999-22222222",
  baseUrl: "/pob-web/9999999-22222222/",
  gzipBytes: 3_800_000,
  wasmBytes: 271_581,
  totalDownloadBytes: 4_071_581,
  files: { vfs: "pob-vfs.bin.gz", wasm: "wasmoon.wasm", license: "LICENSE.md" }
};

// ── Gap 2: Bundle version & update logic ─────────────────────────────────────

test("bundle version: never calculates with an unverified or mismatched bundle", () => {
  // Missing / failed manifest fetch -> stay on server, never boot cached bundle.
  assert.deepEqual(
    evaluateBundleVersion({ manifest: null, cachedVersion: MANIFEST_V1.version, rememberedMode: "local" }),
    { action: "stay_server", reason: "manifest_unavailable", updateAvailable: false, canUseCache: false, downloadBytes: 0 }
  );
  assert.equal(isManifestMatchingCache(null, MANIFEST_V1.version), false);
  assert.equal(isManifestMatchingCache(MANIFEST_V2, MANIFEST_V1.version), false);
  assert.equal(isManifestMatchingCache(MANIFEST_V1, MANIFEST_V1.version), true);
  assert.equal(isValidPobManifest({ version: "x" }), false);

  // Matching manifest + remembered local mode -> boot from cache.
  assert.deepEqual(
    evaluateBundleVersion({ manifest: MANIFEST_V1, cachedVersion: MANIFEST_V1.version, rememberedMode: "local" }),
    { action: "boot_cache", reason: "up_to_date", updateAvailable: false, canUseCache: true, downloadBytes: 0 }
  );

  // Matching manifest + server mode -> stay on server (cache is still valid).
  assert.deepEqual(
    evaluateBundleVersion({ manifest: MANIFEST_V1, cachedVersion: MANIFEST_V1.version, rememberedMode: "server" }),
    { action: "stay_server", reason: "cached_not_active", updateAvailable: false, canUseCache: true, downloadBytes: 0 }
  );

  // Newer manifest shipped -> prompt update, stay on server, cannot use old cache.
  for (const rememberedMode of ["local", "server", null]) {
    assert.deepEqual(
      evaluateBundleVersion({ manifest: MANIFEST_V2, cachedVersion: MANIFEST_V1.version, rememberedMode }),
      {
        action: "prompt_update",
        reason: "update_available",
        updateAvailable: true,
        canUseCache: false,
        downloadBytes: MANIFEST_V2.totalDownloadBytes
      }
    );
  }

  // No cache at all -> stay on server without update banner.
  assert.deepEqual(
    evaluateBundleVersion({ manifest: MANIFEST_V2, cachedVersion: null, rememberedMode: "local" }),
    { action: "stay_server", reason: "not_cached", updateAvailable: false, canUseCache: false, downloadBytes: MANIFEST_V2.totalDownloadBytes }
  );
});

test("bundle version: enable click detects update vs first download vs cache hit", () => {
  assert.equal(
    evaluateEnableLocalClick({ manifest: MANIFEST_V1, cachedVersion: MANIFEST_V1.version, hasCachedAssetsForManifest: true }).action,
    "boot_cache"
  );
  assert.deepEqual(
    evaluateEnableLocalClick({ manifest: MANIFEST_V2, cachedVersion: MANIFEST_V1.version, hasCachedAssetsForManifest: false }),
    { action: "confirm_download", reason: "update_available", updateAvailable: true, downloadBytes: MANIFEST_V2.totalDownloadBytes }
  );
  assert.deepEqual(
    evaluateEnableLocalClick({ manifest: MANIFEST_V2, cachedVersion: null, hasCachedAssetsForManifest: false }),
    { action: "confirm_download", reason: "not_cached", updateAvailable: false, downloadBytes: MANIFEST_V2.totalDownloadBytes }
  );
  assert.equal(
    evaluateEnableLocalClick({ manifest: null, cachedVersion: null, hasCachedAssetsForManifest: false }).action,
    "error"
  );
});

test("bundle version: staleCacheUrls keeps only the active manifest assets", () => {
  const cached = [
    "https://poeviethoa.net/pob-web/601768b-11111111/pob-vfs.bin.gz",
    "https://poeviethoa.net/pob-web/601768b-11111111/wasmoon.wasm",
    "https://poeviethoa.net/pob-web/9999999-22222222/pob-vfs.bin.gz",
    "https://poeviethoa.net/pob-web/9999999-22222222/wasmoon.wasm"
  ];
  assert.deepEqual(staleCacheUrls(cached, MANIFEST_V2), [
    "https://poeviethoa.net/pob-web/601768b-11111111/pob-vfs.bin.gz",
    "https://poeviethoa.net/pob-web/601768b-11111111/wasmoon.wasm"
  ]);
  assert.deepEqual(staleCacheUrls(cached, null), []);
});

// ── Gap 3: Device capability & failure fallback logic ────────────────────────

test("device capabilities: blocks missing primitives and warns on low RAM, mobile, or missing Cache Storage", () => {
  const fullDesktop = {
    inBrowser: true,
    hasWebAssembly: true,
    hasWorker: true,
    hasDecompressionStream: true,
    hasCacheStorage: true,
    deviceMemory: 8,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0"
  };

  const ok = assessDeviceCapabilities(fullDesktop);
  assert.equal(ok.supported, true);
  assert.equal(ok.blocker, null);
  assert.deepEqual(ok.warnings, []);

  // Hard blockers
  assert.equal(assessDeviceCapabilities({ ...fullDesktop, hasWebAssembly: false }).blocker?.code, "no_wasm");
  assert.equal(assessDeviceCapabilities({ ...fullDesktop, hasWorker: false }).blocker?.code, "no_worker");
  assert.equal(assessDeviceCapabilities({ ...fullDesktop, hasDecompressionStream: false }).blocker?.code, "no_decompression");

  // Low memory desktop -> still supported, with a clear RAM warning
  const lowRam = assessDeviceCapabilities({ ...fullDesktop, deviceMemory: 4 }, { estimatedRamMb: 300 });
  assert.equal(lowRam.supported, true);
  assert.deepEqual(lowRam.warnings.map((w) => w.code), ["low_memory"]);
  assert.match(lowRam.warnings[0].vi, /300 MB/);
  assert.match(lowRam.warnings[0].en, /300 MB/);

  // Mobile with unknown deviceMemory (e.g. iOS Safari) -> still supported, mobile warning
  const iphone = assessDeviceCapabilities({
    ...fullDesktop,
    deviceMemory: undefined,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
  });
  assert.equal(iphone.supported, true);
  assert.equal(isMobileUserAgent("iPhone"), true);
  assert.deepEqual(iphone.warnings.map((w) => w.code), ["mobile"]);

  // Mobile + low RAM + no Cache Storage -> combined low_memory_mobile + no_cache_storage
  const lowAndroid = assessDeviceCapabilities({
    ...fullDesktop,
    deviceMemory: 2,
    hasCacheStorage: false,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 6a) Mobile Safari/537.36"
  });
  assert.equal(lowAndroid.supported, true);
  assert.deepEqual(lowAndroid.warnings.map((w) => w.code), ["low_memory_mobile", "no_cache_storage"]);
});

test("failure fallback: classifies OOM, crash, timeout, cancelled, and notifies only once", () => {
  // User cancelled or rejected build -> silent fallback, stay in current mode
  assert.deepEqual(classifyLocalFailure(Object.assign(new Error("terminated"), { cancelled: true })), {
    action: "fallback_silent", kind: "cancelled", switchToServer: false, notifyUser: false, notice: null
  });
  assert.deepEqual(classifyLocalFailure(Object.assign(new Error("bad xml"), { rejectedBuild: true })), {
    action: "fallback_silent", kind: "rejected_build", switchToServer: false, notifyUser: false, notice: null
  });

  // OOM -> switch to server, notify once
  const oomFirst = classifyLocalFailure(new RangeError("WebAssembly.Memory.grow(): out of memory"), { alreadyFailed: false });
  assert.equal(oomFirst.action, "fallback_and_switch");
  assert.equal(oomFirst.kind, "oom");
  assert.equal(oomFirst.switchToServer, true);
  assert.equal(oomFirst.notifyUser, true);
  assert.match(oomFirst.notice.vi, /không đủ bộ nhớ/);

  // Concurrent second failure -> still falls back and switches, but suppresses duplicate notice
  const oomSecond = classifyLocalFailure(new Error("not enough memory"), { alreadyFailed: true });
  assert.equal(oomSecond.notifyUser, false);
  assert.equal(oomSecond.switchToServer, true);

  // Worker crash / timeout
  assert.equal(classifyLocalFailure(new Error("the worker script could not be loaded or crashed")).kind, "worker_crash");
  assert.equal(classifyLocalFailure(new Error("no answer from the local engine after 60 s")).kind, "timeout");
});

test("visibility policy: visible by default with ?localcalc=0 kill switch", () => {
  assert.equal(resolveLocalCalcVisibility({ defaultVisible: true }).visible, true);
  assert.deepEqual(resolveLocalCalcVisibility({ queryParam: "0", defaultVisible: true }), { visible: false, persistKillSwitch: "0" });
  assert.equal(resolveLocalCalcVisibility({ storedKillSwitch: "0", defaultVisible: true }).visible, false);
  assert.deepEqual(resolveLocalCalcVisibility({ queryParam: "1", storedKillSwitch: "0", defaultVisible: true }), { visible: true, persistKillSwitch: null });
  assert.equal(formatDownloadSize(4_467_447), "4.3 MB");
  assert.equal(formatDownloadSize(512_000), "500 KB");
});
