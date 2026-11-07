import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const nowIso = () => new Date().toISOString();

export const parseEnteredZone = (line = "") => {
  const sceneSource = String(line).match(/\[SCENE\]\s+Set Source\s+\[(.+?)\]\s*$/i);
  if (sceneSource?.[1] && !/^\((null|unknown)\)$/i.test(sceneSource[1])) return sceneSource[1].trim();

  const entered = String(line).match(/\bYou have entered\s+(.+?)\.\s*$/i);
  if (entered?.[1]) return entered[1].trim();

  const entering = String(line).match(/\bEntering area\s+['"]?(.+?)(?:['"]?\.|\s+with\s+|\s+\(|\s+\[|$)/i);
  if (entering?.[1]) return entering[1].trim();

  return null;
};

export const parseLogEvent = (line = "") => {
  const text = String(line || "");
  const zoneName = parseEnteredZone(text);
  if (zoneName) return { type: "zone", zoneName };

  const characterLevel = text.match(/\]\s*:?\s*(.+?)\s+\(([^)]+)\)\s+is now level\s+(\d+)\b/i);
  if (characterLevel?.[1]) {
    return {
      type: "level",
      characterName: characterLevel[1].trim(),
      characterClass: characterLevel[2].trim(),
      level: Number(characterLevel[3])
    };
  }

  const level = text.match(/\]\s*:?\s*.+?\bis now level\s+(\d+)\b/i);
  if (level?.[1]) return { type: "level", level: Number(level[1]) };

  const dialogue = text.includes(" 3ef232c2 ")
    ? text.match(/\]\s+([^:\[][^:]{1,80}):\s+(.+)$/)
    : null;
  if (dialogue?.[1] && dialogue?.[2]) {
    return {
      type: "dialogue",
      speaker: dialogue[1].trim(),
      text: dialogue[2].trim()
    };
  }

  return null;
};

export const defaultClientLogCandidates = (env = process.env) => {
  const home = env.USERPROFILE || env.HOME || "";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  return [
    env.POE2_CLIENT_LOG_PATH,
    join(programFilesX86, "Grinding Gear Games", "Path of Exile 2", "logs", "Client.txt"),
    join(programFilesX86, "Grinding Gear Games", "Path of Exile 2", "logs"),
    join(programFiles, "Grinding Gear Games", "Path of Exile 2", "logs", "Client.txt"),
    join(programFiles, "Grinding Gear Games", "Path of Exile 2", "logs"),
    home ? join(home, "Documents", "My Games", "Path of Exile 2", "logs", "Client.txt") : "",
    home ? join(home, "Documents", "My Games", "Path of Exile 2", "logs") : "",
    home ? join(home, "OneDrive", "Documents", "My Games", "Path of Exile 2", "logs", "Client.txt") : ""
  ].filter(Boolean);
};

// The watcher streams every line it reads, so it may only ever open the game's own log
// files. A directory is fine (Client.txt / LatestClient.txt inside it are tried below);
// any other file name is refused.
const LOG_FILE_NAME = /^(?:Latest|Kakao)?Client\.txt$/i;

const isAllowedLogPath = (candidate) =>
  Boolean(candidate) && typeof candidate === "string" && !candidate.includes("\0");

const isAllowedLogFile = (filePath) => LOG_FILE_NAME.test(basename(filePath));

const findReadableLogPath = async (candidates) => {
  for (const candidate of candidates) {
    if (!isAllowedLogPath(candidate)) continue;
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        if (isAllowedLogFile(candidate)) return candidate;
        continue;
      }
      if (info.isDirectory()) {
        const clientPath = join(candidate, "Client.txt");
        const latestPath = join(candidate, "LatestClient.txt");
        try {
          const clientInfo = await stat(clientPath);
          if (clientInfo.isFile()) return clientPath;
        } catch {
          // Try LatestClient.txt below.
        }
        try {
          const latestInfo = await stat(latestPath);
          if (latestInfo.isFile()) return latestPath;
        } catch {
          // Keep trying other candidates.
        }
      }
    } catch {
      // Keep trying the next common install path.
    }
  }
  return null;
};

const readTail = async (filePath, maxBytes = 128 * 1024) => {
  const info = await stat(filePath);
  const start = Math.max(0, info.size - maxBytes);
  const length = info.size - start;
  if (!length) return { text: "", size: info.size };

  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, start);
    return { text: buffer.toString("utf8"), size: info.size };
  } finally {
    await file.close();
  }
};

const fileIdentity = (info) => `${info.dev}:${info.ino}:${info.birthtimeMs}`;

