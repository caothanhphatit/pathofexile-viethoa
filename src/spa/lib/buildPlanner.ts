export const CURRENT_TREE_KEY = "poe2-build-current-tree-v1";
export const SAVED_TREES_KEY = "poe2-build-saved-trees-v1";
export const SAVED_BUILDS_KEY = "poe2-build-saved-builds-v1";

export interface BuildTreeSnapshot {
  id: string;
  name: string;
  className: string;
  ascendancyName: string;
  allocatedIds: string[];
  startIds: string[];
  treeVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuildPlannerData {
  version?: string;
  source?: string;
  passive_ids?: Record<string, string>;
  ascendancies?: Record<string, string>;
}

export interface BuildInventoryChoice {
  id: string;
  inventoryId: string;
  itemName: string;
  note: string;
  isUnique: boolean;
  levelStart: string;
  levelEnd: string;
  itemSlug?: string;
  iconUrl?: string;
  baseName?: string;
  itemLevel?: number;
  quality?: number;
  corrupted?: boolean;
  rareName?: string;
  implicitCount?: number;
  rawText?: string;
  /** The item text before the player edited it (unset = never edited). */
  originalText?: string;
  /** Built or edited in the planner (checked by the item rules on the server too). */
  edited?: boolean;
}

/**
 * Gem details kept from a PoB import so the calculator sees the same gem PoB saw.
 * Picking another gem in the planner clears the pob* fields (they describe the old gem).
 */
export interface BuildGemDetails {
  gemLevel?: number;
  gemQuality?: number;
  /** PoB's own ids: gemId picks the gem, variantId the version (Clarity I vs II). */
  pobGemId?: string;
  pobSkillId?: string;
  pobVariantId?: string;
  nameSpec?: string;
  /** Other PoB gem settings (corruptLevel, skillPart, minion...), see POB_GEM_EXTRA_ATTRIBUTES. */
  pobAttrs?: Record<string, string>;
}

/** PoB <Gem> attributes that change the numbers and are kept as-is from an import. */
export const POB_GEM_EXTRA_ATTRIBUTES = [
  "corrupted", "corruptLevel", "count", "enableGlobal1", "enableGlobal2",
  "skillPart", "skillPartCalcs", "skillStageCount", "skillStageCountCalcs",
  "skillMineCount", "skillMineCountCalcs", "skillMinion", "skillMinionCalcs",
  "skillMinionItemSet", "skillMinionItemSetCalcs", "skillMinionSkill", "skillMinionSkillCalcs",
  "statSetIndex", "statSetIndexCalcs"
];

export interface BuildSupportSkillChoice extends BuildGemDetails {
  id: string;
  skillId: string;
  note: string;
  levelStart: string;
  levelEnd: string;
  /** Gem switched off in PoB: kept so the group stays the same, ignored by the calculator. */
  disabled?: boolean;
  /** A second active gem in the group (e.g. the spell socketed in Cast on Critical). */
  active?: boolean;
}

export interface BuildSkillChoice extends BuildGemDetails {
  id: string;
  skillId: string;
  note: string;
  levelStart: string;
  levelEnd: string;
  supportSkills: BuildSupportSkillChoice[];
  /** Whole socket group switched off in PoB. */
  disabled?: boolean;
  /** The group's own active gem is switched off. */
  gemDisabled?: boolean;
  /** Skill granted by an item ("Weapon 1") rather than a gem the player socketed. */
  itemSlot?: string;
  itemSource?: string;
  /** Which active gem of the group PoB calculates (1 = the first). */
  mainActiveSkill?: number;
}

/** One Input of PoB's Configuration tab (enemy is shocked, nearby enemies, ...). */
export interface PobConfigInput {
  name: string;
  kind: "boolean" | "number" | "string";
  value: boolean | number | string;
}

/** Raw stat row as exported in a `.build` / PoB payload. */
export interface BuildPayloadStat {
  stat: string;
  value?: unknown;
}

/**
 * A `.build` payload is mostly opaque (it is passed through to the calculator),
 * but the planner reads a few well-known fields from it.
 */
export interface BuildPayload {
  mainSocketGroup?: number | string;
  build?: { mainSocketGroup?: number | string; [key: string]: unknown };
  stats?: BuildPayloadStat[];
  [key: string]: unknown;
}

/** An item of the build's personal inventory (see buildInventory.ts). */
export type StashSource = "pob" | "paste" | "search" | "unequipped";

export interface BuildStashItem {
  id: string;
  /** PoB / game item text; what the calculator gets. Empty for an item known only by name. */
  rawText?: string;
  /** Display name and rarity when there is no text (items picked by name in older builds). */
  itemName: string;
  isUnique: boolean;
  baseName?: string;
  itemSlug?: string;
  iconUrl?: string;
  source: StashSource;
  originalText?: string;
  edited?: boolean;
}

export interface BuildProject {
  id: string;
  name: string;
  author: string;
  description: string;
  treeSnapshots: BuildTreeSnapshot[];
  activeTreeId: string;
  inventory: BuildInventoryChoice[];
  skills: BuildSkillChoice[];
  /** Personal inventory: items for this build that are not worn. */
  stash: BuildStashItem[];
  importedPayload?: BuildPayload;
  importedFileName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuildExportInput {
  snapshot?: BuildTreeSnapshot | null;
  basePayload?: BuildPayload | null;
  plannerData?: BuildPlannerData | null;
  name: string;
  author: string;
  description: string;
  inventory: BuildInventoryChoice[];
  skills?: BuildSkillChoice[];
}

export interface PobGem {
  nameSpec: string;
  level: number;
  quality: number;
  enabled: boolean;
  skillEnabled: boolean;
  skillId: string;
  gemId?: string;
  variantId?: string;
  /** POB_GEM_EXTRA_ATTRIBUTES present on the <Gem>. */
  extra?: Record<string, string>;
}

export interface PobSkillGroup {
  enabled: boolean;
  slot: string;
  gems: PobGem[];
  source?: string;
  mainActiveSkill?: number;
}

export interface PobTreeSpec {
  treeVersion: string;
  classId: number;
  ascendClassId: number;
  url: string;
  nodes: string;
  weaponSet1Nodes: string;
  weaponSet2Nodes: string;
}

export interface PobImportData {
  build: {
    className: string;
    ascendClassName: string;
    level: number;
    mainSkill: string;
    mainSocketGroup?: string;
    attribute_overrides?: {
      dexNodes?: string;
      intNodes?: string;
      strNodes?: string;
    };
    config?: string;
    configInputs?: PobConfigInput[];
    /** PoB had weapon set II active (ItemSet useSecondWeaponSet). */
    useSecondWeaponSet?: boolean;
  };
  treeSpec: PobTreeSpec | null;
  skillGroups: PobSkillGroup[];
  notes: string;
  items: Array<{
    text: string;
    slot: string;
  }>;
  stats?: Array<{
    stat: string;
    value: number;
  }>;
}

export interface PobSkillChoiceOptions {
  resolveSkillId?: (gem: PobGem) => string;
  resolveSupportId?: (gem: PobGem) => string;
  isSupportGem?: (gem: PobGem) => boolean;
}

export interface PobBuildPayloadOptions extends PobSkillChoiceOptions {
  plannerData?: BuildPlannerData | null;
  inventorySlotIds?: string[];
}

const nowIso = () => new Date().toISOString();
const choiceId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const safeJsonParse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const uniqueStrings = (values: Iterable<string>) => [...new Set([...values].map(String).filter(Boolean))];
const cleanText = (value: unknown) => String(value ?? "").trim();

const parseWholeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function selectedPassiveIds(snapshot: Pick<BuildTreeSnapshot, "allocatedIds" | "startIds">): string[] {
  const starts = new Set(snapshot.startIds);
  return uniqueStrings(snapshot.allocatedIds).filter((id) => !starts.has(id));
}

export function passiveCount(snapshot: Pick<BuildTreeSnapshot, "allocatedIds" | "startIds"> | null | undefined): number {
  return snapshot ? selectedPassiveIds(snapshot).length : 0;
}

export function readCurrentTreeSnapshot(): BuildTreeSnapshot | null {
  return safeJsonParse<BuildTreeSnapshot | null>(browserStorage()?.getItem(CURRENT_TREE_KEY) ?? null, null);
}

export function writeCurrentTreeSnapshot(snapshot: BuildTreeSnapshot): void {
  browserStorage()?.setItem(CURRENT_TREE_KEY, JSON.stringify(snapshot));
}

export function readSavedTreeSnapshots(): BuildTreeSnapshot[] {
  const rows = safeJsonParse<BuildTreeSnapshot[]>(browserStorage()?.getItem(SAVED_TREES_KEY) ?? null, []);
  return Array.isArray(rows) ? rows.filter((row) => row?.id && Array.isArray(row.allocatedIds)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
}

export function writeSavedTreeSnapshots(rows: BuildTreeSnapshot[]): void {
  browserStorage()?.setItem(SAVED_TREES_KEY, JSON.stringify(rows.slice(0, 24)));
}

export function saveTreeSnapshot(snapshot: BuildTreeSnapshot): BuildTreeSnapshot[] {
  const rows = readSavedTreeSnapshots();
  const next = [snapshot, ...rows.filter((row) => row.id !== snapshot.id)];
  writeSavedTreeSnapshots(next);
  return next;
}

export function deleteTreeSnapshot(snapshotId: string): BuildTreeSnapshot[] {
  const next = readSavedTreeSnapshots().filter((row) => row.id !== snapshotId);
  writeSavedTreeSnapshots(next);
  return next;
}

const normalizeTreeSnapshots = (rows: unknown): BuildTreeSnapshot[] => {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is BuildTreeSnapshot => (
    isPlainObject(row) &&
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    Array.isArray(row.allocatedIds) &&
    Array.isArray(row.startIds)
  )).map((row) => ({
    ...row,
    className: row.className || "Passive tree",
    ascendancyName: row.ascendancyName || "",
    treeVersion: row.treeVersion || "",
    createdAt: row.createdAt || nowIso(),
    updatedAt: row.updatedAt || row.createdAt || nowIso()
  }));
};

const normalizeInventoryChoices = (rows: unknown): BuildInventoryChoice[] => {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is BuildInventoryChoice => (
    isPlainObject(row) &&
    typeof row.inventoryId === "string"
  )).map((row) => ({
    id: row.id || `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    inventoryId: row.inventoryId,
    itemName: row.itemName || "",
    note: row.note || "",
    isUnique: Boolean(row.isUnique),
    levelStart: row.levelStart || "",
    levelEnd: row.levelEnd || "",
    itemSlug: row.itemSlug || "",
    iconUrl: row.iconUrl || "",
    baseName: row.baseName || "",
    itemLevel: row.itemLevel !== undefined ? row.itemLevel : (row as any).item_level,
    quality: row.quality,
    corrupted: row.corrupted !== undefined ? row.corrupted : (row as any).corrupted,
    rareName: row.rareName || (row as any).rare_name,
    implicitCount: row.implicitCount !== undefined ? row.implicitCount : (row as any).implicit_count,
    rawText: row.rawText || (row as any).raw_text || "",
    ...(typeof row.originalText === "string" ? { originalText: row.originalText } : {}),
    ...(row.edited ? { edited: true } : {})
  }));
}

const normalizeSupportSkillChoices = (rows: unknown): BuildSupportSkillChoice[] => {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is BuildSupportSkillChoice => (
    isPlainObject(row) &&
    typeof row.skillId === "string"
  )).map((row) => ({
    id: row.id || choiceId("support"),
    skillId: row.skillId || "",
    note: row.note || "",
    levelStart: row.levelStart || "",
    levelEnd: row.levelEnd || "",
    ...gemDetailsFromPayload(row),
    ...(row.disabled ? { disabled: true } : {}),
    ...(row.active ? { active: true } : {})
  }));
};

const normalizeSkillChoices = (rows: unknown): BuildSkillChoice[] => {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is BuildSkillChoice => (
    isPlainObject(row) &&
    typeof row.skillId === "string"
  )).map((row) => ({
    id: row.id || choiceId("skill"),
    skillId: row.skillId || "",
    note: row.note || "",
    levelStart: row.levelStart || "",
    levelEnd: row.levelEnd || "",
    supportSkills: normalizeSupportSkillChoices(row.supportSkills),
    ...gemDetailsFromPayload(row),
    ...(row.disabled ? { disabled: true } : {}),
    ...(row.gemDisabled ? { gemDisabled: true } : {}),
    ...(row.itemSlot ? { itemSlot: row.itemSlot } : {}),
    ...(row.itemSource ? { itemSource: row.itemSource } : {}),
    ...((row.mainActiveSkill ?? 1) > 1 ? { mainActiveSkill: row.mainActiveSkill } : {})
  }));
};

const STASH_SOURCES: StashSource[] = ["pob", "paste", "search", "unequipped"];

export function normalizeStash(rows: unknown): BuildStashItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row): BuildStashItem | null => {
      const rawText = typeof row.rawText === "string" && row.rawText ? row.rawText : undefined;
      const itemName = typeof row.itemName === "string" ? row.itemName : "";
      if (!rawText && !itemName) return null;
      return {
        id: typeof row.id === "string" && row.id ? row.id : `stash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        rawText,
        itemName,
        isUnique: Boolean(row.isUnique),
        baseName: typeof row.baseName === "string" ? row.baseName : undefined,
        itemSlug: typeof row.itemSlug === "string" ? row.itemSlug : undefined,
        iconUrl: typeof row.iconUrl === "string" ? row.iconUrl : undefined,
        source: STASH_SOURCES.includes(row.source as StashSource) ? row.source as StashSource : "paste",
        ...(typeof row.originalText === "string" ? { originalText: row.originalText } : {}),
        ...(row.edited ? { edited: true } : {})
      };
    })
    .filter((row): row is BuildStashItem => Boolean(row))
    .slice(0, 300);
}

export function normalizeBuildProject(value: unknown): BuildProject | null {
  if (!isPlainObject(value) || typeof value.id !== "string") return null;
  const normalizedTrees = normalizeTreeSnapshots([
    ...(isPlainObject(value.treeSnapshot) ? [value.treeSnapshot] : []),
    ...(Array.isArray(value.treeSnapshots) ? value.treeSnapshots : [])
  ]);
  const importedPayload = isPlainObject(value.importedPayload) ? value.importedPayload : undefined;
  const selectedTree = typeof value.activeTreeId === "string"
    ? normalizedTrees.find((tree) => tree.id === value.activeTreeId) ?? normalizedTrees[0]
    : normalizedTrees[0];
  const treeSnapshots = selectedTree ? [selectedTree] : [];
  const activeTreeId = selectedTree?.id || "";
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "POE2 Build",
    author: typeof value.author === "string" ? value.author : "",
    description: typeof value.description === "string" ? value.description : "",
    treeSnapshots,
    activeTreeId,
    inventory: normalizeInventoryChoices(value.inventory),
    skills: normalizeSkillChoices(value.skills),
    stash: normalizeStash(value.stash),
    importedPayload,
    importedFileName: typeof value.importedFileName === "string" ? value.importedFileName : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso()
  };
}

