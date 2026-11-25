// Runs Path of Building PoE2 inside wasmoon (PUC Lua 5.4 compiled to WebAssembly)
// backed by an in-memory virtual filesystem Map<path, content>.
// Shared between the browser Web Worker and Node.js parity / benchmark suites.
import { LuaFactory } from "wasmoon";

/** Lua 5.1 / LuaJIT compatibility shims + VFS loader for PUC Lua 5.4 (wasmoon). */
const LUA54_POB_BOOTSTRAP = `
unpack = table.unpack
loadstring = load
math.pow = function(a, b) return a ^ b end
math.atan2 = math.atan
math.log10 = function(x) return math.log(x, 10) end
math.ldexp = function(m, e) return m * (2 ^ e) end
math.cosh = function(x) return (math.exp(x) + math.exp(-x)) / 2 end
math.sinh = function(x) return (math.exp(x) - math.exp(-x)) / 2 end
math.tanh = function(x) local e2 = math.exp(2 * x); return (e2 - 1) / (e2 + 1) end

-- Lua 5.1 string.format silently truncates non-integer floats for %d/%i/%u/%o/%x/%X.
local _orig_s_format = string.format
function string.format(fmt, ...)
  local ok, res = pcall(_orig_s_format, fmt, ...)
  if ok then return res end
  local args = { ... }
  local n = select("#", ...)
  local idx, i, flen = 0, 1, #fmt
  while i <= flen do
    if fmt:sub(i, i) == "%" then
      if fmt:sub(i + 1, i + 1) == "%" then
        i = i + 2
      else
        local j = i + 1
        while j <= flen and fmt:sub(j, j):match("[%-+#0 .0-9]") do j = j + 1 end
        local spec = fmt:sub(j, j)
        idx = idx + 1
        if spec:match("[diouxX]") and type(args[idx]) == "number" then
          local v = args[idx]
          if v ~= v or v == math.huge or v == -math.huge then
            args[idx] = 0
          elseif v >= 0 then
            args[idx] = math.floor(v)
          else
            args[idx] = math.ceil(v)
          end
        end
        i = j + 1
      end
    else
      i = i + 1
    end
  end
  return _orig_s_format(fmt, table.unpack(args, 1, n))
end

local _orig_s_char = string.char
function string.char(...)
  local ok, res = pcall(_orig_s_char, ...)
  if ok then return res end
  local args = { ... }
  local n = select("#", ...)
  for i = 1, n do
    if type(args[i]) == "number" then args[i] = math.floor(args[i]) & 0xFF end
  end
  return _orig_s_char(table.unpack(args, 1, n))
end

-- Lua 5.1 formats whole floats without trailing ".0" (e.g. tostring(100.0) == "100").
local _orig_tostring, _math_type, _math_tointeger = tostring, math.type, math.tointeger
function tostring(v)
  if type(v) == "number" and _math_type(v) == "float" then
    local iv = _math_tointeger(v)
    if iv then return _orig_tostring(iv) end
  end
  return _orig_tostring(v)
end
local _orig_s_len = string.len
function string.len(s)
  if type(s) == "number" then return _orig_s_len(tostring(s)) end
  return _orig_s_len(s)
end

-- Stub LuaJIT control table.
jit = {
  opt = { start = function() end },
  off = function() end,
  on = function() end,
  status = function() return false end,
  version = "Lua 5.4 (wasmoon)"
}
package.preload["jit"] = function() return jit end

-- LuaJIT BitOp library implemented with Lua 5.4 native 64-bit bitwise operators (signed 32-bit semantics).
local function tobit(x)
  x = math.floor(x) & 0xFFFFFFFF
  if x >= 0x80000000 then x = x - 0x100000000 end
  return x
end
bit = {
  tobit = tobit,
  bnot = function(a) return tobit(~(math.floor(a) & 0xFFFFFFFF)) end,
  band = function(a, ...)
    local r = math.floor(a) & 0xFFFFFFFF
    for i = 1, select("#", ...) do r = r & (math.floor(select(i, ...)) & 0xFFFFFFFF) end
    return tobit(r)
  end,
  bor = function(a, ...)
    local r = math.floor(a) & 0xFFFFFFFF
    for i = 1, select("#", ...) do r = r | (math.floor(select(i, ...)) & 0xFFFFFFFF) end
    return tobit(r)
  end,
  bxor = function(a, ...)
    local r = math.floor(a) & 0xFFFFFFFF
    for i = 1, select("#", ...) do r = r ~ (math.floor(select(i, ...)) & 0xFFFFFFFF) end
    return tobit(r)
  end,
  lshift = function(a, n) return tobit((math.floor(a) & 0xFFFFFFFF) << (n & 31)) end,
  rshift = function(a, n) return tobit((math.floor(a) & 0xFFFFFFFF) >> (n & 31)) end,
  arshift = function(a, n)
    n = n & 31
    local v = tobit(a)
    if v < 0 and n > 0 then return tobit((v >> n) | (~0 << (32 - n))) end
    return tobit((v & 0xFFFFFFFF) >> n)
  end,
  rol = function(a, n)
    n = n & 31
    local v = math.floor(a) & 0xFFFFFFFF
    return tobit(((v << n) | (v >> (32 - n))) & 0xFFFFFFFF)
  end,
  ror = function(a, n)
    n = n & 31
    local v = math.floor(a) & 0xFFFFFFFF
    return tobit(((v >> n) | (v << (32 - n))) & 0xFFFFFFFF)
  end,
  bswap = function(a)
    local v = math.floor(a) & 0xFFFFFFFF
    return tobit(((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >> 8) & 0xFF00) | ((v >> 24) & 0xFF))
  end,
  tohex = function(a, n)
    n = n or 8
    local upper = n < 0
    if upper then n = -n end
    local v = math.floor(a) & 0xFFFFFFFF
    return string.format(upper and ("%0" .. n .. "X") or ("%0" .. n .. "x"), v):sub(-n)
  end
}
package.preload["bit"] = function() return bit end

-- Minimal lua-utf8 shim (PoB uses reverse, gsub, find, sub, len, next, match, gmatch, lower, upper).
local luaUtf8 = {
  reverse = string.reverse,
  gsub = string.gsub,
  find = string.find,
  sub = string.sub,
  len = function(s) return utf8.len(s) or #s end,
  lower = string.lower,
  upper = string.upper,
  match = string.match,
  gmatch = string.gmatch,
  byte = string.byte,
  char = string.char,
  next = function(s, i, step)
    i = i or 1
    step = step or 1
    if step == 0 then return i end
    return utf8.offset(s, step + 1, i)
  end
}
package.preload["lua-utf8"] = function() return luaUtf8 end
package.preload["lcurl.safe"] = function() return nil end

-- Virtual filesystem hooks (backed by JS __pob_vfs_read).
local function stripShebang(src)
  if src:sub(1, 1) == "#" then return src:gsub("^[^\\n]*", "") end
  return src
end

-- Cache compiled prototypes for small modules PoB reloads on every build
-- (CalcBreakdown, Calcs, CalcSections, ConfigOptions, BuildDisplayStats...).
-- Large data files (> 256 KB) are loaded once and left uncached to keep memory low.
local _chunk_cache = {}
function loadfile(filename, mode, env)
  if not env and (not mode or mode == "t") then
    local cached = _chunk_cache[filename]
    if cached then return cached end
  end
  local src = __pob_vfs_read(filename)
  if not src then return nil, "cannot open " .. tostring(filename) .. ": No such file or directory" end
  src = stripShebang(src)
  local fn, err
  if env then fn, err = load(src, "@" .. filename, mode or "t", env)
  else fn, err = load(src, "@" .. filename, mode or "t") end
  if fn and not env and (not mode or mode == "t") and #src <= 262144 then
    _chunk_cache[filename] = fn
  end
  return fn, err
end

function dofile(filename)
  local f, err = loadfile(filename)
  if not f then error(err) end
  return f()
end

local function makeFileHandle(content)
  local pos, len = 1, #content
  return {
    read = function(self, fmt)
      if pos > len then return nil end
      if fmt == "*a" or fmt == "a" then
        local s = content:sub(pos)
        pos = len + 1
        return s
      elseif fmt == "*l" or fmt == "l" or fmt == nil then
        local nl = content:find("\\n", pos, true)
        if not nl then
          local s = content:sub(pos):gsub("\\r$", "")
          pos = len + 1
          return s
        end
        local s = content:sub(pos, nl - 1):gsub("\\r$", "")
        pos = nl + 1
        return s
      elseif type(fmt) == "number" then
        local s = content:sub(pos, pos + fmt - 1)
        pos = pos + #s
        return #s > 0 and s or nil
      end
      return nil
    end,
    lines = function(self)
      return function() return self:read("*l") end
    end,
    write = function() return true end,
    close = function() return true end,
    seek = function(self, whence, offset)
      offset = offset or 0
      if whence == "end" then pos = len + 1 + offset
      elseif whence == "set" then pos = 1 + offset
      elseif whence == "cur" then pos = pos + offset end
      return pos - 1
    end
  }
end

io = io or {}
io.open = function(filename, mode)
  if mode and (mode:find("w") or mode:find("a")) then
    return { write = function() return true end, close = function() return true end }
  end
  local content = __pob_vfs_read(filename)
  if not content then return nil, tostring(filename) .. ": No such file or directory" end
  return makeFileHandle(content)
end
io.read = function() return "" end

os = os or {}
os.getenv = function() return nil end
os.remove = function() return true end
os.execute = function() return 0 end

package.path = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua"
package.searchers = {
  package.searchers[1],
  function(modname)
    local modpath = modname:gsub("%.", "/")
    for _, p in ipairs({
      "../runtime/lua/" .. modpath .. ".lua",
      "../runtime/lua/" .. modpath .. "/init.lua",
      modpath .. ".lua",
      modpath .. "/init.lua"
    }) do
      local src = __pob_vfs_read(p)
      if src then
        local f, err = load(stripShebang(src), "@" .. p)
        if not f then error("error loading module '" .. modname .. "' from '" .. p .. "': " .. tostring(err)) end
        return f, p
      end
    end
    return "\\n\\tno file in VFS for '" .. modname .. "'"
  end
}

print = function() end
arg = {}
`;