export class Poe2LogWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pollIntervalMs = options.pollIntervalMs || 1000;
    this.env = options.env || process.env;
    this.configuredPath = options.path || this.env.POE2_CLIENT_LOG_PATH || "";
    this.activePath = "";
    this.position = 0;
    this.timer = null;
    this.eventSeq = 0;
    this.maxRecentEvents = options.maxRecentEvents || 200;
    this.state = {
      watching: false,
      configuredPath: this.configuredPath || null,
      activePath: null,
      exists: false,
      zoneName: null,
      characterName: null,
      characterClass: null,
      characterLevel: null,
      characterUpdatedAt: null,
      enteredAt: null,
      lastLineAt: null,
      updatedAt: null,
      error: null,
      bytesRead: 0,
      recentEvents: []
    };
  }

  status() {
    return { ...this.state };
  }

  async configure(filePath = "") {
    this.configuredPath = String(filePath || "").trim();
    this.state.configuredPath = this.configuredPath || null;
    await this.start();
    return this.status();
  }

  async start() {
    this.stopPolling();

    const activePath = this.configuredPath
      ? await findReadableLogPath([this.configuredPath])
      : await findReadableLogPath(defaultClientLogCandidates(this.env));

    if (!activePath) {
      this.activePath = "";
      this.position = 0;
      this.state = {
        ...this.state,
        watching: false,
        activePath: null,
        exists: false,
        updatedAt: nowIso(),
        error: "Client.txt not found"
      };
      // The game may simply not have been started (or installed) yet: look again later
      // instead of giving up until someone reconfigures the watcher.
      this.timer = setInterval(() => {
        if (this.polling) return;
        this.polling = true;
        this.start().catch((error) => this.setError(error)).finally(() => {
          this.polling = false;
        });
      }, Math.max(this.pollIntervalMs, 5000));
      this.emit("status", this.status());
      return this.status();
    }

    this.activePath = activePath;
    await this.readInitialTail();
    this.state = {
      ...this.state,
      watching: true,
      activePath,
      exists: true,
      updatedAt: nowIso(),
      error: null
    };
    // A failed poll (log rotated, file briefly locked, game reinstalled) is reported but
    // keeps the timer running, so watching resumes on its own once the file is back.
    // Polls never overlap: a slow read just skips the ticks that land during it.
    this.timer = setInterval(() => {
      if (this.polling) return;
      this.polling = true;
      this.poll()
        .then(() => this.clearError())
        .catch((error) => this.setError(error))
        .finally(() => {
          this.polling = false;
        });
    }, this.pollIntervalMs);
    this.emit("status", this.status());
    return this.status();
  }

  clearError() {
    if (!this.state.error) return;
    this.state = { ...this.state, watching: true, exists: true, updatedAt: nowIso(), error: null };
    this.emit("status", this.status());
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state.watching = false;
  }

  stop() {
    this.stopPolling();
    this.emit("status", this.status());
  }

  async readInitialTail() {
    const { text, size } = await readTail(this.activePath);
    this.fileId = fileIdentity(await stat(this.activePath));
    this.position = size;
    for (const line of text.split(/\r?\n/)) this.applyLine(line);
    this.state.bytesRead = size;
  }

  async poll() {
    if (!this.activePath) return;
    const info = await stat(this.activePath);
    // A different file at the same path (deleted and recreated, or rotated) starts over
    // from the top, even when it has already grown past the old read position.
    const fileId = fileIdentity(info);
    if (this.fileId && fileId !== this.fileId) this.position = 0;
    this.fileId = fileId;
    if (info.size < this.position) this.position = 0;
    if (info.size === this.position) return;

    let text = "";
    const stream = createReadStream(this.activePath, {
      start: this.position,
      end: info.size - 1,
      encoding: "utf8"
    });
    for await (const chunk of stream) text += chunk;
    this.position = info.size;
    this.state.bytesRead = info.size;
    this.state.lastLineAt = nowIso();
    this.state.updatedAt = this.state.lastLineAt;
    for (const line of text.split(/\r?\n/)) this.applyLine(line);
    this.emit("status", this.status());
  }

  applyLine(line) {
    const event = parseLogEvent(line);
    if (!event) return;

    const eventAt = nowIso();
    const nextEvent = {
      id: ++this.eventSeq,
      at: eventAt,
      ...event
    };
    const recentEvents = [...this.state.recentEvents, nextEvent].slice(-this.maxRecentEvents);
    const nextState = {
      ...this.state,
      recentEvents,
      lastLineAt: eventAt,
      updatedAt: eventAt,
      error: null
    };

    if (event.type === "zone") {
      nextState.zoneName = event.zoneName;
      nextState.enteredAt = eventAt;
    }
    if (event.type === "level") {
      nextState.characterLevel = event.level;
      nextState.characterUpdatedAt = eventAt;
      if (event.characterName) nextState.characterName = event.characterName;
      if (event.characterClass) nextState.characterClass = event.characterClass;
    }

    this.state = nextState;
    this.emit("event", nextEvent, this.status());
    if (event.type === "zone") this.emit("zone", this.status());
  }

  setError(error) {
    const message = error?.message || String(error);
    const changed = this.state.error !== message;
    this.state = {
      ...this.state,
      exists: false,
      updatedAt: nowIso(),
      error: message
    };
    // Only announce a new error, not the same one on every retry tick.
    if (changed) this.emit("status", this.status());
  }
}
