// Lightweight fake PoB worker used by tests/pob-worker-pool.test.mjs.
// Speaks the same --worker stdin/stdout JSON framing protocol as scripts/pob-calculate.lua.
"use strict";
const fs = require("node:fs");
const readline = require("node:readline");

const READY = "__POB_WORKER_READY__ ";
const RES = "__POB_WORKER_RES__ ";
const send = (prefix, obj) => process.stdout.write("\n" + prefix + JSON.stringify(obj) + "\n");

if (process.argv[2] !== "--worker") {
  process.exit(2);
}

send(READY, { ok: true, rssBytes: 120 * 1024 * 1024, luaMemKb: 80 * 1024 });

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.cmd === "quit") process.exit(0);
  const xml = req.xml || fs.readFileSync(req.xmlPath, "utf8");
  const attr = (name) => xml.match(new RegExp(name + '="([^"]*)"'))?.[1];
  const delay = Number(attr("delay") || 0);
  const tag = attr("tag") || "ok";
  const rssMb = Number(attr("rssMb") || 120);

  const finish = () => {
    if (attr("hang") === "1") return;
    if (attr("crash") === "1") process.exit(139);
    if (attr("fatal") === "1") {
      send(RES, { id: req.id, ok: false, error: "Internal Lua panic", fatal: true, rssBytes: rssMb * 1024 * 1024 });
      process.exit(1);
    }
    if (attr("error") === "1") {
      send(RES, { id: req.id, ok: false, error: "Invalid XML", fatal: false, rssBytes: rssMb * 1024 * 1024 });
      return;
    }
    send(RES, {
      id: req.id,
      ok: true,
      data: { tag, pid: process.pid },
      rssBytes: rssMb * 1024 * 1024,
      luaMemKb: 85 * 1024
    });
  };

  if (delay > 0) setTimeout(finish, delay);
  else finish();
});
