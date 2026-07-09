import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadBuildPlannerData, loadItemsData, loadSkillGemsData } from "../lib/data";
import { displayImageUrl } from "../lib/image";
import { formatNumber, localizedText, type Locale, uiText } from "../lib/locale";
import { navigateTo } from "../lib/routes";
import { matchesQuery } from "../lib/text";
import { PassiveTreeWorkspace } from "./PassiveTreePage";
import {
  buildPayloadFromPobImport,
  buildFileName,
  buildPlannerPayload,
  createBuildProject,
  createTreeSnapshot,
  deleteBuildProject,
  downloadBuildFile,
  inventoryChoicesFromBuildPayload,
  isPobExportCode,
  parseBuildFileText,
  parsePobExportCode,
  passiveCount,
  passiveIdsFromPobImport,
  pobBuildClassNames,
  pobBuildName,
  readCurrentTreeSnapshot,
  readSavedBuildProjects,
  readSavedTreeSnapshots,
  saveTreeSnapshot,
  saveBuildProject,
  skillChoicesFromBuildPayload,
  type BuildPayload,
  type BuildInventoryChoice,
  type BuildPlannerData,
  type BuildProject,
  type BuildSkillChoice,
  type BuildSupportSkillChoice,
  type BuildTreeSnapshot,
  type PobGem,
  type PobImportData
} from "../lib/buildPlanner";

type SnapshotOption = {
  key: string;
  label: string;
  source: "current" | "saved";
  snapshot: BuildTreeSnapshot;
};

type ImportedBuild = {
  fileName: string;
  payload: BuildPayload;
  importedAt: string;
};

type GemPickerTarget =
  | { kind: "skill"; skillId: string }
  | { kind: "support"; skillId: string; supportId: string };

type BuildRouteState = {
  screen: "library" | "detail";
  projectId: string;
  isNew: boolean;
};

type BuildDialogAction = {
  label: string;
  tone?: "primary" | "danger" | "neutral";
  onClick?: () => void;
};

type BuildDialogState = {
  title: string;
  body?: string;
  actions: BuildDialogAction[];
};

type ItemRecord = {
  slug?: string;
  menu_key?: string;
  menu_label?: string;
  group_label?: string;
  name?: string;
  gem_type?: string;
  official_id?: string;
  icon_url?: string;
  icon_alt?: string;
  summary_en?: string;
  tags?: string[];
  rarity?: string;
  item_category?: string;
  build_slot_categories?: string[];
  properties?: string[];
  requirements?: string[];
  mods?: string[];
  i18n?: {
    name?: Record<string, string>;
    summary?: Record<string, string>;
    tags?: Array<Record<string, string>>;
    properties?: Array<Record<string, string>>;
    requirements?: Array<Record<string, string>>;
    mods?: Array<Record<string, string>>;
  };
};

type EquipmentSlot = {
  id: string;
  label: string;
  shortLabel: string;
  area: string;
  weaponSet?: 1 | 2;
  slotCategories: string[];
  menuKeys: string[];
  itemIconPattern?: RegExp;
  itemFilter?: (item: ItemRecord) => boolean;
  size?: "wide" | "tall" | "large";
};

const oneHandWeaponMenus = ["claws", "daggers", "flails", "one-hand-axes", "one-hand-maces", "one-hand-swords", "sceptres", "spears", "wands"];
const twoHandWeaponMenus = ["bows", "crossbows", "quarterstaves", "staves", "talismans", "traps", "two-hand-axes", "two-hand-maces", "two-hand-swords"];
const offHandMenus = ["bucklers", "foci", "quivers", "shields"];
const weaponMenus = [...oneHandWeaponMenus, ...twoHandWeaponMenus];
const offHandAndDualWieldMenus = [...offHandMenus, ...oneHandWeaponMenus];
const actualItemIconPattern = /\/2DItems\//i;
const weaponIconPattern = /\/2DItems\/(?:Weapons|Offhand\/Talismans)\//i;
const offHandIconPattern = /\/2DItems\/(?:Weapons\/OneHandWeapons|Offhand\/(?:Shields|Foci)|Quivers)\//i;
const helmetIconPattern = /\/2DItems\/Armours\/Helmets\//i;
const bodyArmourIconPattern = /\/2DItems\/Armours\/BodyArmours\//i;
const glovesIconPattern = /\/2DItems\/Armours\/Gloves\//i;
const bootsIconPattern = /\/2DItems\/Armours\/Boots\//i;
const amuletIconPattern = /\/2DItems\/Amulets\//i;
const ringIconPattern = /\/2DItems\/Rings\//i;
const beltIconPattern = /\/2DItems\/Belts\//i;
const flaskIconPattern = /\/2DItems\/Flasks\//i;
const charmIconPattern = /\/2DItems\/Charms\//i;
const relicIconPattern = /\/2DItems\/Relics\//i;
const beltBaseIconPattern = /\/2DItems\/Belts\/(?:Basetypes\/|Demibelt)/i;
const uniqueItemIconPattern = /\/(?:Uniques\/|RelicUnique|Demigods|Demibelt)/i;

function itemPropertyLines(item: ItemRecord): string[] {
  return (item.properties ?? []).map(String).filter(Boolean);
}

function hasBaseLine(item: ItemRecord, pattern: RegExp): boolean {
  return itemPropertyLines(item).some((line) => pattern.test(line));
}

function hasActualIcon(item: ItemRecord): boolean {
  return actualItemIconPattern.test(item.icon_url ?? "");
}

function isLifeFlaskItem(item: ItemRecord): boolean {
  return item.menu_key === "life-flasks" && flaskIconPattern.test(item.icon_url ?? "");
}

function isManaFlaskItem(item: ItemRecord): boolean {
  return item.menu_key === "mana-flasks" && flaskIconPattern.test(item.icon_url ?? "");
}

function isBeltItem(item: ItemRecord): boolean {
  const iconUrl = item.icon_url ?? "";
  if (!beltIconPattern.test(iconUrl)) return false;
  return item.menu_key === "belts" || beltBaseIconPattern.test(iconUrl) || hasBaseLine(item, /\bBelt\b/i);
}

function isCharmItem(item: ItemRecord): boolean {
  return charmIconPattern.test(item.icon_url ?? "");
}

const equipmentSlots: EquipmentSlot[] = [
  { id: "Weapon1", label: "Weapon I", shortLabel: "WPN I", area: "weapon", weaponSet: 1, slotCategories: ["weapon"], menuKeys: weaponMenus, itemIconPattern: weaponIconPattern, size: "tall" },
  { id: "Weapon2", label: "Off-hand I", shortLabel: "OFF I", area: "offhand", weaponSet: 1, slotCategories: ["offhand"], menuKeys: offHandAndDualWieldMenus, itemIconPattern: offHandIconPattern, size: "tall" },
  { id: "Weapon3", label: "Weapon II", shortLabel: "WPN II", area: "weapon", weaponSet: 2, slotCategories: ["weapon"], menuKeys: weaponMenus, itemIconPattern: weaponIconPattern, size: "tall" },
  { id: "Weapon4", label: "Off-hand II", shortLabel: "OFF II", area: "offhand", weaponSet: 2, slotCategories: ["offhand"], menuKeys: offHandAndDualWieldMenus, itemIconPattern: offHandIconPattern, size: "tall" },
  { id: "Helm1", label: "Helmet", shortLabel: "Helm", area: "helm", slotCategories: ["helmet"], menuKeys: ["helmets"], itemIconPattern: helmetIconPattern },
  { id: "BodyArmour1", label: "Body Armour", shortLabel: "Body", area: "body", slotCategories: ["body-armour"], menuKeys: ["body-armours"], itemIconPattern: bodyArmourIconPattern, size: "large" },
  { id: "Gloves1", label: "Gloves", shortLabel: "Gloves", area: "gloves", slotCategories: ["gloves"], menuKeys: ["gloves"], itemIconPattern: glovesIconPattern },
  { id: "Boots1", label: "Boots", shortLabel: "Boots", area: "boots", slotCategories: ["boots"], menuKeys: ["boots"], itemIconPattern: bootsIconPattern },
  { id: "Amulet1", label: "Amulet", shortLabel: "Amulet", area: "amulet", slotCategories: ["amulet"], menuKeys: ["amulets"], itemIconPattern: amuletIconPattern },
  { id: "Ring1", label: "Ring 1", shortLabel: "Ring", area: "ring1", slotCategories: ["ring"], menuKeys: ["rings"], itemIconPattern: ringIconPattern },
  { id: "Ring2", label: "Ring 2", shortLabel: "Ring", area: "ring2", slotCategories: ["ring"], menuKeys: ["rings"], itemIconPattern: ringIconPattern },
  { id: "Ring3", label: "Ring 3", shortLabel: "Ring", area: "ring3", slotCategories: ["ring"], menuKeys: ["rings"], itemIconPattern: ringIconPattern },
  { id: "Belt1", label: "Belt", shortLabel: "Belt", area: "belt", slotCategories: ["belt"], menuKeys: ["belts", "charms", "flasks"], itemIconPattern: beltIconPattern, itemFilter: isBeltItem, size: "wide" },
  { id: "LifeFlask1", label: "Life Flask", shortLabel: "HP", area: "lifeflask", slotCategories: ["life-flask"], menuKeys: ["life-flasks"], itemIconPattern: flaskIconPattern, itemFilter: isLifeFlaskItem },
  { id: "ManaFlask1", label: "Mana Flask", shortLabel: "MP", area: "manaflask", slotCategories: ["mana-flask"], menuKeys: ["mana-flasks"], itemIconPattern: flaskIconPattern, itemFilter: isManaFlaskItem },
  { id: "Charm1", label: "Charm 1", shortLabel: "C1", area: "charm1", slotCategories: ["charm"], menuKeys: ["charms"], itemIconPattern: charmIconPattern, itemFilter: isCharmItem },
  { id: "Charm2", label: "Charm 2", shortLabel: "C2", area: "charm2", slotCategories: ["charm"], menuKeys: ["charms"], itemIconPattern: charmIconPattern, itemFilter: isCharmItem },
  { id: "Charm3", label: "Charm 3", shortLabel: "C3", area: "charm3", slotCategories: ["charm"], menuKeys: ["charms"], itemIconPattern: charmIconPattern, itemFilter: isCharmItem },
  { id: "Trinket1", label: "Trinket", shortLabel: "Trinket", area: "trinket", slotCategories: ["relic"], menuKeys: ["relics"], itemIconPattern: relicIconPattern }
];

const equipmentSlotIds = equipmentSlots.map((slot) => slot.id);
const BUILD_HELP_SEEN_KEY = "poe2-build-detail-help-seen-v1";

const copy = {
  noTree: {
    vi: "Chưa có tree nào để export. Mở Passive Tree, chọn node rồi bấm Save tree.",
    en: "No tree is ready to export. Open Passive Tree, select nodes, then save the tree."
  },
  emptyTree: {
    vi: "Tree này chưa có passive đã chọn. Hãy tạo tree trước khi export.",
    en: "This tree has no selected passives yet. Create a tree before exporting."
  },
  currentTree: { vi: "Tree hiện tại", en: "Current tree" },
  savedTree: { vi: "Tree đã lưu", en: "Saved tree" },
  importBuild: { vi: "Import .build", en: "Import .build" },
  importPob: { vi: "Import từ PoB", en: "Import from PoB" },
  pobCode: { vi: "PoB code", en: "PoB code" },
  pobPlaceholder: { vi: "Dán PoB export code bắt đầu bằng eN...", en: "Paste a PoB export code that starts with eN..." },
  pobImportAction: { vi: "Import PoB", en: "Import PoB" },
  pobHint: { vi: "Dán code export từ Path of Building. App sẽ tạo build mới, kèm tree, skill/support và item đọc được.", en: "Paste a Path of Building export code. The app will create a new build with readable tree, skills/supports, and items." },
  pobInvalid: { vi: "PoB code phải bắt đầu bằng eN và đủ dài.", en: "PoB code must start with eN and be long enough." },
  libraryTitle: { vi: "Kho build", en: "Build library" },
  libraryEmpty: { vi: "Chưa có build nào. Tạo build mới hoặc import file .build để bắt đầu.", en: "No builds yet. Create a new build or import a .build file to start." },
  openBuild: { vi: "Mở build", en: "Open build" },
  backToBuilds: { vi: "Danh sách", en: "Build list" },
  newBuild: { vi: "Build mới", en: "New build" },
  saveBuild: { vi: "Lưu build", en: "Save build" },
  loadBuild: { vi: "Load", en: "Load" },
  deleteBuild: { vi: "Xóa", en: "Delete" },
  savedBuilds: { vi: "Build đã lưu", en: "Saved builds" },
  noSavedBuilds: { vi: "Chưa có build đã lưu.", en: "No saved builds yet." },
  savedBuild: { vi: "Đã lưu build.", en: "Saved build." },
  deletedBuild: { vi: "Đã xóa build.", en: "Deleted build." },
  draftBuild: { vi: "Draft chưa lưu", en: "Unsaved draft" },
  linkedTrees: { vi: "Tree của build", en: "Build tree" },
  availableTrees: { vi: "Chọn tree cho build", en: "Choose build tree" },
  noBuildTrees: { vi: "Build này chưa chọn tree. Chọn current tree hoặc saved tree trước khi export.", en: "This build has no tree selected. Choose the current tree or a saved tree before exporting." },
  addTree: { vi: "Chọn", en: "Choose" },
  clearTree: { vi: "Bỏ chọn tree", en: "Clear tree" },
  selectedTree: { vi: "Đang dùng", en: "Selected" },
  details: { vi: "Thông tin build", en: "Build details" },
  equipment: { vi: "Trang bị", en: "Equipment" },
  preview: { vi: "Preview .build", en: "Preview .build" },
  skills: { vi: "Skill & support", en: "Skills & support" },
  addSkill: { vi: "Thêm skill", en: "Add skill" },
  addSupport: { vi: "Thêm support", en: "Add support" },
  chooseSkillGem: { vi: "Chọn skill gem", en: "Choose skill gem" },
  chooseSupportGem: { vi: "Chọn support gem", en: "Choose support gem" },
  removeSkill: { vi: "Xóa skill", en: "Remove skill" },
  removeSupport: { vi: "Xóa support", en: "Remove support" },
  noSkills: { vi: "Chưa có skill nào. Có thể import .build hoặc thêm skill thủ công.", en: "No skills yet. Import a .build file or add skills manually." },
  export: { vi: "Tải file .build", en: "Download .build" },
  openTree: { vi: "Mở Passive Tree", en: "Open Passive Tree" },
  buildName: { vi: "Tên build", en: "Build name" },
  author: { vi: "Tác giả", en: "Author" },
  unique: { vi: "Unique", en: "Unique" },
  base: { vi: "Base", en: "Base" },
  selected: { vi: "đã chọn", en: "selected" },
  chooseItem: { vi: "Chọn item", en: "Choose item" },
  clearSlot: { vi: "Xóa ô này", en: "Clear slot" },
  searchItem: { vi: "Tìm item hoặc base...", en: "Search item or base..." },
  searchGem: { vi: "Tìm gem...", en: "Search gem..." },
  noItems: { vi: "Không tìm thấy item phù hợp.", en: "No matching items." },
  noGems: { vi: "Không tìm thấy gem phù hợp.", en: "No matching gems." },
  howTitle: { vi: "Cách dùng", en: "How it works" },
  howIntro: {
    vi: "",
    en: ""
  },
  howStepDownload: { vi: "Tải file .build từ trang này.", en: "Download the .build file from this page." },
  howStepSave: { vi: "Lưu file vào thư mục trên PC:", en: "Save it to your PC folder:" },
  howStepOpen: {
    vi: "Mở công cụ build trong game và chọn build đã import.",
    en: "Open the in-game build tool and select your imported build."
  },
  plannerFolder: {
    vi: "Documents\\My Games\\Path of Exile 2\\BuildPlanner\\",
    en: "Documents\\My Games\\Path of Exile 2\\BuildPlanner\\"
  },
  ok: { vi: "OK", en: "OK" },
  cancel: { vi: "Hủy", en: "Cancel" },
  savedBuildTitle: { vi: "Đã lưu build", en: "Build saved" },
  savedTreeTitle: { vi: "Đã lưu tree", en: "Tree saved" },
  importedBuildTitle: { vi: "Đã import build", en: "Build imported" },
  confirmDeleteBuild: { vi: "Xóa build này?", en: "Delete this build?" },
  confirmDeleteBuildBody: { vi: "Thao tác này chỉ xóa build đã lưu trong trình duyệt hiện tại.", en: "This only removes the saved build from this browser." },
  deleteAction: { vi: "Xóa", en: "Delete" },
  deleteCurrentBuild: { vi: "Xóa build", en: "Delete build" }
};