export function readSavedBuildProjects(): BuildProject[] {
  const rows = safeJsonParse<unknown[]>(browserStorage()?.getItem(SAVED_BUILDS_KEY) ?? null, []);
  return Array.isArray(rows)
    ? rows.map(normalizeBuildProject).filter((row): row is BuildProject => Boolean(row)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];
}

export function writeSavedBuildProjects(rows: BuildProject[]): void {
  browserStorage()?.setItem(SAVED_BUILDS_KEY, JSON.stringify(rows.slice(0, 32)));
}

export function createBuildProject({
  id,
  name,
  author,
  description,
  treeSnapshot = null,
  treeSnapshots = [],
  activeTreeId = "",
  inventory = [],
  skills = [],
  stash = [],
  importedPayload,
  importedFileName,
  createdAt
}: {
  id?: string;
  name: string;
  author: string;
  description: string;
  treeSnapshot?: BuildTreeSnapshot | null;
  treeSnapshots?: BuildTreeSnapshot[];
  activeTreeId?: string;
  inventory?: BuildInventoryChoice[];
  skills?: BuildSkillChoice[];
  stash?: BuildStashItem[];
  importedPayload?: BuildPayload;
  importedFileName?: string;
  createdAt?: string;
}): BuildProject {
  const timestamp = nowIso();
  const trees = normalizeTreeSnapshots([...(treeSnapshot ? [treeSnapshot] : []), ...treeSnapshots]);
  const selectedTree = activeTreeId
    ? trees.find((tree) => tree.id === activeTreeId) ?? trees[0]
    : trees[0];
  const treeId = selectedTree?.id || "";
  return {
    id: id || `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "POE2 Build",
    author: author.trim(),
    description: description.trim(),
    treeSnapshots: selectedTree ? [selectedTree] : [],
    activeTreeId: treeId,
    inventory: normalizeInventoryChoices(inventory),
    skills: normalizeSkillChoices(skills),
    stash: normalizeStash(stash),
    importedPayload,
    importedFileName,
    createdAt: createdAt || timestamp,
    updatedAt: timestamp
  };
}

export function saveBuildProject(project: BuildProject): BuildProject[] {
  const rows = readSavedBuildProjects();
  const next = [project, ...rows.filter((row) => row.id !== project.id)];
  writeSavedBuildProjects(next);
  return next;
}

export function deleteBuildProject(projectId: string): BuildProject[] {
  const next = readSavedBuildProjects().filter((row) => row.id !== projectId);
  writeSavedBuildProjects(next);
  return next;
}

export function createTreeSnapshot({
  name,
  className,
  ascendancyName,
  allocatedIds,
  startIds,
  treeVersion,
  id
}: {
  name: string;
  className: string;
  ascendancyName: string;
  allocatedIds: Iterable<string>;
  startIds: Iterable<string>;
  treeVersion: string;
  id?: string;
}): BuildTreeSnapshot {
  const timestamp = nowIso();
  const safeClass = className || "Passive tree";
  const safeAscendancy = ascendancyName || "Base tree";
  const title = name.trim() || `${safeClass} - ${safeAscendancy}`;
  return {
    id: id || `tree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: title,
    className: safeClass,
    ascendancyName: ascendancyName || "",
    allocatedIds: uniqueStrings(allocatedIds),
    startIds: uniqueStrings(startIds),
    treeVersion,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function officialAscendancyId(snapshot: BuildTreeSnapshot, plannerData?: BuildPlannerData | null): string {
  if (!snapshot.ascendancyName) return "";
  return plannerData?.ascendancies?.[`${snapshot.className}|${snapshot.ascendancyName}`] || snapshot.ascendancyName;
}

export function officialPassiveIds(snapshot: BuildTreeSnapshot, plannerData?: BuildPlannerData | null): string[] {
  const lookup = plannerData?.passive_ids ?? {};
  return selectedPassiveIds(snapshot).map((id) => lookup[id] || id);
}

export function buildLevelInterval(start: string, end: string): number | [number, number] | undefined {
  const startText = start.trim();
  const endText = end.trim();
  const first = Number(startText);
  const second = Number(endText);
  const hasFirst = startText !== "" && Number.isFinite(first) && first >= 0;
  const hasSecond = endText !== "" && Number.isFinite(second) && second >= 0;
  if (hasFirst && hasSecond) return [Math.floor(first), Math.floor(second)];
  if (hasFirst) return Math.floor(first);
  if (hasSecond) return Math.floor(second);
  return undefined;
}

export function buildInventorySlot(choice: BuildInventoryChoice): Record<string, unknown> | null {
  const inventoryId = choice.inventoryId.trim();
  const itemName = choice.itemName.trim();
  const note = choice.note.trim();
  const levelInterval = buildLevelInterval(choice.levelStart, choice.levelEnd);
  if (!inventoryId || (!itemName && !note && levelInterval === undefined)) return null;

  const row: Record<string, unknown> = { inventory_id: inventoryId };
  if (levelInterval !== undefined) row.level_interval = levelInterval;
  if (choice.isUnique && itemName) row.unique_name = itemName;
  if (choice.itemLevel !== undefined) row.item_level = choice.itemLevel;
  if (choice.quality !== undefined) row.quality = choice.quality;
  if (choice.corrupted !== undefined) row.corrupted = choice.corrupted;
  if (choice.rareName !== undefined) row.rare_name = choice.rareName;
  if (choice.implicitCount !== undefined) row.implicit_count = choice.implicitCount;

  if (note) {
    row.additional_text = itemName
      ? `<silver>{${itemName}}\n\n<grey>{${note}}`
      : `<grey>{${note}}`;
  } else if (itemName && !choice.isUnique) {
    row.additional_text = `<silver>{${itemName}}`;
  }

  if (choice.rawText) {
    row.raw_text = choice.rawText;
  }

  return row;
}

export function normalizeImportedBuildPayload(value: unknown): BuildPayload {
  let payload = isPlainObject(value) ? value : null;
  if (payload && isPlainObject(payload.Build)) payload = payload.Build;
  if (payload && isPlainObject(payload.build)) payload = payload.build;
  if (!payload) throw new Error("File .build phải là JSON object hợp lệ.");

  const build = { ...payload };
  const name = typeof build.name === "string" ? build.name.trim() : "";
  if (!name) build.name = "Imported POE2 Build";
  return build;
}

export function parseBuildFileText(text: string): BuildPayload {
  try {
    return normalizeImportedBuildPayload(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("File .build không phải JSON hợp lệ.");
    throw error;
  }
}

function normalizedPobCode(value: string): string {
  return String(value || "").trim().replace(/\s+/g, "");
}

/** PoB export code (zlib + URL-safe Base64, as Path of Building writes it) for a PathOfBuilding2 XML. */
export async function encodePobXmlText(xml: string): Promise<string> {
  if (typeof globalThis.CompressionStream !== "function") {
    throw new Error("Trình duyệt này chưa hỗ trợ nén PoB code. Hãy dùng Chrome/Edge/Firefox bản mới.");
  }
  const stream = new Blob([new TextEncoder().encode(xml)]).stream().pipeThrough(new CompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

export function isPobExportCode(value: string): boolean {
  // zlib header 0x78 then 0x01 / 0x5E / 0x9C / 0xDA: PoB writes "eN", browsers "eJ".
  return /^e[AFJN][A-Za-z0-9+/=_-]{50,}$/.test(normalizedPobCode(value));
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = normalizedPobCode(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  let binary = "";
  try {
    binary = globalThis.atob(padded);
  } catch {
    throw new Error("PoB code không phải Base64 hợp lệ.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function inflateDeflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream !== "function") {
    throw new Error("Trình duyệt này chưa hỗ trợ giải nén PoB code. Hãy dùng Chrome/Edge bản mới hoặc import file .build.");
  }

  const stream = new DecompressionStream("deflate");
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const readable = new Blob([input]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(readable).arrayBuffer());
}

export async function decodePobXmlText(code: string): Promise<string> {
  const bytes = base64ToBytes(code);
  if (bytes.length < 4 || bytes[0] !== 120) {
    throw new Error("PoB code không có zlib header hợp lệ.");
  }
  let inflated: Uint8Array;
  try {
    inflated = await inflateDeflateBytes(bytes);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Trình duyệt này")) throw error;
    throw new Error("Không giải nén được PoB code. Chuỗi có thể bị thiếu hoặc hỏng.");
  }
  return new TextDecoder("utf-8").decode(inflated);
}

function xmlAttribute(element: Element | null | undefined, key: string, fallback = ""): string {
  return element?.getAttribute(key) ?? fallback;
}

export function parsePobXmlText(xml: string): PobImportData {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`PoB XML lỗi: ${(error.textContent ?? "").slice(0, 120)}`);
  return parsePobXmlDocument(doc);
}

/** Inputs of the active ConfigSet (or of <Config> itself in older codes). Placeholders are PoB defaults and are skipped. */
function pobGemExtraAttributes(gem: Element): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  for (const key of POB_GEM_EXTRA_ATTRIBUTES) {
    const value = gem.getAttribute(key);
    if (value !== null && value !== "") extra[key] = value;
  }
  return Object.keys(extra).length ? extra : undefined;
}

function pobConfigInputs(configEl: Element): PobConfigInput[] {
  const sets = [...configEl.querySelectorAll("ConfigSet")];
  const activeId = xmlAttribute(configEl, "activeConfigSet", "1");
  const container = sets.length ? (sets.find((row) => xmlAttribute(row, "id") === activeId) ?? sets[0]) : configEl;
  const inputs: PobConfigInput[] = [];
  for (const input of [...container.querySelectorAll("Input")]) {
    const name = xmlAttribute(input, "name");
    if (!name) continue;
    if (input.hasAttribute("boolean")) inputs.push({ name, kind: "boolean", value: xmlAttribute(input, "boolean") === "true" });
    else if (input.hasAttribute("number")) inputs.push({ name, kind: "number", value: Number(xmlAttribute(input, "number")) || 0 });
    else if (input.hasAttribute("string")) inputs.push({ name, kind: "string", value: xmlAttribute(input, "string") });
  }
  return inputs;
}

export function parsePobXmlDocument(doc: Document): PobImportData {
  const rootTag = doc.documentElement?.tagName || "";
  if (rootTag !== "PathOfBuilding" && rootTag !== "PathOfBuilding2") {
    throw new Error(`PoB XML không đúng định dạng: ${rootTag || "không có root"}.`);
  }

  const treeElement = doc.documentElement.querySelector("Tree");
  let treeSpec: PobTreeSpec | null = null;
  let attribute_overrides: PobImportData["build"]["attribute_overrides"] = undefined;
  if (treeElement) {
    const activeSpec = Math.max(1, parseWholeNumber(xmlAttribute(treeElement, "activeSpec", "1"), 1));
    const specs = [...treeElement.querySelectorAll("Spec")];
    const spec = specs[activeSpec - 1] ?? specs[0] ?? null;
    if (spec) {
      const urlElement = spec.querySelector("URL");
      const weaponSet1 = spec.querySelector("WeaponSet1");
      const weaponSet2 = spec.querySelector("WeaponSet2");
      treeSpec = {
        treeVersion: xmlAttribute(spec, "treeVersion"),
        classId: parseWholeNumber(xmlAttribute(spec, "classId", "0"), 0),
        ascendClassId: parseWholeNumber(xmlAttribute(spec, "ascendClassId", "0"), 0),
        url: cleanText(urlElement?.textContent || xmlAttribute(spec, "URL")),
        nodes: xmlAttribute(spec, "nodes"),
        weaponSet1Nodes: xmlAttribute(weaponSet1, "nodes"),
        weaponSet2Nodes: xmlAttribute(weaponSet2, "nodes")
      };

      const attrOverride = spec.querySelector("AttributeOverride");
      if (attrOverride) {
        attribute_overrides = {
          dexNodes: xmlAttribute(attrOverride, "dexNodes") || undefined,
          intNodes: xmlAttribute(attrOverride, "intNodes") || undefined,
          strNodes: xmlAttribute(attrOverride, "strNodes") || undefined
        };
      }
    }
  }

  const configEl = doc.documentElement.querySelector("Config");
  let config: string | undefined = undefined;
  let configInputs: PobConfigInput[] | undefined = undefined;
  if (configEl) {
    config = configEl.outerHTML || new XMLSerializer().serializeToString(configEl);
    configInputs = pobConfigInputs(configEl);
  }

  const buildElement = doc.documentElement.querySelector("Build");
  const build: PobImportData["build"] = {
    className: xmlAttribute(buildElement, "className"),
    ascendClassName: xmlAttribute(buildElement, "ascendClassName"),
    level: parseWholeNumber(xmlAttribute(buildElement, "level", "1"), 1),
    mainSkill: xmlAttribute(buildElement, "mainSkill"),
    mainSocketGroup: xmlAttribute(buildElement, "mainSocketGroup") || undefined,
    attribute_overrides,
    config,
    configInputs
  };

  const skillsElement = doc.documentElement.querySelector("Skills");
  const skillGroups: PobSkillGroup[] = [];
  if (skillsElement) {
    let activeSkillContainer: Element = skillsElement;
    const skillSets = [...skillsElement.querySelectorAll("SkillSet")];
    if (skillSets.length) {
      const activeSkillSetId = xmlAttribute(skillsElement, "activeSkillSet", "1");
      activeSkillContainer = skillSets.find((row) => xmlAttribute(row, "id") === activeSkillSetId) ?? skillSets[0];
    }

    for (const skill of [...activeSkillContainer.querySelectorAll("Skill")]) {
      const gems = [...skill.querySelectorAll("Gem")].map((gem): PobGem => ({
        nameSpec: xmlAttribute(gem, "nameSpec"),
        level: parseWholeNumber(xmlAttribute(gem, "level", "0"), 0),
        quality: parseWholeNumber(xmlAttribute(gem, "quality", "0"), 0),
        enabled: xmlAttribute(gem, "enabled", "true") !== "false",
        skillEnabled: xmlAttribute(gem, "skillEnabled", "true") !== "false",
        skillId: xmlAttribute(gem, "skillId"),
        gemId: xmlAttribute(gem, "gemId") || undefined,
        variantId: xmlAttribute(gem, "variantId") || undefined,
        extra: pobGemExtraAttributes(gem)
      }));
      // Empty groups are kept: PoB's mainSocketGroup counts them.
      skillGroups.push({
        enabled: xmlAttribute(skill, "enabled", "true") !== "false",
        slot: xmlAttribute(skill, "slot"),
        source: xmlAttribute(skill, "source") || undefined,
        mainActiveSkill: parseWholeNumber(xmlAttribute(skill, "mainActiveSkill", "1"), 1) || 1,
        gems
      });
    }
  }

  const notes = cleanText(doc.documentElement.querySelector("Notes")?.textContent);
  const itemsElement = doc.documentElement.querySelector("Items");
  const items: PobImportData["items"] = [];
  if (itemsElement) {
    const slotByItemId = new Map<string, string>();
    const activeItemSetId = xmlAttribute(itemsElement, "activeItemSet", "1");
    const itemSets = [...itemsElement.querySelectorAll("ItemSet")];
    const activeItemSet = itemSets.find((row) => xmlAttribute(row, "id") === activeItemSetId) ?? itemSets[0] ?? null;
    if ((xmlAttribute(activeItemSet, "useSecondWeaponSet") || xmlAttribute(itemsElement, "useSecondWeaponSet")) === "true") build.useSecondWeaponSet = true;
    if (activeItemSet) {
      for (const slot of [...activeItemSet.querySelectorAll("Slot")]) {
        const itemId = xmlAttribute(slot, "itemId");
        const name = xmlAttribute(slot, "name");
        if (itemId && name) slotByItemId.set(itemId, name);
      }
    }

    const socketsElement = doc.documentElement.querySelector("Sockets");
    if (socketsElement) {
      for (const socket of [...socketsElement.querySelectorAll("Socket")]) {
        const itemId = xmlAttribute(socket, "itemId");
        const nodeId = xmlAttribute(socket, "nodeId");
        if (itemId && nodeId) {
          slotByItemId.set(itemId, `PassiveJewel:${nodeId}`);
        } else if (itemId) {
          slotByItemId.set(itemId, "Jewel");
        }
      }
    }

    for (const item of [...itemsElement.querySelectorAll("Item")]) {
      const text = cleanText(item.textContent);
      if (!text) continue;
      const id = xmlAttribute(item, "id");
      items.push({
        text,
        slot: slotByItemId.get(id) || xmlAttribute(item, "slot")
      });
    }
  }

  const stats: Array<{ stat: string; value: number }> = [];
  if (buildElement) {
    for (const statEl of [...buildElement.querySelectorAll("PlayerStat")]) {
      const stat = xmlAttribute(statEl, "stat");
      const valStr = xmlAttribute(statEl, "value");
      if (stat && valStr) {
        stats.push({ stat, value: parseFloat(valStr) || 0 });
      }
    }
  }

  return { build, treeSpec, skillGroups, notes, items, stats };
}

export async function parsePobExportCode(code: string): Promise<PobImportData> {
  if (!isPobExportCode(code)) throw new Error("PoB code phải bắt đầu bằng eN và đủ dài.");
  return parsePobXmlText(await decodePobXmlText(code));
}

function passiveIdsFromPobNodeList(value: string): string[] {
  return cleanText(value).split(/[\s,]+/).map((id) => id.trim()).filter((id) => id && id !== "0");
}

function passiveIdsFromPobTreeUrl(value: string): string[] {
  const match = cleanText(value).match(/passive-skill-tree\/[^/]+\/([A-Za-z0-9_=+/-]+)/);
  if (!match) return [];
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(match[1]);
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (let index = 7; index + 1 < bytes.length; index += 2) {
    const id = (bytes[index] << 8) | bytes[index + 1];
    if (id) ids.push(String(id));
  }
  return ids;
}

export function passiveIdsFromPobImport(data: PobImportData): string[] {
  const spec = data.treeSpec;
  if (!spec) return [];
  const ids = [
    ...passiveIdsFromPobNodeList(spec.nodes),
    ...passiveIdsFromPobNodeList(spec.weaponSet1Nodes),
    ...passiveIdsFromPobNodeList(spec.weaponSet2Nodes)
  ];
  if (!ids.length) ids.push(...passiveIdsFromPobTreeUrl(spec.url));
  return uniqueStrings(ids);
}

export function pobBuildClassNames(data: PobImportData, plannerData?: BuildPlannerData | null): Pick<BuildTreeSnapshot, "className" | "ascendancyName"> {
  const rawClass = cleanText(data.build.className);
  const rawAscendancy = cleanText(data.build.ascendClassName);
  const ascendancyName = rawAscendancy && rawAscendancy !== "None" ? rawAscendancy : "";
  const entries = Object.keys(plannerData?.ascendancies ?? {}).map((key) => {
    const [className, ascName = ""] = key.split("|");
    return { className, ascendancyName: ascName };
  });

  if (ascendancyName) {
    const match = entries.find((row) => row.ascendancyName.toLowerCase() === ascendancyName.toLowerCase());
    if (match) return { className: rawClass || match.className, ascendancyName: match.ascendancyName };
    return { className: rawClass || "PoB import", ascendancyName };
  }

  const classAsAscendancy = entries.find((row) => row.ascendancyName.toLowerCase() === rawClass.toLowerCase());
  if (classAsAscendancy) return classAsAscendancy;
  return { className: rawClass || "PoB import", ascendancyName: "" };
}

export function pobAscendancyId(data: PobImportData, plannerData?: BuildPlannerData | null): string {
  const { className, ascendancyName } = pobBuildClassNames(data, plannerData);
  if (!ascendancyName) return "";
  return plannerData?.ascendancies?.[`${className}|${ascendancyName}`] || ascendancyName;
}

export function pobBuildName(data: PobImportData): string {
  const className = cleanText(data.build.ascendClassName && data.build.ascendClassName !== "None" ? data.build.ascendClassName : data.build.className);
  const mainSkill = cleanText(data.build.mainSkill);
  return [className, mainSkill].filter(Boolean).join(" - ") || "Imported PoB Build";
}

function fallbackPobGemId(gem: PobGem, prefix: "SkillGem" | "SupportGem"): string {
  const rawId = cleanText(gem.skillId);
  // The game uses both Metadata/Items/Gem/ and Metadata/Items/Gems/ ids; keep either as-is.
  if (/^Metadata\/Items\/Gems?\//.test(rawId)) return rawId;
  if (rawId.startsWith(prefix)) return `Metadata/Items/Gems/${rawId}`;
  if (gem.gemId) return gem.gemId;
  const compactName = cleanText(gem.nameSpec).replace(/[^A-Za-z0-9]+/g, "");
  if (compactName) return `Metadata/Items/Gems/${prefix}${compactName}`;
  // Skills granted by the tree or an item ("ThornsPlayer") have no gem at all.
  return rawId;
}

function defaultPobSupportGemTest(gem: PobGem): boolean {
  if (gem.gemId) return /SupportGem/i.test(gem.gemId);
  if (/SupportGem/i.test(gem.skillId)) return true;
  if (/^support/i.test(gem.skillId)) return true;
  return /\bsupport\b/i.test(gem.nameSpec);
}

function pobGemDetails(gem: PobGem): BuildGemDetails {
  const details: BuildGemDetails = {};
  if (gem.level > 0) details.gemLevel = gem.level;
  if (gem.quality > 0) details.gemQuality = gem.quality;
  if (gem.gemId) details.pobGemId = gem.gemId;
  if (gem.skillId) details.pobSkillId = gem.skillId;
  if (gem.variantId) details.pobVariantId = gem.variantId;
  if (gem.nameSpec) details.nameSpec = gem.nameSpec;
  if (gem.extra && Object.keys(gem.extra).length) details.pobAttrs = { ...gem.extra };
  return details;
}

/**
 * One planner skill per PoB socket group, in PoB's order, disabled groups included,
 * so PoB's mainSocketGroup index still points at the same group.
 * Returns the choices and, for each PoB group, the index of its choice (-1 when the
 * group had no gem and was dropped).
 */
export function pobSkillGroupChoices(data: PobImportData, options: PobSkillChoiceOptions = {}): { choices: BuildSkillChoice[]; groupIndex: number[] } {
  const choices: BuildSkillChoice[] = [];
  const groupIndex: number[] = [];
  const isSupportGem = options.isSupportGem ?? defaultPobSupportGemTest;
  for (const group of data.skillGroups) {
    const gems = group.gems.filter((gem) => gem.nameSpec || gem.skillId || gem.gemId);
    const mainGem = gems.find((gem) => !isSupportGem(gem)) ?? gems[0];
    const skillId = mainGem ? options.resolveSkillId?.(mainGem) || fallbackPobGemId(mainGem, "SkillGem") : "";
    if (!mainGem || !skillId) {
      groupIndex.push(-1);
      continue;
    }
    const supportSkills = gems.filter((gem) => gem !== mainGem).map((gem): BuildSupportSkillChoice | null => {
      const active = !isSupportGem(gem);
      const supportId = active
        ? options.resolveSkillId?.(gem) || fallbackPobGemId(gem, "SkillGem")
        : options.resolveSupportId?.(gem) || fallbackPobGemId(gem, "SupportGem");
      if (!supportId) return null;
      return {
        id: choiceId("support"),
        skillId: supportId,
        note: "",
        levelStart: "",
        levelEnd: "",
        ...pobGemDetails(gem),
        ...(gem.enabled ? {} : { disabled: true }),
        ...(active ? { active: true } : {})
      };
    }).filter((support): support is BuildSupportSkillChoice => Boolean(support));
    const choice: BuildSkillChoice = {
      id: choiceId("skill"),
      skillId,
      note: "",
      levelStart: "",
      levelEnd: "",
      supportSkills,
      ...pobGemDetails(mainGem)
    };
    if (!group.enabled) choice.disabled = true;
    if (!mainGem.enabled) choice.gemDisabled = true;
    if (group.slot) choice.itemSlot = group.slot;
    if (group.source) choice.itemSource = group.source;
    if (group.mainActiveSkill && group.mainActiveSkill > 1) choice.mainActiveSkill = group.mainActiveSkill;
    groupIndex.push(choices.length);
    choices.push(choice);
  }
  return { choices, groupIndex };
}

export function skillChoicesFromPobImport(data: PobImportData, options: PobSkillChoiceOptions = {}): BuildSkillChoice[] {
  return pobSkillGroupChoices(data, options).choices;
}

function pobItemLines(text: string): string[] {
  return cleanText(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function pobItemRarity(lines: string[]): string {
  return cleanText(lines.find((line) => /^Rarity:/i.test(line))?.replace(/^Rarity:/i, "")).toLowerCase();
}

function pobItemTitle(lines: string[]): string {
  return lines.find((line) => !/^(Rarity:|Slot:|Item Level:|Quality:|Sockets:|Requirements:|Level:|Str:|Dex:|Int:|Implicits:|Explicits:|Crafted:|Corrupted|Mirrored|--------|Unique ID:|Radius:)/i.test(line)) ?? "";
}

function pobItemBaseName(lines: string[], title: string, rarity: string): string {
  const meaningful = lines.filter((line) => !/^(Rarity:|Slot:|Item Level:|Quality:|Sockets:|Requirements:|Level:|Str:|Dex:|Int:|Implicits:|Explicits:|Crafted:|Corrupted|Mirrored|--------|Unique ID:|Radius:)/i.test(line));
  if (rarity === "unique" || rarity === "rare") return meaningful.find((line) => line !== title) || "";
  return title;
}

function normalizePobSlotName(value: string): string {
  return cleanText(value).replace(/[^A-Za-z0-9]+/g, "").toLowerCase();
}

function firstFreeSlot(candidates: string[], used: Set<string>, allowed: Set<string>): string {
  return candidates.find((id) => allowed.has(id) && !used.has(id)) || candidates.find((id) => allowed.has(id)) || "";
}

function pobInventorySlotId(slotName: string, lines: string[], used: Set<string>, allowed: Set<string>): string {
  const normalized = normalizePobSlotName(slotName);
  const text = `${slotName}\n${lines.join("\n")}`;
  const explicit: Array<[RegExp, string[]]> = [
    [/^(weapon1|mainhand|weapon)$/i, ["Weapon1"]],
    [/^(weapon2|offhand|offhandweapon|shield|quiver)$/i, ["Weapon2"]],
    [/^(weapon1swap|mainhandswap|weaponswap1)$/i, ["Weapon3"]],
    [/^(weapon2swap|offhandswap|offhandweaponswap|shieldswap|quiverswap|weaponswap2)$/i, ["Weapon4"]],
    [/^(helm|helmet)$/i, ["Helm1"]],
    [/^(bodyarmour|bodyarmor|chest|armour|armor)$/i, ["BodyArmour1"]],
    [/^gloves$/i, ["Gloves1"]],
    [/^boots$/i, ["Boots1"]],
    [/^amulet$/i, ["Amulet1"]],
    [/^(ring1|leftring)$/i, ["Ring1"]],
    [/^(ring2|rightring)$/i, ["Ring2"]],
    [/^ring3$/i, ["Ring3"]],
    [/^ring$/i, ["Ring1", "Ring2"]],
    [/^belt$/i, ["Belt1"]],
    [/^(lifeflask|flask1)$/i, ["LifeFlask1"]],
    [/^(manaflask|flask2)$/i, ["ManaFlask1"]],
    [/^charm1$/i, ["Charm1"]],
    [/^charm2$/i, ["Charm2"]],
    [/^charm3$/i, ["Charm3"]],
    [/^charm$/i, ["Charm1", "Charm2", "Charm3"]],
    [/^(trinket|relic)$/i, ["Trinket1"]],
    [/^jewel\s*1$/i, ["Jewel1"]],
    [/^jewel\s*2$/i, ["Jewel2"]],
    [/^jewel\s*3$/i, ["Jewel3"]],
    [/^jewel\s*4$/i, ["Jewel4"]],
    [/^jewel$/i, ["Jewel1", "Jewel2", "Jewel3", "Jewel4"]]
  ];
  for (const [pattern, candidates] of explicit) {
    if (pattern.test(normalized)) return firstFreeSlot(candidates, used, allowed);
  }

  const inferred: Array<[RegExp, string[]]> = [
    [/\b(life flask)\b/i, ["LifeFlask1"]],
    [/\b(mana flask)\b/i, ["ManaFlask1"]],
    [/\bcharm\b/i, ["Charm1", "Charm2", "Charm3"]],
    [/\b(belt|sash)\b/i, ["Belt1"]],
    [/\bring\b/i, ["Ring1", "Ring2"]],
    [/\b(amulet|talisman|torc)\b/i, ["Amulet1"]],
    [/\b(helmet|helm|crown|mask)\b/i, ["Helm1"]],
    [/\b(gloves|gauntlets)\b/i, ["Gloves1"]],
    [/\b(boots|greaves|slippers)\b/i, ["Boots1"]],
    [/\b(body armour|body armor|chest|plate|vest|tunic|robe)\b/i, ["BodyArmour1"]],
    [/\b(shield|buckler|focus|quiver)\b/i, ["Weapon2"]],
    [/\b(bow|wand|staff|sword|axe|mace|dagger|claw|sceptre|spear|crossbow|flail|quarterstaff)\b/i, ["Weapon1"]],
    [/\bjewel\b/i, ["Jewel1", "Jewel2", "Jewel3", "Jewel4"]]
  ];
  for (const [pattern, candidates] of inferred) {
    if (pattern.test(text)) return firstFreeSlot(candidates, used, allowed);
  }
  return "";
}

/**
 * PoB slots that have no place on the planner's paper doll (augment slots "Arm 1" /
 * "Leg 2", jewels socketed in gear "Gloves Jewel Socket 1"). The item is kept under
 * "PobSlot:<PoB slot name>" so the calculator still wears it.
 */
export const POB_EXTRA_SLOT_PREFIX = "PobSlot:";
export function isPobExtraSlotName(slotName: string): boolean {
  return /^(arm|leg)\s*\d+$/i.test(cleanText(slotName)) || /\bjewel socket\b/i.test(slotName);
}

/** Inventory rows kept besides the doll slots: passive-tree jewels and PoB extra slots. */
export function isExtraInventoryId(inventoryId: string): boolean {
  return inventoryId.startsWith("PassiveJewel:") || inventoryId.startsWith(POB_EXTRA_SLOT_PREFIX);
}

/** One row per doll slot (empty ones created), then the extra rows (jewels, PoB extra slots). */
export function inventoryForSlots(rows: BuildInventoryChoice[], slotIds: string[], emptyChoice: (slotId: string) => BuildInventoryChoice): BuildInventoryChoice[] {
  const bySlot = new Map(rows.map((row) => [row.inventoryId, row]));
  return [
    ...slotIds.map((slotId) => bySlot.get(slotId) ?? emptyChoice(slotId)),
    ...rows.filter((row) => isExtraInventoryId(row.inventoryId))
  ];
}

function pobIsJewel(lines: string[], slot: string): boolean {
  const normalizedSlot = (slot || "").toLowerCase();
  if (normalizedSlot === "jewel" || normalizedSlot.includes("jewel")) return true;
  
  const jewelBases = [
    "emerald", "ruby", "sapphire", "diamond",
    "time-lost emerald", "time-lost ruby", "time-lost sapphire", "time-lost diamond"
  ];
  
  return lines.slice(0, 5).some((line) => {
    const clean = line.trim().toLowerCase();
    return jewelBases.includes(clean) || clean.endsWith("jewel");
  });
}

export function inventoryChoicesFromPobImport(data: PobImportData, slotIds: string[]): BuildInventoryChoice[] {
  const allowed = new Set(slotIds);
  const used = new Set<string>();
  const bySlot = new Map<string, BuildInventoryChoice>();

  let jewelIndex = 1;
  // PoB keeps every item the player ever pasted; only the ones the active item set
  // wears (or a passive socket holds) are part of the build.
  const hasSlottedItems = data.items.some((item) => item.slot);

  for (const item of data.items) {
    const lines = pobItemLines(item.text);
    if (!lines.length) continue;
    if (hasSlottedItems && !item.slot) continue;
    const rarity = pobItemRarity(lines);
    const title = pobItemTitle(lines);
    const baseName = pobItemBaseName(lines, title, rarity);
    if (!title) continue;

    const itemLevelLine = lines.find((line) => /^Item Level:/i.test(line));
    const itemLevel = itemLevelLine ? parseInt(itemLevelLine.replace(/^Item Level:\s*/i, ""), 10) : undefined;

    const qualityLine = lines.find((line) => /^Quality:/i.test(line));
    const quality = qualityLine ? parseInt(qualityLine.replace(/^Quality:\s*\+?/i, ""), 10) : undefined;

    const corrupted = lines.some((line) => /^Corrupted/i.test(line));

    const implicitLine = lines.find((line) => /^Implicits:/i.test(line));
    const implicitCount = implicitLine ? parseInt(implicitLine.replace(/^Implicits:\s*/i, ""), 10) : undefined;

    const mods = lines.filter((line) => {
      const clean = line.trim();
      if (clean === title || clean === baseName) return false;
      if (clean.includes("<ModRange") || /^LevelReq:/i.test(clean)) return false;
      return !/^(Rarity:|Slot:|Item Level:|Quality:|Sockets:|Requirements:|Level:|Str:|Dex:|Int:|Implicits:|Explicits:|Crafted:|Corrupted|Mirrored|--------|Unique ID:|Radius:|Item Class:)/i.test(clean);
    }).map((line) => line.trim());
    const noteText = mods.join("\n");

    if (item.slot && isPobExtraSlotName(item.slot)) {
      const slotId = `${POB_EXTRA_SLOT_PREFIX}${cleanText(item.slot)}`;
      const isUnique = rarity === "unique";
      bySlot.set(slotId, {
        id: choiceId("pob-item"),
        inventoryId: slotId,
        itemName: isUnique ? title : baseName || title,
        note: noteText,
        isUnique,
        levelStart: "",
        levelEnd: "",
        baseName,
        itemLevel,
        quality,
        corrupted,
        implicitCount,
        rawText: item.text
      });
      used.add(slotId);
      continue;
    }

    const isJewel = pobIsJewel(lines, item.slot);
    if (isJewel) {
      const slotId = item.slot && item.slot.startsWith("PassiveJewel:")
        ? item.slot
        : `PassiveJewel:${jewelIndex++}`;
      const isUnique = rarity === "unique";
      const jewelBases = [
        "time-lost emerald", "time-lost ruby", "time-lost sapphire", "time-lost diamond",
        "emerald", "ruby", "sapphire", "diamond"
      ];
      let resolvedBase = "";
      const textToSearch = (title + " " + (baseName || "")).toLowerCase();
      for (const base of jewelBases) {
        if (textToSearch.includes(base)) {
          resolvedBase = base;
          break;
        }
      }
      const itemName = isUnique ? title : (resolvedBase ? resolvedBase.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : baseName || title);

      bySlot.set(slotId, {
        id: choiceId("pob-item"),
        inventoryId: slotId,
        itemName,
        note: noteText,
        isUnique,
        levelStart: "",
        levelEnd: "",
        baseName,
        itemLevel,
        quality,
        corrupted,
        implicitCount,
        rawText: item.text
      });
      used.add(slotId);
      continue;
    }

    const slotId = pobInventorySlotId(item.slot, lines, used, allowed);
    if (!slotId || used.has(slotId)) continue;
    const isUnique = rarity === "unique";
    const itemName = isUnique ? title : baseName || title;
    const rareName = !isUnique && baseName && title && title !== baseName ? title : undefined;
    const itemNote = [rareName, noteText].filter(Boolean).join("\n");
    used.add(slotId);
    bySlot.set(slotId, {
      id: choiceId("pob-item"),
      inventoryId: slotId,
      itemName,
      note: itemNote,
      isUnique,
      levelStart: "",
      levelEnd: "",
      baseName,
      itemLevel,
      quality,
      corrupted,
      rareName,
      implicitCount,
      rawText: item.text
    });
  }

  const gearChoices = slotIds.map((slotId) => bySlot.get(slotId) ?? {
    id: choiceId("item"),
    inventoryId: slotId,
    itemName: "",
    note: "",
    isUnique: false,
    levelStart: "",
    levelEnd: ""
  });

  const jewelChoices = [...bySlot.values()].filter((choice) => isExtraInventoryId(choice.inventoryId));

  return [...gearChoices, ...jewelChoices];
}

// ── Imported item text (PoB / in-game copy) ─────────────────────────────────

export type PobModKind = "implicit" | "explicit" | "rune" | "enchant";

export interface PobModLine {
  text: string;
  kind: PobModKind;
  /** crafted, fractured, desecrated, mutated, … from the line's {tags}. */
  flags: string[];
}

export interface PobItemDetails {
  rarity: "normal" | "magic" | "rare" | "unique" | "";
  name: string;
  baseName: string;
  itemLevel?: number;
  quality?: number;
  levelReq?: number;
  corrupted: boolean;
  mods: PobModLine[];
}

// Header and property lines in an item block that are not modifiers.
const POB_ITEM_META = /^(Rarity|Item Class|Unique ID|Item Level|Quality|Sockets|Rune|LevelReq|Requires|Implicits|Prefix|Suffix|Crafted|Selected Variant|Variant|Has Alt Variant\w*|League|Source|Limited to|Radius|Talisman Tier|Catalyst|CatalystQuality|Armour|Evasion|Energy Shield|Ward|ArmourBasePercentile|EvasionBasePercentile|EnergyShieldBasePercentile|Spirit|Physical Damage|Elemental Damage|Chaos Damage|Critical Hit Chance|Critical Strike Chance|Attacks per Second|Reload Time|Block chance|Charm Slots|Requirements|Level|Str|Dex|Int):/i;
const POB_ITEM_FLAG_LINE = /^(Corrupted|Mirrored|Split|Unidentified|Sanctified|Synthesised Item|Fractured Item|Desecrated Item)$/i;
const POB_KNOWN_FLAGS = new Set(["crafted", "custom", "disabled", "enchant", "fractured", "implicit", "desecrated", "mutated", "rune", "unscalable", "prefix", "suffix"]);

/** Replaces every "(min-max)" in a mod line with the value at `range` (PoB's own rule). */
export function applyPobRange(line: string, range: number[] | number = 0.5): string {
  let index = 0;
  return line.replace(/([+-]?)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g, (_all, sign: string, minText: string, maxText: string) => {
    const at = Array.isArray(range) ? (range[index] ?? 0.5) : range;
    index += 1;
    const min = Number(minText);
    const max = Number(maxText);
    let value = min + at * (max - min);
    // Whole-number stats stay whole; fractional ones keep up to two decimals.
    value = Number.isInteger(min) && Number.isInteger(max) ? Math.round(value) : Math.round(value * 100) / 100;
    if (sign === "-") value = -value;
    return sign === "+" && value > 0 ? `+${value}` : String(value);
  });
}

/**
 * Reads the item text PoB exports (also what the game copies with Ctrl+C) into
 * its name, base and modifier lines, ready to show in a tooltip. Tags such as
 * {crafted}, {range:0.4} and {variant:1,2} are applied and removed; lines of
 * variants that are not selected are dropped.
 */
export function parsePobItemDetails(rawText: string): PobItemDetails {
  const lines = String(rawText || "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
  const out: PobItemDetails = { rarity: "", name: "", baseName: "", corrupted: false, mods: [] };
  const rarityIndex = lines.findIndex((line) => /^Rarity:/i.test(line));
  if (rarityIndex < 0) {
    out.name = lines.find(Boolean) || "";
    return out;
  }
  const rarity = lines[rarityIndex].replace(/^Rarity:\s*/i, "").trim().toLowerCase();
  out.rarity = (["normal", "magic", "rare", "unique"].includes(rarity) ? rarity : "") as PobItemDetails["rarity"];
  out.name = lines[rarityIndex + 1] || "";
  // Rare and unique items have a name line followed by the base line.
  const hasBaseLine = out.rarity === "rare" || out.rarity === "unique";
  const nextLine = lines[rarityIndex + 2] || "";
  out.baseName = hasBaseLine && nextLine && !POB_ITEM_META.test(nextLine) && !/^-+$/.test(nextLine) ? nextLine : out.name;
  const bodyStart = rarityIndex + (out.baseName !== out.name ? 3 : 2);

  const selectedVariant = lines.map((line) => line.match(/^Selected Variant:\s*(\d+)/i)).find(Boolean)?.[1];
  let implicitsLeft = 0;
  for (let index = bodyStart; index < lines.length; index += 1) {
    let line = lines[index];
    if (!line || /^-+$/.test(line)) continue;
    const meta = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (meta && POB_ITEM_META.test(line)) {
      const key = meta[1].toLowerCase();
      const value = meta[2];
      if (key === "item level") out.itemLevel = Number.parseInt(value, 10) || undefined;
      else if (key === "quality") out.quality = Number.parseInt(value.replace(/^\+/, ""), 10) || undefined;
      else if (key === "levelreq") out.levelReq = Number.parseInt(value, 10) || undefined;
      else if (key === "implicits") implicitsLeft = Number.parseInt(value, 10) || 0;
      continue;
    }
    if (POB_ITEM_FLAG_LINE.test(line)) {
      if (/^corrupted$/i.test(line)) out.corrupted = true;
      continue;
    }

    const flags: string[] = [];
    let range: number[] | number = 0.5;
    let skip = false;
    // Leading {tag} / {key:value} groups.
    for (let match = line.match(/^\{([^}]*)\}/); match; match = line.match(/^\{([^}]*)\}/)) {
      line = line.slice(match[0].length).trimStart();
      const [rawKey, rawValue = ""] = match[1].split(/:(.*)/s);
      const key = rawKey.trim().toLowerCase();
      if (key === "range") {
        const values = rawValue.split(",").map(Number).filter((value) => Number.isFinite(value));
        range = values.length > 1 ? values : (values[0] ?? 0.5);
      } else if (key === "variant") {
        if (selectedVariant && !rawValue.split(",").map((value) => value.trim()).includes(selectedVariant)) skip = true;
      } else if (POB_KNOWN_FLAGS.has(key)) {
        flags.push(key);
      }
    }
    if (skip || !line) continue;
    line = applyPobRange(line, range).replace(/\s+\((?:crafted|implicit|enchant|rune|fractured|desecrated)\)$/i, "");

    let kind: PobModKind = "explicit";
    if (implicitsLeft > 0) {
      implicitsLeft -= 1;
      kind = flags.includes("enchant") ? "enchant" : flags.includes("rune") ? "rune" : "implicit";
    } else if (flags.includes("rune")) {
      kind = "rune";
    } else if (flags.includes("enchant")) {
      kind = "enchant";
    } else if (flags.includes("implicit")) {
      kind = "implicit";
    }
    if (flags.includes("disabled")) continue;
    out.mods.push({ text: line, kind, flags: flags.filter((flag) => !["implicit", "rune", "enchant", "prefix", "suffix", "custom", "unscalable"].includes(flag)) });
  }
  return out;
}

export function stripBuildMarkup(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/<[^>{]+>\{/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

export function splitBuildAdditionalText(value: string): { title: string; note: string } {
  const plain = stripBuildMarkup(value);
  const parts = plain.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return {
    title: parts[0] || "",
    note: parts.slice(1).join("\n\n")
  };
}

const levelIntervalToFields = (value: unknown): Pick<BuildInventoryChoice, "levelStart" | "levelEnd"> => {
  if (Array.isArray(value)) {
    return {
      levelStart: Number.isFinite(Number(value[0])) ? String(Math.floor(Number(value[0]))) : "",
      levelEnd: Number.isFinite(Number(value[1])) ? String(Math.floor(Number(value[1]))) : ""
    };
  }
  if (Number.isFinite(Number(value))) return { levelStart: String(Math.floor(Number(value))), levelEnd: "" };
  return { levelStart: "", levelEnd: "" };
};

export function inventoryChoiceFromBuildSlot(value: unknown): BuildInventoryChoice | null {
  if (!isPlainObject(value)) return null;
  const inventoryId = typeof value.inventory_id === "string" ? value.inventory_id.trim() : "";
  if (!inventoryId) return null;

  const uniqueName = typeof value.unique_name === "string" ? value.unique_name.trim() : "";
  const additionalText = typeof value.additional_text === "string" ? value.additional_text : "";
  const { title, note } = splitBuildAdditionalText(additionalText);
  const levelFields = levelIntervalToFields(value.level_interval);
  const cleanNote = uniqueName && title && title !== uniqueName
    ? [title, note].filter(Boolean).join("\n\n")
    : note;

  const itemLevel = typeof value.item_level === "number" ? value.item_level : undefined;
  const quality = typeof value.quality === "number" ? value.quality : undefined;
  const corrupted = typeof value.corrupted === "boolean" ? value.corrupted : undefined;
  const rareName = typeof value.rare_name === "string" ? value.rare_name.trim() : undefined;
  const implicitCount = typeof value.implicit_count === "number" ? value.implicit_count : undefined;

  const rawText = typeof value.raw_text === "string" ? value.raw_text : undefined;

  return {
    id: `imported-${inventoryId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    inventoryId,
    itemName: uniqueName || title,
    note: cleanNote,
    isUnique: Boolean(uniqueName),
    levelStart: levelFields.levelStart,
    levelEnd: levelFields.levelEnd,
    itemLevel,
    quality,
    corrupted,
    rareName,
    implicitCount,
    rawText
  };
}

function buildReferenceId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isPlainObject(value) && typeof value.id === "string") return value.id.trim();
  return "";
}

export function supportSkillChoiceFromBuildSupport(value: unknown): BuildSupportSkillChoice | null {
  const skillId = buildReferenceId(value);
  if (!skillId) return null;
  const levelFields = isPlainObject(value) ? levelIntervalToFields(value.level_interval) : { levelStart: "", levelEnd: "" };
  const choice: BuildSupportSkillChoice = {
    id: choiceId("support"),
    skillId,
    note: isPlainObject(value) && typeof value.additional_text === "string" ? value.additional_text : "",
    levelStart: levelFields.levelStart,
    levelEnd: levelFields.levelEnd,
    ...gemDetailsFromPayload(value)
  };
  if (isPlainObject(value) && value.disabled === true) choice.disabled = true;
  if (isPlainObject(value) && value.active === true) choice.active = true;
  return choice;
}

export function skillChoiceFromBuildSkill(value: unknown): BuildSkillChoice | null {
  const skillId = buildReferenceId(value);
  if (!skillId) return null;
  const levelFields = isPlainObject(value) ? levelIntervalToFields(value.level_interval) : { levelStart: "", levelEnd: "" };
  const supportRows = isPlainObject(value) && Array.isArray(value.support_skills) ? value.support_skills : [];
  const choice: BuildSkillChoice = {
    id: choiceId("skill"),
    skillId,
    note: isPlainObject(value) && typeof value.additional_text === "string" ? value.additional_text : "",
    levelStart: levelFields.levelStart,
    levelEnd: levelFields.levelEnd,
    supportSkills: supportRows.map(supportSkillChoiceFromBuildSupport).filter((row): row is BuildSupportSkillChoice => Boolean(row)),
    ...gemDetailsFromPayload(value)
  };
  if (isPlainObject(value)) {
    if (value.disabled === true) choice.disabled = true;
    if (value.gem_disabled === true) choice.gemDisabled = true;
    if (typeof value.item_slot === "string" && value.item_slot) choice.itemSlot = value.item_slot;
    if (typeof value.item_source === "string" && value.item_source) choice.itemSource = value.item_source;
    const mainActive = Number(value.main_active_skill);
    if (Number.isInteger(mainActive) && mainActive > 1) choice.mainActiveSkill = mainActive;
  }
  return choice;
}

export function skillChoicesFromBuildPayload(payload: BuildPayload): BuildSkillChoice[] {
  const importedSkills = Array.isArray(payload.skills) ? payload.skills : [];
  return importedSkills.map(skillChoiceFromBuildSkill).filter((row): row is BuildSkillChoice => Boolean(row));
}

export function inventoryChoicesFromBuildPayload(payload: BuildPayload, slotIds: string[]): BuildInventoryChoice[] {
  const importedSlots = Array.isArray(payload.inventory_slots) ? payload.inventory_slots : [];
  const bySlot = new Map<string, BuildInventoryChoice>();
  for (const row of importedSlots) {
    const choice = inventoryChoiceFromBuildSlot(row);
    if (choice && (slotIds.includes(choice.inventoryId) || isExtraInventoryId(choice.inventoryId)) && !bySlot.has(choice.inventoryId)) {
      bySlot.set(choice.inventoryId, choice);
    }
  }

  const gearChoices = slotIds.map((slotId) => bySlot.get(slotId) ?? {
    id: `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    inventoryId: slotId,
    itemName: "",
    note: "",
    isUnique: false,
    levelStart: "",
    levelEnd: ""
  });
  const jewelChoices = [...bySlot.values()].filter((choice) => isExtraInventoryId(choice.inventoryId));
  return [...gearChoices, ...jewelChoices];
}

const GEM_DETAIL_KEYS: Array<[keyof BuildGemDetails, string]> = [
  ["gemLevel", "gem_level"],
  ["gemQuality", "gem_quality"],
  ["pobGemId", "pob_gem_id"],
  ["pobSkillId", "pob_skill_id"],
  ["pobVariantId", "pob_variant_id"],
  ["nameSpec", "name_spec"]
];

function gemDetailsToPayload(choice: BuildGemDetails, row: Record<string, unknown>): void {
  for (const [key, payloadKey] of GEM_DETAIL_KEYS) {
    const value = choice[key];
    if (value !== undefined && value !== "") row[payloadKey] = value;
  }
  if (choice.pobAttrs && Object.keys(choice.pobAttrs).length) row.pob_attrs = { ...choice.pobAttrs };
}

/** Reads gem details from a payload row (snake_case) or a saved choice (camelCase). */
function gemDetailsFromPayload(value: unknown): BuildGemDetails {
  const details: BuildGemDetails = {};
  if (!isPlainObject(value)) return details;
  for (const [key, payloadKey] of GEM_DETAIL_KEYS) {
    const raw = value[payloadKey] ?? value[key];
    if (key === "gemLevel" || key === "gemQuality") {
      if (raw !== "" && raw !== null && raw !== undefined && Number.isFinite(Number(raw))) details[key] = Number(raw);
    } else if (typeof raw === "string" && raw) {
      (details as Record<string, unknown>)[key] = raw;
    }
  }
  const attrs = value.pob_attrs ?? value.pobAttrs;
  if (isPlainObject(attrs)) {
    const kept: Record<string, string> = {};
    for (const key of POB_GEM_EXTRA_ATTRIBUTES) if (typeof attrs[key] === "string") kept[key] = attrs[key] as string;
    if (Object.keys(kept).length) details.pobAttrs = kept;
  }
  return details;
}

const hasGemDetails = (choice: BuildGemDetails) => GEM_DETAIL_KEYS.some(([key]) => choice[key] !== undefined && choice[key] !== "") || Boolean(choice.pobAttrs);

/** Drops the PoB gem details; used when the player picks another gem in the planner. */
export function withoutPobGemDetails<T extends BuildGemDetails>(choice: T): T {
  const next = { ...choice };
  delete next.pobGemId;
  delete next.pobSkillId;
  delete next.pobVariantId;
  delete next.nameSpec;
  delete next.pobAttrs;
  return next;
}

export function buildSupportSkill(choice: BuildSupportSkillChoice): string | Record<string, unknown> | null {
  const skillId = choice.skillId.trim();
  const note = choice.note.trim();
  const levelInterval = buildLevelInterval(choice.levelStart, choice.levelEnd);
  if (!skillId) return null;
  if (!note && levelInterval === undefined && !hasGemDetails(choice) && !choice.disabled && !choice.active) return skillId;
  const row: Record<string, unknown> = { id: skillId };
  if (levelInterval !== undefined) row.level_interval = levelInterval;
  if (note) row.additional_text = note;
  gemDetailsToPayload(choice, row);
  if (choice.disabled) row.disabled = true;
  if (choice.active) row.active = true;
  return row;
}

export function buildSkill(choice: BuildSkillChoice): string | Record<string, unknown> | null {
  const skillId = choice.skillId.trim();
  const note = choice.note.trim();
  const levelInterval = buildLevelInterval(choice.levelStart, choice.levelEnd);
  const supportSkills = choice.supportSkills.map(buildSupportSkill).filter((row): row is string | Record<string, unknown> => Boolean(row));
  if (!skillId) return null;
  const hasGroupDetails = choice.disabled || choice.gemDisabled || choice.itemSlot || choice.itemSource || (choice.mainActiveSkill ?? 1) > 1;
  if (!note && levelInterval === undefined && !supportSkills.length && !hasGemDetails(choice) && !hasGroupDetails) return skillId;
  const row: Record<string, unknown> = { id: skillId };
  if (levelInterval !== undefined) row.level_interval = levelInterval;
  if (note) row.additional_text = note;
  if (supportSkills.length) row.support_skills = supportSkills;
  gemDetailsToPayload(choice, row);
  if (choice.disabled) row.disabled = true;
  if (choice.gemDisabled) row.gem_disabled = true;
  if (choice.itemSlot) row.item_slot = choice.itemSlot;
  if (choice.itemSource) row.item_source = choice.itemSource;
  if ((choice.mainActiveSkill ?? 1) > 1) row.main_active_skill = choice.mainActiveSkill;
  return row;
}

export function buildPlannerPayload(input: BuildExportInput): BuildPayload {
  const build: BuildPayload = isPlainObject(input.basePayload) ? { ...input.basePayload } : {};
  const baseName = typeof build.name === "string" ? build.name : "";
  const name = input.name.trim() || baseName.trim() || input.snapshot?.name || "POE2 Viet Hoa Build";
  build.name = name;
  const author = input.author.trim();
  const description = input.description.trim();
  const ascendancy = input.snapshot ? officialAscendancyId(input.snapshot, input.plannerData) : "";
  const passives = input.snapshot ? officialPassiveIds(input.snapshot, input.plannerData) : [];
  const inventorySlots = input.inventory.map(buildInventorySlot).filter((row): row is Record<string, unknown> => Boolean(row));
  const editedInventoryIds = new Set(input.inventory.map((row) => row.inventoryId.trim()).filter(Boolean));
  const skillChoices = Array.isArray(input.skills) ? normalizeSkillChoices(input.skills) : null;
  const skillRows = skillChoices ? skillChoices.map(buildSkill).filter((row): row is string | Record<string, unknown> => Boolean(row)) : [];
  const editedSkillIds = new Set((skillChoices ?? []).map((row) => row.skillId.trim()).filter(Boolean));
  const baseInventorySlots = Array.isArray(build.inventory_slots)
    ? build.inventory_slots.filter((row) => {
      if (!isPlainObject(row)) return false;
      const inventoryId = typeof row.inventory_id === "string" ? row.inventory_id.trim() : "";
      return inventoryId && !editedInventoryIds.has(inventoryId);
    })
    : [];
  const baseSkills = Array.isArray(build.skills)
    ? build.skills.filter((row) => {
      const skillId = buildReferenceId(row);
      return skillId && !editedSkillIds.has(skillId);
    })
    : [];

  if (author) build.author = author;
  else delete build.author;
  if (description) build.description = description;
  else delete build.description;
  if (input.snapshot) {
    if (ascendancy) build.ascendancy = ascendancy;
    else delete build.ascendancy;
    if (passives.length) build.passives = passives;
    else delete build.passives;
  }

  const nextInventorySlots = [...baseInventorySlots, ...inventorySlots];
  if (nextInventorySlots.length) build.inventory_slots = nextInventorySlots;
  else delete build.inventory_slots;

  if (skillChoices) {
    const nextSkills = [...baseSkills, ...skillRows];
    if (nextSkills.length) build.skills = nextSkills;
    else delete build.skills;
  }

  return build;
}

const DEFAULT_INVENTORY_SLOTS = [
  "Weapon1", "Weapon2", "Weapon3", "Weapon4",
  "Helm1", "BodyArmour1", "Gloves1", "Boots1",
  "Amulet1", "Ring1", "Ring2", "Belt1",
  "LifeFlask1", "ManaFlask1",
  "Charm1", "Charm2", "Charm3", "Trinket1"
];

export function buildPayloadFromPobImport(data: PobImportData, options: PobBuildPayloadOptions = {}): BuildPayload {
  const build: BuildPayload = {
    name: pobBuildName(data)
  };
  if (data.notes) build.description = data.notes.slice(0, 1000);
  if (typeof data.build.level === "number" && data.build.level > 0) {
    build.level = data.build.level;
  }

  const { className } = pobBuildClassNames(data, options.plannerData);
  if (className) build.className = className;

  const ascendancy = pobAscendancyId(data, options.plannerData);
  if (ascendancy) build.ascendancy = ascendancy;

  const passives = passiveIdsFromPobImport(data);
  if (passives.length) build.passives = passives;

  const { choices: skillChoices, groupIndex } = pobSkillGroupChoices(data, options);
  const skills = skillChoices
    .map(buildSkill)
    .filter((row): row is string | Record<string, unknown> => Boolean(row));
  if (skills.length) build.skills = skills;

  const weaponSetPassives: Record<string, string[]> = {};
  if (data.treeSpec?.weaponSet1Nodes) weaponSetPassives["1"] = passiveIdsFromPobNodeList(data.treeSpec.weaponSet1Nodes);
  if (data.treeSpec?.weaponSet2Nodes) weaponSetPassives["2"] = passiveIdsFromPobNodeList(data.treeSpec.weaponSet2Nodes);
  if (Object.keys(weaponSetPassives).length) build.weapon_set_passives = weaponSetPassives;
  if (data.build.configInputs?.length) build.config_inputs = data.build.configInputs;
  if (data.build.useSecondWeaponSet) build.active_weapon_set = 2;

  const slotIds = options.inventorySlotIds && options.inventorySlotIds.length ? options.inventorySlotIds : DEFAULT_INVENTORY_SLOTS;
  const inventorySlots = inventoryChoicesFromPobImport(data, slotIds)
    .map(buildInventorySlot)
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (inventorySlots.length) build.inventory_slots = inventorySlots;
  if (data.stats && data.stats.length) {
    build.stats = data.stats;
  }

  if (data.build.attribute_overrides) {
    build.attribute_overrides = data.build.attribute_overrides;
  }
  if (data.build.config) {
    build.config = data.build.config;
  }
  if (data.build.mainSocketGroup) {
    // PoB counts its own socket groups; point at the same group among the planner skills.
    const pobIndex = parseWholeNumber(data.build.mainSocketGroup, 1) - 1;
    const choiceIndex = groupIndex[pobIndex] ?? -1;
    build.mainSocketGroup = choiceIndex >= 0 ? choiceIndex + 1 : 1;
  }

  return normalizeImportedBuildPayload(build);
}

export interface CalculationRequestInput {
  /** The imported (or saved) build payload: class, level, config, weapon-set passives... */
  payload: BuildPayload;
  passives: string[];
  inventory: BuildInventoryChoice[];
  skills: BuildSkillChoice[];
  activeWeaponSet: 1 | 2;
  mainSocketGroup: number;
  /** Config the player changed in the planner; replaces the imported one. */
  configInputs?: PobConfigInput[];
  /** PoB item text for a slot without imported text (an item picked from the site list). */
  itemText?: (choice: BuildInventoryChoice) => string | undefined;
}

const calculationGem = (choice: BuildSkillChoice | BuildSupportSkillChoice, enabled: boolean) => {
  const row: Record<string, unknown> = {
    skill_id: choice.skillId,
    level: choice.gemLevel ?? 20,
    quality: choice.gemQuality ?? 0,
    enabled
  };
  if (choice.pobGemId) row.pob_gem_id = choice.pobGemId;
  if (choice.pobSkillId) row.pob_skill_id = choice.pobSkillId;
  if (choice.pobVariantId) row.pob_variant_id = choice.pobVariantId;
  if (choice.nameSpec) row.name_spec = choice.nameSpec;
  if (choice.pobAttrs) row.pob_attrs = choice.pobAttrs;
  return row;
};

/** Body of POST /api/builds/calculate (see src/server/pob-build-xml.mjs). */
export function calculationRequestBody(input: CalculationRequestInput): Record<string, unknown> {
  const { payload } = input;
  const text = (key: string) => (typeof payload[key] === "string" ? String(payload[key]) : "");
  const configInputs = input.configInputs ?? (Array.isArray(payload.config_inputs) ? payload.config_inputs as PobConfigInput[] : undefined);
  return {
    className: text("className") || "Witch",
    ascendancy: text("ascendancy") || "None",
    level: parseWholeNumber(payload.level, 90) || 90,
    passives: input.passives.map((id) => parseWholeNumber(id, 0)).filter(Boolean),
    weapon_set_passives: isPlainObject(payload.weapon_set_passives) ? payload.weapon_set_passives : undefined,
    inventory_slots: input.inventory
      .filter((row) => row.itemName || row.rawText)
      .map((row) => ({
        inventory_id: row.inventoryId,
        item_name: row.itemName,
        note: row.note,
        is_unique: row.isUnique,
        raw_text: row.rawText || input.itemText?.(row) || undefined,
        // Edited items are checked against the item rules on the server.
        ...(row.edited ? { edited: true } : {}),
        ...(typeof row.originalText === "string" && row.originalText !== row.rawText ? { original_text: row.originalText } : {})
      })),
    skills: input.skills
      .filter((row) => row.skillId.trim())
      .map((row) => {
        const group: Record<string, unknown> = {
          ...calculationGem(row, !row.gemDisabled),
          group_enabled: !row.disabled,
          support: row.supportSkills.filter((s) => s.skillId.trim()).map((s) => calculationGem(s, !s.disabled))
        };
        if (row.itemSlot) group.slot = row.itemSlot;
        if (row.itemSource) group.source = row.itemSource;
        if (row.mainActiveSkill) group.main_active_skill = row.mainActiveSkill;
        return group;
      }),
    activeWeaponSet: input.activeWeaponSet,
    attribute_overrides: payload.attribute_overrides,
    config_inputs: configInputs,
    // Older payloads only carry the raw <Config> element.
    config: configInputs ? undefined : payload.config,
    main_socket_group: input.mainSocketGroup
  };
}

export function buildFileName(name: string): string {
  const safe = (name.trim() || "poe2-build").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  const filename = safe || "poe2-build";
  return /\.build$/i.test(filename) ? filename : `${filename}.build`;
}

export function downloadBuildFile(payload: Record<string, unknown>, fileName: string): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type GemPickerRecord = { slug?: string; name?: string; gem_type?: string; color?: string };

// poe2db lists a gem once per class table, so the data carries copies such as
// "Herald_of_Thunder__3". The picker shows each gem once (the plain slug wins, then a
// coloured copy over an "item" one) and leaves out gems the game marks [DNT].
export function gemPickerOptions<T extends GemPickerRecord>(gems: T[], kind: "skill" | "support"): T[] {
  const copyRank = (gem: T) => (/__\d+$/.test(String(gem.slug ?? "")) ? 2 : 0) + (gem.color === "item" ? 1 : 0);
  const byName = new Map<string, T>();
  for (const gem of gems) {
    if (gem.gem_type !== kind || !gem.name || /\[DNT/i.test(gem.name)) continue;
    const key = gem.name.toLowerCase();
    const current = byName.get(key);
    if (!current || copyRank(gem) < copyRank(current)) byName.set(key, gem);
  }
  return [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// 0 exact name, 1 name starts with the query, 2 a word in the name does, 3 the name
// contains it, 4 matched only through tags/text. `query` is already lower-cased.
export function gemNameRank(name: string, query: string): number {
  if (!query) return 0;
  const lower = name.toLowerCase();
  if (lower === query) return 0;
  if (lower.startsWith(query)) return 1;
  if (lower.split(/[\s'-]+/).some((word) => word.startsWith(query))) return 2;
  if (lower.includes(query)) return 3;
  return 4;
}