/**
 * Replaces PoB's global copyTableSafe (Modules/Common.lua) with one that writes the copy
 * with rawset. Same result for the caller, without a side effect that Lua 5.4 cannot take:
 *
 * PassiveSpec:SwitchAttributeNode deep-copies a tree node with its metatables. A node's
 * modList is a class object whose parent proxy has `__newindex = object`. PoB's version
 * gives the proxy's copy that metatable first and then assigns its fields, so the fields
 * land in the ORIGINAL modList of the shared tree data, while that very table is being
 * traversed with pairs(). Adding keys during a traversal is undefined in Lua: LuaJIT happens
 * to survive it, Lua 5.4 (hash seed differs per VM) sometimes revisits keys, and the shared
 * node then keeps every earlier copy alive. Measured before this shim: in about one VM out
 * of five the heap doubled with each build that picks attribute nodes and reached the 2 GB
 * WebAssembly limit after some 15 builds.
 */
const COPY_TABLE_SAFE_SHIM = `
do
  local subTableMap = {}
  function copyTableSafe(tbl, noRecurse, preserveMeta, isSubTable)
    local out = {}
    if not noRecurse then subTableMap[tbl] = out end
    for k, v in next, tbl do
      if not noRecurse and type(v) == "table" then
        rawset(out, k, subTableMap[v] or copyTableSafe(v, false, preserveMeta, true))
      else
        rawset(out, k, v)
      end
    end
    if preserveMeta then setmetatable(out, getmetatable(tbl)) end
    if not noRecurse and not isSubTable then
      for k in next, subTableMap do subTableMap[k] = nil end
    end
    return out
  end
end
`;