function newInventoryChoice(slot = "Weapon1"): BuildInventoryChoice {
  return {
    id: `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    inventoryId: slot,
    itemName: "",
    note: "",
    isUnique: false,
    levelStart: "",
    levelEnd: ""
  };
}

function newSupportSkillChoice(): BuildSupportSkillChoice {
  return {
    id: `support-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    skillId: "",
    note: "",
    levelStart: "",
    levelEnd: ""
  };
}

function newBuildSkillChoice(): BuildSkillChoice {
  return {
    id: `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    skillId: "",
    note: "",
    levelStart: "",
    levelEnd: "",
    supportSkills: []
  };
}

function emptyEquipmentChoices(): BuildInventoryChoice[] {
  return equipmentSlots.map((slot) => newInventoryChoice(slot.id));
}

function inventoryWithEmptySlots(rows: BuildInventoryChoice[]): BuildInventoryChoice[] {
  const bySlot = new Map(rows.map((row) => [row.inventoryId, row]));
  return equipmentSlots.map((slot) => bySlot.get(slot.id) ?? newInventoryChoice(slot.id));
}

function preferredWeaponSet(rows: BuildInventoryChoice[]): 1 | 2 {
  const hasSetOne = rows.some((row) => (row.inventoryId === "Weapon1" || row.inventoryId === "Weapon2") && row.itemName.trim());
  const hasSetTwo = rows.some((row) => (row.inventoryId === "Weapon3" || row.inventoryId === "Weapon4") && row.itemName.trim());
  return !hasSetOne && hasSetTwo ? 2 : 1;
}

function defaultBuildTree(currentTree: BuildTreeSnapshot | null): BuildTreeSnapshot | null {
  return currentTree;
}

function itemTitle(item: ItemRecord, _locale: Locale | "en" = "en"): string {
  return String(item?.name ?? item?.slug?.replace(/[_-]+/g, " ") ?? "");
}

function localizedLines(item: ItemRecord, field: "properties" | "requirements" | "mods", locale: Locale): string[] {
  const localized = item.i18n?.[field];
  if (Array.isArray(localized) && localized.length) {
    return localized.map((line, index) => localizedText(line, item[field]?.[index] ?? "", locale)).filter(Boolean);
  }
  return (item[field] ?? []).map(String).filter(Boolean);
}

function itemSummaryLines(item: ItemRecord, locale: Locale, limit = 5): string[] {
  return [
    ...localizedLines(item, "properties", locale),
    ...localizedLines(item, "requirements", locale),
    ...localizedLines(item, "mods", locale)
  ].filter(Boolean).slice(0, limit);
}

function itemBaseName(item: ItemRecord, locale: Locale): string {
  return localizedLines(item, "properties", locale).find((line) => !line.includes(":")) || item.menu_label || item.group_label || "";
}

function compactGemSlug(item: ItemRecord): string {
  return String(item.slug || item.name || "").replace(/[^A-Za-z0-9]+/g, "");
}

function compactSupportGemSlug(item: ItemRecord): string {
  return String(item.slug || item.name || "")
    .replace(/(?:^|_)(I|II|III|IV|V)$/i, (_, tier) => ({
      I: "",
      II: "Two",
      III: "Three",
      IV: "Four",
      V: "Five"
    })[String(tier).toUpperCase()] ?? "")
    .replace(/[^A-Za-z0-9]+/g, "");
}

function officialGemId(item: ItemRecord, prefix: "SkillGem" | "SupportGem"): string {
  if (item.official_id) return item.official_id;
  const slug = prefix === "SupportGem" ? compactSupportGemSlug(item) : compactGemSlug(item);
  return slug ? `Metadata/Items/Gems/${prefix}${slug}` : "";
}

function officialGemAliases(item: ItemRecord, prefix: "SkillGem" | "SupportGem"): string[] {
  const primary = officialGemId(item, prefix);
  const aliases = new Set([primary]);
  if (prefix === "SupportGem") {
    const tail = primary.replace(/^Metadata\/Items\/Gems\/SupportGem/, "");
    if (tail) aliases.add(`Metadata/Items/Gems/SupportGem${tail.replace(/(?:One|Two|Three|Four|Five|I|II|III|IV|V)$/i, "")}`);
  }
  return [...aliases].filter(Boolean);
}

const normalizeGemLookupText = (value: string) => value
  .toLowerCase()
  .replace(/\[dnt\]\s*/g, "")
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const compactGemLookupText = (value: string) => normalizeGemLookupText(value).replace(/\s+/g, "");

function gemLookupValues(item: ItemRecord, prefix: "SkillGem" | "SupportGem"): string[] {
  const aliases = officialGemAliases(item, prefix);
  const names = [
    item.name ?? "",
    itemTitle(item, "en"),
    item.slug?.replace(/[_-]+/g, " ") ?? "",
    compactGemSlug(item),
    compactSupportGemSlug(item)
  ];
  return [...aliases, ...aliases.map((id) => id.split("/").pop() ?? ""), ...names]
    .map(String)
    .flatMap((value) => [normalizeGemLookupText(value), compactGemLookupText(value)])
    .filter(Boolean);
}

function pobGemRecord(gem: PobGem, options: ItemRecord[], prefix: "SkillGem" | "SupportGem"): ItemRecord | undefined {
  const rawIds = [gem.skillId, gem.skillId.split("/").pop() ?? ""].map(String).filter(Boolean);
  const rawIdMatch = options.find((item) => {
    const aliases = officialGemAliases(item, prefix);
    const tails = aliases.map((id) => id.split("/").pop() ?? "");
    return rawIds.some((id) => aliases.includes(id) || tails.includes(id));
  });
  if (rawIdMatch) return rawIdMatch;

  const wanted = [gem.nameSpec, gem.nameSpec.replace(/\s+(?:I|II|III|IV|V)$/i, "")].flatMap((value) => [
    normalizeGemLookupText(value),
    compactGemLookupText(value)
  ]).filter(Boolean);
  if (!wanted.length) return undefined;
  return options.find((item) => {
    const values = new Set(gemLookupValues(item, prefix));
    return wanted.some((value) => values.has(value));
  });
}

function fallbackGemName(id: string, fallback = "Chọn gem"): string {
  const tail = id.split("/").pop() || "";
  const clean = tail.replace(/^(?:SkillGem|SupportGem)/, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return clean || fallback;
}

function gemChoiceItem(id: string, options: ItemRecord[], prefix: "SkillGem" | "SupportGem"): ItemRecord | undefined {
  return options.find((item) => officialGemAliases(item, prefix).includes(id));
}

function getGemTooltipHtml(id: string, options: ItemRecord[], prefix: "SkillGem" | "SupportGem", locale: Locale, note?: string): string {
  const item = gemChoiceItem(id, options, prefix);
  if (!item) {
    return note
      ? `<div class="poe-tooltip-card tooltip-rarity-gem"><div class="tooltip-header"><div class="tooltip-name">${note}</div></div></div>`
      : "";
  }
  const title = itemTitle(item, locale);
  const tags = localizedLines(item, "properties", locale).filter(l => !l.includes(":"));
  const properties = localizedLines(item, "properties", locale);
  const requirements = localizedLines(item, "requirements", locale);
  const mods = localizedLines(item, "mods", locale);

  let h = "";
  if (tags.length) {
    h += `<div class="tooltip-tags">${tags.join(", ")}</div>`;
  }
  if (note) {
    if (h) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-note">${note}</div>`;
  }
  if (properties.length) {
    if (h) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-properties">${properties.map((g) => `<div>${g}</div>`).join("")}</div>`;
  }
  if (requirements.length) {
    if (h) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-requirements">${requirements.join(", ")}</div>`;
  }
  if (mods.length) {
    if (h || requirements.length) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-mods">${mods.map((g) => `<div class="tooltip-mod-line">${g}</div>`).join("")}</div>`;
  }

  return `
    <div class="poe-tooltip-card tooltip-rarity-gem">
      <div class="tooltip-header">
        <div class="tooltip-name">${title}</div>
      </div>
      ${h ? `<hr class="tooltip-divider" />${h}` : ""}
    </div>
  `;
}

function gemChoiceLabel(id: string, options: ItemRecord[], prefix: "SkillGem" | "SupportGem", locale: Locale, fallback: string): string {
  const item = gemChoiceItem(id, options, prefix);
  return item ? itemTitle(item, locale) : fallbackGemName(id, fallback);
}

function gemChoiceIcon(id: string, options: ItemRecord[], prefix: "SkillGem" | "SupportGem"): string {
  const item = gemChoiceItem(id, options, prefix);
  return displayImageUrl(item?.icon_url);
}

function isUniqueItem(item: ItemRecord): boolean {
  if (String(item.rarity || "").toLowerCase() === "unique") return true;
  if (uniqueItemIconPattern.test(item.icon_url ?? "")) return true;
  return (item.mods ?? []).some((line) => /\buse unique\b/i.test(line));
}

function buildSlotCategories(item: ItemRecord): string[] {
  if (Array.isArray(item.build_slot_categories)) return item.build_slot_categories.map(String).filter(Boolean);
  if (item.item_category && item.item_category !== "other") return [item.item_category];
  return [];
}

function itemFitsSlot(item: ItemRecord, slot: EquipmentSlot): boolean {
  if (!hasActualIcon(item)) return false;
  const categories = buildSlotCategories(item);
  if (categories.length) return slot.slotCategories.some((category) => categories.includes(category));
  if (slot.itemFilter) return slot.itemFilter(item);
  return slot.itemIconPattern ? slot.itemIconPattern.test(item.icon_url ?? "") : slot.menuKeys.includes(item.menu_key ?? "");
}

function slotForId(slotId: string): EquipmentSlot {
  return equipmentSlots.find((slot) => slot.id === slotId) ?? equipmentSlots[0];
}

function snapshotOptions(current: BuildTreeSnapshot | null, saved: BuildTreeSnapshot[], locale: Locale): SnapshotOption[] {
  const rows: SnapshotOption[] = [];
  if (current) rows.push({ key: `current:${current.id}`, label: localizedText(copy.currentTree, "", locale), source: "current", snapshot: current });
  for (const row of saved) rows.push({ key: `saved:${row.id}`, label: localizedText(copy.savedTree, "", locale), source: "saved", snapshot: row });
  return rows;
}

function payloadText(payload: BuildPayload | null | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function payloadReferenceIds(payload: BuildPayload | null | undefined, key: string): string[] {
  const value = payload?.[key];
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (typeof row === "string") return row;
    if (typeof row === "object" && row !== null && !Array.isArray(row) && typeof row.id === "string") return row.id;
    return "";
  }).filter(Boolean);
}

