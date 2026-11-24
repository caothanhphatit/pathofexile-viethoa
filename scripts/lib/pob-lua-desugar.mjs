// Desugars Path of Building PoE2's custom LuaJIT/Pluto syntax extensions
// (+=, -=, *=, /=, ..=, %=, ^=, ?., ?.[, |args| -> expr, bare continue)
// into standard Lua 5.2+ / 5.4 so upstream PoB files can be executed in
// stock PUC Lua 5.4 (wasmoon) without editing PoB's own source checkout.

/**
 * Splits a single line of Lua into alternating code and string/comment segments
 * so syntax transforms never touch string literals or comments.
 */
function splitLineSegments(line) {
  const segs = [];
  let codeStart = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "-" && line[i + 1] === "-") {
      if (i > codeStart) segs.push({ code: true, text: line.slice(codeStart, i) });
      segs.push({ code: false, text: line.slice(i) });
      return segs;
    }
    if (ch === '"' || ch === "'") {
      if (i > codeStart) segs.push({ code: true, text: line.slice(codeStart, i) });
      const quote = ch;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") { j += 2; continue; }
        if (line[j] === quote) { j++; break; }
        j++;
      }
      segs.push({ code: false, text: line.slice(i, j) });
      i = j;
      codeStart = i;
      continue;
    }
    i++;
  }
  if (codeStart < line.length) segs.push({ code: true, text: line.slice(codeStart) });
  return segs;
}

/** Replaces quoted strings with spaces and strips `--` comments for block-depth scanning. */
function maskLineForScan(line) {
  let out = "";
  for (const seg of splitLineSegments(line)) {
    if (seg.code) {
      out += seg.text;
    } else if (seg.text.startsWith("--")) {
      break;
    } else {
      out += '"' + " ".repeat(Math.max(0, seg.text.length - 2)) + '"';
    }
  }
  return out;
}

function findLoopEnd(lines, loopLine) {
  let depth = 0;
  for (let i = loopLine; i < lines.length; i++) {
    const cleaned = maskLineForScan(lines[i]);
    const tokens = cleaned.match(/\b(?:function|if|for|while|repeat|do|end|until)\b/g) || [];
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (tok === "for" || tok === "while" || tok === "if" || tok === "function" || tok === "repeat") {
        depth++;
      } else if (tok === "do") {
        const prev = tokens[t - 1];
        if (prev !== "for" && prev !== "while") depth++;
      } else if (tok === "end" || tok === "until") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function findEnclosingLoop(lines, contLine) {
  let depth = 0;
  for (let i = contLine - 1; i >= 0; i--) {
    const cleaned = maskLineForScan(lines[i]);
    const tokens = cleaned.match(/\b(?:function|if|for|while|repeat|do|end|until)\b/g) || [];
    for (let t = tokens.length - 1; t >= 0; t--) {
      const tok = tokens[t];
      if (tok === "end" || tok === "until") {
        depth++;
      } else if (tok === "for" || tok === "while") {
        if (depth === 0) return i;
        depth--;
      } else if (tok === "if" || tok === "function" || tok === "repeat") {
        depth = Math.max(0, depth - 1);
      } else if (tok === "do") {
        const prev = tokens[t - 1];
        if (prev !== "for" && prev !== "while") depth = Math.max(0, depth - 1);
      }
    }
  }
  return -1;
}

function transformCodeLine(line, lines, lineIdx, loopLabels, nextContId) {
  const segs = splitLineSegments(line);
  const strings = [];
  let comment = "";
  let code = "";
  for (const seg of segs) {
    if (seg.code) {
      code += seg.text;
    } else if (seg.text.startsWith("--")) {
      comment = seg.text;
    } else {
      const idx = strings.length;
      strings.push(seg.text);
      code += `__STR${idx}__`;
    }
  }

  let next = code;

  // 1. Pluto short lambda: `|params| -> expr` -> `function(params) return expr end`
  if (next.includes("->")) {
    next = next.replace(
      /\|([^|]*)\|\s*->\s*([^}]+?)(?=\s*(?:}|$|,(?![^(]*\))))/g,
      (_m, params, expr) => `function(${params.trim()}) return ${expr.trim()} end`
    );
  }

  // 2. Optional chaining: `expr?.[balanced]` and `expr?.prop`
  if (next.includes("?.")) {
    let idx;
    while ((idx = next.indexOf("?.[")) !== -1) {
      let start = idx - 1;
      while (start >= 0 && /[A-Za-z0-9_.]/.test(next[start])) start--;
      start++;
      const lhs = next.slice(start, idx);
      let depth = 0;
      let end = -1;
      for (let k = idx + 2; k < next.length; k++) {
        if (next[k] === "[") depth++;
        else if (next[k] === "]") {
          depth--;
          if (depth === 0) { end = k; break; }
        }
      }
      if (lhs && end > idx + 2) {
        const key = next.slice(idx + 3, end);
        next = next.slice(0, start) + `(${lhs} and ${lhs}[${key}])` + next.slice(end + 1);
      } else {
        break;
      }
    }
    next = next.replace(
      /([A-Za-z_][\w.]*)\?\.([A-Za-z_][\w.]*)/g,
      "($1 and $1.$2)"
    );
  }

  // 3. Compound assignment: `<lhs> op= <rhs>`
  if (/(?:\+=|-=|\*=|\/=|\.\.=|%=|\^=)/.test(next)) {
    next = next.replace(
      /([A-Za-z_][\w.\[\]]*)\s*(\.\.|[+\-*/%^])=\s*([^;\n]+?)(?=\s*(?:elseif\b|else\b|end\b|$))/g,
      (_m, lhs, op, rhs) => `${lhs} = ${lhs} ${op} (${rhs.trim()})`
    );
  }

  // 4. Bare `continue` -> `goto __pob_cont_N`
  if (/(?:^|[\s;])continue(?=$|[\s;])/.test(next) && !/\bgoto\s+continue\b/.test(next) && !/::\s*continue\s*::/.test(next)) {
    const loopLine = findEnclosingLoop(lines, lineIdx);
    if (loopLine >= 0) {
      const endLine = findLoopEnd(lines, loopLine);
      if (endLine >= 0) {
        let label = loopLabels.get(endLine);
        if (!label) {
          label = `__pob_cont_${nextContId()}`;
          loopLabels.set(endLine, label);
        }
        next = next.replace(/(^|[\s;])continue(?=$|[\s;])/, `$1goto ${label}`);
      }
    }
  }

  if (next === code) return null;
  const restored = next.replace(/__STR(\d+)__/g, (_, i) => strings[Number(i)]);
  return restored + comment;
}

