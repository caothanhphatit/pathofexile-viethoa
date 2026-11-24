// Feasibility pilot: item icons straight from Content.ggpk instead of hotlinking cdn.poe2db.tw.
//
//   node scripts/ggpk/extract-icons.mjs --set=omen,currency-on-site --out=<dir outside public/>
//   node scripts/ggpk/extract-icons.mjs --set=site-all --survey        (formats only, nothing written)
//
// Sets: omen | currency-on-site | misc-all (every record of misc-items.json) |
//       site-all (every icon_url in public/data/currency-data.js + items-data.js)
// Options: --in=<misc-items.json> --helper=<exe> --game=<dir> --webp (also encode WebP with ffmpeg, if installed)
//
// Read-only on the game: the helper is only called with --extract. Icons are single .dds
// files (one per ItemVisualIdentity.DDSFile). The decoder here is pure JS and handles the
// two formats the pilot met: uncompressed 32-bit RGBA and BC1. Other block-compressed files
// (BC3/BC7...) are reported as failures, not guessed.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { DEFAULT_HELPER, ROOT_DIR, resolveGameDir } from "./reader.mjs";

const DEFAULT_IN = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "misc-items.json");
const DATA_DIR = path.join(ROOT_DIR, "public", "data");

const DXGI_NAMES = { 28: "R8G8B8A8_UNORM", 29: "R8G8B8A8_UNORM_SRGB", 87: "B8G8R8A8_UNORM", 91: "B8G8R8A8_UNORM_SRGB", 71: "BC1_UNORM", 72: "BC1_UNORM_SRGB", 77: "BC3_UNORM", 78: "BC3_UNORM_SRGB", 98: "BC7_UNORM", 99: "BC7_UNORM_SRGB" };

/**
 * Parse a DDS header. Returns { width, height, mipCount, format, layout, dataOffset } where
 * layout is "rgba" | "bgra" for the formats decodeDds can read, or "" for the rest.
 */
export const parseDdsHeader = (buffer) => {
  if (buffer.length < 128 || buffer.toString("latin1", 0, 4) !== "DDS ") throw new Error("not a DDS file (magic missing)");
  const height = buffer.readUInt32LE(12);
  const width = buffer.readUInt32LE(16);
  const mipCount = Math.max(1, buffer.readUInt32LE(28));
  const pfFlags = buffer.readUInt32LE(80);
  const fourCC = buffer.toString("latin1", 84, 88).replace(/\0/g, "");
  if (fourCC === "DX10") {
    const dxgi = buffer.readUInt32LE(128);
    const layout = dxgi === 28 || dxgi === 29 ? "rgba" : dxgi === 87 || dxgi === 91 ? "bgra" : dxgi === 71 || dxgi === 72 ? "bc1" : "";
    return { width, height, mipCount, format: DXGI_NAMES[dxgi] || `DXGI_${dxgi}`, layout, dataOffset: 148 };
  }
  if (pfFlags & 0x4) return { width, height, mipCount, format: fourCC, layout: fourCC === "DXT1" ? "bc1" : "", dataOffset: 128 }; // DXT1/DXT5...
  const bits = buffer.readUInt32LE(88);
  const rMask = buffer.readUInt32LE(92);
  if (bits === 32 && (pfFlags & 0x40)) return { width, height, mipCount, format: rMask === 0xff ? "R8G8B8A8 (legacy)" : "B8G8R8A8 (legacy)", layout: rMask === 0xff ? "rgba" : "bgra", dataOffset: 128 };
  return { width, height, mipCount, format: `legacy ${bits}-bit`, layout: "", dataOffset: 128 };
};

const rgb565 = (value) => [((value >> 11) & 31) * 255 / 31, ((value >> 5) & 63) * 255 / 63, (value & 31) * 255 / 31].map(Math.round);

/** BC1 (DXT1) blocks -> RGBA. 4x4 pixels per 8-byte block: two RGB565 colours + 2-bit indexes. */
export const decodeBc1 = (data, width, height) => {
  const rgba = Buffer.alloc(width * height * 4);
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  if (data.length < blocksWide * blocksHigh * 8) throw new Error(`BC1 data truncated: ${data.length} bytes, need ${blocksWide * blocksHigh * 8}`);
  for (let by = 0; by < blocksHigh; by += 1) {
    for (let bx = 0; bx < blocksWide; bx += 1) {
      const at = (by * blocksWide + bx) * 8;
      const c0 = data.readUInt16LE(at);
      const c1 = data.readUInt16LE(at + 2);
      const a = rgb565(c0), b = rgb565(c1);
      const mix = (x, y, wx, wy, div) => x.map((v, i) => Math.round((v * wx + y[i] * wy) / div));
      const palette = c0 > c1
        ? [[...a, 255], [...b, 255], [...mix(a, b, 2, 1, 3), 255], [...mix(a, b, 1, 2, 3), 255]]
        : [[...a, 255], [...b, 255], [...mix(a, b, 1, 1, 2), 255], [0, 0, 0, 0]];
      const bits = data.readUInt32LE(at + 4);
      for (let p = 0; p < 16; p += 1) {
        const x = bx * 4 + (p & 3);
        const y = by * 4 + (p >> 2);
        if (x >= width || y >= height) continue;
        const colour = palette[(bits >>> (p * 2)) & 3];
        const out = (y * width + x) * 4;
        rgba[out] = colour[0]; rgba[out + 1] = colour[1]; rgba[out + 2] = colour[2]; rgba[out + 3] = colour[3];
      }
    }
  }
  return rgba;
};

