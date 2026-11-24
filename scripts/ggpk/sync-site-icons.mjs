// Extract all site item & skill icons straight from Content.ggpk as WebP files under
// public/assets/ggpk-icons/ and rewrite matching cdn.poe2db.tw URLs in public/data/*.js
// so the site self-hosts its icons without hotlinking poe2db.
//
//   node scripts/ggpk/sync-site-icons.mjs [--game=<dir>] [--helper=<exe>] [--force] [--no-rewrite] [--concurrency=8]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeDds, extractDds } from "./extract-icons.mjs";
import { DEFAULT_HELPER, ROOT_DIR, resolveGameDir } from "./reader.mjs";

export const DATA_DIR = path.join(ROOT_DIR, "public", "data");
export const ICONS_DIR = path.join(ROOT_DIR, "public", "assets", "ggpk-icons");
export const ICONS_WEB_PREFIX = "/assets/ggpk-icons/";
export const SITE_DATA_FILES = [
  "items-data.js",
  "currency-data.js",
  "skill-gems-data.js",
  "craft-index.js"
];

const CDN_IMAGE_RE = /https?:\/\/cdn\.poe2db\.tw\/image\/([^"'\s\\]+?)\.(webp|png)/gi;
const LOCAL_ICON_RE = /\/assets\/ggpk-icons\/([^"'\s\\]+?)\.webp/gi;

/** Decode percent-encoding safely and normalize slashes. */
export function normalizeArtPath(raw) {
  let value = String(raw || "").replace(/\\/g, "/").replace(/^\/+/, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep raw if malformed escape
  }
  return value.replace(/\.(dds|webp|png)$/i, "");
}

/** Canonical relative webp path under public/assets/ggpk-icons/ (always lowercase, safe segments). */
export function localRelWebpPath(artPath) {
  const clean = normalizeArtPath(artPath);
  if (!clean || clean.includes("..")) return "";
  return `${clean.toLowerCase()}.webp`;
}

export function localWebUrl(artPath) {
  const rel = localRelWebpPath(artPath);
  return rel ? `${ICONS_WEB_PREFIX}${rel.split("/").map(encodeURIComponent).join("/")}` : "";
}

/** Scan public/data/*.js for every referenced icon art path. Returns Map(lowerKey -> originalCaseDdsPath). */
export function collectSiteIconPaths(dataDir = DATA_DIR, files = SITE_DATA_FILES) {
  const byLower = new Map();
  for (const file of files) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const match of text.matchAll(CDN_IMAGE_RE)) {
      const art = normalizeArtPath(match[1]);
      if (!art) continue;
      const key = art.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, `${art}.dds`);
    }
    for (const match of text.matchAll(LOCAL_ICON_RE)) {
      const art = normalizeArtPath(match[1]);
      if (!art) continue;
      const key = art.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, `${art}.dds`);
    }
  }
  return byLower;
}

