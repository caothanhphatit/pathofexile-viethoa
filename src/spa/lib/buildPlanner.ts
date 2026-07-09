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
}

export interface BuildSupportSkillChoice {
  id: string;
  skillId: string;
  note: string;
  levelStart: string;
  levelEnd: string;
}

export interface BuildSkillChoice {
  id: string;
  skillId: string;
  note: string;
  levelStart: string;
  levelEnd: string;
  supportSkills: BuildSupportSkillChoice[];
}

export type BuildPayload = Record<string, unknown>;

export interface BuildProject {
  id: string;
  name: string;
  author: string;
  description: string;
  treeSnapshots: BuildTreeSnapshot[];
  activeTreeId: string;
  inventory: BuildInventoryChoice[];
  skills: BuildSkillChoice[];
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
}

export interface PobSkillGroup {
  enabled: boolean;
  slot: string;
  gems: PobGem[];
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
    rawText: row.rawText || (row as any).raw_text || ""
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
    levelEnd: row.levelEnd || ""
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
    supportSkills: normalizeSupportSkillChoices(row.supportSkills)
  }));
};

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

export function isPobExportCode(value: string): boolean {
  return /^eN[A-Za-z0-9+/=_-]{50,}$/.test(normalizedPobCode(value));
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
  if (configEl) {
    config = configEl.outerHTML || new XMLSerializer().serializeToString(configEl);
  }

  const buildElement = doc.documentElement.querySelector("Build");
  const build = {
    className: xmlAttribute(buildElement, "className"),
    ascendClassName: xmlAttribute(buildElement, "ascendClassName"),
    level: parseWholeNumber(xmlAttribute(buildElement, "level", "1"), 1),
    mainSkill: xmlAttribute(buildElement, "mainSkill"),
    mainSocketGroup: xmlAttribute(buildElement, "mainSocketGroup") || undefined,
    attribute_overrides,
    config
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
        skillId: xmlAttribute(gem, "skillId")
      }));
      if (gems.length) {
        skillGroups.push({
          enabled: xmlAttribute(skill, "enabled", "true") !== "false",
          slot: xmlAttribute(skill, "slot"),
          gems
        });
      }
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
  if (/^Metadata\/Items\/Gems\//.test(rawId)) return rawId;
  if (rawId.startsWith(prefix)) return `Metadata/Items/Gems/${rawId}`;
  const compactName = cleanText(gem.nameSpec).replace(/[^A-Za-z0-9]+/g, "");
  return compactName ? `Metadata/Items/Gems/${prefix}${compactName}` : "";
}

function defaultPobSupportGemTest(gem: PobGem): boolean {
  if (/SupportGem/i.test(gem.skillId)) return true;
  if (/^support/i.test(gem.skillId)) return true;
  return /\bsupport\b/i.test(gem.nameSpec);
}

export function skillChoicesFromPobImport(data: PobImportData, options: PobSkillChoiceOptions = {}): BuildSkillChoice[] {
  const rows: BuildSkillChoice[] = [];
  const isSupportGem = options.isSupportGem ?? defaultPobSupportGemTest;
  for (const group of data.skillGroups) {
    if (!group.enabled) continue;
    const gems = group.gems.filter((gem) => gem.enabled && (gem.nameSpec || gem.skillId));
    if (!gems.length) continue;

    let activeGems = gems.filter((gem) => !isSupportGem(gem));
    let supportGems = gems.filter((gem) => isSupportGem(gem));
    if (!activeGems.length) {
      activeGems = [gems[0]];
      supportGems = gems.slice(1);
    }

    for (const gem of activeGems) {
      const skillId = options.resolveSkillId?.(gem) || fallbackPobGemId(gem, "SkillGem");
      if (!skillId) continue;
      rows.push({
        id: choiceId("skill"),
        skillId,
        note: "",
        levelStart: "",
        levelEnd: "",
        supportSkills: supportGems.map((support) => {
          const supportId = options.resolveSupportId?.(support) || fallbackPobGemId(support, "SupportGem");
          return supportId ? {
            id: choiceId("support"),
            skillId: supportId,
            note: "",
            levelStart: "",
            levelEnd: ""
          } : null;
        }).filter((support): support is BuildSupportSkillChoice => Boolean(support))
      });
    }
  }
  return rows;
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

  for (const item of data.items) {
    const lines = pobItemLines(item.text);
    if (!lines.length) continue;
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
    used.add(slotId);
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

  const jewelChoices = [...bySlot.values()].filter((choice) => choice.inventoryId.startsWith("PassiveJewel:"));

  return [...gearChoices, ...jewelChoices];
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
  return {
    id: choiceId("support"),
    skillId,
    note: isPlainObject(value) && typeof value.additional_text === "string" ? value.additional_text : "",
    levelStart: levelFields.levelStart,
    levelEnd: levelFields.levelEnd
  };
}

export function skillChoiceFromBuildSkill(value: unknown): BuildSkillChoice | null {
  const skillId = buildReferenceId(value);
  if (!skillId) return null;
  const levelFields = isPlainObject(value) ? levelIntervalToFields(value.level_interval) : { levelStart: "", levelEnd: "" };
  const supportRows = isPlainObject(value) && Array.isArray(value.support_skills) ? value.support_skills : [];
  return {
    id: choiceId("skill"),
    skillId,
    note: isPlainObject(value) && typeof value.additional_text === "string" ? value.additional_text : "",
    levelStart: levelFields.levelStart,
    levelEnd: levelFields.levelEnd,
    supportSkills: supportRows.map(supportSkillChoiceFromBuildSupport).filter((row): row is BuildSupportSkillChoice => Boolean(row))
  };
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
    if (choice && (slotIds.includes(choice.inventoryId) || choice.inventoryId.startsWith("PassiveJewel:")) && !bySlot.has(choice.inventoryId)) {
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
  const jewelChoices = [...bySlot.values()].filter((choice) => choice.inventoryId.startsWith("PassiveJewel:"));
  return [...gearChoices, ...jewelChoices];
}

export function buildSupportSkill(choice: BuildSupportSkillChoice): string | Record<string, unknown> | null {
  const skillId = choice.skillId.trim();
  const note = choice.note.trim();
  const levelInterval = buildLevelInterval(choice.levelStart, choice.levelEnd);
  if (!skillId) return null;
  if (!note && levelInterval === undefined) return skillId;
  const row: Record<string, unknown> = { id: skillId };
  if (levelInterval !== undefined) row.level_interval = levelInterval;
  if (note) row.additional_text = note;
  return row;
}

export function buildSkill(choice: BuildSkillChoice): string | Record<string, unknown> | null {
  const skillId = choice.skillId.trim();
  const note = choice.note.trim();
  const levelInterval = buildLevelInterval(choice.levelStart, choice.levelEnd);
  const supportSkills = choice.supportSkills.map(buildSupportSkill).filter((row): row is string | Record<string, unknown> => Boolean(row));
  if (!skillId) return null;
  if (!note && levelInterval === undefined && !supportSkills.length) return skillId;
  const row: Record<string, unknown> = { id: skillId };
  if (levelInterval !== undefined) row.level_interval = levelInterval;
  if (note) row.additional_text = note;
  if (supportSkills.length) row.support_skills = supportSkills;
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

  const skills = skillChoicesFromPobImport(data, options)
    .map(buildSkill)
    .filter((row): row is string | Record<string, unknown> => Boolean(row));
  if (skills.length) build.skills = skills;

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
    build.mainSocketGroup = data.build.mainSocketGroup;
  }

  return normalizeImportedBuildPayload(build);
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