function importedAscendancyNames(payload: BuildPayload, plannerData: BuildPlannerData | null): Pick<BuildTreeSnapshot, "className" | "ascendancyName"> {
  const rawAscendancy = payloadText(payload, "ascendancy");
  if (!rawAscendancy) return { className: "Imported build", ascendancyName: "" };
  const entries = Object.entries(plannerData?.ascendancies ?? {});
  const match = entries.find(([key, value]) => value === rawAscendancy || key === rawAscendancy);
  if (!match) return { className: "Imported build", ascendancyName: rawAscendancy };
  const [className, ascendancyName = ""] = match[0].split("|");
  return { className: className || "Imported build", ascendancyName };
}

function importedPassiveIds(payload: BuildPayload, plannerData: BuildPlannerData | null): string[] {
  const ids = payloadReferenceIds(payload, "passives");
  const officialToLocal = new Map(Object.entries(plannerData?.passive_ids ?? {}).map(([localId, officialId]) => [officialId, localId]));
  return [...new Set(ids.map((id) => officialToLocal.get(id) || id))];
}

function treeSnapshotFromImportedBuild(payload: BuildPayload, fileName: string, plannerData: BuildPlannerData | null): BuildTreeSnapshot | null {
  const allocatedIds = importedPassiveIds(payload, plannerData);
  if (!allocatedIds.length) return null;
  const { className, ascendancyName } = importedAscendancyNames(payload, plannerData);
  return createTreeSnapshot({
    name: `${payloadText(payload, "name") || fileName.replace(/\.build$/i, "")} tree`,
    className,
    ascendancyName,
    allocatedIds,
    startIds: [],
    treeVersion: plannerData?.version || "imported"
  });
}

function treeSnapshotFromPobImport(data: PobImportData, plannerData: BuildPlannerData | null): BuildTreeSnapshot | null {
  const allocatedIds = passiveIdsFromPobImport(data);
  if (!allocatedIds.length) return null;
  const { className, ascendancyName } = pobBuildClassNames(data, plannerData);
  return createTreeSnapshot({
    name: `${pobBuildName(data)} tree`,
    className,
    ascendancyName,
    allocatedIds,
    startIds: [],
    treeVersion: data.treeSpec?.treeVersion || plannerData?.version || "pob"
  });
}

function treeSignature(snapshot: BuildTreeSnapshot | null | undefined): unknown {
  if (!snapshot) return null;
  return {
    name: snapshot.name || "",
    className: snapshot.className || "",
    ascendancyName: snapshot.ascendancyName || "",
    allocatedIds: [...new Set(snapshot.allocatedIds)].sort(),
    startIds: [...new Set(snapshot.startIds)].sort(),
    treeVersion: snapshot.treeVersion || ""
  };
}

function inventorySignature(rows: BuildInventoryChoice[]): unknown[] {
  return rows.map((row) => ({
    inventoryId: row.inventoryId,
    itemName: row.itemName || "",
    note: row.note || "",
    isUnique: Boolean(row.isUnique),
    levelStart: row.levelStart || "",
    levelEnd: row.levelEnd || "",
    itemSlug: row.itemSlug || "",
    iconUrl: row.iconUrl || "",
    baseName: row.baseName || ""
  })).sort((a, b) => a.inventoryId.localeCompare(b.inventoryId));
}

function skillsSignature(rows: BuildSkillChoice[]): unknown[] {
  return rows.map((row) => ({
    skillId: row.skillId || "",
    note: row.note || "",
    levelStart: row.levelStart || "",
    levelEnd: row.levelEnd || "",
    supportSkills: row.supportSkills.map((support) => ({
      skillId: support.skillId || "",
      note: support.note || "",
      levelStart: support.levelStart || "",
      levelEnd: support.levelEnd || ""
    }))
  }));
}

function buildDraftSignature(input: {
  name: string;
  author: string;
  description: string;
  tree: BuildTreeSnapshot | null;
  inventory: BuildInventoryChoice[];
  skills: BuildSkillChoice[];
  importedPayload?: BuildPayload | null;
  importedFileName?: string;
}): string {
  return JSON.stringify({
    name: input.name.trim(),
    author: input.author.trim(),
    description: input.description.trim(),
    tree: treeSignature(input.tree),
    inventory: inventorySignature(input.inventory),
    skills: skillsSignature(input.skills),
    importedPayload: input.importedPayload ?? null,
    importedFileName: input.importedFileName || ""
  });
}

function buildProjectSignature(project: BuildProject | null): string {
  if (!project) return "";
  return buildDraftSignature({
    name: project.name,
    author: project.author,
    description: project.description,
    tree: project.treeSnapshots[0] ?? null,
    inventory: inventoryWithEmptySlots(project.inventory),
    skills: project.skills ?? [],
    importedPayload: project.importedPayload ?? null,
    importedFileName: project.importedFileName || ""
  });
}

function hasDraftContent(input: {
  name: string;
  description: string;
  tree: BuildTreeSnapshot | null;
  inventoryCount: number;
  skillCount: number;
  importedBuild: ImportedBuild | null;
}): boolean {
  return Boolean(
    input.importedBuild ||
    input.name.trim() ||
    input.description.trim() ||
    (input.tree && passiveCount(input.tree) > 0) ||
    input.inventoryCount > 0 ||
    input.skillCount > 0
  );
}

const normalizeItemLookupText = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function itemLookupNames(item: ItemRecord, locale: Locale): string[] {
  const title = itemTitle(item, locale);
  const base = itemBaseName(item, locale);
  const unique = isUniqueItem(item);
  return [
    item.name ?? "",
    title,
    unique ? "" : base,
    title && base ? `${title} ${base}` : "",
    item.slug?.replace(/[_-]+/g, " ") ?? ""
  ].map(normalizeItemLookupText).filter(Boolean);
}

function itemMatchesLookup(item: ItemRecord, wanted: string, locale: Locale): boolean {
  const names = itemLookupNames(item, locale);
  if (names.some((name) => name === wanted)) return true;
  if (!isUniqueItem(item)) return false;
  const title = normalizeItemLookupText(itemTitle(item, locale));
  const base = normalizeItemLookupText(itemBaseName(item, locale));
  return Boolean(
    title &&
    (
      wanted.startsWith(`${title} `) ||
      (base && wanted === `${title} ${base}`) ||
      (base && wanted.endsWith(` ${base}`) && wanted.includes(title))
    )
  );
}

function enrichInventoryChoice(choice: BuildInventoryChoice, items: ItemRecord[], locale: Locale): BuildInventoryChoice {
  if (!choice.itemName || choice.iconUrl) return choice;
  const slot = slotForId(choice.inventoryId);
  const wanted = normalizeItemLookupText(choice.itemName);
  if (!wanted) return choice;
  const match = items.find((item) => {
    if (!itemFitsSlot(item, slot)) return false;
    const itemUnique = isUniqueItem(item);
    if (choice.isUnique !== itemUnique) return false;
    return itemMatchesLookup(item, wanted, locale);
  });
  if (!match) return choice;
  const unique = isUniqueItem(match);
  return {
    ...choice,
    itemName: unique ? itemTitle(match, locale) : choice.itemName || itemTitle(match, locale),
    isUnique: choice.isUnique || unique,
    itemSlug: match.slug ?? choice.itemSlug,
    iconUrl: displayImageUrl(match.icon_url),
    baseName: itemBaseName(match, locale) || choice.baseName
  };
}

function enrichInventoryChoices(rows: BuildInventoryChoice[], items: ItemRecord[], locale: Locale): BuildInventoryChoice[] {
  if (!items.length) return rows;
  return rows.map((row) => enrichInventoryChoice(row, items, locale));
}

function buildRouteState(pathname = window.location.pathname): BuildRouteState {
  const clean = pathname.replace(/\/+$/, "") || "/build";
  if (clean === "/build" || clean === "/build-planner" || clean === "/builds") return { screen: "library", projectId: "", isNew: false };
  const match = clean.match(/^\/build\/([^/]+)$/);
  if (!match) return { screen: "library", projectId: "", isNew: false };
  const segment = decodeURIComponent(match[1]);
  return {
    screen: "detail",
    projectId: segment === "new" ? "" : segment,
    isNew: segment === "new"
  };
}

