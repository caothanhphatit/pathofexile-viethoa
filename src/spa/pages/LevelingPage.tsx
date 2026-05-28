import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { loadLevelingData } from "../lib/data";
import { formatNumber, type Locale, uiText } from "../lib/locale";
import { asArray, cleanText, stripMarkup } from "../lib/text";

type ActKey = "all" | "act1" | "act2" | "act3" | "act4" | "interlude";
type TaskFilter = "all" | "required" | "reward" | "boss" | "optional" | "tip";

interface LevelingBadge {
  text?: string;
  tone?: string;
}

interface LevelingTask {
  id?: string;
  text?: string;
  note?: string;
  required?: boolean;
  tip?: boolean;
  badges?: LevelingBadge[];
}

interface LevelingZone {
  id?: string;
  act?: string;
  title?: string;
  level?: string;
  meta?: string;
  tasks?: LevelingTask[];
}

interface OverlayPosition {
  left: number;
  top: number;
}

interface LogStatus {
  watching?: boolean;
  activePath?: string | null;
  zoneName?: string | null;
  updatedAt?: string | null;
  error?: string | null;
  source?: "backend" | "browser" | "snapshot";
}

interface LogStatusView {
  tone: "idle" | "ok" | "warn" | "bad";
  text: string;
}

const STORAGE_KEY = "poe2-leveling-v1-progress";
const OVERLAY_POSITION_KEY = "poe2-leveling-overlay-position-v1";
const LOG_FOLLOW_KEY = "poe2-leveling-campaign-log-follow-v1";
const LOG_PATH_KEY = "poe2-leveling-campaign-log-path-v1";
const API_BASE_KEY = "poe2-api-base";
const CLIENT_LOG_TAIL_BYTES = 1024 * 1024;
const CLIENT_LOG_POLL_MS = 1000;

const actRows: { key: ActKey; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "act1", label: "Act I" },
  { key: "act2", label: "Act II" },
  { key: "act3", label: "Act III" },
  { key: "act4", label: "Act IV" },
  { key: "interlude", label: "Interlude" }
];

const taskFilterRows: { key: TaskFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "required", label: "Bắt buộc" },
  { key: "reward", label: "Thưởng" },
  { key: "boss", label: "Boss" },
  { key: "optional", label: "Tùy chọn" },
  { key: "tip", label: "Mẹo" }
];

const normalizeAct = (zone: LevelingZone): Exclude<ActKey, "all"> => {
  const act = cleanText(zone.act).toLowerCase();
  if (act === "act2" || act === "act3" || act === "act4" || act === "interlude") return act;
  return "act1";
};

const taskKey = (task: LevelingTask, fallback = 0): string => cleanText(task.id) || `task-${fallback}`;

const safeTaskHtml = (value: unknown): string =>
  cleanText(value)
    .replace(/<(?!\/?(strong|em|b|i|br)\b)[^>]*>/gi, "")
    .replace(/<(strong|em|b|i)\b[^>]*>/gi, "<$1>")
    .replace(/<br\b[^>]*>/gi, "<br>");

const badgeText = (task: LevelingTask): string =>
  asArray<LevelingBadge>(task.badges).map((badge) => cleanText(badge.text).toLowerCase()).join(" ");

const isBossTask = (task: LevelingTask): boolean =>
  /giết\s+<strong>/i.test(cleanText(task.text)) || badgeText(task).includes("boss");

const isRewardTask = (task: LevelingTask): boolean =>
  /skill|support|spirit|maximum life|max mana|maximum mana|cold res|fire res|lightning res|resistance|salvage|ring|rune|orb|flask|lute|ascendancy|boon|jewel|unique|fragment|torn map|hideout|trading|tattoo|regal|verisium|jeweller/.test(badgeText(task));

const taskMatchesFilter = (task: LevelingTask, filter: TaskFilter): boolean => {
  if (filter === "required") return Boolean(task.required);
  if (filter === "reward") return isRewardTask(task);
  if (filter === "boss") return isBossTask(task);
  if (filter === "optional") return !task.required && !task.tip;
  if (filter === "tip") return Boolean(task.tip);
  return true;
};

const badgeClass = (tone = "") => `badge badge-${cleanText(tone).toLowerCase() || "slate"}`;

function readProgress(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeProgress(value: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...value]));
  } catch {
    // Keep the current in-memory checklist state if storage is blocked.
  }
}

function readOverlayPosition(): OverlayPosition | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERLAY_POSITION_KEY) || "null");
    if (!parsed || typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeOverlayPosition(value: OverlayPosition): void {
  try {
    localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify(value));
  } catch {
    // Drag position is optional.
  }
}

function readStoredText(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeStoredText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Optional browser preference.
  }
}

function writeStoredFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Optional browser preference.
  }
}

