import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv[2] || "public";
const rootDir = path.resolve(__dirname, "..", rootArg);
const port = Number(process.env.PORT || process.argv[3] || 8022);
const host = process.env.HOST || "127.0.0.1";
// The SPA calls same-origin /api/* (e.g. /api/poe2db-image for item icons). In production
// nginx forwards it to the Node backend; locally forward it to `npm run server`.
const apiProxy = (process.env.API_PROXY || "http://127.0.0.1:3000").replace(/\/+$/, "");

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
  ["/build", "/index.html"],
  ["/build-planner", "/index.html"],
  ["/builds", "/index.html"],
  ["/leveling", "/index.html"],
  ["/premium", "/index.html"],
  ["/tai-app", "/index.html"],
  ["/cai-app", "/index.html"],
  ["/install", "/index.html"],
  ["/download", "/index.html"],
  ["/poevh", "/index.html"],
  ["/boss", "/index.html"],
  ["/boss-detail", "/index.html"],
  ["/boss_detail", "/index.html"]
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

// A malformed escape such as "/%E0%A4%A" makes decodeURIComponent throw; inside the
// request handler that is an unhandled rejection and takes the whole server down.
const decodeRequestPath = (urlPath = "/") => {
  try {
    return decodeURIComponent(String(urlPath).split("?")[0] || "/");
  } catch {
    return null;
  }
};

const normalizedRequestPath = (urlPath = "/") => {
  const decoded = decodeRequestPath(urlPath);
  return decoded === null ? null : decoded.replace(/\/+$/, "") || "/";
};

const safePath = (urlPath = "/") => {
  const requested = decodeRequestPath(urlPath);
  if (requested === null || requested.includes("\u0000")) return null;
  const normalized = requested.replace(/\/+$/, "") || "/";
  const filePath = cleanRouteFiles.get(normalized) || requested;
  const resolved = path.resolve(rootDir, `.${filePath}`);
  if (!resolved.startsWith(`${rootDir}${path.sep}`) && resolved !== rootDir) return null;
  return resolved;
};

const proxyApi = async (request, response) => {
  try {
    const hasBody = !["GET", "HEAD"].includes(request.method || "GET");
    const headers = { ...request.headers };
    delete headers.host;
    delete headers.connection;
    const upstream = await fetch(`${apiProxy}${request.url}`, {
      method: request.method,
      headers,
      body: hasBody ? request : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual"
    });
    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key)) outHeaders[key] = value;
    });
    response.writeHead(upstream.status, outHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`API backend not reachable at ${apiProxy} (start it with: npm run server). ${error.message}`);
  }
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

  if (/^\/api(\/|$)/.test(request.url || "")) {
    await proxyApi(request, response);
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
