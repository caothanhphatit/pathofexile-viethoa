export type PassiveChangeStatus = "added" | "removed" | "stats" | "renamed";

export interface PassiveTreeChangeMarker {
  id: string;
  status: PassiveChangeStatus;
  name: string;
  oldName: string;
  newName: string;
  oldStats: string[];
  newStats: string[];
  x: number;
  y: number;
  type: string;
  iconPath: string;
  className: string;
  ascendancyName: string;
}

export interface PassiveTreeChanges {
  baseVersion: string;
  targetVersion: string;
  compareUrl: string;
  sourceUrl: string;
  generatedAt: string;
  counts: Record<PassiveChangeStatus, number>;
  entries: PassiveTreeChangeMarker[];
  byId: Map<string, PassiveTreeChangeMarker>;
}

export const CHANGE_COLORS: Record<PassiveChangeStatus, string> = {
  added: "#4ad6a0",
  removed: "#ef5d5d",
  stats: "#f5b740",
  renamed: "#5fd6cd"
};

export const CHANGE_LABELS: Record<PassiveChangeStatus, string> = {
  added: "New in 0.5",
  removed: "Removed in 0.5",
  stats: "Reworked stats",
  renamed: "Renamed"
};

const emptyCounts = (): Record<PassiveChangeStatus, number> => ({
  added: 0,
  removed: 0,
  stats: 0,
  renamed: 0
});

export function parsePassiveTreeChanges(raw: any): PassiveTreeChanges {
  const entries: PassiveTreeChangeMarker[] = (Array.isArray(raw?.entries) ? raw.entries : []).map((entry: any) => ({
    id: String(entry.id ?? ""),
    status: normalizeStatus(entry.status),
    name: String(entry.name ?? entry.newName ?? entry.oldName ?? ""),
    oldName: String(entry.oldName ?? ""),
    newName: String(entry.newName ?? ""),
    oldStats: Array.isArray(entry.oldStats) ? entry.oldStats.map(String) : [],
    newStats: Array.isArray(entry.newStats) ? entry.newStats.map(String) : [],
    x: finite(entry.x),
    y: finite(entry.y),
    type: String(entry.type ?? "small"),
    iconPath: String(entry.iconPath ?? entry.icon_path ?? ""),
    className: String(entry.className ?? ""),
    ascendancyName: String(entry.ascendancyName ?? "")
  })).filter((entry: PassiveTreeChangeMarker) => entry.id && Number.isFinite(entry.x) && Number.isFinite(entry.y));

  const counts = { ...emptyCounts(), ...(raw?.counts ?? {}) };
  for (const status of Object.keys(counts) as PassiveChangeStatus[]) counts[status] = Number(counts[status]) || 0;

  return {
    baseVersion: String(raw?.base_version ?? raw?.baseVersion ?? "0.4.0"),
    targetVersion: String(raw?.target_version ?? raw?.targetVersion ?? "0.5.0"),
    compareUrl: String(raw?.compare_url ?? raw?.compareUrl ?? ""),
    sourceUrl: String(raw?.source_url ?? raw?.sourceUrl ?? ""),
    generatedAt: String(raw?.generated_at ?? raw?.generatedAt ?? ""),
    counts,
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry]))
  };
}

export function changeTitle(change: PassiveTreeChangeMarker): string {
  if (change.status === "renamed" && change.oldName && change.newName) return `${change.oldName} -> ${change.newName}`;
  return change.name || change.newName || change.oldName || `Node ${change.id}`;
}

export function changePreview(change: PassiveTreeChangeMarker): string {
  if (change.status === "added") return change.newStats[0] || "New passive node";
  if (change.status === "removed") return change.oldStats[0] || "Removed passive node";
  if (change.status === "renamed") return change.newName || change.oldName;
  return change.newStats[0] || change.oldStats[0] || "Stats changed";
}

function normalizeStatus(value: unknown): PassiveChangeStatus {
  if (value === "added" || value === "removed" || value === "stats" || value === "renamed") return value;
  return "stats";
}

function finite(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}