const parseEnteredLogZone = (line = ""): string | null => {
  const text = String(line || "");
  const sceneSource = text.match(/\[SCENE\]\s+Set Source\s+\[(.+?)\]\s*$/i);
  if (sceneSource?.[1] && !/^\((null|unknown)\)$/i.test(sceneSource[1])) return sceneSource[1].trim();

  const entered = text.match(/\bYou have entered\s+(.+?)\.\s*$/i);
  if (entered?.[1]) return entered[1].trim();

  const entering = text.match(/\bEntering area\s+['"]?(.+?)(?:['"]?\.|\s+with\s+|\s+\(|\s+\[|$)/i);
  if (entering?.[1]) return entering[1].trim();

  return null;
};

const latestZoneFromLogText = (text: string): string | null => {
  let latestZone: string | null = null;
  text.split(/\r?\n/).forEach((line) => {
    const zone = parseEnteredLogZone(line);
    if (zone) latestZone = zone;
  });
  return latestZone;
};

function clampOverlayPosition(left: number, top: number, element: HTMLElement): OverlayPosition {
  const maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop)
  };
}

const normalizeClassicZoneName = (value: unknown): string => cleanText(value)
  .toLowerCase()
  .replace(/<[^>]+>/g, " ")
  .replace(/\([^)]*\)/g, " ")
  .replace(/^\s*\d+(?:\.\d+)?\s+/, "")
  .replace(/\bthe\b/g, " ")
  .replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const addClassicZoneAlias = (map: Map<string, LevelingZone[]>, alias: unknown, zone?: LevelingZone): void => {
  if (!zone) return;
  const key = normalizeClassicZoneName(alias);
  if (!key) return;
  const rows = map.get(key) || [];
  rows.push(zone);
  map.set(key, rows);
};

const buildClassicZoneAliasMap = (zones: LevelingZone[]): Map<string, LevelingZone[]> => {
  const map = new Map<string, LevelingZone[]>();
  zones.forEach((zone) => {
    const title = cleanText(zone.title);
    addClassicZoneAlias(map, title, zone);
    addClassicZoneAlias(map, title.replace(/\s*\([^)]*\)/g, ""), zone);
    addClassicZoneAlias(map, zone.id, zone);
    title.split(/\s*->\s*/).forEach((part) => addClassicZoneAlias(map, part, zone));
    title.split(/\s*,\s*/).forEach((part) => addClassicZoneAlias(map, part, zone));
    title.split(/\s*\/\s*/).forEach((part) => addClassicZoneAlias(map, part, zone));
  });
  addClassicZoneAlias(map, "Ardura Caravan", zones.find((zone) => cleanText(zone.title) === "The Ardura Caravan"));
  addClassicZoneAlias(map, "Ziggurat Encampment", zones.find((zone) => cleanText(zone.title) === "Ziggurat Encampment"));
  addClassicZoneAlias(map, "Heart of the Tribe", zones.find((zone) => cleanText(zone.title).includes("Heart of the Tribe")));
  addClassicZoneAlias(map, "Ogham The Refuge", zones.find((zone) => cleanText(zone.title).includes("Ogham, The Refuge")));
  addClassicZoneAlias(map, "Khari Bazaar", zones.find((zone) => cleanText(zone.title).includes("Khari Bazaar")));
  addClassicZoneAlias(map, "Mount Kriar", zones.find((zone) => cleanText(zone.title).includes("Mount Kriar")));
  return map;
};

const firstClassicZoneMatch = (zones: LevelingZone[]): LevelingZone | null => zones.filter(Boolean)[0] || null;

const matchClassicLogZone = (zoneName: string, zones: LevelingZone[], aliases: Map<string, LevelingZone[]>): LevelingZone | null => {
  const key = normalizeClassicZoneName(zoneName);
  if (!key) return null;
  const exact = aliases.get(key);
  if (exact?.length) return firstClassicZoneMatch(exact);

  const fuzzy = zones.filter((zone) => {
    const zoneKey = normalizeClassicZoneName(zone.title);
    return zoneKey && (zoneKey.includes(key) || key.includes(zoneKey));
  });
  return firstClassicZoneMatch(fuzzy);
};

