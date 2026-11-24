// Reads Path of Building's generated Lua data files (src/Data/*.lua) under Node,
// without a Lua runtime: the files are table literals, so a small table-literal
// parser is enough. Used by scripts/build-item-mod-pool.mjs.
import fs from "node:fs";
import path from "node:path";

/**
 * Parses one Lua value (table literal, string, number, boolean, nil) starting at
 * `pos`; returns [value, nextPos]. A table with only positional values becomes an
 * array; otherwise an object whose positional values sit under 1, 2, 3...
 */
export function parseLuaValue(source, pos = 0) {
  pos = skipSpace(source, pos);
  const ch = source[pos];
  if (ch === "{") return parseTable(source, pos);
  if (ch === '"' || ch === "'") return parseString(source, pos);
  const word = /^(-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[-+]?\d+)?)|true|false|nil)/.exec(source.slice(pos, pos + 40));
  if (!word) throw new Error(`Unexpected Lua at ${pos}: ${JSON.stringify(source.slice(pos, pos + 40))}`);
  const text = word[1];
  const value = text === "true" ? true : text === "false" ? false : text === "nil" ? null : Number(text);
  return [value, pos + text.length];
}

function skipSpace(source, pos) {
  for (;;) {
    while (pos < source.length && /\s/.test(source[pos])) pos += 1;
    if (source.startsWith("--", pos)) {
      const end = source.indexOf("\n", pos);
      pos = end < 0 ? source.length : end;
    } else return pos;
  }
}

function parseString(source, pos) {
  const quote = source[pos];
  let out = "";
  pos += 1;
  while (source[pos] !== quote) {
    if (pos >= source.length) throw new Error("Unterminated Lua string");
    if (source[pos] === "\\") {
      const next = source[pos + 1];
      out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      pos += 2;
    } else {
      out += source[pos];
      pos += 1;
    }
  }
  return [out, pos + 1];
}

function parseTable(source, pos) {
  const named = {};
  const list = [];
  let hasNamed = false;
  pos += 1;
  for (;;) {
    pos = skipSpace(source, pos);
    if (source[pos] === "}") return [hasNamed ? Object.assign(named, Object.fromEntries(list.map((value, index) => [index + 1, value]))) : list, pos + 1];
    let key = null;
    if (source[pos] === "[") {
      const [value, next] = parseLuaValue(source, pos + 1);
      pos = skipSpace(source, next);
      if (source[pos] !== "]") throw new Error(`Expected ] at ${pos}`);
      pos = skipSpace(source, pos + 1);
      if (source[pos] !== "=") throw new Error(`Expected = at ${pos}`);
      pos += 1;
      key = String(value);
    } else {
      const ident = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(source.slice(pos, pos + 80));
      if (ident) {
        key = ident[1];
        pos += ident[0].length;
      }
    }
    const [value, next] = parseLuaValue(source, pos);
    if (key === null) list.push(value);
    else {
      named[key] = value;
      hasNamed = true;
    }
    pos = skipSpace(source, next);
    if (source[pos] === "," || source[pos] === ";") pos += 1;
  }
}

/** Positional string values of a parsed mod table (its stat lines), in order. */
export const positional = (table) => {
  if (Array.isArray(table)) return table;
  const out = [];
  for (let index = 1; table[index] !== undefined; index += 1) out.push(table[index]);
  return out;
};

/** A "return { ["Id"] = {...}, ... }" mod file -> { Id: table }. */
export function readModFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("return {");
  if (start < 0) throw new Error(`No "return {" in ${file}`);
  const [table] = parseLuaValue(source, start + "return ".length);
  return table;
}

/** A Bases/*.lua file (itemBases["Name"] = {...} blocks) -> { Name: table }. */
export function readBaseFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const bases = {};
  const entry = /^itemBases\["([^"]+)"\]\s*=\s*/gm;
  let match;
  while ((match = entry.exec(source))) {
    const [table] = parseLuaValue(source, match.index + match[0].length);
    bases[match[1]] = table;
  }
  return bases;
}

/** Every base of src/Data/Bases, as { name: table }. */
export function readAllBases(pobDir) {
  const dir = path.join(pobDir, "src", "Data", "Bases");
  const bases = {};
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".lua")).sort()) Object.assign(bases, readBaseFile(path.join(dir, file)));
  return bases;
}
