// Prepare a local Path of Building PoE2 checkout so `npm run server` can answer
// /api/builds/calculate on a Windows dev machine (production uses
// scripts/update-pob-core.sh on the Linux server).
//
//   git clone --depth 1 --branch dev https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git ../pob-core
//   node scripts/setup-pob-local.mjs [../pob-core]
//   POB_CORE_DIR=<pob-core>/src POB_LUAJIT=<pob-core>/runtime/pob-luajit-bin/pob-luajit.exe npm run server
//
// PoB runs on its own patched LuaJIT (runtime/lua51.dll: `x += 1`, `a?.b`, `continue`), which
// a stock luajit.exe can neither parse nor load. tools/pob-luahost is a tiny `luajit`-style
// host for that DLL; this script builds it into the checkout and installs calculate.lua with
// package paths relative to <pob-core>/src instead of the server's /root/pob-core.
// Rerun after every `git pull` of the PoB checkout.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const HOST_PROJECT = path.join(ROOT_DIR, "tools", "pob-luahost", "PobLuaHost.csproj");

/** scripts/pob-calculate.lua with package paths relative to <pob-core>/src. */
export const localCalculateScript = (source) => {
  const next = source.replace(
    /package\.path = "[^"]*" \.\. package\.path/,
    'package.path = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua;" .. package.path\npackage.cpath = "../runtime/?.dll;" .. package.cpath'
  );
  if (next === source) throw new Error("scripts/pob-calculate.lua: package.path line not found");
  return next;
};

export const findDotnet = () => {
  const candidates = [
    process.env.DOTNET,
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "dotnet", "dotnet.exe"),
    "C:\\Program Files\\dotnet\\dotnet.exe"
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file)) || "dotnet";
};

export const setupPobLocal = (pobDir, { dotnet = findDotnet(), buildHost = true } = {}) => {
  const srcDir = path.join(pobDir, "src");
  const runtimeDir = path.join(pobDir, "runtime");
  if (!fs.existsSync(path.join(srcDir, "HeadlessWrapper.lua")) || !fs.existsSync(path.join(runtimeDir, "lua51.dll"))) {
    throw new Error(`${pobDir} is not a Path of Building PoE2 checkout (src/HeadlessWrapper.lua or runtime/lua51.dll missing)`);
  }
  const calculate = localCalculateScript(fs.readFileSync(path.join(ROOT_DIR, "scripts", "pob-calculate.lua"), "utf8"));
  fs.writeFileSync(path.join(srcDir, "calculate.lua"), calculate);

  const hostDir = path.join(runtimeDir, "pob-luajit-bin");
  const hostExe = path.join(hostDir, "pob-luajit.exe");
  if (buildHost) {
    execFileSync(dotnet, ["publish", HOST_PROJECT, "-c", "Release", "-o", hostDir, "--nologo"], { stdio: "inherit" });
  }
  return { srcDir, hostExe };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const pobDir = path.resolve(process.argv[2] || path.join(ROOT_DIR, "..", "pob-core"));
  try {
    const { srcDir, hostExe } = setupPobLocal(pobDir);
    console.log(`\ncalculate.lua installed in ${srcDir}`);
    console.log(`PoB Lua host: ${hostExe}`);
    console.log(`Run the API with:\n  POB_CORE_DIR=${srcDir}\n  POB_LUAJIT=${hostExe}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
