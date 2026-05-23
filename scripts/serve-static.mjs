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
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

const cleanRouteFiles = new Map([
  ["/", "/index.html"],
  ["/home", "/index.html"],
  ["/patchnote", "/patchnote_vn.html"],
  ["/patch-note", "/patchnote_vn.html"],
  ["/dictionary", "/dictionary.html"],
  ["/tu-dien", "/dictionary.html"],
  ["/weapon", "/weapon.html"],
  ["/skill-gems", "/skill_gems.html"],
  ["/skill_gems", "/skill_gems.html"],
  ["/skill-gem", "/skill_gem_detail.html"],
  ["/skill_gem_detail", "/skill_gem_detail.html"],
  ["/currency", "/currency.html"],
  ["/currency-detail", "/currency_detail.html"],
  ["/currency_detail", "/currency_detail.html"],
  ["/leveling", "/leveling.html"]
]);

const safePath = (urlPath = "/") => {
  const requested = decodeURIComponent(urlPath.split("?")[0] || "/");
  const normalized = requested.replace(/\/+$/, "") || "/";
  const filePath = cleanRouteFiles.get(normalized) || requested;
  const resolved = path.resolve(rootDir, `.${filePath}`);
  if (!resolved.startsWith(`${rootDir}${path.sep}`) && resolved !== rootDir) return null;
  return resolved;
};

const server = http.createServer(async (request, response) => {
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
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end(await fs.readFile(path.join(rootDir, "404.html"), "utf8").catch(() => "Not found"));
  }
});

server.listen(port, host, () => {
  console.log(`Static site: http://${host}:${port}/`);
});