/**
 * Turns scripts/pob-calculate.lua into a persistent Lua function
 * `pobCalculateXml(xmlText) -> jsonString`.
 *
 * The script is used as is up to its "One-shot mode" section: everything before it only
 * defines hooks and the local functions `calculateBuild`, `resetBetweenBuilds`,
 * `restoreSharedSkillCosts` and `resetGroupDpsHooks`. Instead of the CLI tail (read a
 * file, print, os.exit) or the stdin loop of `--worker`, each call does what one worker
 * request does: reset the per-build state, then run the same `calculateBuild` the
 * one-shot path runs. The returned JSON is `{"ok":true,"data":...}` or
 * `{"ok":false,"error":...,"fatal":bool}`.
 */
export function buildPersistentCalculateScript(calculateLuaSource) {
  const oneShot = calculateLuaSource.indexOf("-- ── One-shot mode");
  const wrapper = 'dofile("HeadlessWrapper.lua")';
  if (oneShot < 0 || !calculateLuaSource.includes(wrapper) || !calculateLuaSource.includes("local function calculateBuild(xmlText)") || !calculateLuaSource.includes("local function resetBetweenBuilds()")) {
    throw new Error("scripts/pob-calculate.lua changed shape: cannot build the persistent local runner");
  }
  // HeadlessWrapper is loaded by the engine itself (before this chunk), not twice.
  const head = calculateLuaSource.slice(0, oneShot).replace(wrapper, "");
  return `
${head}
-- Same settings as the script's --worker mode: no background item DB load, no dev autosave.
if main then
  main.disableDevAutoSave = true
  if main.onFrameFuncs then main.onFrameFuncs["LoadItems"] = nil end
end
function pobCalculateXml(xmlText)
  resetBetweenBuilds()
  local okCall, cleanOutput, errMsg, isFatal = xpcall(function()
    return calculateBuild(xmlText)
  end, debug.traceback)
  restoreSharedSkillCosts()
  resetGroupDpsHooks()
  local encoded
  if not okCall then
    encoded = dkjson.encode({ ok = false, error = stripColorCodes(tostring(cleanOutput)), fatal = true })
  elseif not cleanOutput then
    encoded = dkjson.encode({ ok = false, error = errMsg or "Calculation failed", fatal = isFatal == true })
  else
    encoded = dkjson.encode({ ok = true, data = cleanOutput })
  end
  cleanOutput = nil
  -- Release the finished build and reclaim its dead tables right after encoding so the
  -- next calculation starts from the ~55-75 MB baseline instead of peaking at 2x build memory.
  resetBetweenBuilds()
  collectgarbage("collect")
  return encoded
end
-- Frees the finished build (the next request would do the same reset first).
function pobReleaseBuild()
  resetBetweenBuilds()
  collectgarbage("collect")
  return collectgarbage("count")
end
`;
}

