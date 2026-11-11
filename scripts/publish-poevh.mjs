// Copies the release POEVH.exe into public/downloads/poevh/ and writes the
// latest.json manifest that the /tai-app page reads.
//
//   npm run poevh:build
//   npm run poevh:publish -- --notes "Thêm Premium|Sửa lỗi price-check"
//
// Options: --exe=<path> (default: the cargo release output), --version=<x.y.z>
// (default: the poe2-bot crate version plus the build date), --notes="a|b|c".
// Both files are generated and gitignored; deploy them together with public/.
import crypto from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

const exe = resolve(args.exe || join(root, "apps/poevh-desktop/target/release/POEVH.exe"));
const outDir = join(root, "public/downloads/poevh");

const info = await stat(exe).catch(() => null);
if (!info?.isFile()) {
  console.error(`No exe at ${exe}. Run "npm run poevh:build" first.`);
  process.exit(1);
}

const cargo = await readFile(join(root, "apps/poevh-desktop/crates/poe2-bot/Cargo.toml"), "utf8");
const crateVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] || "0.0.0";
const built = info.mtime;
const stamp = built.toISOString().slice(0, 10).replace(/-/g, "");
const version = typeof args.version === "string" ? args.version : `${crateVersion}+${stamp}`;
if (!/^[\w.+-]+$/.test(version)) {
  console.error(`Version "${version}" may only use letters, digits, ".", "+", "-" and "_".`);
  process.exit(1);
}

const bytes = await readFile(exe);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
const file = `POEVH-${version.replace(/\+/g, "-")}.exe`;

await mkdir(outDir, { recursive: true });
// Keep only the build being published, so old exes do not pile up in public/.
for (const name of await readdir(outDir)) {
  if (/^POEVH-.*\.exe$/i.test(name) && name !== file) await rm(join(outDir, name));
}
await copyFile(exe, join(outDir, file));

const notes = typeof args.notes === "string" ? args.notes.split("|").map((note) => note.trim()).filter(Boolean) : [];
const manifest = {
  version,
  file,
  size: bytes.length,
  sha256,
  publishedAt: new Date().toISOString(),
  builtAt: built.toISOString(),
  notes
};
await writeFile(join(outDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Published ${file} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`SHA-256 ${sha256}`);
console.log(`Manifest public/downloads/poevh/latest.json`);
