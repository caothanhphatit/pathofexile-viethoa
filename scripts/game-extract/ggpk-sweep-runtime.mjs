import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_GAME_PATH,
  DEFAULT_POB_PATH,
  hashJson
} from "./runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_OOZ_TOOLS_DIR = path.join(ROOT_DIR, ".codex_tmp", "ooz", "release");
export const DEFAULT_GGPK_SWEEP_OUTPUT_DIR = path.join(ROOT_DIR, "data", "game-extract", "ggpk", "pob-sweep");

const nowIso = () => new Date().toISOString();
const normalizeSlash = (value = "") => String(value).replace(/\\/g, "/");
const resolveRepoPath = (value) => path.isAbsolute(value || "") ? value : path.resolve(ROOT_DIR, value || "");
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const braceBlockAt = (text, openIndex) => {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, index + 1);
    }
  }
  return "";
};

const luaStringValues = (block) => [...block.matchAll(/"((?:\\.|[^"])*)"/g)]
  .map((match) => match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));

export const extractLuaArrayStrings = (text, variableName) => {
  const matches = [...text.matchAll(new RegExp(`local\\s+${variableName}\\s*=\\s*\\{`, "g"))];
  const arrays = matches.map((match) => {
    const openIndex = match.index + match[0].lastIndexOf("{");
    return luaStringValues(braceBlockAt(text, openIndex));
  });
  return arrays.sort((a, b) => b.length - a.length)[0] || [];
};

export const parsePobNeededFiles = (luaText) => {
  const datTables = uniqueSorted(extractLuaArrayStrings(luaText, "datFiles"));
  const csdPatterns = uniqueSorted(extractLuaArrayStrings(luaText, "csdFiles"));
  const otPatterns = uniqueSorted(extractLuaArrayStrings(luaText, "otFiles"));
  const itemFiles = uniqueSorted(extractLuaArrayStrings(luaText, "itFiles"));
  const datFiles = datTables.map((file) => `${file}c64`);
  return {
    dat_tables: datTables,
    direct_files: uniqueSorted([...datFiles, ...itemFiles]),
    regex_patterns: uniqueSorted([...csdPatterns, ...otPatterns]),
    groups: {
      datc64: datFiles.length,
      item_templates: itemFiles.length,
      stat_descriptions: csdPatterns.length,
      object_templates: otPatterns.length
    }
  };
};

export const buildPobGgpkSweepManifest = async ({
  pobPath = DEFAULT_POB_PATH
} = {}) => {
  const resolvedPobPath = resolveRepoPath(pobPath);
  const ggpkDataPath = path.join(resolvedPobPath, "src", "Export", "Classes", "GGPKData.lua");
  const luaText = await fs.readFile(ggpkDataPath, "utf8");
  const parsed = parsePobNeededFiles(luaText);
  const manifest = {
    generated_at: nowIso(),
    source: {
      kind: "pob_ggpk_sweep",
      pob_path: normalizeSlash(resolvedPobPath),
      ggpk_data_lua: normalizeSlash(path.relative(resolvedPobPath, ggpkDataPath))
    },
    direct: {
      files: parsed.direct_files
    },
    regex: {
      patterns: parsed.regex_patterns
    },
    dat_tables: parsed.dat_tables,
    groups: parsed.groups,
    summary: {
      dat_tables: parsed.dat_tables.length,
      direct_files: parsed.direct_files.length,
      regex_patterns: parsed.regex_patterns.length,
      total_extract_specs: parsed.direct_files.length + parsed.regex_patterns.length
    }
  };
  return {
    ...manifest,
    manifest_hash: hashJson({
      direct: manifest.direct.files,
      regex: manifest.regex.patterns,
      dat_tables: manifest.dat_tables
    })
  };
};

export const validateOozToolDir = async (toolsDir = DEFAULT_OOZ_TOOLS_DIR) => {
  const resolvedToolsDir = resolveRepoPath(toolsDir);
  const names = ["bun_extract_file.exe", "libbun.dll", "libooz.dll"];
  const files = await Promise.all(names.map(async (name) => {
    const filePath = path.join(resolvedToolsDir, name);
    return {
      name,
      path: filePath,
      exists: await exists(filePath)
    };
  }));
  const bunExtract = files.find((file) => file.name === "bun_extract_file.exe");
  return {
    dir: resolvedToolsDir,
    ready: files.every((file) => file.exists),
    bun_extract_file: bunExtract,
    files
  };
};