/** Normalizes a Lua file path to match keys stored in the VFS pack. */
export function normalizeVfsPath(relPath) {
  const norm = String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  // Strip accidental leading "/" when PoB joins empty script/user path + file name.
  if (norm.startsWith("/")) return norm.slice(1);
  return norm;
}

/**
 * UI-only PoB data files that headless build calculation never reads (item browser,
 * trade query, sprite sheets, flavour tooltips, world area lists). Returning empty
 * stubs avoids parsing ~2.5 MB of Lua tables and allows dropping them from the bundle.
 */
export const HEADLESS_UI_EMPTY_TABLE_FILES = new Set([
  "Data/Rares.lua",
  "Data/FlavourText.lua",
  "Data/Assets.lua",
  "Data/Skills/SkillAssets.lua",
  "Data/Essence.lua",
  "Data/ModMap.lua",
  "Data/TradeSiteStats.lua",
  "Data/QueryMods.lua",
  "Data/Uniques/Special/race.lua"
]);

export const HEADLESS_UI_NOOP_FUNC_FILES = new Set([
  "Data/WorldAreas.lua",
  "Data/Uniques/Special/New.lua"
]);

// Data/Uniques/Special/Generated.lua builds UI templates for data.uniques.generated (unused
// headless), AND as a side effect rewrites "Spectre: {0}" / "Companion: {0}" gem names on
// data.gems so Prism of Belief ("+2 to Level of all Tamed Companion Skills") matches them.
const GENERATED_UNIQUES_HEADLESS_STUB = `
data.uniques.generated = {}
local excluded = { ["Detonate Minion"] = true, ["Rhoa Mount"] = true }
for _, gemData in pairs(data.gems) do
  if not gemData.tags.support and not excluded[gemData.name] and not gemData.grantedEffect.hidden and not gemData.grantedEffect.fromItem and not gemData.grantedEffect.fromTree then
    gemData.name = gemData.name:gsub("Spectre: {0}", "Summon Spectre"):gsub("Companion: {0}", "Tamed Companion")
  end
end
`;