/**
 * Desugars PoB's LuaJIT/Pluto extensions into standard Lua 5.4 syntax.
 * Also neutralizes `local _ENV = nil` in PoB's forked dkjson.lua, which uses
 * global `table.sort` inside sortedkeys (ignored by LuaJIT's Lua 5.1 semantics
 * but fatal in Lua 5.2+/5.4).
 */
export function desugarPobLua(source) {
  let text = source;
  if (text.includes("local _ENV = nil")) {
    text = text.replace(/\blocal _ENV = nil\b/g, "-- local _ENV = nil (Lua 5.1 compat)");
  }
  if (!/(?:\+=|-=|\*=|\/=|\.\.=|%=|\^=|\?\.|->|\bcontinue\b)/.test(text)) return text;

  const lines = text.split("\n");
  let changed = false;
  let continueCounter = 0;
  const loopLabels = new Map();
  const nextContId = () => ++continueCounter;

  let longBracketDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const hasCR = raw.endsWith("\r");
    const line = hasCR ? raw.slice(0, -1) : raw;

    if (longBracketDepth >= 0) {
      const closer = "]" + "=".repeat(longBracketDepth) + "]";
      if (line.includes(closer)) longBracketDepth = -1;
      continue;
    }
    const openMatch = line.match(/\[(=*)\[/);
    if (openMatch) {
      const closer = "]" + openMatch[1] + "]";
      if (!line.includes(closer, openMatch.index + openMatch[0].length)) {
        longBracketDepth = openMatch[1].length;
        continue;
      }
    }

    const transformed = transformCodeLine(line, lines, i, loopLabels, nextContId);
    if (transformed !== null) {
      lines[i] = transformed + (hasCR ? "\r" : "");
      changed = true;
    }
  }

  for (const [endLine, label] of loopLabels.entries()) {
    const raw = lines[endLine];
    const hasCR = raw.endsWith("\r");
    const line = hasCR ? raw.slice(0, -1) : raw;
    lines[endLine] = line.replace(/^(\s*)(end\b)/, `$1::${label}:: $2`) + (hasCR ? "\r" : "");
    changed = true;
  }

  return changed ? lines.join("\n") : text;
}
