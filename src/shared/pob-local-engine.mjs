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

function loadfile(filename, mode, env)
  local src = __pob_vfs_read(filename)
  if not src then return nil, "cannot open " .. tostring(filename) .. ": No such file or directory" end
  src = stripShebang(src)
  if env then return load(src, "@" .. filename, mode or "t", env) end
  return load(src, "@" .. filename, mode or "t")
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
 * Turns scripts/pob-calculate.lua (which runs once per CLI process) into a persistent
 * Lua function `pobCalculateXml(xmlText) -> jsonString` that resets per-build state
 * (GlobalCache and planner XML row counters) between calls while keeping PoB loaded.
 */
export function buildPersistentCalculateScript(calculateLuaSource) {
  const hookStart = calculateLuaSource.indexOf("-- ── Planner: remember which XML");
  const loadCall = calculateLuaSource.indexOf("loadBuildFromXML(xmlText)");
  const exitCall = calculateLuaSource.lastIndexOf("local jsonStr = dkjson.encode(cleanOutput)");
  if (hookStart < 0 || loadCall < 0 || exitCall < 0) {
    throw new Error("Could not slice scripts/pob-calculate.lua for persistent runner");
  }
  const hooks = calculateLuaSource
    .slice(hookStart, loadCall)
    .replace("local rows = {}", "__plannerXmlRows = {}\n    local rows = __plannerXmlRows");
  const body = calculateLuaSource.slice(loadCall, exitCall);
  return `
local dkjson = require("dkjson")
${hooks}
function pobCalculateXml(xmlText)
  if __plannerXmlRows then
    for k in pairs(__plannerXmlRows) do __plannerXmlRows[k] = nil end
  end
  if GlobalCache and GlobalCache.cachedData then
    wipeGlobalCache()
  end
  plannerGroupDps = nil
  ${body}
  local encoded = dkjson.encode(cleanOutput)
  collectgarbage("step", 200)
  return encoded
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

  // Bind VFS reader: must return `undefined` (not `null`) on miss so wasmoon pushes Lua nil.
  lua.global.set("__pob_vfs_read", (filePath) => {
    const key = normalizeVfsPath(filePath);
    const value = vfs.get(key);
    return value !== undefined ? value : undefined;
  });

  if (typeof inflate === "function") lua.global.set("__pob_inflate", inflate);
  if (typeof deflate === "function") lua.global.set("__pob_deflate", deflate);

  const tLoad0 = performance.now();
  try {
    await lua.doString(LUA54_POB_BOOTSTRAP);
    const persistentRunner = buildPersistentCalculateScript(calcSource);
    await lua.doString(`
      dofile("HeadlessWrapper.lua")
      if __mainObject__ and __mainObject__.promptMsg then
        error("PoB startup failed: " .. tostring(__mainObject__.promptMsg))
      end
      if __pob_inflate then Inflate = __pob_inflate end
      if __pob_deflate then Deflate = __pob_deflate end
      ${persistentRunner}
      collectgarbage("collect")
    `);
  } catch (error) {
    try { lua.global.close(); } catch { /* ignore */ }
    throw error;
  }
  const pobLoadMs = performance.now() - tLoad0;

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
      if (parsed && typeof parsed.error === "string") {
        throw new Error(parsed.error);
      }
      return parsed;
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
