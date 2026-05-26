import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

import {
  ROOT_DIR,
  crawlPassiveTreeData,
  parseCliArgs
} from "./passive-tree/runtime.mjs";
import { passiveIconAssetPath } from "./passive-tree/passive-tree-lib.mjs";

dotenv.config();

const CDN_IMAGE_BASE = "https://cdn.poe2db.tw/image/";
const CONCURRENCY = 16;

const iconCdnUrl = (icon = "") => `${CDN_IMAGE_BASE}${String(icon).replace(/\\/g, "/").replace(/\.(dds|png)$/i, ".webp")}`;

const publicAssetPath = (assetPath = "") =>
  path.join(ROOT_DIR, "public", assetPath.replace(/^\/+/, "").replace(/\//g, path.sep));

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const downloadIcon = async ({ icon, assetPath, force = false }) => {
  const filePath = publicAssetPath(assetPath);
  if (!force && await fileExists(filePath)) return { status: "skipped", icon, assetPath };

  const response = await fetch(iconCdnUrl(icon), {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      referer: "https://poe2db.tw/",
      "user-agent": "poe2-vietnamese-passive-tree-icon-fetcher/1.0"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  return { status: "downloaded", icon, assetPath };
};

const mapLimit = async (rows, limit, mapper) => {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (index < rows.length) {
      const current = rows[index];
      index += 1;
      results.push(await mapper(current));
    }
  });
  await Promise.all(workers);
  return results;
};

const args = parseCliArgs();
const tree = await crawlPassiveTreeData({
  repo: args.get("repo") || undefined,
  ref: args.get("ref") || undefined,
  treePath: args.get("path") || undefined,
  jsonPath: args.get("json") || undefined
});

const icons = [...new Map(tree.nodes
  .map((node) => [node.icon, passiveIconAssetPath(node.icon)])
  .filter(([icon, assetPath]) => icon && assetPath)).entries()]
  .map(([icon, assetPath]) => ({ icon, assetPath }));

const force = args.get("force") === "true";
const summary = { total: icons.length, downloaded: 0, skipped: 0, failed: 0, failures: [] };

const results = await mapLimit(icons, CONCURRENCY, async (row) => {
  try {
    return await downloadIcon({ ...row, force });
  } catch (error) {
    return { status: "failed", ...row, message: error.message };
  }
});

for (const result of results) {
  if (result.status === "downloaded") summary.downloaded += 1;
  else if (result.status === "skipped") summary.skipped += 1;
  else {
    summary.failed += 1;
    summary.failures.push({
      icon: result.icon,
      assetPath: result.assetPath,
      message: result.message
    });
  }
}

console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