export const writeSweepManifest = async (manifest, {
  outputDir = DEFAULT_GGPK_SWEEP_OUTPUT_DIR
} = {}) => {
  const resolvedOutput = path.resolve(outputDir);
  await fs.mkdir(resolvedOutput, { recursive: true });
  const manifestPath = path.join(resolvedOutput, "sweep-manifest.json");
  const directListPath = path.join(resolvedOutput, "extract-direct.txt");
  const regexListPath = path.join(resolvedOutput, "extract-regex.txt");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(directListPath, `${manifest.direct.files.map((file) => file.toLowerCase()).join("\n")}\n`, "utf8");
  await fs.writeFile(regexListPath, `${manifest.regex.patterns.map((pattern) => pattern.toLowerCase()).join("\n")}\n`, "utf8");
  return {
    outputDir: resolvedOutput,
    manifestPath,
    directListPath,
    regexListPath
  };
};

export const resolveGgpkSource = ({
  ggpkPath,
  gamePath = DEFAULT_GAME_PATH
} = {}) => {
  if (ggpkPath) return path.resolve(ggpkPath);
  const resolvedGamePath = path.resolve(gamePath);
  return /\.ggpk$/i.test(resolvedGamePath) ? resolvedGamePath : path.join(resolvedGamePath, "Content.ggpk");
};

const runProcess = (command, args, {
  cwd,
  input = "",
  timeoutMs = 0
} = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let timeout = null;
  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);
  }
  child.stdout.on("data", (chunk) => {
    stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
  });
  child.stderr.on("data", (chunk) => {
    stderr = Buffer.concat([stderr, Buffer.from(chunk)]);
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (timeout) clearTimeout(timeout);
    const result = {
      code,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8")
    };
    if (code === 0) resolve(result);
    else {
      const error = new Error(`Command failed (${code}): ${command} ${args.join(" ")}`);
      error.result = result;
      reject(error);
    }
  });
  if (input) child.stdin.write(input);
  child.stdin.end();
});

const listExtractedFiles = async (dir) => {
  const files = [];
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else files.push(normalizeSlash(path.relative(dir, fullPath)));
    }
  };
  if (await exists(dir)) await walk(dir);
  return uniqueSorted(files);
};

export const runGgpkSweep = async ({
  pobPath = DEFAULT_POB_PATH,
  gamePath = DEFAULT_GAME_PATH,
  ggpkPath = "",
  toolsDir = DEFAULT_OOZ_TOOLS_DIR,
  outputDir = DEFAULT_GGPK_SWEEP_OUTPUT_DIR,
  dryRun = false,
  listFiles = false,
  timeoutMs = 0
} = {}) => {
  const manifest = await buildPobGgpkSweepManifest({ pobPath });
  const output = await writeSweepManifest(manifest, { outputDir });
  const tools = await validateOozToolDir(toolsDir);
  const sourcePath = resolveGgpkSource({ ggpkPath, gamePath });
  const extractDir = path.join(output.outputDir, "files");
  const fileListPath = path.join(output.outputDir, "ggpk-file-list.log");
  const sourceExists = await exists(sourcePath);
  const summary = {
    mode: dryRun ? "dry-run" : "extract",
    source: {
      ggpk_path: sourcePath,
      exists: sourceExists
    },
    tools,
    manifest: {
      hash: manifest.manifest_hash,
      dat_tables: manifest.summary.dat_tables,
      direct_files: manifest.summary.direct_files,
      regex_patterns: manifest.summary.regex_patterns,
      total_extract_specs: manifest.summary.total_extract_specs
    },
    output: {
      dir: output.outputDir,
      manifest: output.manifestPath,
      direct_list: output.directListPath,
      regex_list: output.regexListPath,
      extract_dir: extractDir,
      file_list: listFiles ? fileListPath : ""
    },
    extract: {
      direct_exit_code: null,
      regex_exit_code: null,
      files: 0,
      sample_files: []
    }
  };

  if (dryRun) return summary;
  if (!sourceExists) throw new Error(`GGPK source not found: ${sourcePath}`);
  if (!tools.ready) throw new Error(`OOZ tools are missing in ${tools.dir}`);

  await fs.mkdir(extractDir, { recursive: true });

  if (listFiles) {
    const listed = await runProcess(tools.bun_extract_file.path, ["list-files", sourcePath], {
      cwd: tools.dir,
      timeoutMs
    });
    await fs.writeFile(fileListPath, listed.stdout, "utf8");
  }

  const direct = await runProcess(tools.bun_extract_file.path, ["extract-files", sourcePath, extractDir], {
    cwd: tools.dir,
    input: `${manifest.direct.files.map((file) => file.toLowerCase()).join("\n")}\n`,
    timeoutMs
  });
  const regex = await runProcess(tools.bun_extract_file.path, ["extract-files", "--regex", sourcePath, extractDir], {
    cwd: tools.dir,
    input: `${manifest.regex.patterns.map((pattern) => pattern.toLowerCase()).join("\n")}\n`,
    timeoutMs
  });
  const extractedFiles = await listExtractedFiles(extractDir);
  return {
    ...summary,
    extract: {
      direct_exit_code: direct.code,
      regex_exit_code: regex.code,
      files: extractedFiles.length,
      sample_files: extractedFiles.slice(0, 20)
    }
  };
};
