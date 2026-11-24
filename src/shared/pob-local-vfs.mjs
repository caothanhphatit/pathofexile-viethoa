// Binary pack/unpack for the PoB virtual filesystem bundle.
// Pure Web-standard JS (Uint8Array, DataView, TextEncoder/TextDecoder) so it runs
// identically in Node.js (bundle builder + tests) and in the browser Web Worker.
//
// Format (little-endian):
//   [4 bytes]  magic "POBV" (0x50 0x4F 0x42 0x56)
//   [4 bytes]  uint32 format version (1)
//   [4 bytes]  uint32 file count
//   Repeated `fileCount` times:
//     [2 bytes]  uint16 UTF-8 path byte length
//     [N bytes]  UTF-8 path (forward slashes, relative to PoB src/, e.g. "Modules/Main.lua" or "../runtime/lua/dkjson.lua")
//     [4 bytes]  uint32 UTF-8 content byte length
//     [M bytes]  UTF-8 content

const MAGIC = 0x56424f50; // "POBV" in little-endian
const FORMAT_VERSION = 1;

/**
 * Packs an array of `[path, content]` string pairs into a single Uint8Array.
 * @param {Array<[string, string]>} entries
 * @returns {Uint8Array}
 */
export function packPobVfs(entries) {
  const encoder = new TextEncoder();
  const encoded = entries.map(([relPath, text]) => [
    encoder.encode(relPath),
    encoder.encode(text)
  ]);

  let totalBytes = 12;
  for (const [pathBytes, dataBytes] of encoded) {
    if (pathBytes.length > 0xffff) {
      throw new Error(`VFS path too long (${pathBytes.length} bytes)`);
    }
    totalBytes += 2 + pathBytes.length + 4 + dataBytes.length;
  }

  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, encoded.length, true);

  let offset = 12;
  for (const [pathBytes, dataBytes] of encoded) {
    view.setUint16(offset, pathBytes.length, true);
    offset += 2;
    out.set(pathBytes, offset);
    offset += pathBytes.length;
    view.setUint32(offset, dataBytes.length, true);
    offset += 4;
    out.set(dataBytes, offset);
    offset += dataBytes.length;
  }

  return out;
}

/**
 * Unpacks a Uint8Array created by `packPobVfs` into a Map<path, content>.
 * @param {Uint8Array} bytes
 * @returns {Map<string, string>}
 */
export function unpackPobVfs(bytes) {
  if (bytes.byteLength < 12) throw new Error("PoB VFS bundle is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("Invalid PoB VFS bundle header");
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) throw new Error(`Unsupported PoB VFS bundle version: ${version}`);
  const count = view.getUint32(8, true);

  const decoder = new TextDecoder("utf-8");
  const files = new Map();
  let offset = 12;
  for (let i = 0; i < count; i += 1) {
    if (offset + 2 > bytes.byteLength) throw new Error("PoB VFS bundle ended unexpectedly");
    const pathLen = view.getUint16(offset, true);
    offset += 2;
    const relPath = decoder.decode(bytes.subarray(offset, offset + pathLen));
    offset += pathLen;
    if (offset + 4 > bytes.byteLength) throw new Error("PoB VFS bundle ended unexpectedly");
    const dataLen = view.getUint32(offset, true);
    offset += 4;
    const content = decoder.decode(bytes.subarray(offset, offset + dataLen));
    offset += dataLen;
    files.set(relPath, content);
  }
  return files;
}
