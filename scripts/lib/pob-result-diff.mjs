// Deep comparison of two PoB calculation results (server LuaJIT vs local Lua 5.4/WASM).
//
// Both engines do the same IEEE-754 double arithmetic, so results are expected to be
// identical. The one allowed difference is the last bits of a double: LuaJIT's VM computes
// x^y (and folds constants) with its own routines, while PUC Lua calls C pow(); the two can
// differ by 1 ulp, which then shows in the 15th-17th significant digit. REL_TOLERANCE covers
// exactly that and nothing a player could see.
export const REL_TOLERANCE = 1e-9;

export function compareResults(a, b, { rel = REL_TOLERANCE } = {}) {
  const mismatches = [];
  let compared = 0;
  let maxRel = 0;
  const walk = (x, y, path) => {
    if (typeof x === "number" && typeof y === "number") {
      compared += 1;
      if (x === y || (Number.isNaN(x) && Number.isNaN(y))) return;
      const diff = Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-300);
      if (diff > maxRel) maxRel = diff;
      if (diff > rel) mismatches.push({ path, a: x, b: y });
      return;
    }
    if (x && y && typeof x === "object" && typeof y === "object") {
      if (Array.isArray(x) !== Array.isArray(y)) { mismatches.push({ path, a: x, b: y }); return; }
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const next = path ? `${path}.${key}` : key;
        if (!(key in x) || !(key in y)) { compared += 1; mismatches.push({ path: next, a: x[key], b: y[key] }); continue; }
        walk(x[key], y[key], next);
      }
      return;
    }
    compared += 1;
    if (x !== y) mismatches.push({ path, a: x, b: y });
  };
  walk(a, b, "");
  return { compared, mismatches, maxRel };
}