function readBuildHelpSeen(): boolean {
  try {
    return window.localStorage.getItem(BUILD_HELP_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeBuildHelpSeen(): void {
  try {
    window.localStorage.setItem(BUILD_HELP_SEEN_KEY, "1");
  } catch {
    // Ignore storage failures; the help button remains available.
  }
}

export function BuildPlannerPage({ locale }: { locale: Locale }) {
  const [currentTree, setCurrentTree] = useState<BuildTreeSnapshot | null>(() => readCurrentTreeSnapshot());
  const [savedTrees, setSavedTrees] = useState<BuildTreeSnapshot[]>(() => readSavedTreeSnapshots());
  const [savedBuilds, setSavedBuilds] = useState<BuildProject[]>(() => readSavedBuildProjects());
  const [activeBuildId, setActiveBuildId] = useState("");
  const [buildPath, setBuildPath] = useState(() => window.location.pathname);
  const [buildTree, setBuildTree] = useState<BuildTreeSnapshot | null>(() => defaultBuildTree(readCurrentTreeSnapshot()));
  const [itemsData, setItemsData] = useState<ItemRecord[]>([]);
  const [gemsData, setGemsData] = useState<ItemRecord[]>([]);
  const [plannerData, setPlannerData] = useState<BuildPlannerData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [importError, setImportError] = useState("");
  const [importedBuild, setImportedBuild] = useState<ImportedBuild | null>(null);
  const [buildDialog, setBuildDialog] = useState<BuildDialogState | null>(null);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("POE2 Viet Hoa");
  const [description, setDescription] = useState("");
  const [inventory, setInventory] = useState<BuildInventoryChoice[]>(() => emptyEquipmentChoices());
  const [buildSkills, setBuildSkills] = useState<BuildSkillChoice[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [activeWeaponSet, setActiveWeaponSet] = useState<1 | 2>(1);
  const [pickerMode, setPickerMode] = useState<"base" | "unique">("base");
  const [pickerQuery, setPickerQuery] = useState("");
  const [activeGemPicker, setActiveGemPicker] = useState<GemPickerTarget | null>(null);
  const [gemPickerQuery, setGemPickerQuery] = useState("");
  const [showBuildHelp, setShowBuildHelp] = useState(false);
  const [treeChoicesOpen, setTreeChoicesOpen] = useState(false);
  const [pobImportOpen, setPobImportOpen] = useState(false);
  const [pobCode, setPobCode] = useState("");
  const [pobImporting, setPobImporting] = useState(false);

  const [liveStats, setLiveStats] = useState<any>(null);
  const activeStats = useMemo(() => {
    if (!liveStats) return null;
    return activeWeaponSet === 2 ? liveStats.set2 : liveStats.set1;
  }, [liveStats, activeWeaponSet]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [mainSocketGroup, setMainSocketGroup] = useState<number>(1);
  const mainSocketGroupRef = useRef(mainSocketGroup);
  mainSocketGroupRef.current = mainSocketGroup;
  const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>({});
  const toggleSkillExpand = (id: string) => {
    setExpandedSkills(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: string;
  }>({ visible: false, x: 0, y: 0, content: "" });

  const handleMouseMove = (e: React.MouseEvent) => {
    setTooltip(prev => ({
      ...prev,
      x: e.clientX + 15,
      y: e.clientY + 15
    }));
  };

  const handleMouseLeave = () => {
    setTooltip(prev => ({
      ...prev,
      visible: false
    }));
  };

  const buildRoute = useMemo(() => buildRouteState(buildPath), [buildPath]);
  const editorOpen = buildRoute.screen !== "library";

  useEffect(() => {
    let alive = true;
    Promise.all([loadItemsData(), loadBuildPlannerData(), loadSkillGemsData()]).then(([items, buildData, gemData]) => {
      if (!alive) return;
      setItemsData(Array.isArray(items?.items) ? items.items : Array.isArray(items?.records) ? items.records : []);
      setPlannerData(buildData);
      setGemsData(Array.isArray(gemData?.gems) ? gemData.gems : []);
    }).catch((error: Error) => {
      if (alive) setLoadError(error.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setInventory((rows) => enrichInventoryChoices(rows, itemsData, locale));
  }, [itemsData, locale]);

  useEffect(() => {
    const syncPath = () => setBuildPath(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  useEffect(() => {
    const refresh = () => {
      setCurrentTree(readCurrentTreeSnapshot());
      setSavedTrees(readSavedTreeSnapshots());
      setSavedBuilds(readSavedBuildProjects());
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("poe-build-tree-saved", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("poe-build-tree-saved", refresh);
    };
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveSlotId(null);
        setActiveGemPicker(null);
        setShowBuildHelp(false);
        setTreeChoicesOpen(false);
        setPobImportOpen(false);
        if (buildDialog) setBuildDialog(null);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [buildDialog]);

  const options = useMemo(() => snapshotOptions(currentTree, savedTrees, locale), [currentTree, savedTrees, locale]);

  const activeBuildProject = savedBuilds.find((project) => project.id === activeBuildId) ?? null;
  const selected = buildTree;

  useEffect(() => {
    if (importedBuild || !selected || name) return;
    setName(selected.name);
    setDescription(`${selected.className}${selected.ascendancyName ? ` - ${selected.ascendancyName}` : ""}`);
  }, [selected, name, importedBuild]);

  const inventoryBySlot = useMemo(() => new Map(inventory.map((row) => [row.inventoryId, row])), [inventory]);
  const selectedInventoryCount = inventory.filter((row) => row.itemName.trim() || row.note.trim()).length;
  const selectedSkillCount = buildSkills.filter((row) => row.skillId.trim()).length;
  const activeSlot = activeSlotId ? slotForId(activeSlotId) : null;
  const visibleEquipmentSlots = useMemo(
    () => equipmentSlots.filter((slot) => !slot.weaponSet || slot.weaponSet === activeWeaponSet),
    [activeWeaponSet]
  );
  const skillGemOptions = useMemo(() => gemsData
    .filter((item) => item.gem_type === "skill" && item.name)
    .sort((a, b) => itemTitle(a, locale).localeCompare(itemTitle(b, locale))), [gemsData, locale]);
  const supportGemOptions = useMemo(() => gemsData
    .filter((item) => item.gem_type === "support" && item.name)
    .sort((a, b) => itemTitle(a, locale).localeCompare(itemTitle(b, locale))), [gemsData, locale]);

  const pickerItems = useMemo(() => {
    if (!activeSlot) return [];
    return itemsData
      .filter((item) => itemFitsSlot(item, activeSlot))
      .filter((item) => isUniqueItem(item) === (pickerMode === "unique"))
      .filter((item) => matchesQuery({ title: itemTitle(item, locale), menu: item.menu_label, base: itemBaseName(item, locale), lines: itemSummaryLines(item, locale, 8) }, pickerQuery, ["title", "menu", "base", "lines"]))
      .sort((a, b) => itemTitle(a, locale).localeCompare(itemTitle(b, locale)))
      .slice(0, 80);
  }, [activeSlot, itemsData, locale, pickerMode, pickerQuery]);

  const gemPickerItems = useMemo(() => {
    const kind = activeGemPicker?.kind ?? "skill";
    const prefix = kind === "support" ? "SupportGem" : "SkillGem";
    const rows = kind === "support" ? supportGemOptions : skillGemOptions;
    return rows
      .filter((item) => matchesQuery({
        title: itemTitle(item, locale),
        id: officialGemId(item, prefix),
        tags: item.tags ?? [],
        summary: localizedText(item.i18n?.summary, item.summary_en ?? "", locale),
        lines: itemSummaryLines(item, locale, 4)
      }, gemPickerQuery, ["title", "id", "tags", "summary", "lines"]))
      .slice(0, 80);
  }, [activeGemPicker, gemPickerQuery, locale, skillGemOptions, supportGemOptions]);
  const currentSupportGemId = useMemo(() => {
    if (!activeGemPicker || activeGemPicker.kind !== "support") return "";
    const skill = buildSkills.find(s => s.id === activeGemPicker.skillId);
    const support = skill?.supportSkills.find(sup => sup.id === activeGemPicker.supportId);
    return support?.skillId || "";
  }, [activeGemPicker, buildSkills]);

  const currentSkillGemId = useMemo(() => {
    if (!activeGemPicker || activeGemPicker.kind !== "skill") return "";
    const skill = buildSkills.find(s => s.id === activeGemPicker.skillId);
    return skill?.skillId || "";
  }, [activeGemPicker, buildSkills]);

  const activeGemPickerLabel = activeGemPicker?.kind === "support"
    ? localizedText(copy.chooseSupportGem, "", locale)
    : localizedText(copy.chooseSkillGem, "", locale);
  const resolvePobSkillId = useCallback((gem: PobGem) => {
    const match = pobGemRecord(gem, skillGemOptions, "SkillGem");
    return match ? officialGemId(match, "SkillGem") : "";
  }, [skillGemOptions]);
  const resolvePobSupportId = useCallback((gem: PobGem) => {
    const match = pobGemRecord(gem, supportGemOptions, "SupportGem");
    return match ? officialGemId(match, "SupportGem") : "";
  }, [supportGemOptions]);
  const isPobSupportGem = useCallback((gem: PobGem) => {
    if (/SupportGem/i.test(gem.skillId) || /^support/i.test(gem.skillId)) return true;
    if (/SkillGem/i.test(gem.skillId)) return false;
    const supportMatch = pobGemRecord(gem, supportGemOptions, "SupportGem");
    const skillMatch = pobGemRecord(gem, skillGemOptions, "SkillGem");
    if (supportMatch && !skillMatch) return true;
    if (skillMatch && !supportMatch) return false;
    return /\bsupport\b/i.test(gem.nameSpec);
  }, [skillGemOptions, supportGemOptions]);

  const selectedPassiveCount = passiveCount(selected);
  const exportSnapshot = selected && selectedPassiveCount > 0 ? selected : null;
  const payload = useMemo(() => {
    if (!importedBuild && !exportSnapshot) return null;
    return buildPlannerPayload({
      basePayload: importedBuild?.payload,
      snapshot: exportSnapshot,
      plannerData,
      name,
      author,
      description,
      inventory,
      skills: buildSkills
    });
  }, [exportSnapshot, importedBuild, plannerData, name, author, description, inventory, buildSkills]);

  const canExport = Boolean(payload && (importedBuild || exportSnapshot));

  const runCalculation = useCallback(() => {
    if (!importedBuild?.payload) return;
    setIsCalculating(true);
    const className = importedBuild.payload.className || "Witch";
    const ascendancy = importedBuild.payload.ascendancy || "None";
    const level = importedBuild.payload.level || 90;
    const passives = (buildTree?.allocatedIds || []).map(id => parseInt(id, 10)).filter(Boolean);
    const inventory_slots = inventory.map(row => ({
      inventory_id: row.inventoryId,
      item_name: row.itemName,
      note: row.note,
      is_unique: row.isUnique,
      raw_text: row.rawText
    }));
    const skills = buildSkills.map(row => ({
      skill_id: row.skillId,
      level: parseInt(row.levelEnd, 10) || 20,
      enabled: true,
      support: (row.supportSkills || []).map(s => ({
        skill_id: s.skillId,
        level: parseInt(s.levelEnd, 10) || 20
      }))
    }));
    const attribute_overrides = importedBuild?.payload?.attribute_overrides;
    const config = importedBuild?.payload?.config;
    const main_socket_group = mainSocketGroupRef.current;

    fetch("/api/builds/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        className,
        ascendancy,
        level,
        passives,
        inventory_slots,
        skills,
        activeWeaponSet,
        attribute_overrides,
        config,
        main_socket_group
      })
    })
      .then(res => res.json())
      .then(res => {
        if (res.ok && res.data) {
          setLiveStats(res.data);
        }
        setIsCalculating(false);
      })
      .catch(err => {
        console.error("Failed to calculate live stats", err);
        setIsCalculating(false);
      });
  }, [importedBuild, inventory, buildSkills, buildTree, activeWeaponSet]);

  useEffect(() => {
    if (importedBuild?.payload) {
      runCalculation();
    }
  }, [importedBuild, mainSocketGroup, runCalculation]);

  useEffect(() => {
    if (!importedBuild?.payload) {
      setLiveStats(null);
      setMainSocketGroup(1);
    } else {
      const msg = importedBuild.payload.mainSocketGroup || importedBuild.payload.build?.mainSocketGroup || 1;
      setMainSocketGroup(Number(msg));
    }
  }, [importedBuild]);

  const getBaseDps = () => {
    if (!importedBuild?.payload?.stats) return 0;
    const dpsStat = importedBuild.payload.stats.find((s: any) => s.stat === "CombinedDPS" || s.stat === "TotalDPS");
    return dpsStat ? Number(dpsStat.value) : 0;
  };

  const getBaseStat = (statKey: string) => {
    if (!importedBuild?.payload?.stats) return 0;
    const stat = importedBuild.payload.stats.find((s: any) => s.stat === statKey);
    return stat ? Number(stat.value) : 0;
  };

  const renderDelta = (statKey: string, currentVal: number, baseVal: number, suffix = "") => {
    if (baseVal === 0) return null;
    const delta = Math.round(currentVal - baseVal);
    if (delta === 0) return null;
    const color = delta > 0 ? "#2af598" : "#ff5252";
    const sign = delta > 0 ? "+" : "";
    return (
      <span style={{ fontSize: "10px", color, marginLeft: "4px", fontWeight: "bold" }}>
        ({sign}{delta}{suffix})
      </span>
    );
  };
  const howIntro = localizedText(copy.howIntro, "", locale);
  const buildDetailTitle = name || activeBuildProject?.name || localizedText(copy.draftBuild, "", locale);
  const buildCount = savedBuilds.length;
  const buildTreeCount = savedBuilds.filter((project) => project.treeSnapshots[0]).length;
  const buildItemCount = savedBuilds.reduce((total, project) => total + project.inventory.filter((row) => row.itemName || row.note).length, 0);
  const currentBuildSignature = useMemo(() => buildDraftSignature({
    name,
    author,
    description,
    tree: buildTree,
    inventory,
    skills: buildSkills,
    importedPayload: importedBuild?.payload ?? null,
    importedFileName: importedBuild?.fileName || ""
  }), [name, author, description, buildTree, inventory, buildSkills, importedBuild]);
  const savedBuildSignature = useMemo(() => buildProjectSignature(activeBuildProject), [activeBuildProject]);
  const hasBuildChanges = activeBuildProject
    ? currentBuildSignature !== savedBuildSignature
    : hasDraftContent({ name, description, tree: buildTree, inventoryCount: selectedInventoryCount, skillCount: selectedSkillCount, importedBuild });

  const closeBuildDialog = () => setBuildDialog(null);
  const showInfoDialog = (title: string, body = "") => setBuildDialog({
    title,
    body,
    actions: [{ label: localizedText(copy.ok, "", locale), tone: "primary", onClick: closeBuildDialog }]
  });

  const updateSlot = (slotId: string, patch: Partial<BuildInventoryChoice>) => {
    setInventory((rows) => {
      const index = rows.findIndex((row) => row.inventoryId === slotId);
      if (index < 0) return [...rows, { ...newInventoryChoice(slotId), ...patch }];
      return rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
    });
  };

  const clearSlot = (slotId: string) => {
    updateSlot(slotId, {
      itemName: "",
      note: "",
      isUnique: false,
      levelStart: "",
      levelEnd: "",
      itemSlug: "",
      iconUrl: "",
      baseName: ""
    });
  };

  const openPicker = (slotId: string) => {
    const choice = inventoryBySlot.get(slotId);
    setActiveGemPicker(null);
    setTreeChoicesOpen(false);
    setPickerMode(choice?.isUnique ? "unique" : "base");
    setPickerQuery("");
    setActiveSlotId(slotId);
  };

  const addBuildSkill = () => {
    const skill = newBuildSkillChoice();
    setBuildSkills((rows) => [...rows, skill]);
    setGemPickerQuery("");
    setActiveGemPicker({ kind: "skill", skillId: skill.id });
  };

  const updateBuildSkill = (skillId: string, patch: Partial<BuildSkillChoice>) => {
    setBuildSkills((rows) => rows.map((row) => row.id === skillId ? { ...row, ...patch } : row));
  };

  const removeBuildSkill = (skillId: string) => {
    setBuildSkills((rows) => rows.filter((row) => row.id !== skillId));
  };

  const addSupportSkill = (skillId: string) => {
    const support = newSupportSkillChoice();
    setBuildSkills((rows) => rows.map((row) => row.id === skillId ? { ...row, supportSkills: [...row.supportSkills, support] } : row));
    setGemPickerQuery("");
    setActiveGemPicker({ kind: "support", skillId, supportId: support.id });
  };

  const updateSupportSkill = (skillId: string, supportId: string, patch: Partial<BuildSupportSkillChoice>) => {
    setBuildSkills((rows) => rows.map((row) => row.id === skillId
      ? { ...row, supportSkills: row.supportSkills.map((support) => support.id === supportId ? { ...support, ...patch } : support) }
      : row));
  };

  const removeSupportSkill = (skillId: string, supportId: string) => {
    setBuildSkills((rows) => rows.map((row) => row.id === skillId
      ? { ...row, supportSkills: row.supportSkills.filter((support) => support.id !== supportId) }
      : row));
  };

  const openSkillGemPicker = (skillId: string) => {
    setActiveSlotId(null);
    setTreeChoicesOpen(false);
    setGemPickerQuery("");
    setActiveGemPicker({ kind: "skill", skillId });
  };

  const openSupportGemPicker = (skillId: string, supportId: string) => {
    setActiveSlotId(null);
    setTreeChoicesOpen(false);
    setGemPickerQuery("");
    setActiveGemPicker({ kind: "support", skillId, supportId });
  };

  const selectGem = (item: ItemRecord) => {
    if (!activeGemPicker) return;
    if (activeGemPicker.kind === "skill") {
      updateBuildSkill(activeGemPicker.skillId, { skillId: officialGemId(item, "SkillGem") });
    } else {
      updateSupportSkill(activeGemPicker.skillId, activeGemPicker.supportId, { skillId: officialGemId(item, "SupportGem") });
    }
    setActiveGemPicker(null);
  };

  const resetBuildDraft = () => {
    const tree = defaultBuildTree(currentTree);
    setActiveBuildId("");
    setBuildTree(tree);
    setImportedBuild(null);
    setImportError("");
    setName(tree?.name ?? "");
    setAuthor("POE2 Viet Hoa");
    setDescription(tree ? `${tree.className}${tree.ascendancyName ? ` - ${tree.ascendancyName}` : ""}` : "");
    setActiveWeaponSet(1);
    setInventory(emptyEquipmentChoices());
    setBuildSkills([]);
    setLiveStats(null);
    setMainSocketGroup(1);
  };

  const newBuildDraft = () => {
    resetBuildDraft();
    navigateTo("/build/new");
  };

  const openBuildLibrary = () => {
    navigateTo("/build");
    setActiveSlotId(null);
    setActiveGemPicker(null);
    setTreeChoicesOpen(false);
  };

  const applyBuildProject = (project: BuildProject) => {
    setActiveBuildId(project.id);
    setName(project.name);
    setAuthor(project.author || "POE2 Viet Hoa");
    setDescription(project.description);
    setBuildTree(project.treeSnapshots[0] ?? null);
    const nextInventory = enrichInventoryChoices(inventoryWithEmptySlots(project.inventory), itemsData, locale);
    setActiveWeaponSet(preferredWeaponSet(nextInventory));
    setInventory(nextInventory);
    setBuildSkills(project.skills ?? []);
    setImportedBuild(project.importedPayload ? {
      fileName: project.importedFileName || `${project.name}.build`,
      payload: project.importedPayload,
      importedAt: project.updatedAt
    } : null);
    setImportError("");
    setTreeChoicesOpen(false);
    setLiveStats(null);
    const msg = project.importedPayload?.mainSocketGroup || project.importedPayload?.build?.mainSocketGroup || 1;
    setMainSocketGroup(Number(msg));
  };

  const loadBuildProject = (project: BuildProject) => {
    applyBuildProject(project);
    navigateTo(`/build/${encodeURIComponent(project.id)}`);
  };

  const buildDetailPath = (projectId = activeBuildId || buildRoute.projectId) => projectId ? `/build/${encodeURIComponent(projectId)}` : "/build/new";

  const saveCurrentBuild = ({ showDialog = false, navigateAfterSave = true } = {}) => {
    const updatedPayload = importedBuild?.payload ? {
      ...importedBuild.payload,
      mainSocketGroup
    } : null;
    const project = createBuildProject({
      id: activeBuildId || undefined,
      name,
      author,
      description,
      treeSnapshot: buildTree,
      inventory,
      skills: buildSkills,
      importedPayload: updatedPayload,
      importedFileName: importedBuild?.fileName,
      createdAt: activeBuildProject?.createdAt
    });
    setSavedBuilds(saveBuildProject(project));
    setActiveBuildId(project.id);
    setName(project.name);
    setAuthor(project.author || "POE2 Viet Hoa");
    setDescription(project.description);
    setBuildTree(project.treeSnapshots[0] ?? null);
    const nextInventory = inventoryWithEmptySlots(project.inventory);
    setActiveWeaponSet(preferredWeaponSet(nextInventory));
    setInventory(nextInventory);
    setBuildSkills(project.skills ?? []);
    if (navigateAfterSave && (buildRoute.isNew || !buildRoute.projectId)) navigateTo(`/build/${encodeURIComponent(project.id)}`);
    if (showDialog) showInfoDialog(localizedText(copy.savedBuildTitle, "", locale));
    return project;
  };

  const deleteBuildNow = (projectId: string) => {
    setSavedBuilds(deleteBuildProject(projectId));
    if (activeBuildId === projectId) {
      resetBuildDraft();
      navigateTo("/build");
    }
    closeBuildDialog();
  };

  const removeSavedBuild = (projectId: string) => {
    setBuildDialog({
      title: localizedText(copy.confirmDeleteBuild, "", locale),
      body: localizedText(copy.confirmDeleteBuildBody, "", locale),
      actions: [
        { label: localizedText(copy.cancel, "", locale), tone: "neutral", onClick: closeBuildDialog },
        { label: localizedText(copy.deleteAction, "", locale), tone: "danger", onClick: () => deleteBuildNow(projectId) }
      ]
    });
  };

  const chooseTreeForBuild = (option: SnapshotOption) => {
    setImportError("");
    setBuildTree(option.snapshot);
    if (!name) setName(option.snapshot.name);
    if (!description) setDescription(`${option.snapshot.className}${option.snapshot.ascendancyName ? ` - ${option.snapshot.ascendancyName}` : ""}`);
    setTreeChoicesOpen(false);
  };

  const clearBuildTree = () => {
    setBuildTree(null);
    setTreeChoicesOpen(true);
  };

  const updateBuildTreeFromEditor = useCallback((snapshot: BuildTreeSnapshot) => {
    setBuildTree(snapshot);
  }, []);

  const saveBuildTreeFromEditor = useCallback((snapshot: BuildTreeSnapshot) => {
    setBuildTree(snapshot);
    setSavedTrees(saveTreeSnapshot(snapshot));
    showInfoDialog(localizedText(copy.savedTreeTitle, "", locale));
    window.dispatchEvent(new CustomEvent("poe-build-tree-saved", { detail: { source: "build-editor", id: snapshot.id } }));
  }, [locale]);

  const applyImportedBuild = (
    payload: BuildPayload,
    fileName: string,
    data: BuildPlannerData | null = plannerData,
    treeOverride?: BuildTreeSnapshot | null
  ) => {
    const importedTree = treeOverride === undefined ? treeSnapshotFromImportedBuild(payload, fileName, data) : treeOverride;
    if (importedTree) {
      setSavedTrees(saveTreeSnapshot(importedTree));
      window.dispatchEvent(new CustomEvent("poe-build-tree-saved", { detail: { source: "build-import", id: importedTree.id } }));
    }
    setImportedBuild({ fileName, payload, importedAt: new Date().toISOString() });
    setImportError("");
    setActiveBuildId("");
    setBuildTree(importedTree);
    setName(payloadText(payload, "name") || fileName.replace(/\.build$/i, ""));
    setAuthor(payloadText(payload, "author"));
    setDescription(payloadText(payload, "description"));
    const nextInventory = enrichInventoryChoices(inventoryChoicesFromBuildPayload(payload, equipmentSlotIds), itemsData, locale);
    setActiveWeaponSet(preferredWeaponSet(nextInventory));
    setInventory(nextInventory);
    setBuildSkills(skillChoicesFromBuildPayload(payload));
    setTreeChoicesOpen(false);
    navigateTo("/build/new");
  };

  const importBuildFile = async (file: File | null) => {
    if (!file) return;
    try {
      const payload = parseBuildFileText(await file.text());
      let data = plannerData;
      if (!data) {
        try {
          data = await loadBuildPlannerData();
          setPlannerData(data);
        } catch {
          data = null;
        }
      }
      applyImportedBuild(payload, file.name || "imported.build", data);
      showInfoDialog(localizedText(copy.importedBuildTitle, "", locale));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Không import được file .build.");
    }
  };

  const openPobImport = () => {
    setImportError("");
    setPobImportOpen(true);
  };

  const importPobCode = async () => {
    if (!isPobExportCode(pobCode)) {
      setImportError(localizedText(copy.pobInvalid, "", locale));
      return;
    }
    setPobImporting(true);
    try {
      let data = plannerData;
      if (!data) {
        try {
          data = await loadBuildPlannerData();
          setPlannerData(data);
        } catch {
          data = null;
        }
      }
      const pobData = await parsePobExportCode(pobCode);
      const payload = buildPayloadFromPobImport(pobData, {
        plannerData: data,
        inventorySlotIds: equipmentSlotIds,
        resolveSkillId: resolvePobSkillId,
        resolveSupportId: resolvePobSupportId,
        isSupportGem: isPobSupportGem
      });
      const importedTree = treeSnapshotFromPobImport(pobData, data);
      applyImportedBuild(payload, buildFileName(pobBuildName(pobData)), data, importedTree);
      setPobImportOpen(false);
      setPobCode("");
      showInfoDialog(localizedText(copy.importedBuildTitle, "", locale));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Không import được PoB code.");
    } finally {
      setPobImporting(false);
    }
  };

  const selectItem = (item: ItemRecord) => {
    if (!activeSlot) return;
    const unique = isUniqueItem(item);
    updateSlot(activeSlot.id, {
      itemName: itemTitle(item, locale),
      note: "",
      isUnique: unique,
      itemSlug: item.slug ?? "",
      iconUrl: displayImageUrl(item.icon_url),
      baseName: itemBaseName(item, locale)
    });
    setActiveSlotId(null);
  };

  const exportBuild = () => {
    if (!payload || !canExport) return;
    downloadBuildFile(payload, buildFileName(String(payload.name || name || importedBuild?.fileName || selected?.name || "poe2-build")));
  };

  useEffect(() => {
    if (!editorOpen) {
      setActiveSlotId(null);
      setActiveGemPicker(null);
      setTreeChoicesOpen(false);
      return;
    }
    if (buildRoute.isNew) {
      if (activeBuildId) resetBuildDraft();
      return;
    }
    if (!buildRoute.projectId) return;
    const project = savedBuilds.find((row) => row.id === buildRoute.projectId);
    if (project && activeBuildId !== project.id) applyBuildProject(project);
  }, [activeBuildId, buildRoute.isNew, buildRoute.projectId, editorOpen, savedBuilds]);

  useEffect(() => {
    if (!editorOpen || readBuildHelpSeen()) return;
    setShowBuildHelp(true);
    writeBuildHelpSeen();
  }, [editorOpen]);

  const showTreeChoices = options.length > 0 && (treeChoicesOpen || !buildTree);

  const linkedTreeCard = (
    <section className="build-card build-tree-card build-linked-trees">
      <div className="build-mini-head">
        <h3>{localizedText(copy.linkedTrees, "", locale)}</h3>
        <div className="build-tree-head-actions">
          <span>{formatNumber(buildTree ? 1 : 0, locale)}</span>
          {options.length ? (
            <button type="button" onClick={() => setTreeChoicesOpen((open) => !open)} aria-expanded={treeChoicesOpen} aria-label={localizedText(copy.availableTrees, "", locale)} title={localizedText(copy.availableTrees, "", locale)}>
              <span className="material-symbols-rounded" aria-hidden="true">swap_horiz</span>
            </button>
          ) : null}
        </div>
      </div>
      {buildTree ? (
        <div className="build-tree-list">
          <article
            className="is-active"
            key={buildTree.id}
          >
            <span className="material-symbols-rounded" aria-hidden="true">account_tree</span>
            <span>
              <strong>{buildTree.name}</strong>
              <small>{buildTree.className}{buildTree.ascendancyName ? ` / ${buildTree.ascendancyName}` : ""}</small>
            </span>
            <em>{formatNumber(passiveCount(buildTree), locale)}</em>
            <button className="build-tree-icon-action build-tree-clear" type="button" onClick={(event) => {
              event.stopPropagation();
              clearBuildTree();
            }} aria-label={localizedText(copy.clearTree, "", locale)}>
              <span className="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </article>
        </div>
      ) : (
        <div className="build-empty">
          <p>{localizedText(copy.noBuildTrees, "", locale)}</p>
          {!options.length ? (
            <a href="/passive-tree">{localizedText(copy.openTree, "", locale)}</a>
          ) : null}
        </div>
      )}
      {showTreeChoices ? (
        <div className="build-tree-source build-tree-source--inline">
          <div className="build-tree-list build-tree-choice-list">
            {options.map((option) => (
              <button className={buildTree?.id === option.snapshot.id ? "is-active" : ""} type="button" onClick={() => chooseTreeForBuild(option)} key={option.key}>
                <span>
                  <strong>{option.snapshot.name}</strong>
                  <small>{option.label} - {option.snapshot.className}{option.snapshot.ascendancyName ? ` / ${option.snapshot.ascendancyName}` : ""}</small>
                </span>
                <em>{formatNumber(passiveCount(option.snapshot), locale)}</em>
                <b>{localizedText(buildTree?.id === option.snapshot.id ? copy.selectedTree : copy.addTree, "", locale)}</b>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {buildTree ? (
        <div className="build-tree-mini" aria-label={localizedText(copy.linkedTrees, "", locale)}>
          <PassiveTreeWorkspace
            key={`${buildTree.id}:${buildTree.className}:${buildTree.ascendancyName}`}
            locale={locale}
            embedded
            initialSnapshot={buildTree}
            onSnapshotChange={updateBuildTreeFromEditor}
            onSaveSnapshot={saveBuildTreeFromEditor}
          />
        </div>
      ) : null}
    </section>
  );

  return (
    <main className="page-shell build-page">
      {!editorOpen ? (
        <section className="build-library">
          {loadError ? <div className="error-panel">{uiText("loadFailed", locale)}: {loadError}</div> : null}

          <section className="build-library-toolbar">
            <div className="build-library-summary">
              <h2>{localizedText(copy.libraryTitle, "", locale)}</h2>
              <div className="build-library-metrics" aria-label={localizedText(copy.libraryTitle, "", locale)}>
                <span><strong>{formatNumber(buildCount, locale)}</strong><small>builds</small></span>
                <span><strong>{formatNumber(buildTreeCount, locale)}</strong><small>trees</small></span>
                <span><strong>{formatNumber(buildItemCount, locale)}</strong><small>items</small></span>
              </div>
            </div>
            <div className="build-library-actions">
              <button type="button" onClick={openPobImport}>
                <span className="material-symbols-rounded" aria-hidden="true">data_object</span>
                {localizedText(copy.importPob, "", locale)}
              </button>
              <label className="build-import-button">
                <span className="material-symbols-rounded" aria-hidden="true">upload_file</span>
                {localizedText(copy.importBuild, "", locale)}
                <input
                  type="file"
                  accept=".build,.json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    event.currentTarget.value = "";
                    importBuildFile(file);
                  }}
                />
              </label>
              <button type="button" onClick={newBuildDraft}>
                <span className="material-symbols-rounded" aria-hidden="true">note_add</span>
                {localizedText(copy.newBuild, "", locale)}
              </button>
            </div>
            {importError ? <p className="build-import-error">{importError}</p> : null}
          </section>

          {savedBuilds.length ? (
            <section className="build-library-grid" aria-label={localizedText(copy.savedBuilds, "", locale)}>
              {savedBuilds.map((project) => {
                const projectTree = project.treeSnapshots[0] ?? null;
                return (
                <article className="build-library-card" key={project.id}>
                  <div className="build-library-card-head">
                    <span className="material-symbols-rounded" aria-hidden="true">inventory</span>
                    <div>
                      <h2>{project.name}</h2>
                      <p>{project.author || "POE2 Viet Hoa"}</p>
                    </div>
                  </div>
                  <div className="build-library-stats">
                    <span>
                      <strong>{formatNumber(projectTree ? 1 : 0, locale)}</strong>
                      <small>tree</small>
                    </span>
                    <span>
                      <strong>{formatNumber(project.inventory.filter((row) => row.itemName || row.note).length, locale)}</strong>
                      <small>items</small>
                    </span>
                    <span>
                      <strong>{project.importedPayload ? "Import" : "Local"}</strong>
                      <small>.build</small>
                    </span>
                  </div>
                  <p>{project.description || projectTree?.name || project.importedFileName || localizedText(copy.noBuildTrees, "", locale)}</p>
                  <div className="build-library-card-actions">
                    <button type="button" onClick={() => loadBuildProject(project)}>
                      <span className="material-symbols-rounded" aria-hidden="true">open_in_new</span>
                      {localizedText(copy.openBuild, "", locale)}
                    </button>
                    <button type="button" onClick={() => removeSavedBuild(project.id)} aria-label={localizedText(copy.deleteBuild, "", locale)}>
                      <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                    </button>
                  </div>
                </article>
              );
              })}
            </section>
          ) : (
            <section className="build-library-empty">
              <span className="material-symbols-rounded" aria-hidden="true">inventory_2</span>
              <p>{localizedText(copy.libraryEmpty, "", locale)}</p>
            </section>
          )}
        </section>
      ) : (
      <section className="build-workbench">
        <aside className="build-source-panel">
          <div className="build-panel-head build-panel-head--detail">
            <span className="material-symbols-rounded" aria-hidden="true">dashboard_customize</span>
            <div>
              <h2>{buildDetailTitle}</h2>
            </div>
            <button className="build-help-button build-help-button--panel" type="button" onClick={() => setShowBuildHelp(true)} aria-label={localizedText(copy.howTitle, "", locale)} title={localizedText(copy.howTitle, "", locale)}>
              <span className="material-symbols-rounded" aria-hidden="true">help</span>
            </button>
          </div>

          <div className="build-project-actions">
            <button className="build-action-back" type="button" onClick={openBuildLibrary}>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
              {localizedText(copy.backToBuilds, "", locale)}
            </button>
            <button className={`build-action-save ${hasBuildChanges ? "has-changes" : ""}`} type="button" onClick={() => saveCurrentBuild({ showDialog: true })}>
              <span className="material-symbols-rounded" aria-hidden="true">save</span>
              {localizedText(copy.saveBuild, "", locale)}
            </button>
            <button className="build-action-download" type="button" onClick={exportBuild} disabled={!canExport}>
              <span className="material-symbols-rounded" aria-hidden="true">download</span>
              .build
            </button>
            {activeBuildId ? (
              <button className="build-action-delete" type="button" onClick={() => removeSavedBuild(activeBuildId)}>
                <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                {localizedText(copy.deleteBuild, "", locale)}
              </button>
            ) : null}
          </div>

        </aside>

        <section className="build-editor-panel">
          {loadError ? <div className="error-panel">{uiText("loadFailed", locale)}: {loadError}</div> : null}
          <section className="build-card">
            <div className="build-section-head">
              <span className="material-symbols-rounded" aria-hidden="true">edit_note</span>
              <h2>{localizedText(copy.details, "", locale)}</h2>
            </div>
            <div className="build-form-grid">
              <label>
                <span>{localizedText(copy.buildName, "", locale)}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Titan Slam Leveling" />
              </label>
              <label>
                <span>{localizedText(copy.author, "", locale)}</span>
                <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="POE2 Viet Hoa" />
              </label>
            </div>
          </section>

          <div className="build-editor-split">
            <div className="build-equipment-column">
              <section className="build-card build-equipment-card">
                <div className="build-section-head">
                  <span className="material-symbols-rounded" aria-hidden="true">inventory_2</span>
                  <h2>{localizedText(copy.equipment, "", locale)}</h2>
                  <strong className="build-selected-count">{formatNumber(selectedInventoryCount, locale)} {localizedText(copy.selected, "", locale)}</strong>
                </div>

                <div className="build-equipment-frame" aria-label={localizedText(copy.equipment, "", locale)}>
                  <div className="build-weapon-set-switch" style={{ gridArea: "setswitch" }} role="group" aria-label="Weapon set">
                    {[1, 2].map((set) => (
                      <button
                        className={activeWeaponSet === set ? "is-active" : ""}
                        type="button"
                        onClick={() => setActiveWeaponSet(set as 1 | 2)}
                        aria-pressed={activeWeaponSet === set}
                        key={set}
                      >
                        {set === 1 ? "I" : "II"}
                      </button>
                    ))}
                  </div>
                  {visibleEquipmentSlots.map((slot) => {
                    const choice = inventoryBySlot.get(slot.id);
                    const hasItem = Boolean(choice?.itemName);
                    return (
                      <button
                        className={`build-equip-slot build-equip-slot--${slot.area} ${slot.size ? `is-${slot.size}` : ""} ${hasItem ? "has-item" : ""} ${choice?.isUnique ? "is-unique" : ""}`}
                        type="button"
                        onClick={() => openPicker(slot.id)}
                        style={{ gridArea: slot.area }}
                        key={slot.id}
                        aria-label={`${localizedText(copy.chooseItem, "", locale)}: ${slot.label}`}
                      >
                        {!hasItem ? <span className="build-slot-label">{slot.shortLabel}</span> : null}
                        {hasItem ? (
                          choice?.iconUrl ? <img src={choice.iconUrl} alt="" loading="lazy" /> : <span className="material-symbols-rounded build-slot-fallback" aria-hidden="true">inventory_2</span>
                        ) : (
                          <>
                            <span className="material-symbols-rounded build-slot-plus" aria-hidden="true">add</span>
                            <strong>{slot.label}</strong>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              {linkedTreeCard}

              {importedBuild?.payload?.stats && importedBuild.payload.stats.length > 0 ? (
                <section className="build-card build-stats-card" style={{ marginTop: "16px" }}>
                  <div className="build-section-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="material-symbols-rounded" aria-hidden="true" style={{ color: "var(--gold)" }}>analytics</span>
                      <h2>{locale === "vi" ? "Chỉ số nhân vật" : "Character Stats"}</h2>
                    </div>
                    {isCalculating && (
                      <span style={{ fontSize: "11px", color: "var(--gold)", fontStyle: "italic" }}>
                        {locale === "vi" ? "Đang tính..." : "Calculating..."}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: "16px" }}>
                    {(() => {
                      const stats = importedBuild.payload.stats;
                      const lifeVal = stats.find((s: any) => s.stat === "Life");
                      const esVal = stats.find((s: any) => s.stat === "EnergyShield");
                      const manaVal = stats.find((s: any) => s.stat === "Mana");
                      const fireVal = stats.find((s: any) => s.stat === "FireResist");
                      const coldVal = stats.find((s: any) => s.stat === "ColdResist");
                      const lightningVal = stats.find((s: any) => s.stat === "LightningResist");
                      const chaosVal = stats.find((s: any) => s.stat === "ChaosResist");
                      const evadeVal = stats.find((s: any) => s.stat === "MeleeEvadeChance");
                      const physVal = stats.find((s: any) => s.stat === "PhysicalDamageReduction");
                      const speedVal = stats.find((s: any) => s.stat === "EffectiveMovementSpeedMod");

                      const formatVal = (statKey: string, valObj: any, round = true) => {
                        if (activeStats && activeStats[statKey] !== undefined) {
                          const val = activeStats[statKey];
                          return round ? Math.round(val).toLocaleString("en-US") : (Math.round(val * 100) / 100).toString();
                        }
                        if (!valObj || typeof valObj.value !== "number") return "-";
                        return round ? Math.round(valObj.value).toLocaleString("en-US") : (Math.round(valObj.value * 100) / 100).toString();
                      };

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                          {/* Row 1: DPS & Defences */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "12px" }}>
                            {/* DPS */}
                            <div style={{
                              background: "rgba(255, 75, 75, 0.05)",
                              border: "1px solid rgba(255, 75, 75, 0.15)",
                              borderRadius: "6px",
                              padding: "10px",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "center",
                              alignItems: "center"
                            }}>
                              <span style={{ fontSize: "10px", color: "rgba(255, 100, 100, 0.7)", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.5px" }}>Combined/Full DPS</span>
                              <strong style={{ fontSize: "18px", color: "#ff5252", fontWeight: "900", marginTop: "4px" }}>
                                {activeStats && activeStats.CombinedDPS !== undefined ? (
                                  (() => {
                                    const hasSkillDps = activeStats.skillsDps && activeStats.skillsDps[mainSocketGroup - 1] !== undefined;
                                    const skillDpsVal = hasSkillDps ? activeStats.skillsDps[mainSocketGroup - 1] : 0;
                                    const activeDps = (skillDpsVal > 0) ? skillDpsVal : activeStats.CombinedDPS;
                                    return Math.round(activeDps).toLocaleString("en-US");
                                  })()
                                ) : (
                                  getBaseDps() ? Math.round(getBaseDps()).toLocaleString("en-US") : "-"
                                )}
                              </strong>
                            </div>

                            {/* Core Defences */}
                            <div style={{
                              background: "rgba(255, 255, 255, 0.02)",
                              border: "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "8px 12px",
                              display: "grid",
                              gridTemplateColumns: "1fr",
                              gap: "4px"
                            }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "11px", color: "var(--muted)" }}>Life</span>
                                <span style={{ fontSize: "12px" }}>
                                  <strong style={{ color: "#ff4d4d" }}>{formatVal("Life", lifeVal, true)}</strong>
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "11px", color: "var(--muted)" }}>ES</span>
                                <span style={{ fontSize: "12px" }}>
                                  <strong style={{ color: "#33ccff" }}>{formatVal("EnergyShield", esVal, true)}</strong>
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: "11px", color: "var(--muted)" }}>Mana</span>
                                <span style={{ fontSize: "12px" }}>
                                  <strong style={{ color: "#3366ff" }}>{formatVal("Mana", manaVal, true)}</strong>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Active Skill Details */}
                          {(() => {
                            const details = activeStats && activeStats.skillsDetails && activeStats.skillsDetails[mainSocketGroup - 1];
                            if (!details || !details.name) return null;
                            const hasDamage = (details.PhysicalMax > 0 || details.LightningMax > 0 || details.ColdMax > 0 || details.FireMax > 0 || details.ChaosMax > 0);
                            return (
                              <div style={{
                                background: "rgba(255, 215, 0, 0.02)",
                                border: "1px solid rgba(255, 215, 0, 0.1)",
                                borderRadius: "6px",
                                padding: "10px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px"
                              }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "4px" }}>
                                  <span style={{ fontSize: "10px", fontWeight: "bold", color: "var(--gold)" }}>
                                    {locale === "vi" ? "CHI TIẾT KỸ NĂNG CHÍNH" : "MAIN SKILL DETAILS"}
                                  </span>
                                  <span style={{ fontSize: "11px", fontWeight: "900", color: "#fff" }}>
                                    {details.name}
                                  </span>
                                </div>

                                {hasDamage && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", background: "rgba(0,0,0,0.2)", padding: "6px", borderRadius: "4px" }}>
                                    <span style={{ fontSize: "9px", color: "var(--muted)", fontWeight: "bold" }}>
                                      {locale === "vi" ? "SÁT THƯƠNG ĐÒN ĐÁNH" : "HIT DAMAGE RANGE"}
                                    </span>
                                    {details.PhysicalMax > 0 && (
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                                        <span style={{ color: "#e0e0e0" }}>{locale === "vi" ? "Vật lý" : "Physical"}</span>
                                        <strong style={{ color: "#e0e0e0" }}>{Math.round(details.PhysicalMin).toLocaleString("en-US")} - {Math.round(details.PhysicalMax).toLocaleString("en-US")}</strong>
                                      </div>
                                    )}
                                    {details.FireMax > 0 && (
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                                        <span style={{ color: "#ec5e24" }}>{locale === "vi" ? "Lửa" : "Fire"}</span>
                                        <strong style={{ color: "#ec5e24" }}>{Math.round(details.FireMin).toLocaleString("en-US")} - {Math.round(details.FireMax).toLocaleString("en-US")}</strong>
                                      </div>
                                    )}
                                    {details.ColdMax > 0 && (
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                                        <span style={{ color: "#3fd2f4" }}>{locale === "vi" ? "Băng" : "Cold"}</span>
                                        <strong style={{ color: "#3fd2f4" }}>{Math.round(details.ColdMin).toLocaleString("en-US")} - {Math.round(details.ColdMax).toLocaleString("en-US")}</strong>
                                      </div>
                                    )}
                                    {details.LightningMax > 0 && (
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                                        <span style={{ color: "#fcd116" }}>{locale === "vi" ? "Sét" : "Lightning"}</span>
                                        <strong style={{ color: "#fcd116" }}>{Math.round(details.LightningMin).toLocaleString("en-US")} - {Math.round(details.LightningMax).toLocaleString("en-US")}</strong>
                                      </div>
                                    )}
                                    {details.ChaosMax > 0 && (
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                                        <span style={{ color: "#d020ff" }}>{locale === "vi" ? "Hỗn loạn" : "Chaos"}</span>
                                        <strong style={{ color: "#d020ff" }}>{Math.round(details.ChaosMin).toLocaleString("en-US")} - {Math.round(details.ChaosMax).toLocaleString("en-US")}</strong>
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: "11px" }}>
                                  {details.Speed > 0 && (
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                      <span style={{ color: "var(--muted)" }}>{locale === "vi" ? "Tốc độ" : "Speed"}</span>
                                      <strong>{(Math.round(details.Speed * 100) / 100).toFixed(2)}/s</strong>
                                    </div>
                                  )}
                                  {details.HitChance < 100 && (
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                      <span style={{ color: "var(--muted)" }}>{locale === "vi" ? "Tỉ lệ trúng" : "Hit Chance"}</span>
                                      <strong style={{ color: "#ff5252" }}>{Math.round(details.HitChance)}%</strong>
                                    </div>
                                  )}
                                  {details.CritChance > 0 && (
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                      <span style={{ color: "var(--muted)" }}>{locale === "vi" ? "Chí mạng" : "Crit Chance"}</span>
                                      <strong style={{ color: "var(--gold)" }}>{(Math.round(details.CritChance * 100) / 100).toFixed(2)}%</strong>
                                    </div>
                                  )}
                                  {details.CritMultiplier > 0 && (
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                      <span style={{ color: "var(--muted)" }}>{locale === "vi" ? "ST Chí mạng" : "Crit Multi"}</span>
                                      <strong style={{ color: "var(--gold)" }}>{Math.round(details.CritMultiplier * 100)}%</strong>
                                    </div>
                                  )}
                                  {details.ManaCost > 0 && (
                                    <div style={{ display: "flex", justifyContent: "space-between", gridColumn: "span 2" }}>
                                      <span style={{ color: "var(--muted)" }}>{locale === "vi" ? "Tiêu hao năng lượng" : "Mana Cost"}</span>
                                      <strong style={{ color: "#33ccff" }}>{details.ManaCost} Mana</strong>
                                    </div>
                                  )}
                                  {details.LifeCost > 0 && (
                                    <div style={{ display: "flex", justifyContent: "space-between", gridColumn: "span 2" }}>
                                      <span style={{ color: "var(--muted)" }}>{locale === "vi" ? "Tiêu hao sinh mệnh" : "Life Cost"}</span>
                                      <strong style={{ color: "#ff4d4d" }}>{details.LifeCost} Life</strong>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Row 2: Resistances and Evade/Reduction */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            {/* Resists */}
                            <div style={{
                              background: "rgba(255, 255, 255, 0.01)",
                              border: "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "10px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px"
                            }}>
                              <span style={{ fontSize: "10px", color: "var(--muted)", fontWeight: "bold", textTransform: "uppercase", borderBottom: "1px solid var(--line)", paddingBottom: "4px" }}>Resistances</span>
                              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: "#ff6b6b" }}>Fire</span>
                                  <strong style={{ fontSize: "11px", color: "#ff6b6b" }}>{formatVal("FireResist", fireVal, true)}%</strong>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: "#4dadf7" }}>Cold</span>
                                  <strong style={{ fontSize: "11px", color: "#4dadf7" }}>{formatVal("ColdResist", coldVal, true)}%</strong>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: "#ffd43b" }}>Lightning</span>
                                  <strong style={{ fontSize: "11px", color: "#ffd43b" }}>{formatVal("LightningResist", lightningVal, true)}%</strong>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "11px", color: "#cc5de8" }}>Chaos</span>
                                  <strong style={{ fontSize: "11px", color: "#cc5de8" }}>{formatVal("ChaosResist", chaosVal, true)}%</strong>
                                </div>
                              </div>
                            </div>

                            {/* Avoidance & Mitigations */}
                            <div style={{
                              background: "rgba(255, 255, 255, 0.01)",
                              border: "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "10px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px"
                            }}>
                              <span style={{ fontSize: "10px", color: "var(--muted)", fontWeight: "bold", textTransform: "uppercase", borderBottom: "1px solid var(--line)", paddingBottom: "4px" }}>Defense & Speed</span>
                              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>Evade%</span>
                                  <strong style={{ fontSize: "11px", color: "#2af598" }}>
                                    {activeStats && activeStats.MeleeEvadeChance !== undefined ? (
                                      `${Math.round(activeStats.MeleeEvadeChance * 100)}%`
                                    ) : (
                                      evadeVal && typeof evadeVal.value === "number" ? (evadeVal.value * 100).toFixed(0) + "%" : "-"
                                    )}
                                  </strong>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>Phys Red%</span>
                                  <strong style={{ fontSize: "11px", color: "#2af598" }}>
                                    {activeStats && activeStats.PhysicalDamageReduction !== undefined ? (
                                      `${Math.round(activeStats.PhysicalDamageReduction * 100)}%`
                                    ) : (
                                      physVal && typeof physVal.value === "number" ? (physVal.value * 100).toFixed(0) + "%" : "-"
                                    )}
                                  </strong>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>Move Spd</span>
                                  <strong style={{ fontSize: "11px", color: "#2af598" }}>
                                    {activeStats && activeStats.EffectiveMovementSpeedMod !== undefined ? (
                                      `+${Math.round((activeStats.EffectiveMovementSpeedMod - 1) * 100)}%`
                                    ) : (
                                      speedVal ? `+${Math.round((parseFloat(String(speedVal.value)) - 1) * 100)}%` : "-"
                                    )}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </section>
              ) : null}

              {selected && selectedPassiveCount === 0 ? (
                <div className="build-warning">
                  <p>{localizedText(copy.emptyTree, "", locale)}</p>
                  <a href="/passive-tree">{localizedText(copy.openTree, "", locale)}</a>
                </div>
              ) : null}
            </div>

            <section className="build-card build-skills-card">
              <div className="build-section-head">
                <span className="material-symbols-rounded" aria-hidden="true">auto_awesome_motion</span>
                <h2>{localizedText(copy.skills, "", locale)}</h2>
                <strong className="build-selected-count">{formatNumber(selectedSkillCount, locale)}</strong>
                <button type="button" onClick={addBuildSkill}>
                  <span className="material-symbols-rounded" aria-hidden="true">add</span>
                  {localizedText(copy.addSkill, "", locale)}
                </button>
              </div>
              {buildSkills.length ? (
                <div className="build-skill-list" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {buildSkills.map((skill, index) => {
                    const details = activeStats && activeStats.skillsDetails && activeStats.skillsDetails[index];
                    const isExpanded = !!expandedSkills[skill.id];
                    return (
                      <article className="build-ninja-skill-card" key={skill.id} style={{
                        background: "rgba(255, 255, 255, 0.01)",
                        border: "1px solid var(--line)",
                        borderRadius: "8px",
                        padding: "12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px"
                      }}>
                        {/* Active Skill Header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            {skill.skillId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMainSocketGroup(index + 1);
                                }}
                                title={locale === "vi" ? "Chọn làm kỹ năng chính để tính DPS" : "Set as main skill for DPS calculation"}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  color: (index + 1) === mainSocketGroup ? "var(--gold)" : "rgba(255,255,255,0.15)",
                                  outline: "none",
                                  transition: "color 0.2s"
                                }}
                              >
                                <span className="material-symbols-rounded" style={{ fontSize: "18px" }}>
                                  {(index + 1) === mainSocketGroup ? "stars" : "star"}
                                </span>
                              </button>
                            )}
                            <span style={{ fontSize: "13px", fontWeight: "bold", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {skill.skillId ? gemChoiceLabel(skill.skillId, skillGemOptions, "SkillGem", locale, "Empty") : (locale === "vi" ? "Chưa chọn kỹ năng" : "No Skill")}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {activeStats && Array.isArray(activeStats.skillsDps) && activeStats.skillsDps[index] > 0 && (
                              <span style={{ 
                                background: "rgba(42, 245, 152, 0.08)", 
                                border: "1px solid rgba(42, 245, 152, 0.2)", 
                                borderRadius: "4px", 
                                padding: "1px 6px", 
                                color: "#2af598", 
                                fontSize: "11px", 
                                fontWeight: "bold",
                                whiteSpace: "nowrap"
                              }}>
                                {Math.round(activeStats.skillsDps[index]).toLocaleString("en-US")} DPS
                              </span>
                            )}
                            {/* Remove Skill Button */}
                            <button
                              type="button"
                              onClick={() => removeBuildSkill(skill.id)}
                              style={{
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                color: "rgba(255, 82, 82, 0.6)",
                                display: "flex",
                                alignItems: "center",
                                padding: "2px",
                                outline: "none"
                              }}
                              title={locale === "vi" ? "Xóa kỹ năng" : "Remove skill"}
                            >
                              <span className="material-symbols-rounded" style={{ fontSize: "18px" }}>delete</span>
                            </button>
                          </div>
                        </div>

                        {/* PoE2 Style Horizontal Socket Link Chain */}
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          background: "rgba(0, 0, 0, 0.25)",
                          border: "1px solid rgba(255, 255, 255, 0.03)",
                          padding: "12px 16px",
                          borderRadius: "6px",
                          justifyContent: "flex-start",
                          gap: "0",
                          overflowX: "auto",
                          scrollbarWidth: "none"
                        }}>
                          {/* Active Skill Socket */}
                          <div style={{ position: "relative", zIndex: 2, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => openSkillGemPicker(skill.id)}
                              onMouseEnter={() => {
                                if (skill.skillId) {
                                  const html = getGemTooltipHtml(skill.skillId, skillGemOptions, "SkillGem", locale, skill.note);
                                  if (html) setTooltip({ x: 0, y: 0, content: html, visible: true });
                                }
                              }}
                              onMouseMove={(e) => { handleMouseMove(e); }}
                              onMouseLeave={() => { handleMouseLeave(); }}
                              style={{
                                width: "56px",
                                height: "56px",
                                borderRadius: "50%",
                                background: "radial-gradient(circle, #1a1510 30%, #0c0a08 100%)",
                                border: "2.5px solid var(--gold)",
                                boxShadow: "0 0 10px rgba(194, 156, 91, 0.45), inset 0 2px 4px rgba(0,0,0,0.8)",
                                display: "grid",
                                placeItems: "center",
                                cursor: "pointer",
                                padding: 0,
                                outline: "none",
                                flexShrink: 0
                              }}
                            >
                              {skill.skillId && gemChoiceIcon(skill.skillId, skillGemOptions, "SkillGem") ? (
                                <img src={gemChoiceIcon(skill.skillId, skillGemOptions, "SkillGem")} alt="" style={{ width: "32px", height: "32px", objectFit: "contain" }} />
                              ) : (
                                <span className="material-symbols-rounded" style={{ fontSize: "20px", color: "var(--muted)" }}>add</span>
                              )}
                            </button>
                          </div>

                          {/* Support Sockets and Links */}
                          {skill.supportSkills.map((support) => (
                            <Fragment key={support.id}>
                              {/* Link Bridge */}
                              <div style={{
                                width: "6px",
                                height: "6px",
                                background: "linear-gradient(90deg, var(--gold), #786446)",
                                border: "1px solid #000",
                                boxShadow: "0 0 4px rgba(194,156,91,0.2)",
                                zIndex: 1,
                                flexShrink: 0
                              }} />
                              {/* Support Socket */}
                              <div style={{ position: "relative", zIndex: 2, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => openSupportGemPicker(skill.id, support.id)}
                                  onMouseEnter={() => {
                                    if (support.skillId) {
                                      const html = getGemTooltipHtml(support.skillId, supportGemOptions, "SupportGem", locale, support.note);
                                      if (html) setTooltip({ x: 0, y: 0, content: html, visible: true });
                                    }
                                  }}
                                  onMouseMove={(e) => { handleMouseMove(e); }}
                                  onMouseLeave={() => { handleMouseLeave(); }}
                                  style={{
                                    width: "46px",
                                    height: "46px",
                                    borderRadius: "50%",
                                    background: "radial-gradient(circle, #101216 30%, #06070a 100%)",
                                    border: "2px solid #888888",
                                    boxShadow: "0 0 6px rgba(136,136,136,0.35), inset 0 2px 4px rgba(0,0,0,0.8)",
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                    padding: 0,
                                    outline: "none",
                                    flexShrink: 0
                                  }}
                                >
                                  {support.skillId && gemChoiceIcon(support.skillId, supportGemOptions, "SupportGem") ? (
                                    <img src={gemChoiceIcon(support.skillId, supportGemOptions, "SupportGem")} alt="" style={{ width: "26px", height: "26px", objectFit: "contain" }} />
                                  ) : (
                                    <span className="material-symbols-rounded" style={{ fontSize: "18px", color: "var(--muted)" }}>add</span>
                                  )}
                                </button>
                              </div>
                            </Fragment>
                          ))}

                          {/* Add Support Socket */}
                          {skill.supportSkills.length < 5 && (
                            <Fragment>
                              {/* Link Bridge */}
                              <div style={{
                                width: "6px",
                                height: "6px",
                                background: "rgba(255, 255, 255, 0.05)",
                                border: "1px dashed rgba(255, 255, 255, 0.15)",
                                zIndex: 1,
                                flexShrink: 0
                              }} />
                              {/* Dash Socket */}
                              <div style={{ position: "relative", zIndex: 2, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => addSupportSkill(skill.id)}
                                  style={{
                                    width: "46px",
                                    height: "46px",
                                    borderRadius: "50%",
                                    background: "transparent",
                                    border: "2px dashed rgba(255, 255, 255, 0.15)",
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                    color: "var(--muted)",
                                    padding: 0,
                                    outline: "none",
                                    flexShrink: 0
                                  }}
                                  title={locale === "vi" ? "Thêm Hỗ trợ" : "Add Support"}
                                >
                                  <span className="material-symbols-rounded" style={{ fontSize: "18px" }}>add</span>
                                </button>
                              </div>
                            </Fragment>
                          )}
                        </div>

                        {/* PoE2 Style Tooltip details */}
                        {details && details.name && (
                          <div className="poe-tooltip-card tooltip-rarity-gem" style={{
                            background: "#0c0d12",
                            border: "1px solid var(--gold)",
                            borderRadius: "4px",
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            marginTop: "8px",
                            boxShadow: "0 4px 15px rgba(0, 0, 0, 0.6)"
                          }}>
                            {/* Title & Tags */}
                            <div style={{ borderBottom: "1px solid #33271a", paddingBottom: "6px" }}>
                              <h3 style={{ fontSize: "13px", fontWeight: "bold", color: "var(--gold)", margin: 0 }}>
                                {details.name}
                              </h3>
                              {skill.skillId && (() => {
                                const activeGemRec = gemChoiceItem(skill.skillId, skillGemOptions, "SkillGem");
                                return activeGemRec ? (
                                  <div className="tooltip-tags" style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                                    {localizedLines(activeGemRec, "properties", locale)
                                      .filter(l => !l.includes(":"))
                                      .join(", ")}
                                  </div>
                                ) : null;
                              })()}
                            </div>

                            {/* Core properties like Cast Time, Cost */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "11px", color: "#e0e0e0", borderBottom: "1px solid #33271a", paddingBottom: "6px" }}>
                              {details.Speed > 0 && (
                                <div>
                                  <span style={{ color: "var(--muted)" }}>
                                    {locale === "vi" ? "Thời gian thi triển: " : "Cast Time: "}
                                  </span>
                                  <strong>{(1 / details.Speed).toFixed(2)}s</strong>
                                </div>
                              )}
                              {details.ManaCost > 0 && (
                                <div>
                                  <span style={{ color: "var(--muted)" }}>
                                    {locale === "vi" ? "Tiêu hao năng lượng: " : "Mana Cost: "}
                                  </span>
                                  <strong style={{ color: "#33ccff" }}>{details.ManaCost}</strong>
                                </div>
                              )}
                              {details.LifeCost > 0 && (
                                <div>
                                  <span style={{ color: "var(--muted)" }}>
                                    {locale === "vi" ? "Tiêu hao sinh mệnh: " : "Life Cost: "}
                                  </span>
                                  <strong style={{ color: "#ff4d4d" }}>{details.LifeCost}</strong>
                                </div>
                              )}
                            </div>

                            {/* Gem Stats (Light blue list) */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#88adbf" }}>
                              {details.PhysicalMax > 0 && (
                                <div>
                                  {locale === "vi" ? "Gây " : "Deals "}
                                  <strong>{Math.round(details.PhysicalMin)} - {Math.round(details.PhysicalMax)}</strong>
                                  {locale === "vi" ? " Sát thương Vật lý" : " Physical Damage"}
                                </div>
                              )}
                              {details.FireMax > 0 && (
                                <div>
                                  {locale === "vi" ? "Gây " : "Deals "}
                                  <strong>{Math.round(details.FireMin)} - {Math.round(details.FireMax)}</strong>
                                  {locale === "vi" ? " Sát thương Lửa" : " Fire Damage"}
                                </div>
                              )}
                              {details.ColdMax > 0 && (
                                <div>
                                  {locale === "vi" ? "Gây " : "Deals "}
                                  <strong>{Math.round(details.ColdMin)} - {Math.round(details.ColdMax)}</strong>
                                  {locale === "vi" ? " Sát thương Băng" : " Cold Damage"}
                                </div>
                              )}
                              {details.LightningMax > 0 && (
                                <div>
                                  {locale === "vi" ? "Gây " : "Deals "}
                                  <strong>{Math.round(details.LightningMin)} - {Math.round(details.LightningMax)}</strong>
                                  {locale === "vi" ? " Sát thương Sét" : " Lightning Damage"}
                                </div>
                              )}
                              {details.ChaosMax > 0 && (
                                <div>
                                  {locale === "vi" ? "Gây " : "Deals "}
                                  <strong>{Math.round(details.ChaosMin)} - {Math.round(details.ChaosMax)}</strong>
                                  {locale === "vi" ? " Sát thương Hỗn loạn" : " Chaos Damage"}
                                </div>
                              )}

                              {details.HitChance < 100 && (
                                <div>
                                  {locale === "vi" ? "Tỉ lệ đánh trúng: " : "Chance to Hit: "}
                                  <strong>{Math.round(details.HitChance)}%</strong>
                                </div>
                              )}
                              {details.CritChance > 0 && (
                                <div>
                                  {locale === "vi" ? "Tỉ lệ Chí mạng: " : "Critical Strike Chance: "}
                                  <strong>{(Math.round(details.CritChance * 100) / 100).toFixed(2)}%</strong>
                                </div>
                              )}
                              {details.CritMultiplier > 0 && (
                                <div>
                                  {locale === "vi" ? "Tăng nhân sát thương Chí mạng: " : "Multiplier for Critical Strikes: "}
                                  <strong>+{Math.round((details.CritMultiplier - 1) * 100)}%</strong>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="build-empty">
                  <p>{localizedText(copy.noSkills, "", locale)}</p>
                  <button type="button" onClick={addBuildSkill}>{localizedText(copy.addSkill, "", locale)}</button>
                </div>
              )}
            </section>
          </div>


        </section>
      </section>
      )}

      {!editorOpen && pobImportOpen ? (
        <div className="build-picker-backdrop build-pob-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !pobImporting) setPobImportOpen(false);
        }}>
          <section className="build-pob-import" role="dialog" aria-modal="true" aria-label={localizedText(copy.importPob, "", locale)}>
            <div className="build-picker-head">
              <div>
                <p className="eyebrow">{localizedText(copy.pobCode, "", locale)}</p>
                <h2>{localizedText(copy.importPob, "", locale)}</h2>
              </div>
              <button type="button" onClick={() => setPobImportOpen(false)} aria-label="Close" disabled={pobImporting}>
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="build-pob-body">
              <p>{localizedText(copy.pobHint, "", locale)}</p>
              <label>
                <span>{localizedText(copy.pobCode, "", locale)}</span>
                <textarea
                  value={pobCode}
                  onChange={(event) => {
                    setPobCode(event.target.value);
                    setImportError("");
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") importPobCode();
                  }}
                  placeholder={localizedText(copy.pobPlaceholder, "", locale)}
                  spellCheck={false}
                  autoFocus
                />
              </label>
              {importError ? <p className="build-import-error">{importError}</p> : null}
              <div className="build-pob-actions">
                <button type="button" onClick={() => setPobImportOpen(false)} disabled={pobImporting}>Close</button>
                <button type="button" onClick={importPobCode} disabled={!isPobExportCode(pobCode) || pobImporting}>
                  <span className="material-symbols-rounded" aria-hidden="true">download_for_offline</span>
                  {pobImporting ? "Importing..." : localizedText(copy.pobImportAction, "", locale)}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {editorOpen && activeGemPicker ? (
        <div className="build-picker-backdrop build-gem-picker-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveGemPicker(null);
        }}>
          <section className="build-gem-picker" role="dialog" aria-modal="true" aria-label={activeGemPickerLabel}>
            <div className="build-picker-head">
              <div>
                <p className="eyebrow">Gem</p>
                <h2>{activeGemPickerLabel}</h2>
              </div>
              <button type="button" onClick={() => setActiveGemPicker(null)} aria-label="Close">
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="build-picker-controls build-gem-picker-controls" style={{ display: "flex", gap: "10px", alignItems: "center", width: "100%" }}>
              <label className="build-picker-search" style={{ flex: 1 }}>
                <span className="material-symbols-rounded" aria-hidden="true">search</span>
                <input value={gemPickerQuery} onChange={(event) => setGemPickerQuery(event.target.value)} placeholder={localizedText(copy.searchGem, "", locale)} autoFocus />
              </label>
              {activeGemPicker?.kind === "support" && currentSupportGemId && (
                <button className="build-picker-clear" type="button" onClick={() => {
                  removeSupportSkill(activeGemPicker.skillId, activeGemPicker.supportId);
                  setActiveGemPicker(null);
                }} style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "38px",
                  border: "1px solid rgba(255, 82, 82, 0.3)",
                  borderRadius: "7px",
                  background: "rgba(255, 82, 82, 0.08)",
                  color: "#ff5252",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                  padding: "0 12px",
                  whiteSpace: "nowrap"
                }}>
                  <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: "16px" }}>backspace</span>
                  {locale === "vi" ? "Gỡ bỏ" : "Remove"}
                </button>
              )}
              {activeGemPicker?.kind === "skill" && currentSkillGemId && (
                <button className="build-picker-clear" type="button" onClick={() => {
                  updateBuildSkill(activeGemPicker.skillId, { skillId: "" });
                  setActiveGemPicker(null);
                }} style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "38px",
                  border: "1px solid rgba(255, 82, 82, 0.3)",
                  borderRadius: "7px",
                  background: "rgba(255, 82, 82, 0.08)",
                  color: "#ff5252",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                  padding: "0 12px",
                  whiteSpace: "nowrap"
                }}>
                  <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: "16px" }}>backspace</span>
                  {locale === "vi" ? "Gỡ bỏ" : "Remove"}
                </button>
              )}
            </div>
            <div className="build-picker-list build-gem-list">
              {gemPickerItems.length ? gemPickerItems.map((item) => {
                const iconUrl = displayImageUrl(item.icon_url);
                return (
                  <button className="build-picker-result build-gem-result" type="button" onClick={() => selectGem(item)} key={`${item.menu_key}:${item.slug ?? item.name}`}>
                    <span className="build-picker-icon build-gem-picker-icon">
                      {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">auto_awesome_motion</span>}
                    </span>
                    <span className="build-picker-copy build-gem-picker-copy">
                      <strong>{itemTitle(item, locale)}</strong>
                    </span>
                  </button>
                );
              }) : <p className="build-picker-empty">{localizedText(copy.noGems, "", locale)}</p>}
            </div>
          </section>
        </div>
      ) : null}

      {editorOpen && activeSlot ? (
        <div className="build-picker-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveSlotId(null);
        }}>
          <section className="build-item-picker" role="dialog" aria-modal="true" aria-label={`${localizedText(copy.chooseItem, "", locale)}: ${activeSlot.label}`}>
            <div className="build-picker-head">
              <div>
                <p className="eyebrow">{activeSlot.label}</p>
                <h2>{localizedText(copy.chooseItem, "", locale)}</h2>
              </div>
              <button type="button" onClick={() => setActiveSlotId(null)} aria-label="Close">
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="build-picker-controls">
              <label className="build-picker-search">
                <span className="material-symbols-rounded" aria-hidden="true">search</span>
                <input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder={localizedText(copy.searchItem, "", locale)} autoFocus />
              </label>
              <div className="build-picker-mode" role="group" aria-label="Item type">
                <button className={pickerMode === "base" ? "is-active" : ""} type="button" onClick={() => setPickerMode("base")}>{localizedText(copy.base, "", locale)}</button>
                <button className={pickerMode === "unique" ? "is-active" : ""} type="button" onClick={() => setPickerMode("unique")}>{localizedText(copy.unique, "", locale)}</button>
              </div>
              {inventoryBySlot.get(activeSlot.id)?.itemName ? (
                <button className="build-picker-clear" type="button" onClick={() => clearSlot(activeSlot.id)}>
                  <span className="material-symbols-rounded" aria-hidden="true">backspace</span>
                  {localizedText(copy.clearSlot, "", locale)}
                </button>
              ) : null}
            </div>
            <div className="build-picker-list">
              {pickerItems.length ? pickerItems.map((item) => {
                const unique = isUniqueItem(item);
                const lines = itemSummaryLines(item, locale);
                const iconUrl = displayImageUrl(item.icon_url);
                return (
                  <button className={`build-picker-result ${unique ? "is-unique" : ""}`} type="button" onClick={() => selectItem(item)} key={`${item.menu_key}:${item.slug ?? item.name}`}>
                    <span className="build-picker-icon">
                      {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">inventory_2</span>}
                    </span>
                    <span className="build-picker-copy">
                      <strong>{itemTitle(item, locale)}</strong>
                      <small>{item.menu_label}{itemBaseName(item, locale) ? ` - ${itemBaseName(item, locale)}` : ""}</small>
                      {lines.length ? <span>{lines.map((line) => <em key={line}>{line}</em>)}</span> : null}
                    </span>
                  </button>
                );
              }) : <p className="build-picker-empty">{localizedText(copy.noItems, "", locale)}</p>}
            </div>
          </section>
        </div>
      ) : null}

      {editorOpen && showBuildHelp ? (
        <div className="build-help-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowBuildHelp(false);
        }}>
          <section className="build-help-dialog" role="dialog" aria-modal="true" aria-label={localizedText(copy.howTitle, "", locale)}>
            <div className="build-help-head">
              <div>
                <p className="eyebrow">Build Planner</p>
                <h2>{localizedText(copy.howTitle, "", locale)}</h2>
                {howIntro ? <p>{howIntro}</p> : null}
              </div>
              <button type="button" onClick={() => setShowBuildHelp(false)} aria-label="Close">
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
            <ol>
              <li>{localizedText(copy.howStepDownload, "", locale)}</li>
              <li>
                {localizedText(copy.howStepSave, "", locale)}
                <code>{localizedText(copy.plannerFolder, "", locale)}</code>
              </li>
              <li>{localizedText(copy.howStepOpen, "", locale)}</li>
            </ol>
          </section>
        </div>
      ) : null}

      {buildDialog ? (
        <div className="build-action-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeBuildDialog();
        }}>
          <section className="build-action-dialog" role="dialog" aria-modal="true" aria-label={buildDialog.title}>
            <div>
              <h2>{buildDialog.title}</h2>
              {buildDialog.body ? <p>{buildDialog.body}</p> : null}
            </div>
            <div className="build-action-dialog-actions">
              {buildDialog.actions.map((action) => (
                <button className={action.tone ? `is-${action.tone}` : ""} type="button" onClick={action.onClick ?? closeBuildDialog} key={action.label}>
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tooltip.visible && (
        <div style={{
          position: "fixed",
          left: tooltip.x,
          top: tooltip.y,
          pointerEvents: "none",
          zIndex: 9999,
          maxWidth: "320px",
          transform: "translate(-50%, -105%)"
        }} dangerouslySetInnerHTML={{ __html: tooltip.content }} />
      )}
    </main>
  );
}