const classicLogStatusMessage = (status: LogStatus | null, zone?: LevelingZone | null): LogStatusView => {
  if (!status || !status.updatedAt) {
    return { tone: "idle", text: "Chưa kết nối log. Dò tự động hoặc dán path Client.txt rồi kết nối." };
  }
  if (status.error === "Backend offline") {
    return { tone: "bad", text: "Backend chưa chạy ở port 3000 nên chưa đọc được Client.txt." };
  }
  if (status.source === "browser" && status.activePath && status.zoneName && zone) {
    return { tone: "ok", text: `Web log: ${status.zoneName} -> ${zone.title || zone.id}` };
  }
  if (status.source === "snapshot" && status.activePath && status.zoneName && zone) {
    return { tone: "warn", text: `Snapshot: ${status.zoneName} -> ${zone.title || zone.id}. Browser nay khong poll realtime; chon lai file de cap nhat.` };
  }
  if (status.source === "browser" && status.activePath && status.watching) {
    return { tone: "warn", text: "Da cap quyen doc Client.txt tren web, dang cho game ghi dong chuyen map." };
  }
  if (status.source === "snapshot" && status.activePath) {
    return { tone: "warn", text: "Da doc snapshot Client.txt. Browser nay khong ho tro quyen doc realtime." };
  }
  if (status.activePath && status.zoneName && zone) {
    return { tone: "ok", text: `Log: ${status.zoneName} -> ${zone.title || zone.id}` };
  }
  if (status.activePath && status.zoneName) {
    return { tone: "warn", text: `Log thấy "${status.zoneName}" nhưng chưa map được vào route.` };
  }
  if (status.activePath && status.watching) {
    return { tone: "warn", text: "Đã đọc file log, đang chờ game ghi dòng chuyển map." };
  }
  return { tone: "bad", text: status.error || "Không tìm thấy Client.txt." };
};