/** Top mip level as RGBA bytes. Throws for formats the pure-JS decoder does not read. */
export const decodeDds = (buffer) => {
  const header = parseDdsHeader(buffer);
  if (!header.layout) throw new Error(`unsupported DDS format ${header.format}`);
  if (header.layout === "bc1") return { ...header, rgba: decodeBc1(buffer.subarray(header.dataOffset), header.width, header.height) };
  const size = header.width * header.height * 4;
  if (buffer.length < header.dataOffset + size) throw new Error(`DDS truncated: ${buffer.length} bytes, need ${header.dataOffset + size}`);
  const rgba = Buffer.from(buffer.subarray(header.dataOffset, header.dataOffset + size));
  if (header.layout === "bgra") for (let i = 0; i < size; i += 4) { const b = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = b; }
  return { ...header, rgba };
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Encode RGBA bytes as a PNG (8-bit RGBA, per-row filter picked by minimum absolute sum). */
export const encodePng = (rgba, width, height) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    let best = 0;
    let bestSum = Infinity;
    for (let filter = 0; filter < 5; filter += 1) {
      const out = candidates[filter];
      let sum = 0;
      for (let x = 0; x < stride; x += 1) {
        const value = rgba[row + x];
        const left = x >= 4 ? rgba[row + x - 4] : 0;
        const up = y ? rgba[row - stride + x] : 0;
        const upLeft = y && x >= 4 ? rgba[row - stride + x - 4] : 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
        const byte = (value - predicted) & 0xff;
        out[x] = byte;
        sum += byte < 128 ? byte : 256 - byte;
      }
      if (sum < bestSum) { bestSum = sum; best = filter; }
    }
    raw[y * (stride + 1)] = best;
    candidates[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
};

/** "https://cdn.poe2db.tw/image/Art/2DItems/X.webp" -> "Art/2DItems/X.dds" */
export const ddsPathFromIconUrl = (url) => {
  const match = String(url || "").match(/\/image\/(.+)\.(webp|png)$/i);
  if (!match) return "";
  try {
    return `${decodeURIComponent(match[1])}.dds`;
  } catch {
    return `${match[1]}.dds`;
  }
};

/** File name used for a bundle path in the output folder. */
export const iconFileName = (ddsPath, ext = "png") => String(ddsPath).replace(/\.dds$/i, "").replace(/[\\/]/g, "_") + `.${ext}`;

const loadSiteFile = (file) => {
  const sandbox = {};
  new Function("window", fs.readFileSync(path.join(DATA_DIR, file), "utf8"))(sandbox);
  return Object.values(sandbox)[0];
};

/** DDS paths of an icon set. */
export const selectIcons = (set, { game, currencyRows, itemRows }) => {
  const siteNames = new Set([...currencyRows, ...itemRows].map((row) => row.name));
  switch (set) {
    case "omen": return game.items.filter((r) => r.category === "omen").map((r) => r.icon_dds);
    case "currency-on-site": return game.items.filter((r) => r.item_class_id === "StackableCurrency" && siteNames.has(r.name)).map((r) => r.icon_dds);
    case "misc-all": return game.items.map((r) => r.icon_dds);
    case "site-all": return [...currencyRows, ...itemRows].map((row) => ddsPathFromIconUrl(row.icon_url));
    default: throw new Error(`unknown icon set "${set}"`);
  }
};

/** Read-only batch extract. Returns { files: Map(path -> Buffer), missing: [paths] }. */
export const extractDds = (ggpk, paths, helper, batchSize = 150) => {
  const files = new Map();
  const missing = [];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "poevh-ggpk-icons-"));
  try {
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      let result;
      try {
        result = JSON.parse(execFileSync(helper, ["--extract", ggpk, batch.join(","), workDir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
      } catch (error) {
        if (!error.stdout) throw error;
        result = JSON.parse(error.stdout); // non-zero exit when some paths are missing
      }
      const gone = new Set((result.alreadyPatchedAssets || []).map((p) => p.toLowerCase()));
      for (const p of batch) {
        if (gone.has(p.toLowerCase())) { missing.push(p); continue; }
        const file = path.join(workDir, p.replace(/[\\/]/g, "_"));
        files.set(p, fs.readFileSync(file));
        fs.rmSync(file);
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return { files, missing };
};

/** True when `target` is `parent` or below it (a path on another drive is never inside). */
export const isInside = (parent, target) => {
  const relative = path.relative(parent, target);
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..";
};

const parseCliArgs = (argv = process.argv.slice(2)) => new Map(argv.map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key.replace(/^--/, ""), rest.join("=") || "true"];
}));

export const run = (args) => {
  const sets = (args.get("set") || "omen").split(",").filter(Boolean);
  const survey = args.has("survey");
  const outDir = args.get("out") ? path.resolve(args.get("out")) : "";
  if (!survey && !outDir) throw new Error("Pass --out=<folder> (outside public/) or --survey");
  if (outDir && isInside(path.join(ROOT_DIR, "public"), outDir)) throw new Error("Refusing to write icons inside public/ (pilot only)");
  const helper = args.get("helper") || DEFAULT_HELPER;
  const ggpk = path.join(resolveGameDir(args.get("game")), "Content.ggpk");
  const context = {
    game: JSON.parse(fs.readFileSync(path.resolve(args.get("in") || DEFAULT_IN), "utf8")),
    currencyRows: loadSiteFile("currency-data.js").items,
    itemRows: loadSiteFile("items-data.js").items
  };
  const report = { sets: {}, webp: null };
  for (const set of sets) {
    const requested = selectIcons(set, context);
    const paths = [...new Set(requested.filter(Boolean))];
    const startedExtract = Date.now();
    const { files, missing } = extractDds(ggpk, paths, helper);
    const extractMs = Date.now() - startedExtract;
    const formats = {};
    const failures = [];
    let ddsBytes = 0;
    let pngBytes = 0;
    let converted = 0;
    const sizes = [];
    const startedConvert = Date.now();
    if (outDir) fs.mkdirSync(path.join(outDir, set), { recursive: true });
    for (const [ddsPath, buffer] of files) {
      ddsBytes += buffer.length;
      try {
        const header = parseDdsHeader(buffer);
        const key = `${header.format} ${header.width}x${header.height} mips=${header.mipCount}`;
        formats[key] = (formats[key] || 0) + 1;
        if (survey) continue;
        const image = decodeDds(buffer);
        const png = encodePng(image.rgba, image.width, image.height);
        fs.writeFileSync(path.join(outDir, set, iconFileName(ddsPath)), png);
        pngBytes += png.length;
        sizes.push(png.length);
        converted += 1;
      } catch (error) {
        failures.push(`${ddsPath}: ${error.message}`);
      }
    }
    const convertMs = Date.now() - startedConvert;
    sizes.sort((a, b) => a - b);
    report.sets[set] = {
      rows: requested.length, rows_without_icon: requested.filter((p) => !p).length, distinct_paths: paths.length,
      extracted: files.size, missing_in_game: missing, formats, converted, failures,
      dds_bytes: ddsBytes, png_bytes: pngBytes,
      png_avg: converted ? Math.round(pngBytes / converted) : 0, png_min: sizes[0] || 0, png_median: sizes[sizes.length >> 1] || 0, png_max: sizes[sizes.length - 1] || 0,
      extract_ms: extractMs, convert_ms: convertMs
    };
    const r = report.sets[set];
    console.log(`${set}: ${r.rows} rows, ${r.distinct_paths} distinct icons, ${r.extracted} extracted (${r.missing_in_game.length} not in the game files), ${survey ? "survey only" : `${r.converted} converted`}, ${r.failures.length} failed`);
    console.log(`  formats: ${Object.entries(formats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`).join("; ")}`);
    console.log(`  dds ${r.dds_bytes} bytes${survey ? "" : `, png ${r.png_bytes} bytes (avg ${r.png_avg}, min ${r.png_min}, median ${r.png_median}, max ${r.png_max})`}; extract ${r.extract_ms} ms${survey ? "" : `, decode+encode ${r.convert_ms} ms`}`);
    if (missing.length) console.log(`  not in game: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " ..." : ""}`);
    for (const failure of failures.slice(0, 10)) console.log(`  failed: ${failure}`);

    if (!survey && args.has("webp")) {
      // Optional second encoding with a tool that is already installed; skipped when ffmpeg is missing.
      const started = Date.now();
      let bytes = 0, done = 0, bad = 0;
      fs.mkdirSync(path.join(outDir, `${set}-webp`), { recursive: true });
      for (const ddsPath of files.keys()) {
        const png = path.join(outDir, set, iconFileName(ddsPath));
        const webp = path.join(outDir, `${set}-webp`, iconFileName(ddsPath, "webp"));
        if (!fs.existsSync(png)) continue;
        const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", webp], { encoding: "utf8" });
        if (result.status === 0 && fs.existsSync(webp)) { bytes += fs.statSync(webp).size; done += 1; } else bad += 1;
      }
      r.webp = { converted: done, failed: bad, bytes, avg: done ? Math.round(bytes / done) : 0, ms: Date.now() - started };
      console.log(`  webp (ffmpeg libwebp lossless): ${done} converted, ${bad} failed, ${bytes} bytes (avg ${r.webp.avg}), ${r.webp.ms} ms`);
    }
  }
  if (outDir) {
    fs.writeFileSync(path.join(outDir, "icons-report.json"), JSON.stringify(report, null, 2));
    console.log(`\nWrote ${outDir}`);
  }
  return report;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    run(parseCliArgs());
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