/** True when `vfsPath` is a UI-only PoB data file unused by headless calculation. */
export function isHeadlessUnusedDataFile(vfsPath) {
  const key = normalizeVfsPath(vfsPath);
  return HEADLESS_UI_EMPTY_TABLE_FILES.has(key)
    || HEADLESS_UI_NOOP_FUNC_FILES.has(key)
    || key === "Data/Uniques/Special/Generated.lua"
    || (key.startsWith("Data/Uniques/") && key.endsWith(".lua"));
}

/**
 * Heavy item-crafting mod tables (Data/ModItemExclusive 1.78 MB, Data/ModItem 1.02 MB,
 * etc.) that are loaded eagerly by Modules/Data.lua for the item crafter UI, but only
 * accessed in headless calculation for rare edge cases (e.g. advancedCopy uniques).
 * Loaded lazily on first access via a Lua metatable proxy so results stay 100% identical.
 */
const LAZY_ITEM_MOD_FILES = new Set([
  "Data/ModItem.lua",
  "Data/ModFlask.lua",
  "Data/ModCharm.lua",
  "Data/ModIncursionLimb.lua",
  "Data/ModJewel.lua",
  "Data/ModCorrupted.lua",
  "Data/ModItemExclusive.lua",
  "Data/ModVeiled.lua"
]);

/**
 * One-shot static data files loaded once into Lua globals during PoB startup and
 * never re-read afterwards: safe to release from the JS VFS Map after startup.
 */
const RELEASABLE_AFTER_INIT_PREFIXES = [
  "Data/Skills/",
  "Data/Bases/"
];
const RELEASABLE_AFTER_INIT_FILES = new Set([
  "Data/ModCache.lua",
  "Data/Gems.lua",
  "Data/Spectres.lua",
  "Data/Minions.lua",
  "Data/ModScalability.lua",
  "Data/SkillStatMap.lua",
  "Data/Misc.lua",
  "Data/Global.lua",
  "Data/Bosses.lua",
  "Data/BossSkills.lua",
  "Data/QuestRewards.lua",
  "Data/Costs.lua",
  "Data/ModRunes.lua",
  "__planner_calculate.lua"
]);

/**
 * Starts wasmoon, loads Path of Building headless once from `vfs`, and returns a
 * reusable calculator handle `{ calculate(xml), getMemoryStats(), close() }`.
 *
 * @param {object} options
 * @param {Map<string, string>} options.vfs  Unpacked PoB VFS map (must include `__planner_calculate.lua` unless `calculateScript` is passed)
 * @param {string} [options.calculateScript] Optional scripts/pob-calculate.lua override
 * @param {string} [options.wasmUri]         Optional explicit URL/path to wasmoon glue.wasm
 * @param {(data: string) => string} [options.inflate] Optional zlib inflate hook
 * @param {(data: string) => string} [options.deflate] Optional zlib deflate hook
 */
