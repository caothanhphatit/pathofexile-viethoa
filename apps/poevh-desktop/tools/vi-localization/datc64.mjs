import fs from "node:fs";

const MARKER = Buffer.alloc(8, 0xbb);
const SIZE = { bool: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, i64: 8, u64: 8, string: 8, row: 8, foreignrow: 16, enumrow: 4, array: 16 };

export function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

/** validFor: 1 = PoE1 only, 2 = PoE2 only, 3 = both */
export function tableSchema(schema, name, game = 2) {
  const matches = schema.tables.filter((t) => t.name.toLowerCase() === name.toLowerCase() && (t.validFor & game));
  if (!matches.length) throw new Error(`No schema for ${name}`);
  return matches[0];
}

export function columnLayout(table) {
  let offset = 0;
  return table.columns.map((c, i) => {
    const width = c.array ? SIZE.array : SIZE[c.type] ?? (() => { throw new Error(`unknown type ${c.type}`); })();
    const col = { index: i, name: c.name || `col${i}`, type: c.type, array: Boolean(c.array), offset, width };
    offset += width;
    return col;
  });
}

function readString(buf, dataStart, rel) {
  let p = dataStart + Number(rel);
  const start = p;
  while (p + 3 < buf.length && !(buf[p] === 0 && buf[p + 1] === 0 && buf[p + 2] === 0 && buf[p + 3] === 0)) p += 2;
  return buf.subarray(start, p).toString("utf16le");
}

export function parse(buf, table) {
  const rowCount = buf.readUInt32LE(0);
  const dataStart = buf.indexOf(MARKER, 4);
  if (dataStart < 0) throw new Error("marker missing");
  const rowWidth = rowCount ? (dataStart - 4) / rowCount : 0;
  const layout = columnLayout(table);
  const expected = layout.reduce((s, c) => s + c.width, 0);
  if (rowCount && rowWidth !== expected) throw new Error(`${table.name}: row width ${rowWidth} != schema ${expected}`);
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const base = 4 + r * rowWidth;
    const row = { _row: r };
    for (const c of layout) {
      const o = base + c.offset;
      if (c.array) { row[c.name] = { count: Number(buf.readBigUInt64LE(o)), offset: Number(buf.readBigUInt64LE(o + 8)) }; continue; }
      switch (c.type) {
        case "bool": row[c.name] = buf[o] === 1; break;
        case "i32": row[c.name] = buf.readInt32LE(o); break;
        case "u32": case "enumrow": row[c.name] = buf.readUInt32LE(o); break;
        case "i16": row[c.name] = buf.readInt16LE(o); break;
        case "u16": row[c.name] = buf.readUInt16LE(o); break;
        case "f32": row[c.name] = buf.readFloatLE(o); break;
        case "string": row[c.name] = readString(buf, dataStart, buf.readBigUInt64LE(o)); break;
        case "row": { const v = buf.readBigUInt64LE(o); row[c.name] = v === 0xfefefefefefefefen ? null : Number(v); break; }
        case "foreignrow": { const v = buf.readBigUInt64LE(o); row[c.name] = v === 0xfefefefefefefefen ? null : Number(v); break; }
        default: row[c.name] = buf.readBigUInt64LE(o);
      }
    }
    rows.push(row);
  }
  return { rowCount, rowWidth, dataStart, layout, rows };
}

/**
 * Rewrite string cells: edits = [{ row, column, value }]. Fixed rows are kept
 * byte-identical except the 8-byte offsets of edited cells; new strings are
 * appended to the variable section so untouched offsets remain valid.
 */
export function rewriteStrings(buf, table, edits) {
  const { dataStart, rowWidth, layout } = parse(buf, table);
  const out = Buffer.from(buf);
  const tail = [];
  let appendAt = buf.length - dataStart;
  for (const e of edits) {
    const col = layout.find((c) => c.name === e.column);
    if (!col || col.type !== "string" || col.array) throw new Error(`not a string column: ${e.column}`);
    const bytes = Buffer.concat([Buffer.from(String(e.value), "utf16le"), Buffer.alloc(4)]);
    out.writeBigUInt64LE(BigInt(appendAt), 4 + e.row * rowWidth + col.offset);
    tail.push(bytes);
    appendAt += bytes.length;
  }
  return Buffer.concat([out, ...tail]);
}
