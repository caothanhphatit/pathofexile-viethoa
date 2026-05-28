import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv[2] || "public";
const rootDir = path.resolve(__dirname, "..", rootArg);
const port = Number(process.env.PORT || process.argv[3] || 8022);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2"
};

const spaFallbackFile = "/index.html";

const cleanRouteFiles = new Map([
  ["/", "/index.html"],
  ["/home", "/index.html"],
  ["/patchnote", "/index.html"],
  ["/patch-note", "/index.html"],
  ["/tra-cuu", "/index.html"],
  ["/lookup", "/index.html"],
  ["/newbie", "/index.html"],
  ["/beginner-guide", "/index.html"],
  ["/items", "/index.html"],
  ["/dictionary", "/index.html"],
  ["/tu-dien", "/index.html"],
  ["/weapon", "/index.html"],
  ["/skill-gems", "/index.html"],
  ["/skill_gems", "/index.html"],
  ["/skill-gem", "/index.html"],
  ["/skill_gem_detail", "/index.html"],
  ["/currency", "/index.html"],
  ["/currency-detail", "/index.html"],
  ["/currency_detail", "/index.html"],
  ["/passive-tree", "/index.html"],
  ["/passive_tree", "/index.html"],
  ["/leveling", "/index.html"]
]);

const goneRoutes = new Set([
  "/data/ggpk-lookup-data.js",
  "/data/ggpk-skills-data.js",
  "/ggpk-data",
  "/ggpk-lookup",
  "/ggpk_lookup",
  "/ggpk_lookup.html",
  "/ggpk-skills",
  "/ggpk_skills",
  "/ggpk_skills.html"
]);

const normalizedRequestPath = (urlPath = "/") => decodeURIComponent(urlPath.split("?")[0] || "/").replace(/\/+$/, "") || "/";

const safePath = (urlPath = "/") => {
  const requested = decodeURIComponent(urlPath.split("?")[0] || "/");
  const normalized = requested.replace(/\/+$/, "") || "/";
  const filePath = cleanRouteFiles.get(normalized) || requested;
  const resolved = path.resolve(rootDir, `.${filePath}`);
  if (!resolved.startsWith(`${rootDir}${path.sep}`) && resolved !== rootDir) return null;
  return resolved;
};

const server = http.createServer(async (request, response) => {
  if (goneRoutes.has(normalizedRequestPath(request.url))) {
    response.writeHead(410, {
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Gone");
    return;
  }

  const resolved = safePath(request.url);
  if (!resolved) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    const filePath = stat.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  } catch {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    response.end(await fs.readFile(path.join(rootDir, spaFallbackFile), "utf8").catch(() => "Not found"));
  }
});

server.listen(port, host, () => {
  console.log(`Static site: http://${host}:${port}/`);
});