/** Encode RGBA buffer directly to WebP using ffmpeg over stdin (no intermediate PNG). */
function encodeRgbaToWebp(rgba, width, height, outPath, quality = 88) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const proc = spawn("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "pipe:0",
      "-c:v", "libwebp", "-quality", String(quality), "-method", "4",
      outPath
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath)) resolve(fs.statSync(outPath).size);
      else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`));
    });
    proc.stdin.end(rgba);
  });
}

/** Fallback: let ffmpeg decode unusual DDS formats (e.g. BC3/BC7) directly from a temp file. */
function encodeDdsFallbackToWebp(ddsBuffer, outPath, quality = 88) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const tmp = path.join(os.tmpdir(), `poevh-dds-${process.pid}-${Math.random().toString(36).slice(2)}.dds`);
    fs.writeFileSync(tmp, ddsBuffer);
    const proc = spawn("ffmpeg", [
      "-y", "-loglevel", "error",
      "-i", tmp,
      "-c:v", "libwebp", "-quality", String(quality), "-method", "4",
      outPath
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("error", (err) => { try { fs.rmSync(tmp, { force: true }); } catch {} reject(err); });
    proc.on("close", (code) => {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      if (code === 0 && fs.existsSync(outPath)) resolve(fs.statSync(outPath).size);
      else reject(new Error(stderr.trim() || `ffmpeg DDS fallback exited ${code}`));
    });
  });
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

/**
 * Rewrite matching https://cdn.poe2db.tw/image/<ArtPath>.webp URLs in public/data/*.js
 * to /assets/ggpk-icons/<art-path-lower>.webp whenever the local file exists.
 */
export function rewriteSiteIconUrls({ dataDir = DATA_DIR, iconsDir = ICONS_DIR, files = SITE_DATA_FILES } = {}) {
  const summary = {};
  for (const file of files) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) continue;
    const before = fs.readFileSync(full, "utf8");
    let rewritten = 0;
    let keptCdn = 0;
    const after = before.replace(CDN_IMAGE_RE, (fullMatch, artRaw) => {
      const rel = localRelWebpPath(artRaw);
      if (rel && fs.existsSync(path.join(iconsDir, rel))) {
        rewritten += 1;
        return localWebUrl(artRaw);
      }
      keptCdn += 1;
      return fullMatch;
    });
    if (after !== before) fs.writeFileSync(full, after, "utf8");
    summary[file] = { rewritten, kept_cdn: keptCdn };
  }
  return summary;
}

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export async function syncSiteIcons(args = new Map()) {
  const force = args.has("force");
  const noRewrite = args.has("no-rewrite");
  const concurrency = Math.max(1, Number(args.get("concurrency") || 8));
  const quality = Math.max(50, Math.min(100, Number(args.get("quality") || 88)));
  const helper = args.get("helper") || DEFAULT_HELPER;
  const ggpk = path.join(resolveGameDir(args.get("game")), "Content.ggpk");

  const started = Date.now();
  const iconMap = collectSiteIconPaths(DATA_DIR, SITE_DATA_FILES);
  const toExtract = [];
  let skippedExisting = 0;

  for (const [, ddsPath] of iconMap) {
    const rel = localRelWebpPath(ddsPath);
    const outPath = path.join(ICONS_DIR, rel);
    if (!force && fs.existsSync(outPath)) {
      skippedExisting += 1;
    } else {
      toExtract.push({ ddsPath, rel, outPath });
    }
  }

  let extracted = 0;
  let converted = 0;
  let fallbackConverted = 0;
  let webpBytes = 0;
  const missing = [];
  const failed = [];

  if (toExtract.length > 0) {
    const extractResult = extractDds(ggpk, toExtract.map((item) => item.ddsPath), helper, 180);
    extracted = extractResult.files.size;
    missing.push(...extractResult.missing);

    const workItems = toExtract.filter((item) => extractResult.files.has(item.ddsPath));
    await runPool(workItems, concurrency, async (item) => {
      const buf = extractResult.files.get(item.ddsPath);
      try {
        const img = decodeDds(buf);
        const bytes = await encodeRgbaToWebp(img.rgba, img.width, img.height, item.outPath, quality);
        webpBytes += bytes;
        converted += 1;
      } catch {
        try {
          const bytes = await encodeDdsFallbackToWebp(buf, item.outPath, quality);
          webpBytes += bytes;
          converted += 1;
          fallbackConverted += 1;
        } catch (err) {
          failed.push(`${item.ddsPath}: ${err.message}`);
        }
      }
    });
  }

  const rewrite = noRewrite ? null : rewriteSiteIconUrls({ dataDir: DATA_DIR, iconsDir: ICONS_DIR, files: SITE_DATA_FILES });
  const elapsedMs = Date.now() - started;

  const report = {
    generated_at: new Date().toISOString(),
    total_unique_site_icons: iconMap.size,
    skipped_existing: skippedExisting,
    extracted_from_ggpk: extracted,
    converted_webp: converted,
    ffmpeg_dds_fallback: fallbackConverted,
    webp_bytes_added: webpBytes,
    missing_in_game_count: missing.length,
    missing_in_game_sample: missing.slice(0, 30),
    failed_count: failed.length,
    failed_sample: failed.slice(0, 20),
    rewrite,
    elapsed_ms: elapsedMs
  };

  const reportDir = path.join(ROOT_DIR, "data", "game-extract", "ggpk");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "icons-sync-report.json"), JSON.stringify(report, null, 2));
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncSiteIcons(parseCliArgs())
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.failed_count > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}