export async function createPobLocalEngine({ vfs, calculateScript, wasmUri, inflate, deflate }) {
  const calcSource = calculateScript || vfs.get("__planner_calculate.lua");
  if (!calcSource) {
    throw new Error("PoB VFS bundle is missing __planner_calculate.lua");
  }

  const t0 = performance.now();
  const factory = new LuaFactory(wasmUri);
  const lua = await factory.createEngine({ openStandardLibs: true });
  const vmInitMs = performance.now() - t0;

  const readDuringInit = new Set();
  // Bind VFS reader: must return `undefined` (not `null`) on miss so wasmoon pushes Lua nil.
  lua.global.set("__pob_vfs_read", (filePath) => {
    const key = normalizeVfsPath(filePath);
    if (key === "Data/Uniques/Special/Generated.lua") return GENERATED_UNIQUES_HEADLESS_STUB;
    if (HEADLESS_UI_NOOP_FUNC_FILES.has(key)) return "return function() end";
    if (HEADLESS_UI_EMPTY_TABLE_FILES.has(key) || (key.startsWith("Data/Uniques/") && key.endsWith(".lua"))) {
      return "return {}";
    }
    if (LAZY_ITEM_MOD_FILES.has(key) && vfs.has(key)) {
      return `return __pob_make_lazy_mod_table(${JSON.stringify(key)})`;
    }
    const value = vfs.get(key);
    if (value !== undefined) readDuringInit.add(key);
    return value !== undefined ? value : undefined;
  });

  // Raw VFS reader used when a lazy mod table is actually materialized on demand.
  lua.global.set("__pob_vfs_read_raw", (filePath) => {
    const key = normalizeVfsPath(filePath);
    const value = vfs.get(key);
    if (value !== undefined) vfs.delete(key);
    return value !== undefined ? value : undefined;
  });

  if (typeof inflate === "function") lua.global.set("__pob_inflate", inflate);
  if (typeof deflate === "function") lua.global.set("__pob_deflate", deflate);

  const tLoad0 = performance.now();
  try {
    await lua.doString(LUA54_POB_BOOTSTRAP);
    const persistentRunner = buildPersistentCalculateScript(calcSource);
    await lua.doString(`
      -- Keep GC tight during startup: Launch.lua sets pause=400% for LuaJIT, which on
      -- Lua 5.4 lets ~190 MB of startup garbage pile up and permanently expands WASM
      -- linear memory before startup even finishes.
      local _orig_collectgarbage = collectgarbage
      collectgarbage = function(opt, ...)
        if opt == "setpause" then return _orig_collectgarbage("incremental", 120, 200) end
        return _orig_collectgarbage(opt, ...)
      end
      _orig_collectgarbage("incremental", 120, 200)

      -- Lazy proxy for heavy Data/Mod*.lua tables: only parsed if a build accesses them.
      function __pob_make_lazy_mod_table(vfsPath)
        local real = nil
        local inDataInit = true
        local function materialize()
          if real then return real end
          local src = __pob_vfs_read_raw(vfsPath)
          real = src and assert(load(src, "@" .. vfsPath))() or {}
          -- Mirror Modules/Data.lua lines 705-717 JewelRadius prefix rewrite on demand.
          if vfsPath == "Data/ModJewel.lua" or vfsPath == "Data/ModVeiled.lua" then
            for index, value in pairs(real) do
              if (index:find("JewelRadius") or index:find("AbyssModRadiusJewel")) and value.nodeType and value[1] then
                if value.nodeType == 1 then
                  value[1] = "Small Passive Skills in Radius also grant " .. value[1]
                elseif value.nodeType == 2 then
                  value[1] = "Notable Passive Skills in Radius also grant " .. value[1]
                end
              end
            end
          end
          return real
        end
        local proxy = {}
        proxy.__pob_lazy_done_init = function() inDataInit = false end
        return setmetatable(proxy, {
          __index = function(_, k) return materialize()[k] end,
          __newindex = function(_, k, v) materialize()[k] = v end,
          __pairs = function()
            if inDataInit then return next, {}, nil end
            return pairs(materialize())
          end,
          __len = function() return #materialize() end
        })
      end

      -- HeadlessWrapper.lua startup sequence, skipping the Frame-1 LoadItems unique/rare
      -- DB coroutine (~1.2 s + ~148 MB WASM) and the initial empty "Unnamed build" Init
      -- (~0.5 s) that resetBetweenBuilds() immediately discards on the first build.
      dofile("_SimpleGraphic.def.lua")
      function GetVirtualScreenSize() return 1920, 1080 end
      __callbackTable__ = {}
      function runCallback(name, ...)
        if __callbackTable__[name] then
          return __callbackTable__[name](...)
        elseif __mainObject__ and __mainObject__[name] then
          return __mainObject__[name](__mainObject__, ...)
        end
      end
      local _l_require = require
      function require(name)
        if name == "lcurl.safe" then return end
        return _l_require(name)
      end
      dofile("Launch.lua")
      __mainObject__.continuousIntegrationMode = os.getenv("CI")
      runCallback("OnInit")
      if data and data.itemMods then
        for _, tbl in pairs(data.itemMods) do
          local done = type(tbl) == "table" and rawget(tbl, "__pob_lazy_done_init")
          if done then
            done()
            rawset(tbl, "__pob_lazy_done_init", nil)
          end
        end
      end
      if __mainObject__ and __mainObject__.main then
        local m = __mainObject__.main
        m.disableDevAutoSave = true
        if m.onFrameFuncs then m.onFrameFuncs["LoadItems"] = nil end
        m.newMode = nil
        m.newModeArgs = nil
      end
      runCallback("OnFrame")
      if __mainObject__ and __mainObject__.promptMsg then
        error("PoB startup failed: " .. tostring(__mainObject__.promptMsg))
      end
      build = __mainObject__.main.modes["BUILD"]
      function newBuild()
        if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
        __mainObject__.main:SetMode("BUILD", false, "Help, I'm stuck in Path of Building!")
        runCallback("OnFrame")
      end
      function loadBuildFromXML(xmlText, name)
        __mainObject__.main:SetMode("BUILD", false, name or "", xmlText)
        runCallback("OnFrame")
      end
      ${COPY_TABLE_SAFE_SHIM}
      if __pob_inflate then Inflate = __pob_inflate end
      if __pob_deflate then Deflate = __pob_deflate end
      ${persistentRunner}
      -- Restore collectgarbage and switch to generational GC so per-build short-lived
      -- tables are reclaimed without re-walking static data or growing WASM linear memory.
      collectgarbage = _orig_collectgarbage
      collectgarbage("collect")
      collectgarbage("incremental", 200, 200)
      collectgarbage("generational")
    `);
  } catch (error) {
    try { lua.global.close(); } catch { /* ignore */ }
    throw error;
  }
  const pobLoadMs = performance.now() - tLoad0;

  // Release static startup files that are already inside Lua and never re-read,
  // freeing ~15-20 MB of JS heap strings immediately after boot.
  for (const key of readDuringInit) {
    const isLoadedTree = key.startsWith("TreeData/") && key.endsWith("/tree.lua");
    if (
      isLoadedTree
      || RELEASABLE_AFTER_INIT_FILES.has(key)
      || RELEASABLE_AFTER_INIT_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      vfs.delete(key);
    }
  }
  vfs.delete("__planner_calculate.lua");
  readDuringInit.clear();

  const calcFn = lua.global.get("pobCalculateXml");
  const gcCountFn = await lua.doString('return function() return collectgarbage("count") end');
  const gcCollectFn = await lua.doString('return function() collectgarbage("collect"); return collectgarbage("count") end');

  // Access underlying Emscripten WASM memory buffer if exposed by wasmoon.
  const getWasmMemoryBytes = () => {
    try {
      const mod = factory.luaModule || lua.global?.lua?.module;
      const buf = mod?.HEAPU8?.buffer || mod?.wasmMemory?.buffer;
      return buf ? buf.byteLength : null;
    } catch {
      return null;
    }
  };

  let closed = false;
  return {
    timings: { vmInitMs, pobLoadMs },

    /** Runs one build XML calculation and returns the parsed JSON stats object. */
    calculate(xmlText) {
      if (closed) throw new Error("PoB local engine is closed");
      const jsonStr = calcFn(String(xmlText || ""));
      if (typeof jsonStr !== "string" || !jsonStr.startsWith("{")) {
        throw new Error("Local PoB engine returned invalid JSON output");
      }
      const parsed = JSON.parse(jsonStr);
      if (!parsed || parsed.ok !== true || !parsed.data) {
        const error = new Error(String(parsed?.error || "Calculation failed"));
        // fatal: a Lua error escaped PoB, so this VM can no longer be trusted (the server
        // pool restarts its worker in the same case). Otherwise PoB only rejected this build.
        error.fatal = parsed?.fatal === true;
        throw error;
      }
      return parsed.data;
    },

    /** Returns Lua VM memory (KB) and Emscripten WASM linear memory size (bytes). */
    getMemoryStats({ gc = false } = {}) {
      if (closed) return { luaMemoryKB: 0, wasmMemoryBytes: 0 };
      const luaMemoryKB = gc ? gcCollectFn() : gcCountFn();
      return {
        luaMemoryKB: Number(luaMemoryKB) || 0,
        wasmMemoryBytes: getWasmMemoryBytes()
      };
    },

    close() {
      if (closed) return;
      closed = true;
      try { lua.global.close(); } catch { /* ignore */ }
    }
  };
}