export function LevelingPage({ locale }: { locale: Locale }) {
  const [zones, setZones] = useState<LevelingZone[]>([]);
  const [error, setError] = useState("");
  const [activeAct, setActiveAct] = useState<ActKey>("all");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [hideDone, setHideDone] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(() => readOverlayPosition());
  const [pipRoot, setPipRoot] = useState<HTMLElement | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(() => readProgress());
  const [focusedZoneId, setFocusedZoneId] = useState("");
  const [logAutoFollow, setLogAutoFollow] = useState(() => readStoredFlag(LOG_FOLLOW_KEY));
  const [logPath, setLogPath] = useState(() => readStoredText(LOG_PATH_KEY));
  const [logStatus, setLogStatus] = useState<LogStatus | null>(null);
  const [browserLogActive, setBrowserLogActive] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const browserLogInputRef = useRef<HTMLInputElement>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const logEventSourceRef = useRef<EventSource | null>(null);
  const browserLogHandleRef = useRef<any>(null);
  const browserLogPollRef = useRef<number | null>(null);
  const browserLogOffsetRef = useRef(0);
  const browserLogPendingLineRef = useRef("");
  const browserLogActiveRef = useRef(false);
  const lastLogZoneRef = useRef("");
  const zonesRef = useRef<LevelingZone[]>([]);
  const logAutoFollowRef = useRef(logAutoFollow);

  useEffect(() => {
    let alive = true;
    loadLevelingData().then((data) => {
      if (alive) setZones(asArray<LevelingZone>(data));
    }).catch((err: Error) => {
      if (alive) setError(err.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    writeProgress(completed);
  }, [completed]);

  useEffect(() => {
    zonesRef.current = zones;
  }, [zones]);

  useEffect(() => {
    logAutoFollowRef.current = logAutoFollow;
    writeStoredFlag(LOG_FOLLOW_KEY, logAutoFollow);
  }, [logAutoFollow]);

  useEffect(() => {
    writeStoredText(LOG_PATH_KEY, logPath);
  }, [logPath]);

  useEffect(() => {
    if (!overlayOpen || !overlayRef.current || !overlayPosition) return;
    const next = clampOverlayPosition(overlayPosition.left, overlayPosition.top, overlayRef.current);
    if (next.left !== overlayPosition.left || next.top !== overlayPosition.top) {
      setOverlayPosition(next);
      writeOverlayPosition(next);
    }
  }, [overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGameOverlay();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [overlayOpen]);

  useEffect(() => () => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) pipWindowRef.current.close();
    logEventSourceRef.current?.close();
    if (browserLogPollRef.current) window.clearInterval(browserLogPollRef.current);
  }, []);

  const apiBase = useMemo(() => {
    const configured = (window as any).POE2_API_BASE || readStoredText(API_BASE_KEY);
    if (configured) return configured;
    return window.location.port === "3000" ? "" : `http://${window.location.hostname || "127.0.0.1"}:3000`;
  }, []);

  const rows = useMemo(() => zones.flatMap((zone) => asArray<LevelingTask>(zone.tasks).map((task, index) => ({
    zone,
    task,
    index,
    id: taskKey(task, index),
    act: normalizeAct(zone)
  }))), [zones]);
  const zoneAliasMap = useMemo(() => buildClassicZoneAliasMap(zones), [zones]);

  const scopedRows = rows.filter((row) => activeAct === "all" || row.act === activeAct);
  const visibleRows = scopedRows.filter((row) => taskMatchesFilter(row.task, taskFilter));
  const doneCount = scopedRows.filter((row) => !row.task.tip && completed.has(row.id)).length;
  const totalCount = scopedRows.filter((row) => !row.task.tip).length;
  const requiredCount = scopedRows.filter((row) => row.task.required).length;
  const percent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const nextRow = scopedRows.find((row) => !row.task.tip && taskMatchesFilter(row.task, taskFilter) && !completed.has(row.id));
  const focusedZoneRows = focusedZoneId ? rows.filter((row) => row.zone.id === focusedZoneId && !row.task.tip) : [];
  const hasFocusedZoneRows = focusedZoneRows.length > 0;
  const overlayBaseRows = focusedZoneRows.length ? focusedZoneRows : scopedRows.filter((row) => !row.task.tip);
  const nextOpenIndex = overlayBaseRows.findIndex((row) => !completed.has(row.id));
  const overlayCurrentIndex = nextOpenIndex >= 0 ? nextOpenIndex : (hasFocusedZoneRows ? 0 : overlayBaseRows.length);
  const overlayRows = [-1, 0, 1, 2, 3].map((offset) => overlayBaseRows[overlayCurrentIndex + offset] || null);
  const matchedLogZone = logStatus?.zoneName ? matchClassicLogZone(logStatus.zoneName, zones, zoneAliasMap) : null;
  const logStatusView = classicLogStatusMessage(logStatus, matchedLogZone);

  const visibleZones = zones.map((zone) => {
    const act = normalizeAct(zone);
    const isFocusedZone = Boolean(focusedZoneId && zone.id === focusedZoneId);
    const tasks = asArray<LevelingTask>(zone.tasks).map((task, index) => ({
      task,
      index,
      id: taskKey(task, index),
      act
    })).filter((row) => {
      if (isFocusedZone) return true;
      if (activeAct !== "all" && row.act !== activeAct) return false;
      if (!taskMatchesFilter(row.task, taskFilter)) return false;
      if (hideDone && !row.task.tip && completed.has(row.id)) return false;
      return true;
    });
    return { zone, act, tasks };
  }).filter((row) => row.tasks.length);

  const revealZoneFromLog = (zone: LevelingZone, status?: LogStatus) => {
    const zoneId = cleanText(zone.id);
    if (!zoneId || zoneId === lastLogZoneRef.current) return;
    lastLogZoneRef.current = zoneId;
    setFocusedZoneId(zoneId);
    setActiveAct(normalizeAct(zone));
    requestAnimationFrame(() => {
      document.getElementById(zoneId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if (status) setLogStatus(status);
  };

  const applyClassicLogStatus = (status: LogStatus) => {
    setLogStatus(status);
    const aliases = buildClassicZoneAliasMap(zonesRef.current);
    const zone = status.zoneName
      ? matchClassicLogZone(status.zoneName, zonesRef.current, aliases)
      : null;
    if (logAutoFollowRef.current && zone) revealZoneFromLog(zone, status);
  };

  const closeClassicLogEvents = () => {
    logEventSourceRef.current?.close();
    logEventSourceRef.current = null;
  };

  const stopBrowserClientLog = () => {
    if (browserLogPollRef.current) {
      window.clearInterval(browserLogPollRef.current);
      browserLogPollRef.current = null;
    }
    browserLogHandleRef.current = null;
    browserLogOffsetRef.current = 0;
    browserLogPendingLineRef.current = "";
    browserLogActiveRef.current = false;
    setBrowserLogActive(false);
  };

  const enableLogFollow = () => {
    setLogAutoFollow(true);
    logAutoFollowRef.current = true;
    writeStoredFlag(LOG_FOLLOW_KEY, true);
  };

  const consumeBrowserLogText = (text: string, fileName: string, source: "browser" | "snapshot", includeTrailing = false) => {
    const merged = `${browserLogPendingLineRef.current}${text}`;
    const completeLines = merged.split(/\r?\n/);
    browserLogPendingLineRef.current = /\r?\n$/.test(merged) ? "" : (completeLines.pop() || "");
    const scanText = includeTrailing ? merged : completeLines.join("\n");
    const zoneName = latestZoneFromLogText(scanText);
    const baseStatus: LogStatus = {
      watching: source === "browser",
      activePath: fileName,
      zoneName: null,
      updatedAt: new Date().toISOString(),
      source
    };
    applyClassicLogStatus(zoneName ? { ...baseStatus, zoneName } : baseStatus);
  };

  const readBrowserLogHandle = async (handle: any, initial = false) => {
    const file: File = await handle.getFile();
    const start = initial
      ? Math.max(0, file.size - CLIENT_LOG_TAIL_BYTES)
      : (file.size < browserLogOffsetRef.current ? 0 : browserLogOffsetRef.current);
    if (!initial && file.size === browserLogOffsetRef.current) return;

    const text = await file.slice(start).text();
    browserLogOffsetRef.current = file.size;
    if (text) {
      consumeBrowserLogText(text, file.name || handle.name || "Client.txt", "browser", initial);
    } else if (initial) {
      applyClassicLogStatus({
        watching: true,
        activePath: file.name || handle.name || "Client.txt",
        zoneName: null,
        updatedAt: new Date().toISOString(),
        source: "browser"
      });
    }
  };

  const startBrowserLogHandle = async (handle: any) => {
    closeClassicLogEvents();
    stopBrowserClientLog();
    enableLogFollow();
    browserLogHandleRef.current = handle;
    browserLogActiveRef.current = true;
    setBrowserLogActive(true);
    const fileName = handle.name || "Client.txt";
    setLogPath(fileName);
    writeStoredText(LOG_PATH_KEY, fileName);
    applyClassicLogStatus({
      watching: true,
      activePath: fileName,
      zoneName: null,
      updatedAt: new Date().toISOString(),
      source: "browser"
    });
    await readBrowserLogHandle(handle, true);
    browserLogPollRef.current = window.setInterval(() => {
      const currentHandle = browserLogHandleRef.current;
      if (!currentHandle) return;
      readBrowserLogHandle(currentHandle).catch((error: Error) => {
        stopBrowserClientLog();
        applyClassicLogStatus({
          watching: false,
          activePath: fileName,
          zoneName: null,
          updatedAt: new Date().toISOString(),
          error: error.message || "Browser log permission lost",
          source: "browser"
        });
      });
    }, CLIENT_LOG_POLL_MS);
  };

  const readBrowserLogSnapshot = async (file: File) => {
    closeClassicLogEvents();
    stopBrowserClientLog();
    enableLogFollow();
    setLogPath(file.name || "Client.txt");
    writeStoredText(LOG_PATH_KEY, file.name || "Client.txt");
    browserLogPendingLineRef.current = "";
    const text = await file.text();
    consumeBrowserLogText(text, file.name || "Client.txt", "snapshot", true);
  };

  const chooseBrowserLogFile = async () => {
    const picker = (window as any).showOpenFilePicker;
    if (!picker) {
      browserLogInputRef.current?.click();
      return;
    }

    try {
      const [handle] = await picker({
        multiple: false,
        types: [{
          description: "POE2 Client log",
          accept: { "text/plain": [".txt"] }
        }]
      });
      if (handle) await startBrowserLogHandle(handle);
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      applyClassicLogStatus({
        watching: false,
        activePath: null,
        zoneName: null,
        updatedAt: new Date().toISOString(),
        error: error?.message || "Khong mo duoc Client.txt tren browser",
        source: "browser"
      });
    }
  };

  const requestClassicLogJson = async (path: string, options: RequestInit = {}): Promise<{ data: LogStatus }> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: "include",
      headers: { "content-type": "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  };

  const connectClassicLogEvents = () => {
    if (!window.EventSource || logEventSourceRef.current) return;
    try {
      const source = new EventSource(`${apiBase}/api/leveling/log/events`, { withCredentials: true });
      source.addEventListener("status", (event) => applyClassicLogStatus(JSON.parse(event.data)));
      source.addEventListener("zone", (event) => applyClassicLogStatus(JSON.parse(event.data)));
      source.addEventListener("log-event", (event) => applyClassicLogStatus(JSON.parse(event.data).status));
      source.onerror = () => {
        logEventSourceRef.current?.close();
        logEventSourceRef.current = null;
      };
      logEventSourceRef.current = source;
    } catch {
      logEventSourceRef.current = null;
    }
  };

  const refreshClassicLogStatus = async () => {
    try {
      const payload = await requestClassicLogJson("/api/leveling/log/status");
      applyClassicLogStatus(payload.data);
      connectClassicLogEvents();
    } catch {
      applyClassicLogStatus({ watching: false, error: "Backend offline", zoneName: null, updatedAt: new Date().toISOString() });
    }
  };

  const configureClassicLog = async (pathOverride?: string) => {
    stopBrowserClientLog();
    const nextPath = pathOverride ?? logPath.trim();
    setLogPath(nextPath);
    setLogAutoFollow(true);
    logAutoFollowRef.current = true;
    writeStoredFlag(LOG_FOLLOW_KEY, true);
    writeStoredText(LOG_PATH_KEY, nextPath);
    try {
      const payload = await requestClassicLogJson("/api/leveling/log/config", {
        method: "POST",
        body: JSON.stringify({ path: nextPath })
      });
      applyClassicLogStatus(payload.data);
      connectClassicLogEvents();
    } catch {
      applyClassicLogStatus({ watching: false, error: "Backend offline", zoneName: null, updatedAt: new Date().toISOString() });
    }
  };

  useEffect(() => {
    if (!logAutoFollow || !zones.length || browserLogActive) return;
    refreshClassicLogStatus();
  }, [logAutoFollow, zones.length, browserLogActive]);

  const toggleTask = (id: string) => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRequiredInZone = (zone: LevelingZone, checked: boolean) => {
    setCompleted((current) => {
      const next = new Set(current);
      asArray<LevelingTask>(zone.tasks).forEach((task, index) => {
        if (!task.required) return;
        const id = taskKey(task, index);
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const goNext = () => {
    if (!nextRow) return;
    if (activeAct === "all") setActiveAct(nextRow.act);
    setFocusedZoneId(cleanText(nextRow.zone.id));
    requestAnimationFrame(() => {
      document.getElementById(nextRow.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const revealTask = (id: string, act: Exclude<ActKey, "all">) => {
    if (activeAct === "all") setActiveAct(act);
    const row = rows.find((entry) => entry.id === id);
    if (row) setFocusedZoneId(cleanText(row.zone.id));
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const startOverlayDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, select, label")) return;
    const panel = overlayRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = clampOverlayPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, panel);
      setOverlayPosition(next);
    };
    const stop = () => {
      const finalRect = panel.getBoundingClientRect();
      const next = clampOverlayPosition(finalRect.left, finalRect.top, panel);
      setOverlayPosition(next);
      writeOverlayPosition(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    event.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const overlayStyle = overlayPosition
    ? { left: `${overlayPosition.left}px`, top: `${overlayPosition.top}px`, right: "auto", bottom: "auto" }
    : undefined;

  const closeGameOverlay = () => {
    setOverlayOpen(false);
    setPipRoot(null);
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
    }
    pipWindowRef.current = null;
  };

  const openGameOverlay = async () => {
    const pipApi = (window as any).documentPictureInPicture;
    if (pipApi?.requestWindow) {
      try {
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          pipWindowRef.current.focus();
          return;
        }
        const pipWindow = await pipApi.requestWindow({ width: 260, height: 190 });
        pipWindow.document.head.innerHTML = "<title>POE2 Checklist Overlay</title>";
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
          pipWindow.document.head.appendChild(node.cloneNode(true));
        });
        pipWindow.document.documentElement.classList.toggle("dark", document.documentElement.classList.contains("dark"));
        pipWindow.document.body.style.margin = "0";
        const root = pipWindow.document.createElement("div");
        pipWindow.document.body.appendChild(root);
        pipWindowRef.current = pipWindow;
        setPipRoot(root);
        setOverlayOpen(false);
        pipWindow.addEventListener("pagehide", () => {
          pipWindowRef.current = null;
          setPipRoot(null);
        });
        return;
      } catch {
        setOverlayOpen(true);
        return;
      }
    }

    setOverlayOpen(true);
  };

  const renderOverlayInner = (mode: "page" | "pip") => (
    <div className="game-overlay-inner" onPointerDown={mode === "page" ? startOverlayDrag : undefined}>
      {mode === "page" ? (
        <button className="game-overlay-close" type="button" onClick={closeGameOverlay} title="Đóng overlay" aria-label="Đóng overlay">
          <span className="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      ) : null}
      <div className="game-overlay-list">
        {overlayRows.map((row, slotIndex) => {
          const isCurrent = slotIndex === 1;
          if (!row) return <div className="game-overlay-task is-empty" key={`overlay:${mode}:empty:${slotIndex}`} />;
          const done = completed.has(row.id);
          return (
            <div className={`game-overlay-task ${done ? "is-complete" : ""} ${isCurrent ? "is-current" : ""}`} key={`overlay:${mode}:${row.id}`}>
              <input className="game-overlay-check" checked={done} id={`overlay-${mode}-${row.id}`} type="checkbox" onChange={() => toggleTask(row.id)} />
              <label className="game-overlay-task-body" htmlFor={`overlay-${mode}-${row.id}`}>
                <span className="game-overlay-task-title" dangerouslySetInnerHTML={{ __html: safeTaskHtml(row.task.text) }} />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (error) return <main className="page-shell"><div className="error-panel">{error}</div></main>;
  if (!zones.length) return <main className="page-shell"><div className="loading-panel">{uiText("loadingChecklist", locale)}</div></main>;

  return (
    <main className="leveling-v1-shell">
      <section className="leveling-v1-panel" id="route-checklist">
        <div className="leveling-v1-act-panel">
          <div className="leveling-v1-panel-head">
            <div>
              <p>Chọn act</p>
              <h1>Task nhỏ theo từng zone</h1>
            </div>
            <span>Act 1-4 + Interlude</span>
          </div>
          <div className="leveling-v1-act-grid">
            {actRows.map((row) => (
              <button key={row.key} className={`filter-button ${activeAct === row.key ? "is-active" : ""}`} type="button" onClick={() => {
                setActiveAct(row.key);
                setFocusedZoneId("");
              }}>
                {row.label}
              </button>
            ))}
          </div>
        </div>

        <div className="leveling-v1-layout">
          <aside className="leveling-v1-sidebar">
            <p className="leveling-v1-sidebar-title">Theo dõi route</p>
            <div className="leveling-v1-stats">
              <div>
                <p>Task</p>
                <strong>{formatNumber(totalCount, locale)}</strong>
              </div>
              <div>
                <p>Xong</p>
                <strong>{formatNumber(doneCount, locale)}</strong>
              </div>
            </div>
            <p className="leveling-v1-required">Route bắt buộc: <span>{formatNumber(requiredCount, locale)}</span> task</p>
            <div className="leveling-v1-progress">
              <div>
                <strong>{formatNumber(doneCount, locale)}/{formatNumber(totalCount, locale)} task đã xong</strong>
                <span>{percent}%</span>
              </div>
              <i><b style={{ width: `${percent}%` }} /></i>
            </div>
            <div className="leveling-v1-actions">
              <button className="leveling-v1-next" type="button" onClick={goNext} disabled={!nextRow}>
                <span className="material-symbols-rounded" aria-hidden="true">flag</span>
                <span>{nextRow ? `Đi tiếp: ${stripMarkup(nextRow.task.text)}` : "Hoàn tất campaign"}</span>
              </button>
              <label className="leveling-v1-toggle">
                <span>Ẩn task xong</span>
                <input className="task-checkbox" checked={hideDone} type="checkbox" onChange={(event) => setHideDone(event.target.checked)} />
              </label>
              <div className="leveling-v1-filter-box">
                <p>Hiển thị</p>
                <div>
                  {taskFilterRows.map((row) => (
                    <button key={row.key} className={`filter-button ${taskFilter === row.key ? "is-active" : ""}`} type="button" onClick={() => setTaskFilter(row.key)}>
                      {row.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="leveling-v1-overlay" type="button" onClick={openGameOverlay}>
                <span className="material-symbols-rounded" aria-hidden="true">picture_in_picture_alt</span>
                <span>Mở overlay chơi game</span>
              </button>
              <div className="leveling-v1-log">
                <div className="leveling-v1-log-head">
                  <div>
                    <p>Game log V1</p>
                    <strong>Auto map theo Client.txt</strong>
                  </div>
                  <label>
                    <span>Auto</span>
                    <input
                      checked={logAutoFollow}
                      className="task-checkbox"
                      id="classicLogAutoFollow"
                      type="checkbox"
                      onChange={(event) => {
                        setLogAutoFollow(event.target.checked);
                        logAutoFollowRef.current = event.target.checked;
                        if (!event.target.checked) {
                          closeClassicLogEvents();
                          stopBrowserClientLog();
                          return;
                        }
                        if (!browserLogActiveRef.current) refreshClassicLogStatus();
                      }}
                    />
                  </label>
                </div>
                <input
                  accept=".txt,text/plain"
                  hidden
                  ref={browserLogInputRef}
                  type="file"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    readBrowserLogSnapshot(file).catch((error: Error) => applyClassicLogStatus({
                      watching: false,
                      activePath: file.name || "Client.txt",
                      zoneName: null,
                      updatedAt: new Date().toISOString(),
                      error: error.message,
                      source: "snapshot"
                    }));
                  }}
                />
                <input
                  className="leveling-v1-log-path"
                  id="classicLogPath"
                  placeholder="...\\logs\\Client.txt hoặc folder logs"
                  type="text"
                  value={logPath}
                  onChange={(event) => setLogPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    configureClassicLog();
                  }}
                />
                <div className="leveling-v1-log-buttons">
                  <button id="classicLogPick" type="button" onClick={chooseBrowserLogFile}>
                    <span className="material-symbols-rounded" aria-hidden="true">folder_open</span>
                    {browserLogActive ? "Dang doc web" : "Cap quyen web"}
                  </button>
                  <button id="classicLogDetect" type="button" onClick={() => configureClassicLog("")}>
                    <span className="material-symbols-rounded" aria-hidden="true">travel_explore</span>
                    Dò
                  </button>
                  <button id="classicLogConnect" type="button" onClick={() => configureClassicLog()}>
                    <span className="material-symbols-rounded" aria-hidden="true">sync</span>
                    Kết nối
                  </button>
                </div>
                <p className="leveling-v1-log-status" data-log-zone-status={logStatusView.tone} id="classicLogStatus">
                  {logStatusView.text}
                </p>
              </div>
              <button className="leveling-v1-reset" type="button" onClick={() => setCompleted(new Set())} disabled={!completed.size}>
                <span className="material-symbols-rounded" aria-hidden="true">restart_alt</span>
                <span>Reset</span>
              </button>
            </div>
            <div className="leveling-v1-jump">
              <p>Nhảy nhanh</p>
              <div>
                {zones.filter((zone) => activeAct === "all" || normalizeAct(zone) === activeAct).map((zone) => (
                  <a key={zone.id || zone.title} href={`#${zone.id}`} onClick={() => {
                    setActiveAct(normalizeAct(zone));
                    setFocusedZoneId(cleanText(zone.id));
                  }}>
                    {actRows.find((row) => row.key === normalizeAct(zone))?.label} - {zone.title}
                  </a>
                ))}
              </div>
            </div>
          </aside>

          <div className="leveling-v1-task-list">
            {visibleZones.map(({ zone, act, tasks }) => {
              const requiredTasks = asArray<LevelingTask>(zone.tasks).map((task, index) => ({ task, id: taskKey(task, index) })).filter((row) => row.task.required);
              const requiredDone = requiredTasks.length > 0 && requiredTasks.every((row) => completed.has(row.id));
              const zoneTasks = asArray<LevelingTask>(zone.tasks).map((task, index) => ({ task, id: taskKey(task, index) })).filter((row) => !row.task.tip);
              const zoneComplete = zoneTasks.length > 0 && zoneTasks.every((row) => completed.has(row.id));
              return (
                <section className={`task-zone ${zoneComplete ? "is-complete" : ""}`} data-act={act} data-zone={zone.id} id={zone.id} key={zone.id || zone.title}>
                  <div className="task-zone-header">
                    <div>
                      <div className="leveling-v1-zone-title-row">
                        <h3 className="task-zone-title">{zone.title}</h3>
                        <span className="badge badge-violet">{actRows.find((row) => row.key === act)?.label}</span>
                        {zone.meta ? <span className="badge badge-violet">{zone.meta}</span> : null}
                        {zone.level ? <span className="badge badge-amber">{zone.level}</span> : null}
                      </div>
                    </div>
                    <label className="zone-actions">
                      <input className="task-checkbox zone-required-toggle" checked={requiredDone} type="checkbox" onChange={(event) => toggleRequiredInZone(zone, event.target.checked)} />
                      <span>tick bắt buộc</span>
                    </label>
                  </div>
                  <div className="task-list">
                    {tasks.map(({ task, index, id }) => {
                      const done = completed.has(id);
                      const badges = [
                        ...(task.required ? [{ text: "bắt buộc", tone: "amber" }] : []),
                        ...asArray<LevelingBadge>(task.badges)
                      ];
                      if (task.tip) {
                        return (
                          <div className="task-row task-info-row" data-act={act} id={id} key={id}>
                            <span className="material-symbols-rounded task-info-icon" aria-hidden="true">info</span>
                            <span className="task-main">
                              <span className="task-title" dangerouslySetInnerHTML={{ __html: safeTaskHtml(task.text) }} />
                              {task.note ? <span className="task-note">{stripMarkup(task.note)}</span> : null}
                            </span>
                            <span className="task-badges">
                              {badges.map((badge, badgeIndex) => <span className={badgeClass(badge.tone)} key={`${id}:${badgeIndex}`}>{badge.text}</span>)}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div className={`task-row ${done ? "is-complete" : ""}`} data-act={act} id={id} key={id}>
                          <input
                            checked={done}
                            className="task-checkbox leveling-checkbox"
                            data-act={act}
                            data-boss={isBossTask(task)}
                            data-optional={!task.required && !task.tip}
                            data-required={Boolean(task.required)}
                            data-reward={isRewardTask(task)}
                            data-tip={Boolean(task.tip)}
                            data-zone={zone.id}
                            id={`check-${id}`}
                            type="checkbox"
                            value={id}
                            onChange={() => toggleTask(id)}
                          />
                          <label className="task-main" htmlFor={`check-${id}`}>
                            <span className="task-title" dangerouslySetInnerHTML={{ __html: safeTaskHtml(task.text) }} />
                            {task.note ? <span className="task-note">{stripMarkup(task.note)}</span> : null}
                          </label>
                          <span className="task-badges">
                            {badges.map((badge, badgeIndex) => <span className={badgeClass(badge.tone)} key={`${id}:${badgeIndex}`}>{badge.text}</span>)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {!visibleRows.length ? <div className="leveling-v1-empty">Không có task khớp filter.</div> : null}
          </div>
        </div>
      </section>
      <div className={`game-overlay ${overlayOpen ? "is-open" : ""}`} aria-hidden={!overlayOpen} ref={overlayRef} style={overlayStyle}>
        <section className="game-overlay-card" aria-label="Checklist overlay">
          {renderOverlayInner("page")}
        </section>
      </div>
      {pipRoot ? createPortal(
        <section className="game-overlay-card game-overlay-card--pip" aria-label="Checklist overlay">
          {renderOverlayInner("pip")}
        </section>,
        pipRoot
      ) : null}
    </main>
  );
}
