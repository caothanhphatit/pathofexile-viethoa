import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadBuildPlannerData, loadCraftData, loadCraftIndex, loadItemsData, loadPassiveTreeData, loadSkillGemsData } from "../lib/data";
import { buildModPool, type ModPool } from "../../shared/item-mods.mjs";
import { ItemEditor, NewItemDialog, type NewItemChoice } from "../components/ItemEditor";
import { displayImageUrl } from "../lib/image";
import { formatNumber, localizedText, type Locale, uiText } from "../lib/locale";
import { navigateTo, setLeaveGuard } from "../lib/routes";
import { matchesQuery } from "../lib/text";
import { PassiveTreeWorkspace, type TreeJewelHooks } from "./PassiveTreePage";
import { SocketJewelMenu } from "../components/SocketJewelMenu";
import { parsePassiveTree, type PassiveNode, type PassiveTreeModel } from "../passive/tree";
import { selectedStartNodeIds } from "../passive/planner";
import "../styles/planner-new-build.css";
import "../styles/planner-rules.css";
import {
  DEFAULT_CHARACTER_LEVEL,
  MAX_CHARACTER_LEVEL,
  MIN_CHARACTER_LEVEL,
  buildCharacterLevel,
  characterLevel,
  classBuildPayload,
  createClassTreeSnapshot,
  dedupeTreeSnapshots,
  officialAscendancyId,
  buildPayloadFromPobImport,
  calculationRequestBody,
  encodePobXmlText,
  inventoryForSlots,
  withoutPobGemDetails,
  gemNameRank,
  gemPickerOptions,
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
  parsePobItemDetails,
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
  treePicksFromPobImport,
  weaponSetPointCounts,
  withTreePicksFromPayload,
  type BuildPayload,
  type BuildInventoryChoice,
  type BuildPlannerData,
  type BuildProject,
  type BuildSkillChoice,
  type BuildSupportSkillChoice,
  type BuildTreeSnapshot,
  type PobGem,
  type PobImportData,
  type PobConfigInput,
  type BuildStashItem
} from "../lib/buildPlanner";
import { arrangeSkillCards, cardDamageLines, cardDamageNeedsNames, cardDamageOwners, foldedGrantedGroups, formatStat, groupDamageByRow, groupDamageValue, pobItemTextFromRecord, resistanceText, skillDpsByGroup, stampedStatsUsable, type PobSkillDps } from "../lib/buildStats";
import { buildPobXml } from "../../server/pob-build-xml.mjs";
import { pobGemId } from "../../server/pob-gem-ids.mjs";
import { supportFamilyConflicts } from "../../server/pob-gem-families.mjs";
import { monsterGemTitle, monsterLibraryOf } from "../../server/pob-monster-gems.mjs";
import type { MonsterGemPatch } from "../../server/pob-monsters.mjs";
import { BuildConfigPanel, BuildStatDetails } from "../components/BuildCalcPanels";
import { StatBreakdownDialog, type ExplainTarget } from "../components/StatBreakdown";
import { BuildSummonStats, GemOptionControls, MonsterPicker, gemOptionBadges } from "../components/BuildGemOptions";
import { hasGemChoices, plannerGemTargets, withGemOption, type GemOptionChange, type PobGemOptions } from "../lib/gemOptions";
import { mainSkillDps } from "../lib/summonStats";
import {
  BuildInventoryPanel,
  CompareBlock,
  GemSwapStrip,
  SLOT_DRAG_TYPE,
  SupportValue,
  STASH_DRAG_TYPE,
  type CatalogEntry,
  type CompareSpec,
  type GemOptionView,
  type StashItemView
} from "../components/BuildInventoryPanel";
import {
  duplicateStashItem,
  equipTargets,
  isItemEdited,
  resetItemText,
  withItemText,
  itemCategoriesFromText,
  removeStashItem,
  slotIdsForCategories,
  splitItemTexts,
  stashFromPobImport,
  stashItemFromText,
  stashItemSummary,
  unequipSlot,
  isJewelText,
  jewelSocketAccepts,
  jewelSocketNodeId,
  moveSocketedJewel,
  socketJewel,
  unsocketJewel
} from "../lib/buildInventory";
import { buildWeaponFlags, enforceWeaponSets, equipWithWeaponRules, inventoryWithoutImpossibleOffHands, weaponNoticeText, weaponSlotCategories } from "../lib/weaponSets";
import { buildWarnings, freeAllocatedNames, itemLevelRequirement, type WarningGem, type WarningItem, type WarningPoints } from "../lib/buildWarnings";
import { isChoiceOptionNode } from "../../shared/equipment-rules.mjs";
import { skillWeaponHint } from "../lib/skillWeapon";
import { treePointsSpent } from "../lib/treePoints";
import { countMatches, searchItems } from "../lib/itemSearch";
import { applyLocalMods } from "../lib/itemLocalStats";
import { CalcQueue, calcKey } from "../lib/calcQueue";
import { useNodePreview } from "../lib/useNodePreview";
import { gemCandidates } from "../lib/gemSuggest";

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
  color?: string;
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
  startFromClass: { vi: "Bắt đầu build: chọn class và ascendancy, rồi chọn điểm trên cây.", en: "Start a build: pick a class and ascendancy, then allocate points on the tree." },
  pickClass: { vi: "Class", en: "Class" },
  pickAscendancy: { vi: "Ascendancy", en: "Ascendancy" },
  noAscendancyChoice: { vi: "Chưa chọn ascendancy", en: "No ascendancy yet" },
  createClassTree: { vi: "Tạo cây", en: "Create tree" },
  changeClass: { vi: "Đổi class", en: "Change class" },
  orSavedTree: { vi: "Hoặc dùng tree đã lưu", en: "Or use a saved tree" },
  loadingClasses: { vi: "Đang tải danh sách class...", en: "Loading classes..." },
  confirmChangeClass: { vi: "Đổi class?", en: "Change class?" },
  confirmChangeClassBody: { vi: "Cây mới chỉ có điểm xuất phát của class này; các điểm thụ động đang chọn sẽ bị bỏ.", en: "The new tree only has this class's start; the passives allocated now are dropped." },
  characterLevel: { vi: "Cấp nhân vật", en: "Character level" },
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
  savedBuildBody: {
    vi: "Build nằm trong trình duyệt này (không đăng công khai, không đồng bộ sang máy khác). Muốn chia sẻ hoặc giữ bản sao: chép «PoB code» hoặc tải file .build.",
    en: "The build is kept in this browser (not public, not synced). To share or back it up, copy the PoB code or download the .build file."
  },
  saveBuildHint: { vi: "Lưu trong trình duyệt này, không công khai", en: "Saved in this browser, not public" },
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

// Passive-tree jewels and PoB extra slots (augments, gear jewel sockets) ride along after the doll slots.
function inventoryWithEmptySlots(rows: BuildInventoryChoice[]): BuildInventoryChoice[] {
  return inventoryForSlots(rows, equipmentSlotIds, newInventoryChoice);
}

/** The weapon set PoB had active in an imported build, if it says. */
function payloadWeaponSet(payload: BuildPayload): 1 | 2 | undefined {
  const value = Number(payload.active_weapon_set);
  return value === 1 || value === 2 ? value : undefined;
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
  // A guess from the slug is often not PoB's id (HeraldofAsh vs HeraldOfAsh, Decompose is
  // CorpseCloud); PoB would drop the gem, so use PoB's own id when it has the gem.
  return slug ? pobGemId(`Metadata/Items/Gems/${prefix}${slug}`, item.name ?? "") : "";
}

function officialGemAliases(item: ItemRecord, prefix: "SkillGem" | "SupportGem"): string[] {
  const primary = officialGemId(item, prefix);
  const aliases = new Set([primary]);
  // Builds saved before ids came from the game data used name-based guesses; keep matching them.
  const slug = prefix === "SupportGem" ? compactSupportGemSlug(item) : compactGemSlug(item);
  if (slug) aliases.add(`Metadata/Items/Gems/${prefix}${slug}`);
  // The game mixes Metadata/Items/Gem/ and Metadata/Items/Gems/; accept either spelling.
  aliases.add(primary.replace(/^Metadata\/Items\/Gem\//, "Metadata/Items/Gems/"));
  aliases.add(primary.replace(/^Metadata\/Items\/Gems\//, "Metadata/Items/Gem/"));
  if (prefix === "SupportGem") {
    const tail = primary.replace(/^Metadata\/Items\/Gems?\/SupportGem/, "");
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
  // PoB's gemId is the game id: an exact hit beats name matching ("Zenith II" is not "Zenith I").
  if (gem.gemId) {
    const exact = options.find((item) => item.official_id === gem.gemId);
    if (exact) return exact;
  }
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

// Saved builds and PoB imports name gems in several ways: the full game id, its
// last path segment ("SkillGemFrenzy" / "Frenzy"), or the display name or slug
// ("Hollow Palm", "hollow-palm"). Try them from the most to the least exact.
// (Ported from a hotfix that had been applied by hand on the server, 2026-09-01.)
function gemChoiceItem(id: string, options: ItemRecord[], prefix: "SkillGem" | "SupportGem"): ItemRecord | undefined {
  if (!id) return undefined;

  const direct = options.find((item) => officialGemAliases(item, prefix).includes(id));
  if (direct) return direct;

  const stripKind = (value: string) => value.replace(/^(?:SkillGem|SupportGem)/, "");
  const tail = id.split("/").pop() || id;
  const tailMatch = options.find((item) => {
    const tails = officialGemAliases(item, prefix).map((alias) => alias.split("/").pop() || "");
    return tails.includes(tail) || tails.map(stripKind).includes(stripKind(tail));
  });
  if (tailMatch) return tailMatch;

  const normalized = normalizeGemLookupText(id);
  const compact = compactGemLookupText(id);
  return options.find((item) => {
    const values = new Set(gemLookupValues(item, prefix));
    return values.has(normalized) || values.has(compact);
  });
}

function getGemTooltipHtml(id: string, options: ItemRecord[], prefix: "SkillGem" | "SupportGem", locale: Locale, note?: string): string {
  const item = gemChoiceItem(id, options, prefix);
  if (!item) {
    return note
      ? `<div class="poe-tooltip-card poe-no-tooltip tooltip-rarity-gem"><div class="tooltip-header"><div class="tooltip-name">${escapeHtml(note)}</div></div></div>`
      : "";
  }
  const title = itemTitle(item, locale);
  const tags = localizedLines(item, "properties", locale).filter(l => !l.includes(":"));
  const properties = localizedLines(item, "properties", locale).filter(l => l.includes(":")).map(cleanTooltipLine);
  const requirements = localizedLines(item, "requirements", locale).map(cleanTooltipLine);
  const mods = localizedLines(item, "mods", locale).filter((line) => !isInternalStatLine(line)).map(cleanTooltipLine);

  let h = "";
  if (tags.length) {
    h += `<div class="tooltip-tags">${escapeHtml(tags.join(", "))}</div>`;
  }
  if (note) {
    if (h) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-note">${escapeHtml(note)}</div>`;
  }
  if (properties.length) {
    if (h) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-properties">${properties.map((line) => tooltipPropertyHtml(line)).join("")}</div>`;
  }
  if (requirements.length) {
    if (h) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-requirements">${requirements.map(tooltipRequirementHtml).join("")}</div>`;
  }
  if (mods.length) {
    if (h || requirements.length) h += '<hr class="tooltip-divider" />';
    h += `<div class="tooltip-mods">${mods.map((g) => `<div class="tooltip-mod-line">${escapeHtml(g)}</div>`).join("")}</div>`;
  }

  return `
    <div class="poe-tooltip-card poe-no-tooltip tooltip-rarity-gem">
      <div class="tooltip-header">
        <div class="tooltip-name">${escapeHtml(title)}</div>
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch] as string));
}

/**
 * poe2db's gem pages also list the raw stats the client never displays, e.g.
 * "disable visual hit effect [1]" or "... locked duration % [50]". Shown lines never end
 * in a bracketed number, so those are dropped from tooltips.
 */
function isInternalStatLine(line: string): boolean {
  return /\[[-+]?\d+(?:\.\d+)?\]\s*\.?$/.test(line.trim());
}

// Letters the game font (Fontin, Latin-1 only) does not have. A text run that
// contains one is drawn whole in the Vietnamese small-caps face instead of
// mixing two fonts inside a word.
const VIETNAMESE_LETTER = /[ĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

/** Wraps every text node of tooltip HTML that holds Vietnamese in <span class="tip-vi">. */
function markVietnameseRuns(html: string): string {
  return html.replace(/>([^<>]+)</g, (match, text: string) => (VIETNAMESE_LETTER.test(text) ? `><span class="tip-vi">${text}</span><` : match));
}

/** Localised lines end with a stray "." in the vi data; the game never shows one. */
function cleanTooltipLine(line: string): string {
  return line.trim().replace(/(?<![.])\.$/, "");
}

function itemRarity(item: ItemRecord): "normal" | "magic" | "rare" | "unique" {
  if (isUniqueItem(item)) return "unique";
  const rarity = String(item.rarity || "").toLowerCase();
  if (rarity === "magic" || rarity === "rare") return rarity;
  return "normal";
}

/** "Armour: 179" -> grey label, white value; ranged values "(447-626)" are augmented (blue). */
function tooltipPropertyHtml(line: string, augmented = false): string {
  const split = line.indexOf(":");
  if (split < 0) return `<div class="tip-line">${escapeHtml(line)}</div>`;
  const label = line.slice(0, split + 1);
  const value = line.slice(split + 1).trim();
  const aug = augmented || /[(—]/.test(value) ? " tip-value--aug" : "";
  return `<div class="tip-line"><span class="tip-label">${escapeHtml(label)}</span> <span class="tip-value${aug}">${escapeHtml(value)}</span></div>`;
}

/** "Requires: Level 65, 59 Str" -> numbers in white, the rest grey. */
function tooltipRequirementHtml(line: string): string {
  const html = escapeHtml(line).replace(/(\d+)/g, '<span class="tip-value">$1</span>');
  return `<div class="tip-line tip-req">${html}</div>`;
}

/** Item card in the in-game tooltip layout: rarity header band, class, properties, requirements, mods. */
function getItemTooltipHtml(item: ItemRecord, locale: Locale): string {
  const rarity = itemRarity(item);
  const title = itemTitle(item, locale);
  const properties = localizedLines(item, "properties", locale).map(cleanTooltipLine);
  const base = properties.find((line) => !line.includes(":")) || "";
  const stats = properties.filter((line) => line.includes(":"));
  const requirements = localizedLines(item, "requirements", locale).map(cleanTooltipLine);
  const mods = localizedLines(item, "mods", locale).map(cleanTooltipLine);
  const itemClass = item.menu_label || item.group_label || "";

  const sections: string[] = [];
  const head: string[] = [];
  if (itemClass) head.push(`<div class="tip-line tip-class">${escapeHtml(itemClass)}</div>`);
  head.push(...stats.map((line) => tooltipPropertyHtml(line)));
  if (head.length) sections.push(head.join(""));
  if (requirements.length) sections.push(requirements.map(tooltipRequirementHtml).join(""));
  if (mods.length) sections.push(`<div class="tooltip-mods">${mods.map((line) => `<div class="tooltip-mod-line">${escapeHtml(line)}</div>`).join("")}</div>`);

  return `
    <div class="poe-tooltip-card poe-no-tooltip tooltip-rarity-${rarity}${base ? " has-base" : ""}">
      <div class="tooltip-header">
        <div class="tooltip-name">${escapeHtml(title)}</div>
        ${base && base !== title ? `<div class="tooltip-base">${escapeHtml(base)}</div>` : ""}
      </div>
      ${sections.map((section) => `<div class="tooltip-section">${section}</div>`).join('<div class="tooltip-divider"></div>')}
    </div>`;
}

// Tooltip for an item that came from a PoB code or a .build file: name, rolls,
// item level and corruption come from the item's own text; the database record
// of its base only adds the item class, base properties and requirements.
// baseRecord: the record of the item's base type (a unique's own record only names its base).
function getImportedItemTooltipHtml(rawText: string, record: ItemRecord | undefined, locale: Locale, baseRecord?: ItemRecord): string {
  const item = parsePobItemDetails(rawText);
  const rarity = item.rarity || (record ? itemRarity(record) : "normal");
  // The base type's numbers with the item's own local mods and quality applied, as PoB shows
  // them (damage, attacks per second, armour, Spirit...): changed values are drawn as augmented.
  const propertySource = baseRecord ?? (rarity !== "unique" ? record : undefined);
  const propertyRows = (propertySource?.properties ?? []).map(String)
    .map((line, index) => ({ line, shown: cleanTooltipLine(localizedText(propertySource?.i18n?.properties?.[index], line, locale)) }))
    .filter((row) => row.line.includes(":"));
  const baseProperties = applyLocalMods(propertyRows.map((row) => row.line), item.mods.map((mod) => mod.text), item.quality ?? 0).map((row) => {
    const shown = row.index >= 0 ? propertyRows[row.index]?.shown ?? row.line : row.line;
    if (!row.changed) return { line: shown, changed: false };
    // Keep the localised label, show the new value.
    const label = shown.includes(":") ? shown.slice(0, shown.indexOf(":")) : row.line.slice(0, row.line.indexOf(":"));
    return { line: `${label}: ${row.line.slice(row.line.indexOf(":") + 1).trim()}`, changed: true };
  });
  const requirements = record ? localizedLines(record, "requirements", locale).map(cleanTooltipLine) : [];
  const itemClass = record?.menu_label || record?.group_label || "";
  const isVi = locale === "vi";

  const head: string[] = [];
  if (itemClass) head.push(`<div class="tip-line tip-class">${escapeHtml(itemClass)}</div>`);
  if (item.quality) head.push(tooltipPropertyHtml(`${isVi ? "Chất lượng" : "Quality"}: +${item.quality}%`));
  head.push(...baseProperties.map((row) => tooltipPropertyHtml(row.line, row.changed)));

  const meta: string[] = [];
  if (item.itemLevel) meta.push(`<div class="tooltip-item-level">${isVi ? "Cấp vật phẩm" : "Item Level"}: ${item.itemLevel}</div>`);
  if (item.levelReq && !requirements.length) meta.push(tooltipRequirementHtml(`${isVi ? "Yêu cầu cấp" : "Requires Level"} ${item.levelReq}`));
  else meta.push(...requirements.map(tooltipRequirementHtml));

  const modHtml = (kind: string) => item.mods
    .filter((mod) => mod.kind === kind)
    .map((mod) => `<div class="tooltip-mod-line${mod.flags.map((flag) => ` is-${flag}`).join("")}">${escapeHtml(mod.text)}</div>`)
    .join("");
  const enchants = modHtml("enchant") + modHtml("rune");
  const implicits = modHtml("implicit");
  const explicits = modHtml("explicit");

  const sections: string[] = [];
  if (head.length) sections.push(head.join(""));
  if (meta.length) sections.push(meta.join(""));
  if (enchants) sections.push(`<div class="tooltip-enchants">${enchants}</div>`);
  if (implicits) sections.push(`<div class="tooltip-implicits">${implicits}</div>`);
  if (explicits) sections.push(`<div class="tooltip-mods">${explicits}</div>`);
  if (item.corrupted) sections.push(`<div class="tooltip-corrupted">${isVi ? "Đã corrupt" : "Corrupted"}</div>`);

  const title = item.name || (record ? itemTitle(record, locale) : "");
  const base = item.baseName && item.baseName !== title ? item.baseName : "";
  return `
    <div class="poe-tooltip-card poe-no-tooltip tooltip-rarity-${rarity}${base ? " has-base" : ""}">
      <div class="tooltip-header">
        <div class="tooltip-name">${escapeHtml(title)}</div>
        ${base ? `<div class="tooltip-base">${escapeHtml(base)}</div>` : ""}
      </div>
      ${sections.map((section) => `<div class="tooltip-section">${section}</div>`).join('<div class="tooltip-divider"></div>')}
    </div>`;
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
  // A build imported twice saves the same tree twice: list it once.
  const unique = new Set(dedupeTreeSnapshots(rows.map((row) => row.snapshot)));
  return rows.filter((row) => unique.has(row.snapshot));
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
    treeVersion: data.treeSpec?.treeVersion || plannerData?.version || "pob",
    ...treePicksFromPobImport(data)
  });
}

function treeSignature(snapshot: BuildTreeSnapshot | null | undefined): unknown {
  if (!snapshot) return null;
  return {
    name: snapshot.name || "",
    className: snapshot.className || "",
    ascendancyName: snapshot.ascendancyName || "",
    allocatedIds: [...new Set(snapshot.allocatedIds)].sort(),
    // startIds are the class's start nodes, filled in by the tree once it loads, and the
    // version is written "0_5" by PoB codes and "0.5" by the tree: neither is an edit, so
    // a build just imported or reopened does not read as "Chưa lưu".
    treeVersion: String(snapshot.treeVersion || "").replace(/_/g, "."),
    weaponSets: snapshot.weaponSets ?? {},
    attributeChoices: snapshot.attributeChoices ?? {}
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
    baseName: row.baseName || "",
    // An item edited in place keeps its slot: only its text tells.
    rawText: row.rawText || ""
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
  stash?: BuildStashItem[];
  level: number;
}): string {
  return JSON.stringify({
    level: input.level,
    // The id alone would miss an inventory item whose mods were edited.
    stash: (input.stash ?? []).map((row) => [row.id, row.rawText || ""]),
    name: input.name.trim(),
    author: input.author.trim(),
    description: input.description.trim(),
    // Trees saved before weapon sets / attributes were editable read them from the payload.
    tree: treeSignature(withTreePicksFromPayload(input.tree, input.importedPayload)),
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
    importedFileName: project.importedFileName || "",
    stash: project.stash ?? [],
    level: buildCharacterLevel(project)
  });
}

function hasDraftContent(input: {
  name: string;
  description: string;
  tree: BuildTreeSnapshot | null;
  inventoryCount: number;
  skillCount: number;
  /** Items in the build's inventory (pasted, crafted, searched): work worth keeping too. */
  stashCount: number;
  importedBuild: ImportedBuild | null;
}): boolean {
  return Boolean(
    input.importedBuild ||
    input.stashCount > 0 ||
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
  // Empty by default: the user's own build is not by "POE2 Viet Hoa", and a build saved with
  // no author must reopen with none (otherwise it reads as "Chưa lưu" right away).
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [inventory, setInventory] = useState<BuildInventoryChoice[]>(() => emptyEquipmentChoices());
  const [buildSkills, setBuildSkills] = useState<BuildSkillChoice[]>([]);
  // Personal inventory ("Kho đồ"): items for this build that are not worn.
  const [stash, setStash] = useState<BuildStashItem[]>([]);
  /** A jewel picked in the inventory, waiting for a click on a tree socket. */
  const [carriedJewelId, setCarriedJewelId] = useState<string | null>(null);
  const [draggedJewelId, setDraggedJewelId] = useState<string | null>(null);
  const [socketHover, setSocketHover] = useState<{ node: PassiveNode; allocated: boolean } | null>(null);
  // An inventory item waiting for the player to pick one of several slots.
  const [slotChoice, setSlotChoice] = useState<{ itemId: string; slots: string[] } | null>(null);
  const [dropSlotId, setDropSlotId] = useState<string | null>(null);
  // One line under the doll: why an item moved back to the inventory or was refused.
  const [equipNotice, setEquipNotice] = useState<{ text: string; id: number } | null>(null);
  const notifyEquip = useCallback((text: string) => setEquipNotice({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!equipNotice) return;
    const timer = window.setTimeout(() => setEquipNotice((current) => (current?.id === equipNotice.id ? null : current)), 12000);
    return () => window.clearTimeout(timer);
  }, [equipNotice]);
  // Item editor: the mod pool loads the first time it opens.
  const [modPool, setModPool] = useState<ModPool | null>(null);
  const [editorTarget, setEditorTarget] = useState<
    | { kind: "stash"; id: string }
    | { kind: "slot"; slotId: string; before: BuildInventoryChoice }
    | { kind: "new"; text: string; built: boolean; iconUrl?: string; itemSlug?: string }
    | null
  >(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [calcError, setCalcError] = useState("");
  // Stat whose "where does it come from" breakdown is open.
  const [explainStat, setExplainStat] = useState<ExplainTarget | null>(null);
  // Gem whose alternatives are shown under it ("main" = the group's own skill gem).
  // Support whose DPS contribution is shown, and the card whose details are open.
  const [hoveredSupport, setHoveredSupport] = useState<{ skillId: string; supportId: string; keys: { withKey: string; withoutKey: string } | null } | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [gemStrip, setGemStrip] = useState<{ skillId: string; supportId: string | "main"; limit?: number } | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  // Where the clicked slot sits in the doll, so its menu opens right next to it.
  const [slotMenuAt, setSlotMenuAt] = useState<{ left: number; top: number; width: number } | null>(null);
  // The slot menu closes on Escape or a click outside it and outside the slots.
  useEffect(() => {
    if (!slotMenuAt) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSlotMenuAt(null); };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".build-slot-menu, .build-equip-slot")) return;
      setSlotMenuAt(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [slotMenuAt]);
  const [activeWeaponSet, setActiveWeaponSet] = useState<1 | 2>(1);
  const [activeGemPicker, setActiveGemPicker] = useState<GemPickerTarget | null>(null);
  const [gemPickerQuery, setGemPickerQuery] = useState("");
  const [showBuildHelp, setShowBuildHelp] = useState(false);
  const [treeChoicesOpen, setTreeChoicesOpen] = useState(false);
  const [pobImportOpen, setPobImportOpen] = useState(false);
  const [pobCode, setPobCode] = useState("");
  const [pobImporting, setPobImporting] = useState(false);
  // Character level the calculation runs at (the imported build's own until changed).
  const [level, setLevel] = useState<number>(DEFAULT_CHARACTER_LEVEL);
  // What the level box shows while it is being typed in (it may be empty or out of range).
  const [levelText, setLevelText] = useState(String(DEFAULT_CHARACTER_LEVEL));
  // Classes and start nodes, from the passive tree data the tree itself shows.
  const [classTree, setClassTree] = useState<PassiveTreeModel | null>(null);
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [pickedClass, setPickedClass] = useState("");
  const [pickedAscendancy, setPickedAscendancy] = useState("");
  const classPickerRef = useRef<HTMLDivElement | null>(null);

  const slotSilhouetteIcon = (area: string) => {
    switch (area) {
      case "helm": return "smart_toy";
      case "body": return "shield";
      case "weapon": return "swords";
      case "offhand": return "security";
      case "gloves": return "front_hand";
      case "boots": return "footprint";
      case "belt": return "fit_screen";
      case "amulet": return "diamond";
      case "ring1":
      case "ring2": return "circle";
      case "lifeflask":
      case "manaflask": return "science";
      case "charm1":
      case "charm2":
      case "charm3": return "token";
      case "trinket": return "auto_awesome";
      default: return "inventory_2";
    }
  };

  const [liveStats, setLiveStats] = useState<any>(null);
  // Stats of the calculation before the current one, for the "what changed" badges.
  const [previousStats, setPreviousStats] = useState<any>(null);
  const liveStatsRef = useRef<any>(null);
  liveStatsRef.current = liveStats;
  // Conditions the player changed in the planner; null = the build's own (imported) config.
  const [configInputs, setConfigInputs] = useState<PobConfigInput[] | null>(null);
  const activeStats = useMemo(() => {
    if (!liveStats) return null;
    // /api/builds/calculate already runs for activeWeaponSet and returns PoB's flat output;
    // keep accepting a { set1, set2 } shape in case the engine starts returning both.
    if (liveStats.set1 || liveStats.set2) return activeWeaponSet === 2 ? liveStats.set2 : liveStats.set1;
    return liveStats;
  }, [liveStats, activeWeaponSet]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [mainSocketGroup, setMainSocketGroup] = useState<number>(1);
  const mainSocketGroupRef = useRef(mainSocketGroup);
  mainSocketGroupRef.current = mainSocketGroup;
  // Class and main skill of the build as it is now (set once both are known, further down).
  const compareKeyRef = useRef("");
  // PoB's calculate.lua returns totals for the main socket group only (no per-skill
  // skillsDps array), so the main skill shows CombinedDPS and the others show nothing
  // until they are picked as main.
  // The main group shows PoB's main-skill DPS (what PoB's sidebar shows); the others
  // their row of PoB's per-skill list (every enabled group is in it).
  const skillDps = (index: number): number => groupSkillDps[index] ?? 0;

  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: string;
    /** "Nếu mặc vào" block under an inventory item's card. */
    compare?: CompareSpec;
  }>({ visible: false, x: 0, y: 0, content: "" });

  // Place the tooltip above the cursor, or below it when there is no room above, and
  // keep it inside the viewport (it used to run off the top for the upper slots).
  const tooltipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !tooltip.visible) return;
    const place = () => {
      const margin = 8;
      const gap = 14;
      const { width, height } = el.getBoundingClientRect();
      const left = Math.min(Math.max(tooltip.x - width / 2, margin), window.innerWidth - width - margin);
      let top = tooltip.y - height - gap;
      if (top < margin) top = tooltip.y + gap + 6;
      if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);
      el.style.left = `${Math.max(margin, left)}px`;
      el.style.top = `${top}px`;
    };
    place();
    // The "Nếu mặc vào" block grows when its numbers arrive: keep the card on screen.
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tooltip]);

  const handleMouseMove = (e: React.MouseEvent) => {
    setTooltip(prev => ({
      ...prev,
      x: e.clientX,
      y: e.clientY
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
    if (!editorOpen || classTree) return;
    let alive = true;
    loadPassiveTreeData().then((raw) => {
      if (alive) setClassTree(parsePassiveTree(raw, locale));
    }).catch(() => {
      // The tree panel shows its own load error.
    });
    return () => {
      alive = false;
    };
  }, [editorOpen, classTree, locale]);

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
  const itemRecordForChoice = useMemo(() => {
    const bySlug = new Map<string, ItemRecord>();
    const byName = new Map<string, ItemRecord>();
    for (const item of itemsData) {
      if (item.slug && !bySlug.has(item.slug)) bySlug.set(item.slug, item);
      const key = itemTitle(item, locale).toLowerCase();
      if (key && !byName.has(key)) byName.set(key, item);
    }
    return (choice?: { itemSlug?: string; itemName?: string }): ItemRecord | undefined => {
      if (!choice) return undefined;
      if (choice.itemSlug && bySlug.has(choice.itemSlug)) return bySlug.get(choice.itemSlug);
      return byName.get(String(choice.itemName || "").toLowerCase());
    };
  }, [itemsData, locale]);
  const selectedInventoryCount = inventory.filter((row) => row.itemName.trim() || row.note.trim()).length;
  const selectedSkillCount = buildSkills.filter((row) => row.skillId.trim()).length;
  const activeSlot = activeSlotId ? slotForId(activeSlotId) : null;
  // PoE2 characters wear two rings; the third ring slot only exists for
  // imported builds that filled it, so keep it out of the doll otherwise.
  const visibleEquipmentSlots = useMemo(
    () => equipmentSlots.filter((slot) =>
      (!slot.weaponSet || slot.weaponSet === activeWeaponSet)
      && (slot.id !== "Ring3" || Boolean(inventoryBySlot.get("Ring3")?.itemName))),
    [activeWeaponSet, inventoryBySlot]
  );
  const skillGemOptions = useMemo(() => gemPickerOptions(gemsData, "skill"), [gemsData, locale]);
  const supportGemOptions = useMemo(() => gemPickerOptions(gemsData, "support"), [gemsData, locale]);
  // Names of each group's active gems, to find their rows in PoB's per-skill DPS list.
  const groupNames = useMemo(() => buildSkills.map((skill) => skill.disabled ? [] : [
    skill.nameSpec || gemChoiceItem(skill.skillId, skillGemOptions, "SkillGem")?.name || "",
    ...skill.supportSkills.filter((support) => support.active && !support.disabled).map((support) => support.nameSpec || gemChoiceItem(support.skillId, skillGemOptions, "SkillGem")?.name || "")
  ]), [buildSkills, skillGemOptions]);
  /**
   * DPS of each group in a stats object. With the calculator's GroupDPS every group gets
   * its own skills' damage (all of them: a gem's second skill, DoT, per-hit skills), the
   * main one included, so a card reads the same whether it is main or not. Without it
   * (older calculator) the group that was main gets PoB's main-skill DPS and the others
   * their per-skill row (undefined when the calculator did not send the per-skill list).
   */
  const groupDpsIn = useCallback((stats: any): Array<number | undefined> | undefined => {
    if (!stats) return undefined;
    const main = Number(stats.__mainGroup) || mainSocketGroup;
    const damage = groupDamageByRow(stats.GroupDPS, buildSkills);
    if (damage) {
      return damage.map((entry, index) => {
        const value = groupDamageValue(entry);
        if (index + 1 === main && !value) return mainSkillDps(stats);
        return value ?? 0;
      });
    }
    const rows = Array.isArray(stats.SkillDPS) ? skillDpsByGroup(stats.SkillDPS as PobSkillDps[], groupNames) : null;
    // A minion skill deals no damage itself: its card shows the minion's.
    return groupNames.map((_, index) => (index + 1 === main ? mainSkillDps(stats) : rows ? rows[index] : undefined));
  }, [buildSkills, groupNames, mainSocketGroup]);
  // Groups whose number is an average hit (no rate per second), labelled "/đòn".
  const perHitGroups = useMemo(() => {
    const damage = groupDamageByRow(activeStats?.GroupDPS, buildSkills);
    return new Set((damage ?? []).flatMap((entry, index) => (entry && !(entry.dps > 0) && entry.average ? [index] : [])));
  }, [activeStats, buildSkills]);
  const currentGroupDps = useMemo(() => groupDpsIn(activeStats), [groupDpsIn, activeStats]);
  const previousGroupDps = useMemo(() => groupDpsIn(previousStats), [groupDpsIn, previousStats]);
  const groupSkillDps = useMemo(() => (currentGroupDps ?? []).map((value) => value ?? 0), [currentGroupDps]);
  // Whose damage each card's number is (PoB's own skill names), and the item-granted
  // groups PoB folds into the player's group for the same skill (one card for the two).
  const groupDamage = useMemo(() => groupDamageByRow(activeStats?.GroupDPS, buildSkills), [activeStats, buildSkills]);
  const groupDamageLines = useMemo(() => buildSkills.map((_, index) => cardDamageLines(groupDamage?.[index])), [groupDamage, buildSkills]);
  const foldedGroups = useMemo(() => foldedGrantedGroups(buildSkills, mainSocketGroup - 1), [buildSkills, mainSocketGroup]);
  // Choices PoB offers per gem (stat set, skill part, minion...), from the last calculation.
  const gemTargets = useMemo(() => plannerGemTargets(activeStats?.GemOptions, buildSkills), [activeStats, buildSkills]);
  const gemOptionFor = (group: number, supportId?: string): PobGemOptions | undefined =>
    gemTargets.find((target) => target.group === group && target.supportId === supportId)?.option;

  const gemPickerItems = useMemo(() => {
    const kind = activeGemPicker?.kind ?? "skill";
    const prefix = kind === "support" ? "SupportGem" : "SkillGem";
    const rows = kind === "support" ? supportGemOptions : skillGemOptions;
    const query = gemPickerQuery.trim().toLowerCase();
    return rows
      .filter((item) => matchesQuery({
        title: itemTitle(item, locale),
        id: officialGemId(item, prefix),
        tags: item.tags ?? [],
        summary: localizedText(item.i18n?.summary, item.summary_en ?? "", locale),
        lines: itemSummaryLines(item, locale, 4)
      }, gemPickerQuery, ["title", "id", "tags", "summary", "lines"]))
      // Name hits first ("Arc" before gems that only match through a "Warcry" tag);
      // the sort is stable, so each group keeps alphabetical order.
      .sort((a, b) => gemNameRank(itemTitle(a, locale), query) - gemNameRank(itemTitle(b, locale), query))
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
    if (gem.gemId) return /SupportGem/i.test(gem.gemId);
    if (/SupportGem/i.test(gem.skillId) || /^support/i.test(gem.skillId)) return true;
    if (/SkillGem/i.test(gem.skillId)) return false;
    const supportMatch = pobGemRecord(gem, supportGemOptions, "SupportGem");
    const skillMatch = pobGemRecord(gem, skillGemOptions, "SkillGem");
    if (supportMatch && !skillMatch) return true;
    if (skillMatch && !supportMatch) return false;
    return /\bsupport\b/i.test(gem.nameSpec);
  }, [skillGemOptions, supportGemOptions]);

  // The same count everywhere a tree's points are printed (start nodes are never points).
  const treePoints = (snapshot: BuildTreeSnapshot | null) => treePointsSpent(snapshot, (id) => {
    const node = classTree?.nodeById.get(id);
    return Boolean(node?.isClassStart || node?.isAscendancyStart);
  });
  const selectedPassiveCount = passiveCount(selected);
  const exportSnapshot = selected && selectedPassiveCount > 0 ? selected : null;
  // A tree whose class is one of the game's (picked in the planner, or read from a PoB code).
  const treeHasKnownClass = Boolean(buildTree?.className && classTree?.classByName.has(buildTree.className));
  // The imported payload with the tree's class when the player changed it in the planner.
  const basePayload = useMemo<BuildPayload | undefined>(() => {
    const base = importedBuild?.payload;
    if (!base || !buildTree || !treeHasKnownClass) return base;
    const ascendancy = officialAscendancyId(buildTree, plannerData) || "None";
    if (base.className === buildTree.className && (base.ascendancy || "None") === ascendancy) return base;
    return { ...base, className: buildTree.className, ascendancy };
  }, [importedBuild, buildTree, treeHasKnownClass, plannerData]);
  const payload = useMemo(() => {
    if (!importedBuild && !exportSnapshot) return null;
    return buildPlannerPayload({
      basePayload,
      snapshot: exportSnapshot,
      plannerData,
      name,
      author,
      description,
      inventory,
      skills: buildSkills,
      level
    });
  }, [exportSnapshot, importedBuild, basePayload, plannerData, name, author, description, inventory, buildSkills, level]);

  compareKeyRef.current = `${buildTree?.className ?? importedBuild?.payload?.className ?? ""}|${buildSkills[mainSocketGroup - 1]?.skillId ?? ""}`;
  const canExport = Boolean(payload && (importedBuild || exportSnapshot));
  const exportDisabledHint = selected
    ? localizedText(copy.emptyTree, "", locale)
    : localizedText(copy.noTree, "", locale);

  // Builds made from scratch have no imported payload: class, ascendancy and level come from the tree.
  // A class picked in the planner is calculated right away, before any point is spent.
  const calcPayload = useMemo<BuildPayload | null>(() => {
    if (basePayload) return { ...basePayload, level };
    if (!buildTree || !buildTree.className || (!passiveCount(buildTree) && !treeHasKnownClass)) return null;
    return classBuildPayload(buildTree, level, plannerData);
  }, [basePayload, buildTree, treeHasKnownClass, level, plannerData]);
  const importedConfigInputs = useMemo<PobConfigInput[]>(() => (
    Array.isArray(importedBuild?.payload?.config_inputs) ? importedBuild!.payload.config_inputs as PobConfigInput[] : []
  ), [importedBuild]);
  const effectiveConfigInputs = configInputs ?? importedConfigInputs;

  const effectiveTree = useMemo(() => withTreePicksFromPayload(buildTree, importedBuild?.payload), [buildTree, importedBuild]);
  // Giant's Blood and the like decide which off-hands a two-hander allows (src/shared/equipment-rules.mjs).
  const allocatedPassiveIds = effectiveTree?.allocatedIds;
  const weaponFlagState = useMemo(() => buildWeaponFlags(inventory, allocatedPassiveIds ?? []), [inventory, allocatedPassiveIds]);
  // An off-hand that cannot be held with its main hand goes back to the inventory: builds
  // imported or saved with such a pair, and pairs a keystone taken off the tree made illegal.
  useEffect(() => {
    const fixed = enforceWeaponSets({ inventory, stash }, allocatedPassiveIds ?? []);
    if (!fixed.notices.length) return;
    setInventory(fixed.state.inventory);
    setStash(fixed.state.stash);
    notifyEquip(fixed.notices.map((notice) => weaponNoticeText(notice, locale)).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, allocatedPassiveIds]);
  // What the character cannot use yet (level, attributes, passive points). Warnings only:
  // PoB still counts such items and gems, so the numbers keep them too.
  const warningList = useMemo(() => {
    const items: WarningItem[] = inventory.filter((row) => row.itemName || row.rawText).map((row) => ({
      slotId: row.inventoryId,
      slotLabel: row.inventoryId,
      name: row.rareName || (row.rawText ? parsePobItemDetails(row.rawText).name : "") || row.itemName,
      levelReq: itemLevelRequirement(row.rawText, itemRecordForChoice(row)?.requirements)
    }));
    // Gems the player socketed; a skill an item or the tree grants has no gem requirement.
    const gems: WarningGem[] = buildSkills.flatMap((skill, index) => (skill.skillId && !skill.disabled && !skill.itemSlot && !skill.itemSource && !gemOptionFor(index)?.grantedSkill) ? [
      { name: gemChoiceLabel(skill.skillId, skillGemOptions, "SkillGem", locale, skill.nameSpec || ""), gemLevel: skill.gemLevel ?? 20 },
      ...skill.supportSkills.filter((support) => support.active && support.skillId && !support.disabled).map((support) => ({
        name: gemChoiceLabel(support.skillId, skillGemOptions, "SkillGem", locale, support.nameSpec || ""),
        gemLevel: support.gemLevel ?? 20
      }))
    ] : []);
    let points: WarningPoints | null = null;
    if (classTree && effectiveTree) {
      const free = freeAllocatedNames(inventory.map((row) => row.rawText));
      let passive = 0;
      let ascendancy = 0;
      for (const id of new Set(effectiveTree.allocatedIds)) {
        const node = classTree.nodeById.get(id);
        if (!node || node.isClassStart || node.isAscendancyStart) continue;
        // PoB counts a multiple-choice ascendancy node once, not its chosen option.
        if (node.ascendancyName) ascendancy += isChoiceOptionNode(id) ? 0 : 1;
        else if (!free.includes(node.name.toLowerCase())) passive += 1;
      }
      const sets = weaponSetPointCounts(effectiveTree.weaponSets, effectiveTree.allocatedIds);
      points = { passive, ascendancy, set1: sets.set1, set2: sets.set2 };
    }
    return buildWarnings({ level, locale, items, gems, stats: activeStats, activeWeaponSet, points });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, buildSkills, classTree, effectiveTree, level, locale, activeStats, activeWeaponSet, itemRecordForChoice, skillGemOptions, gemTargets]);
  const calcRequestRef = useRef(0);
  // The calculation request for the build as it is, or with another inventory / skills /
  // main skill ("what if" comparisons use the same body, so their numbers are comparable).
  const calculationBodyFor = useCallback((overrides: { inventory?: BuildInventoryChoice[]; skills?: BuildSkillChoice[]; mainSocketGroup?: number } = {}) => calcPayload ? calculationRequestBody({
      payload: calcPayload,
      passives: effectiveTree?.allocatedIds || [],
      weaponSets: effectiveTree?.weaponSets,
      attributeChoices: effectiveTree?.attributeChoices,
      // Never an off-hand its main hand cannot hold (the server drops such a pair as well).
      inventory: inventoryWithoutImpossibleOffHands(overrides.inventory ?? inventory, effectiveTree?.allocatedIds || []),
      skills: overrides.skills ?? buildSkills,
      activeWeaponSet,
      mainSocketGroup: overrides.mainSocketGroup ?? mainSocketGroupRef.current,
      configInputs: configInputs ?? undefined,
      itemText: (choice) => {
        const record = itemRecordForChoice(choice);
        return record ? pobItemTextFromRecord({ name: itemTitle(record, "en"), rarity: record.rarity, baseName: record.properties?.[0], mods: record.mods }) : undefined;
      }
    }) : null, [calcPayload, inventory, buildSkills, effectiveTree, activeWeaponSet, configInputs, itemRecordForChoice]);
  const currentCalculationBody = useCallback(() => calculationBodyFor(), [calculationBodyFor]);

  // "What if" calculations (equip this item, use that gem): one at a time, cached by body.
  const compareQueue = useMemo(() => new CalcQueue<Record<string, unknown>>(async (body) => {
    // The server runs these after the build's own calculation and never on its last free slot.
    // Comparisons only read the main skill's numbers, so PoB skips every group's Full DPS.
    const request = JSON.stringify({ ...(body as Record<string, unknown>), calc_priority: "compare", full_dps: false });
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch("/api/builds/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: request });
      const json = await response.json().catch(() => null);
      // Busy calculator: wait and try again rather than showing an error.
      if (response.status === 503 && attempt < 4) {
        const wait = Math.min(Number(response.headers.get("retry-after")) || 2, 10) * 1000 * (attempt + 1);
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        continue;
      }
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || `HTTP ${response.status}`);
      return json.data;
    }
  }), []);
  const mainCalcKeyRef = useRef("");
  // The build changed: queued comparisons are for the old build.
  useEffect(() => {
    compareQueue.dropPending();
  }, [compareQueue, currentCalculationBody]);
  /** Queues a body unless it is already known, queued, or is the main calculation in flight. */
  const requestCalc = useCallback((body: Record<string, unknown>, priority: number) => {
    const key = calcKey(body);
    if (compareQueue.get(key) || key === mainCalcKeyRef.current) {
      compareQueue.prioritize(key, priority);
      return key;
    }
    return compareQueue.request(body, priority);
  }, [compareQueue]);

  const runCalculation = useCallback(() => {
    const body = currentCalculationBody();
    if (!body) return;
    // The main group as the page lists it (the body holds PoB's number, which skips empty groups).
    const listedMainGroup = mainSocketGroupRef.current;
    const compareKey = compareKeyRef.current;
    setIsCalculating(true);
    const requestId = ++calcRequestRef.current;
    const bodyKey = calcKey(body);
    mainCalcKeyRef.current = bodyKey;
    // What-if previews wait while the build's own numbers are being calculated.
    compareQueue.setPaused(true);

    const attempt = async (triesLeft: number): Promise<void> => {
      const response = await fetch("/api/builds/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const res = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      // A newer request already went out: drop this answer.
      if (requestId !== calcRequestRef.current) return;
      // Busy calculator: try again shortly instead of leaving the old numbers up.
      if (response.status === 503 && triesLeft > 0) {
        const wait = Math.min(Number(response.headers.get("retry-after")) || 2, 10) * 1000;
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        if (requestId === calcRequestRef.current) await attempt(triesLeft - 1);
        return;
      }
      setCalcError(res.ok ? "" : String(res.error || (locale === "vi" ? "Không tính được chỉ số." : "Calculation failed.")));
      if (res.ok && res.data) {
        compareQueue.seed(bodyKey, res.data);
        // "What changed" compares with the calculation before this one only when both are of
        // the same class and main skill: the first skill of a fresh build (or another main
        // skill) has nothing to compare with, and used to read "+6161%" or "−100%".
        const before = liveStatsRef.current;
        setPreviousStats(before && before.__compareKey === compareKey ? before : null);
        setLiveStats({ ...res.data, __mainGroup: listedMainGroup || 1, __compareKey: compareKey });
        if (Array.isArray(res.item_errors) && res.item_errors.length) {
          setCalcError(locale === "vi"
            ? `Đã bỏ qua món đồ không hợp lệ khi tính: ${res.item_errors.map((row: { messages?: string[] }) => row.messages?.[0]).filter(Boolean).join("; ")}`
            : `Invalid edited items were left out of the calculation.`);
        }
      }
    };

    attempt(3)
      .catch((err) => {
        console.error("Failed to calculate live stats", err);
        if (requestId === calcRequestRef.current) setCalcError(locale === "vi" ? "Không kết nối được máy tính chỉ số." : "Calculator unreachable.");
      })
      .finally(() => {
        if (requestId !== calcRequestRef.current) return;
        setIsCalculating(false);
        compareQueue.setPaused(false);
      });
  }, [currentCalculationBody, compareQueue, locale]);

  // Typing a gem level or ticking several conditions in a row sends one request.
  useEffect(() => {
    if (!calcPayload) return;
    const timer = window.setTimeout(runCalculation, 350);
    return () => window.clearTimeout(timer);
  }, [calcPayload, mainSocketGroup, runCalculation]);

  // Hovering a passive node on the build's tree shows what taking (or dropping) it changes.
  const nodePreviewBody = useMemo(() => calculationBodyFor(), [calculationBodyFor]);
  const nodePreview = useNodePreview({
    body: nodePreviewBody,
    allocatedIds: buildTree?.allocatedIds ?? [],
    paused: isCalculating,
    locale: locale === "vi" ? "vi" : "en"
  });

  useEffect(() => {
    setPreviousStats(null);
    if (!importedBuild?.payload) {
      setLiveStats(null);
      setMainSocketGroup(1);
      setConfigInputs(null);
    } else {
      const saved = importedBuild.payload.planner_config_inputs;
      setConfigInputs(Array.isArray(saved) ? saved as PobConfigInput[] : null);
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
    importedFileName: importedBuild?.fileName || "",
    stash,
    level
  }), [name, author, description, buildTree, inventory, buildSkills, importedBuild, stash, level]);
  const savedBuildSignature = useMemo(() => buildProjectSignature(activeBuildProject), [activeBuildProject]);
  const hasBuildChanges = activeBuildProject
    ? currentBuildSignature !== savedBuildSignature
    : hasDraftContent({ name, description, tree: buildTree, inventoryCount: selectedInventoryCount, skillCount: selectedSkillCount, stashCount: stash.length, importedBuild });

  // Unsaved work: the browser asks before a reload or closing the tab, and the site's own
  // links ask before leaving the build (saving stays one click: "Lưu build"). The planner's
  // own moves after a save, delete or import go through moveTo, which skips the question.
  // The question is a dialog of the page (Ở lại / Rời, không lưu / Lưu rồi rời), not the
  // browser's confirm(): automated browsers dismiss confirm() silently, which looked like
  // "Danh sách does nothing", and a dialog of our own can offer to save.
  const skipLeaveGuard = useRef(false);
  const moveTo = (path: string) => {
    skipLeaveGuard.current = true;
    try { navigateTo(path); } finally { skipLeaveGuard.current = false; }
  };
  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;
  /** Runs `leave` at once when nothing is unsaved; otherwise asks first, with the option to save. */
  const askBeforeLeaving = (leave: () => void) => {
    if (!hasBuildChanges) {
      leave();
      return;
    }
    const vi = locale === "vi";
    setBuildDialog({
      title: vi ? "Build còn thay đổi chưa lưu" : "This build has unsaved changes",
      body: vi
        ? "Rời khỏi build này thì các thay đổi chưa lưu sẽ mất. Build được lưu trong trình duyệt này."
        : "Leaving this build drops the unsaved changes. Builds are saved in this browser.",
      actions: [
        { label: vi ? "Ở lại" : "Stay", tone: "neutral", onClick: () => setBuildDialog(null) },
        { label: vi ? "Rời, không lưu" : "Leave without saving", tone: "danger", onClick: () => { setBuildDialog(null); leave(); } },
        { label: vi ? "Lưu rồi rời" : "Save and leave", tone: "primary", onClick: () => { setBuildDialog(null); saveBeforeLeavingRef.current(); leave(); } }
      ]
    });
  };
  const askBeforeLeavingRef = useRef(askBeforeLeaving);
  askBeforeLeavingRef.current = askBeforeLeaving;
  // Set below, once saveCurrentBuild exists.
  const saveBeforeLeavingRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!hasBuildChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    // A link of the site: stay for now and ask; "leave" then goes there without asking again.
    const removeGuard = setLeaveGuard((next) => {
      if (skipLeaveGuard.current || next === window.location.pathname) return true;
      askBeforeLeavingRef.current(() => moveToRef.current(next));
      return false;
    });
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      removeGuard();
    };
  }, [hasBuildChanges]);

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

  // Clicking a slot selects it: the inventory then shows only what fits there.
  const openPicker = (slotId: string) => {
    setActiveGemPicker(null);
    setTreeChoicesOpen(false);
    setSlotChoice(null);
    setActiveSlotId((current) => (current === slotId ? null : slotId));
  };

  const itemByName = useMemo(() => {
    const map = new Map<string, ItemRecord>();
    for (const item of itemsData) {
      const key = itemTitle(item, "en").toLowerCase();
      if (key && !map.has(key)) map.set(key, item);
    }
    return map;
  }, [itemsData]);
  /** The base type's record of an item text (its damage, armour, Spirit before the item's own mods). */
  const baseRecordForText = (text: string): ItemRecord | undefined => {
    const record = itemByName.get(parsePobItemDetails(text).baseName.toLowerCase());
    return record && !isUniqueItem(record) ? record : undefined;
  };
  const stashRecord = useCallback((item: BuildStashItem): ItemRecord | undefined => {
    if (item.itemSlug) {
      const bySlug = itemsData.find((row) => row.slug === item.itemSlug);
      if (bySlug) return bySlug;
    }
    const summary = stashItemSummary(item);
    return itemByName.get(summary.name.toLowerCase()) ?? itemByName.get(summary.baseName.toLowerCase());
  }, [itemsData, itemByName]);
  /** Slot categories of an inventory item: the site's item data first, else the item text. */
  const stashCategories = useCallback((item: BuildStashItem): string[] => {
    // Weapons and off-hands: PoB's own tags (a wand is main hand only, a spear never off-hand).
    const byRule = weaponSlotCategories(item, weaponFlagState);
    if (byRule) return byRule;
    const record = stashRecord(item);
    const fromData = record ? buildSlotCategories(record) : [];
    if (fromData.length) return fromData;
    const summary = stashItemSummary(item);
    return itemCategoriesFromText(item.rawText || "", summary.baseName);
  }, [stashRecord, weaponFlagState]);
  const withStashIcon = useCallback((item: BuildStashItem): BuildStashItem => {
    if (item.iconUrl) return item;
    const record = stashRecord(item);
    return record ? { ...item, iconUrl: displayImageUrl(record.icon_url), itemSlug: item.itemSlug || record.slug } : item;
  }, [stashRecord]);
  const slotLabel = (slotId: string) => {
    const slot = equipmentSlots.find((row) => row.id === slotId);
    if (!slot) return slotId;
    const vi: Record<string, string> = {
      Weapon1: "Vũ khí I", Weapon2: "Tay phụ I", Weapon3: "Vũ khí II", Weapon4: "Tay phụ II", Helm1: "Mũ", BodyArmour1: "Giáp",
      Gloves1: "Găng", Boots1: "Giày", Amulet1: "Dây chuyền", Ring1: "Nhẫn trái", Ring2: "Nhẫn phải", Ring3: "Nhẫn 3", Belt1: "Đai",
      LifeFlask1: "Bình máu", ManaFlask1: "Bình mana", Charm1: "Bùa 1", Charm2: "Bùa 2", Charm3: "Bùa 3", Trinket1: "Cổ vật"
    };
    return locale === "vi" ? vi[slotId] ?? slot.label : slot.label;
  };
  /** The word inside an empty slot: short, and Vietnamese on the Vietnamese site. */
  const slotShortLabel = (slot: EquipmentSlot) => {
    if (locale !== "vi") return slot.shortLabel;
    const vi: Record<string, string> = {
      Weapon1: "Vũ khí I", Weapon2: "Tay phụ I", Weapon3: "Vũ khí II", Weapon4: "Tay phụ II", Helm1: "Mũ", BodyArmour1: "Giáp",
      Gloves1: "Găng", Boots1: "Giày", Amulet1: "Dây chuyền", Ring1: "Nhẫn", Ring2: "Nhẫn", Ring3: "Nhẫn", Belt1: "Đai",
      LifeFlask1: "Máu", ManaFlask1: "Mana", Charm1: "Bùa 1", Charm2: "Bùa 2", Charm3: "Bùa 3", Trinket1: "Cổ vật"
    };
    return vi[slot.id] ?? slot.shortLabel;
  };
  const availableSlotIds = useMemo(() => equipmentSlots
    .filter((slot) => slot.id !== "Ring3" || Boolean(inventoryBySlot.get("Ring3")?.itemName))
    .map((slot) => slot.id), [inventoryBySlot]);

  /** Equips with the weapon-set rule; says in one line what moved back to the inventory or why not. */
  const equipFrom = (state: { inventory: BuildInventoryChoice[]; stash: BuildStashItem[] }, itemId: string, slotId: string): boolean => {
    const result = equipWithWeaponRules(state, itemId, slotId, effectiveTree?.allocatedIds || []);
    if (result.notice) notifyEquip(weaponNoticeText(result.notice, locale));
    else setEquipNotice(null);
    if (result.notice?.rejected) return false;
    setInventory(enrichInventoryChoices(result.state.inventory, itemsData, locale));
    setStash(result.state.stash.map(withStashIcon));
    return true;
  };
  const equipItem = (itemId: string, slotId: string) => {
    equipFrom({ inventory, stash }, itemId, slotId);
    setSlotChoice(null);
    setTooltip((prev) => ({ ...prev, visible: false }));
  };
  const slotRefusal = (slotId: string) => notifyEquip(locale === "vi" ? `Món này không vừa ô ${slotLabel(slotId)}.` : `This item does not fit the ${slotLabel(slotId)} slot.`);
  /** An equipped item dragged onto another slot: moves there (rings, charms, weapon to off-hand) when it fits. */
  const moveEquippedItem = (fromSlotId: string, toSlotId: string) => {
    if (fromSlotId === toSlotId) return;
    const taken = unequipSlot({ inventory, stash }, fromSlotId);
    const item = taken.stash[0];
    if (taken.stash.length === stash.length || !item) return;
    if (!slotIdsForCategories(stashCategories(item)).includes(toSlotId)) {
      slotRefusal(toSlotId);
      return;
    }
    equipFrom(taken, item.id, toSlotId);
    setTooltip((prev) => ({ ...prev, visible: false }));
  };
  const unequipItem = (slotId: string) => {
    const next = unequipSlot({ inventory, stash }, slotId);
    setInventory(next.inventory);
    setStash(next.stash.map(withStashIcon));
    setTooltip((prev) => ({ ...prev, visible: false }));
  };
  const equipTargetsFor = (item: BuildStashItem) => equipTargets(stashCategories(item), {
    activeWeaponSet,
    selectedSlot: activeSlotId,
    inventory,
    availableSlots: availableSlotIds
  });
  const clickStashItem = (itemId: string) => {
    const item = stash.find((row) => row.id === itemId);
    if (!item) return;
    if (isJewelText(item.rawText || "", item.baseName)) {
      setCarriedJewelId((current) => (current === itemId ? null : itemId));
      setTooltip((prev) => ({ ...prev, visible: false }));
      return;
    }
    const targets = equipTargetsFor(item);
    if (!targets.length) {
      showInfoDialog(
        locale === "vi" ? "Không mặc được món này" : "This item cannot be equipped",
        locale === "vi" ? "Món này không có ô nào trên hình nhân vật (ví dụ jewel gắn trên cây thụ động), hoặc nó chỉ vừa bộ vũ khí còn lại." : "No paper-doll slot fits it."
      );
      return;
    }
    if (targets.length === 1) equipItem(itemId, targets[0]);
    else setSlotChoice({ itemId, slots: targets });
  };
  const addStashItems = (items: BuildStashItem[]) => {
    if (!items.length) return;
    setStash((rows) => [...items.map(withStashIcon), ...rows]);
  };
  const pasteStashText = (text: string): number | string => {
    const items = splitItemTexts(text).map((block) => stashItemFromText(block, "paste")).filter((row): row is BuildStashItem => Boolean(row));
    if (!items.length) {
      return locale === "vi"
        ? "Không đọc được món đồ nào. Trong game rê chuột lên món đồ rồi bấm Ctrl+C, đoạn chép được phải có dòng \"Rarity:\"."
        : "No item found. Copy an item in game with Ctrl+C.";
    }
    addStashItems(items);
    return items.length;
  };
  // What the search box can add: with a slot selected, only what fits it. A whole word or
  // the item class ranks first, so "wand" lists wands before "Wanderer Armour".
  const describeForSearch = (item: ItemRecord) => ({ title: itemTitle(item, locale), base: itemBaseName(item, locale), itemClass: item.menu_label });
  /** A catalogue item fits a slot: weapons and off-hands by PoB's rule (a wand is no off-hand), the rest by the site's data. */
  const recordFitsSlot = (item: ItemRecord, slot: EquipmentSlot): boolean => {
    const name = itemTitle(item, "en");
    const byRule = weaponSlotCategories({ itemName: name, baseName: isUniqueItem(item) ? item.properties?.[0] : name, isUnique: isUniqueItem(item) }, weaponFlagState);
    return byRule ? hasActualIcon(item) && slot.slotCategories.some((category) => byRule.includes(category)) : itemFitsSlot(item, slot);
  };
  const catalogPool = (slot: EquipmentSlot | null) => itemsData.filter((item) => hasActualIcon(item) && (slot ? recordFitsSlot(item, slot) : buildSlotCategories(item).length > 0));
  /** Matches the slot filter leaves out (0 when no slot is selected). */
  const catalogHiddenCount = (query: string): number => (activeSlot ? countMatches(catalogPool(null), query, describeForSearch) - countMatches(catalogPool(activeSlot), query, describeForSearch) : 0);
  const catalogSearch = (query: string): CatalogEntry[] => searchItems(catalogPool(activeSlot), query, describeForSearch, 12)
    .map((item) => ({
      key: item.slug || itemTitle(item, "en"),
      name: itemTitle(item, locale),
      baseName: itemBaseName(item, locale),
      rarity: itemRarity(item),
      iconUrl: displayImageUrl(item.icon_url)
    }));
  const addCatalogItem = (entry: CatalogEntry) => {
    const record = itemsData.find((item) => (item.slug || itemTitle(item, "en")) === entry.key);
    if (!record) return;
    const unique = isUniqueItem(record);
    const item = stashItemFromText(pobItemTextFromRecord({ name: itemTitle(record, "en"), rarity: record.rarity, baseName: record.properties?.[0], mods: record.mods }), "search", {
      itemSlug: record.slug,
      iconUrl: displayImageUrl(record.icon_url)
    }) ?? {
      id: `stash-${Date.now().toString(36)}`, itemName: itemTitle(record, "en"), isUnique: unique, itemSlug: record.slug, iconUrl: displayImageUrl(record.icon_url), source: "search" as const
    };
    // A slot is selected and the item fits it: the player wants it there.
    if (activeSlot && recordFitsSlot(record, activeSlot) && slotIdsForCategories(stashCategories(item)).includes(activeSlot.id)) {
      // Refused by the weapon-set rule (a quiver without a bow): it still lands in the inventory.
      if (equipFrom({ inventory, stash: [item, ...stash] }, item.id, activeSlot.id)) return;
    }
    addStashItems([item]);
  };
  const nameFields = (text: string) => {
    const details = parsePobItemDetails(text);
    const isUnique = details.rarity === "unique";
    return { itemName: isUnique ? details.name : details.baseName || details.name, isUnique, baseName: details.baseName || details.name };
  };
  const stashViews = useMemo<StashItemView[]>(() => stash.map((item) => {
    const summary = stashItemSummary(item);
    const record = stashRecord(item);
    return {
      item,
      name: summary.name,
      baseName: summary.baseName,
      rarity: summary.rarity || "normal",
      iconUrl: item.iconUrl || (record ? displayImageUrl(record.icon_url) : undefined),
      fits: activeSlotId ? slotIdsForCategories(stashCategories(item)).includes(activeSlotId) : true,
      edited: isItemEdited(item),
      ...(isJewelText(item.rawText || "", item.baseName) ? { clickHint: locale === "vi" ? "bấm rồi chọn ô ngọc trên cây" : "click, then pick a tree socket" } : {})
    };
  }), [stash, stashRecord, stashCategories, activeSlotId, locale]);

  const ensureModPool = async (): Promise<ModPool | null> => {
    if (modPool) return modPool;
    try {
      const [craft, index] = await Promise.all([loadCraftData(), loadCraftIndex()]);
      const pool = buildModPool(craft, index, itemsData.filter((item) => isUniqueItem(item)).map((item) => ({ name: itemTitle(item, "en"), rarity: "unique", mods: item.mods })));
      setModPool(pool);
      return pool;
    } catch (error) {
      showInfoDialog(locale === "vi" ? "Không tải được dữ liệu mod" : "Could not load mod data", error instanceof Error ? error.message : "");
      return null;
    }
  };
  /** Text to edit for an item known only by name (older builds): the site's record. */
  const itemTextFor = (item: { rawText?: string; itemSlug?: string; itemName: string; isUnique: boolean; baseName?: string }) => {
    if (item.rawText) return item.rawText;
    const record = itemRecordForChoice({ itemSlug: item.itemSlug, itemName: item.itemName });
    return record
      ? pobItemTextFromRecord({ name: itemTitle(record, "en"), rarity: record.rarity, baseName: record.properties?.[0], mods: record.mods })
      : `Rarity: ${item.isUnique ? "Unique" : "Normal"}\n${item.itemName}${item.isUnique && item.baseName ? `\n${item.baseName}` : ""}`;
  };
  const editStashItem = async (itemId: string) => {
    if (!(await ensureModPool())) return;
    setTooltip((prev) => ({ ...prev, visible: false }));
    setEditorTarget({ kind: "stash", id: itemId });
  };
  const editSlotItem = async (slotId: string) => {
    const choice = inventoryBySlot.get(slotId);
    if (!choice?.itemName && !choice?.rawText) return;
    if (!(await ensureModPool())) return;
    setEditorTarget({ kind: "slot", slotId, before: choice });
  };
  const openNewItem = async () => {
    if (!(await ensureModPool())) return;
    setNewItemOpen(true);
  };
  const newItemChoices = useMemo<NewItemChoice[]>(() => {
    if (!modPool || !newItemOpen) return [];
    const byName = new Map(itemsData.map((item) => [itemTitle(item, "en").toLowerCase(), item]));
    const bases = [...modPool.bases.values()].map((base): NewItemChoice => ({
      key: `base:${base.name}`,
      name: base.name,
      baseName: base.name,
      itemClass: base.itemClass,
      unique: false,
      iconUrl: byName.get(base.name.toLowerCase()) ? displayImageUrl(byName.get(base.name.toLowerCase())!.icon_url) : undefined,
      text: `Rarity: RARE\n${locale === "vi" ? "Đồ tự tạo" : "New Item"}\n${base.name}\nItem Level: 82`
    }));
    const uniques = itemsData.filter((item) => isUniqueItem(item) && buildSlotCategories(item).length).map((item): NewItemChoice => ({
      key: `unique:${item.slug || itemTitle(item, "en")}`,
      name: itemTitle(item, "en"),
      baseName: item.properties?.[0] ?? "",
      itemClass: item.menu_label ?? "",
      unique: true,
      iconUrl: displayImageUrl(item.icon_url),
      text: pobItemTextFromRecord({ name: itemTitle(item, "en"), rarity: item.rarity, baseName: item.properties?.[0], mods: item.mods })
    }));
    return [...bases, ...uniques].sort((a, b) => a.name.localeCompare(b.name));
  }, [modPool, newItemOpen, itemsData, locale]);
  const pickNewItem = (choice: NewItemChoice) => {
    setNewItemOpen(false);
    // A unique starts as the game makes it (its own lines are the original); a base is built from scratch.
    setEditorTarget({ kind: "new", text: choice.text, built: !choice.unique, iconUrl: choice.iconUrl });
  };

  const editorModel = (() => {
    if (!editorTarget || !modPool) return null;
    const vi = locale === "vi";
    if (editorTarget.kind === "stash") {
      const item = stash.find((row) => row.id === editorTarget.id);
      if (!item) return null;
      const text = itemTextFor(item);
      return {
        text,
        originalText: item.edited && item.originalText === undefined ? "" : item.originalText ?? text,
        title: vi ? "Sửa đồ trong kho" : "Edit inventory item",
        canReset: item.originalText !== undefined && item.originalText !== item.rawText
      };
    }
    if (editorTarget.kind === "slot") {
      const choice = inventoryBySlot.get(editorTarget.slotId);
      if (!choice) return null;
      const text = itemTextFor(choice);
      return {
        text,
        originalText: choice.edited && choice.originalText === undefined ? "" : choice.originalText ?? text,
        title: vi ? `Sửa đồ đang mặc · ${slotLabel(editorTarget.slotId)} (chỉ số tính lại ngay)` : `Edit equipped item · ${slotLabel(editorTarget.slotId)}`,
        canReset: choice.originalText !== undefined && choice.originalText !== choice.rawText
      };
    }
    return { text: editorTarget.text, originalText: editorTarget.built ? "" : editorTarget.text, title: vi ? "Tạo đồ mới" : "New item", canReset: false };
  })();
  const setSlotText = (slotId: string, text: string) => setInventory((rows) => rows.map((row) => (row.inventoryId === slotId ? withItemText(row, text) : row)));
  const saveEditor = (text: string) => {
    if (!editorTarget) return;
    if (editorTarget.kind === "stash") {
      setStash((rows) => rows.map((row) => (row.id === editorTarget.id ? withItemText({ ...row, ...nameFields(text) }, text) : row)));
    } else if (editorTarget.kind === "slot") {
      setSlotText(editorTarget.slotId, text);
    } else {
      const item = stashItemFromText(text, "search", editorTarget.built ? { edited: true, iconUrl: editorTarget.iconUrl } : { originalText: editorTarget.text, iconUrl: editorTarget.iconUrl });
      if (item) {
        const final = editorTarget.built ? item : withItemText({ ...item, rawText: editorTarget.text }, text);
        addStashItems([final]);
      }
    }
    setEditorTarget(null);
  };
  const cancelEditor = () => {
    // Live edits of an equipped item are undone.
    if (editorTarget?.kind === "slot") {
      const { slotId, before } = editorTarget;
      setInventory((rows) => rows.map((row) => (row.inventoryId === slotId ? before : row)));
    }
    setEditorTarget(null);
  };
  const resetEditor = () => {
    if (editorTarget?.kind === "stash") setStash((rows) => rows.map((row) => (row.id === editorTarget.id ? resetItemText(row) : row)));
    if (editorTarget?.kind === "slot") setInventory((rows) => rows.map((row) => (row.inventoryId === editorTarget.slotId ? resetItemText(row) : row)));
    setEditorTarget(null);
  };

  /** "Nếu mặc vào": the build with this item in each slot it could go to, against the build as it is. */
  const stashCompareSpec = (item: BuildStashItem, priority: number): CompareSpec | undefined => {
    const base = currentCalculationBody();
    if (!base) return undefined;
    const vi = locale === "vi";
    if (isJewelText(item.rawText || "", item.baseName)) {
      return { title: vi ? "Ngọc cho cây thụ động" : "Passive tree jewel", baseKey: "", entries: [], note: vi ? "Bấm vào ngọc rồi bấm một ô ngọc trên cây (hoặc kéo thả vào ô) để gắn. Rê chuột lên ô ngọc để xem chỉ số thay đổi." : "Click it, then click a socket on the tree (or drag it there)." };
    }
    const targets = equipTargetsFor(item);
    if (!targets.length) return { title: vi ? "Nếu mặc vào" : "If equipped", baseKey: "", entries: [], note: vi ? "Không có ô nào trên hình nhân vật vừa món này." : "No slot fits this item." };
    const baseKey = requestCalc(base, priority);
    const entries = targets.slice(0, 3).map((slotId) => {
      // As a click would equip it: the off-hand a two-hander pushes out is not counted.
      const body = calculationBodyFor({ inventory: equipWithWeaponRules({ inventory, stash }, item.id, slotId, effectiveTree?.allocatedIds || []).state.inventory });
      const current = inventoryBySlot.get(slotId);
      const replacing = current?.itemName ? ` (${vi ? "thay" : "replacing"} ${current.rareName || current.itemName})` : "";
      return { label: targets.length > 1 || replacing ? `${slotLabel(slotId)}${replacing}` : undefined, key: body ? requestCalc(body, priority) : "" };
    });
    return { title: vi ? "Nếu mặc vào" : "If equipped", baseKey, entries };
  };
  // ── Jewels in passive tree sockets ──────────────────────────────────────
  const socketedRows = useMemo(() => inventory.filter((row) => jewelSocketNodeId(row.inventoryId) && (row.itemName || row.rawText)), [inventory]);
  const jewelName = (row: { rawText?: string; itemName: string; rareName?: string }) => (row.rawText ? parsePobItemDetails(row.rawText).name : "") || row.rareName || row.itemName;
  const jewelRarity = (row: { rawText?: string; isUnique: boolean }) => (row.rawText ? parsePobItemDetails(row.rawText).rarity : "") || (row.isUnique ? "unique" : "rare");
  const carriedId = draggedJewelId ?? carriedJewelId;
  const carriedJewel = carriedId ? stash.find((row) => row.id === carriedId) ?? null : null;
  useEffect(() => {
    if (carriedJewelId && !stash.some((row) => row.id === carriedJewelId)) setCarriedJewelId(null);
  }, [stash, carriedJewelId]);
  const putJewel = (itemId: string, nodeId: string) => {
    const next = socketJewel({ inventory, stash }, itemId, nodeId);
    setInventory(next.inventory);
    setStash(next.stash.map(withStashIcon));
    setCarriedJewelId(null);
    setDraggedJewelId(null);
    setSocketHover(null);
  };
  const takeOutJewel = (nodeId: string) => {
    const next = unsocketJewel({ inventory, stash }, nodeId);
    setInventory(next.inventory);
    setStash(next.stash.map(withStashIcon));
  };
  const moveJewel = (fromNodeId: string, toNodeId: string) => {
    const next = moveSocketedJewel({ inventory, stash }, fromNodeId, toNodeId);
    setInventory(next.inventory);
  };
  const socketAccepts = (node: PassiveNode, item: BuildStashItem) => Boolean(node.jewelSocket) && jewelSocketAccepts(node.jewelSocket!, item);
  /** "Nếu gắn vào": the build with this jewel in the socket, against the build as it is. */
  const socketCompare = useCallback((nodeId: string, change: { put?: string; out?: boolean; from?: string }) => {
    const base = currentCalculationBody();
    if (!base) return null;
    const state = { inventory, stash };
    const next = change.put ? socketJewel(state, change.put, nodeId) : change.from ? moveSocketedJewel(state, change.from, nodeId) : change.out ? unsocketJewel(state, nodeId) : null;
    const body = next ? calculationBodyFor({ inventory: next.inventory }) : null;
    return body ? { base, body, baseKey: calcKey(base), key: calcKey(body) } : null;
  }, [currentCalculationBody, calculationBodyFor, inventory, stash]);
  // The socket under the mouse: with a carried jewel, what it would change.
  const socketHoverCompare = useMemo(() => {
    if (!socketHover || !carriedJewel || !socketHover.allocated) return null;
    return socketCompare(socketHover.node.id, { put: carriedJewel.id });
  }, [socketHover, carriedJewel, socketCompare]);
  useEffect(() => {
    if (!socketHoverCompare) return;
    requestCalc(socketHoverCompare.base, 10);
    requestCalc(socketHoverCompare.body, 10);
  }, [socketHoverCompare, requestCalc]);
  const treeJewelHooks = useMemo<TreeJewelHooks>(() => ({
    socketed: new Map(socketedRows.map((row) => [jewelSocketNodeId(row.inventoryId), { name: jewelName(row), rarity: jewelRarity(row) }])),
    carried: carriedJewel ? {
      name: stashItemSummary(carriedJewel).name,
      accepts: (node) => socketAccepts(node, carriedJewel),
      dragging: Boolean(draggedJewelId)
    } : null,
    onCancelCarried: () => setCarriedJewelId(null),
    onSocketCarried: (node) => carriedJewel && putJewel(carriedJewel.id, node.id),
    dragType: STASH_DRAG_TYPE,
    onSocketHover: (node) => setSocketHover((current) => {
      if (!node) return null;
      const allocated = Boolean(effectiveTree?.allocatedIds.includes(node.id));
      return current?.node.id === node.id && current.allocated === allocated ? current : { node, allocated };
    }),
    renderSocketTooltip: (node, allocated) => {
      const vi = locale === "vi";
      const row = inventoryBySlot.get(`PassiveJewel:${node.id}`);
      const lines: React.ReactNode[] = [];
      if (row && (row.itemName || row.rawText)) lines.push(<p key="jewel" className="passive-tooltip-jewel">{vi ? "Đang gắn: " : "Socketed: "}<b translate="no">{jewelName(row)}</b></p>);
      if (!allocated) lines.push(<p key="off" className="passive-tooltip-hint">{vi ? "Ô này chưa được chọn điểm nên ngọc chưa có tác dụng." : "Not allocated: the jewel does nothing yet."}</p>);
      if (carriedJewel) {
        if (!socketAccepts(node, carriedJewel)) {
          lines.push(<p key="no" className="passive-tooltip-hint">{node.jewelSocket === "sinister" ? (vi ? "Ô này không nhận ngọc độc nhất (unique)." : "No unique jewels here.") : (vi ? "Ô này chỉ nhận ngọc cơ bản, không độc nhất." : "Basic non-unique jewels only.")}</p>);
        } else if (socketHoverCompare && socketHover?.node.id === node.id) {
          lines.push(<CompareBlock key="cmp" queue={compareQueue} spec={{ title: vi ? `Nếu gắn ${stashItemSummary(carriedJewel).name}` : "If socketed", baseKey: socketHoverCompare.baseKey, entries: [{ key: socketHoverCompare.key }] }} locale={locale} />);
        }
      } else {
        lines.push(<p key="tip" className="passive-tooltip-hint">{allocated ? (vi ? "Bấm để gắn, đổi hoặc tháo ngọc." : "Click to socket, swap or remove a jewel.") : (vi ? "Bấm để chọn điểm ô này." : "Click to allocate.")}</p>);
      }
      return <>{lines}</>;
    },
    renderSocketMenu: (node, allocated, close) => (
      <SocketJewelMenu
        node={node}
        allocated={allocated}
        locale={locale}
        queue={compareQueue}
        current={inventoryBySlot.get(`PassiveJewel:${node.id}`) ?? null}
        candidates={stash.filter((item) => socketAccepts(node, item))}
        others={socketedRows.filter((row) => jewelSocketNodeId(row.inventoryId) !== node.id && jewelSocketAccepts(node.jewelSocket!, { rawText: row.rawText, baseName: row.baseName, isUnique: row.isUnique }))}
        jewelName={jewelName}
        compare={(change) => socketCompare(node.id, change)}
        requestCalc={requestCalc}
        onPut={(itemId) => { putJewel(itemId, node.id); close(); }}
        onMove={(fromNodeId) => { moveJewel(fromNodeId, node.id); close(); }}
        onTakeOut={() => { takeOutJewel(node.id); close(); }}
      />
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [socketedRows, carriedJewel, draggedJewelId, effectiveTree, locale, inventoryBySlot, socketHoverCompare, socketHover, compareQueue, stash, socketCompare, requestCalc, inventory]);

  const enterStashItem = (itemId: string, event: React.MouseEvent) => {
    const item = stash.find((row) => row.id === itemId);
    if (!item) return;
    const record = stashRecord(item);
    const content = item.rawText ? getImportedItemTooltipHtml(item.rawText, record, locale, baseRecordForText(item.rawText)) : record ? getItemTooltipHtml(record, locale) : `<div class="poe-tooltip-card"><div class="tooltip-header"><div class="tooltip-name">${escapeHtml(item.itemName)}</div></div></div>`;
    setTooltip({ x: event.clientX, y: event.clientY, content, visible: true, compare: stashCompareSpec(item, 10) });
  };
  // Selecting a slot also starts comparing the few items that fit it.
  useEffect(() => {
    if (!activeSlotId || !calcPayload) return;
    for (const view of stashViews.filter((row) => row.fits).slice(0, 6)) stashCompareSpec(view.item, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlotId, stashViews, currentCalculationBody]);

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
    setActiveGemPicker(null);
    setGemStrip({ skillId, supportId: support.id });
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

  const clampGemNumber = (value: string, min: number, max: number) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
  };
  // Level / quality boxes for one gem; level defaults to 20 like the calculator.
  const gemLevelControls = (gem: { gemLevel?: number; gemQuality?: number }, onPatch: (patch: { gemLevel?: number; gemQuality?: number }) => void) => (
    <span className="pc-gem-levels">
      <label title={locale === "vi" ? "Cấp gem. Gem cấp cao mạnh hơn; +cấp từ trang bị được PoB cộng thêm." : "Gem level"}>
        Lv
        <input type="number" min={1} max={40} value={gem.gemLevel ?? 20} onChange={(event) => onPatch({ gemLevel: clampGemNumber(event.target.value, 1, 40) })} />
      </label>
      <label title={locale === "vi" ? "Chất lượng (quality) của gem, thường 0–20%." : "Gem quality"}>
        Q
        <input type="number" min={0} max={23} value={gem.gemQuality ?? 0} onChange={(event) => onPatch({ gemQuality: clampGemNumber(event.target.value, 0, 23) })} />
      </label>
    </span>
  );
  const grantedSkillTag = (skill: BuildSkillChoice) => {
    if (!skill.itemSlot && !skill.itemSource) return null;
    const fromTree = /^Tree:/i.test(skill.itemSource || "");
    const label = locale === "vi" ? (fromTree ? "Từ cây thụ động" : "Từ trang bị") : (fromTree ? "From passive tree" : "From item");
    const hint = locale === "vi"
      ? "Kỹ năng có sẵn nhờ trang bị hoặc điểm thụ động, không phải gem bạn tự gắn. Muốn bỏ thì tháo món đồ / điểm đó."
      : "Granted by an item or a passive, not a gem you socketed.";
    return <span className="pc-tag" title={hint}>{label}</span>;
  };

  /** Why a skill shows no damage when the active weapon set does not hold what its gem requires. */
  const weaponHintFor = (skill: BuildSkillChoice): string | null => {
    // A skill an item grants comes with that item.
    if (skill.itemSlot || skill.itemSource) return null;
    const record = gemChoiceItem(skill.skillId, skillGemOptions, "SkillGem");
    if (!record) return null;
    return skillWeaponHint({
      skillName: itemTitle(record, locale),
      requirements: record.requirements,
      activeSet: activeWeaponSet,
      sets: {
        1: { main: inventoryBySlot.get("Weapon1"), off: inventoryBySlot.get("Weapon2") },
        2: { main: inventoryBySlot.get("Weapon3"), off: inventoryBySlot.get("Weapon4") }
      },
      locale
    });
  };

  // "Thêm skill" adds a group and opens the picker; closed without a pick, the empty group
  // goes away again (a group that already holds supports is kept).
  useEffect(() => {
    if (activeGemPicker) return;
    const isEmpty = (row: BuildSkillChoice) => !row.skillId.trim() && !row.supportSkills.length;
    if (!buildSkills.some(isEmpty)) return;
    // Keep the main skill pointing at the same group.
    const removedBefore = buildSkills.slice(0, Math.max(mainSocketGroup - 1, 0)).filter(isEmpty).length;
    setBuildSkills((rows) => rows.filter((row) => !isEmpty(row)));
    if (removedBefore) setMainSocketGroup((current) => Math.max(1, current - removedBefore));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGemPicker]);

  const toggleGemStrip = (skillId: string, supportId: string | "main") => {
    setActiveGemPicker(null);
    setGemStrip((current) => (current && current.skillId === skillId && current.supportId === supportId ? null : { skillId, supportId }));
  };

  /** Gems to try in place of the clicked one, each with the request that tells its DPS. */
  const gemStripModel = useMemo(() => {
    if (!gemStrip || !calcPayload) return null;
    const groupIndex = buildSkills.findIndex((row) => row.id === gemStrip.skillId);
    const group = buildSkills[groupIndex];
    if (!group) return null;
    const isMain = gemStrip.supportId === "main";
    const support = isMain ? undefined : group.supportSkills.find((row) => row.id === gemStrip.supportId);
    if (!isMain && !support) return null;
    const skillRecord = gemChoiceItem(group.skillId, skillGemOptions, "SkillGem");
    const groupNames = [
      skillRecord?.name,
      ...group.supportSkills.map((row) => gemChoiceItem(row.skillId, row.active ? skillGemOptions : supportGemOptions, row.active ? "SkillGem" : "SupportGem")?.name)
    ].filter((name): name is string => Boolean(name));
    const pool = isMain || support?.active ? skillGemOptions : supportGemOptions;
    const prefix = isMain || support?.active ? "SkillGem" : "SupportGem";
    const swapsSkill = isMain || Boolean(support?.active);
    // Skills: look like the gem being replaced. Supports: fit the skill that does the damage
    // (in a Cast on X group that is the spell socketed in it, picked by mainActiveSkill).
    const activeGems = group.supportSkills.filter((row) => row.active);
    const damageGem = (group.mainActiveSkill ?? 1) > 1 ? activeGems[(group.mainActiveSkill ?? 1) - 2] : undefined;
    const tagSource = isMain
      ? skillRecord
      : support?.active
        ? gemChoiceItem(support.skillId, skillGemOptions, "SkillGem")
        : (damageGem ? gemChoiceItem(damageGem.skillId, skillGemOptions, "SkillGem") : undefined) ?? skillRecord;
    const candidates = gemCandidates(tagSource?.tags, pool, { exclude: groupNames, limit: gemStrip.limit ?? (swapsSkill ? 8 : 10), triggered: Boolean(damageGem) });
    // DPS of this group: calculate it as the main skill, with and without the change.
    const mainSocketGroup = groupIndex + 1;
    const skillsWith = (gemId: string) => buildSkills.map((row) => {
      if (row.id !== group.id) return row;
      if (isMain) return { ...withoutPobGemDetails(row), skillId: gemId };
      return { ...row, supportSkills: row.supportSkills.map((item) => (item.id === support!.id ? { ...withoutPobGemDetails(item), skillId: gemId, disabled: false } : item)) };
    });
    const baseBody = calculationBodyFor({ mainSocketGroup });
    if (!baseBody) return null;
    const options = candidates.map((record): GemOptionView & { body: Record<string, unknown> } => {
      const id = officialGemId(record, prefix);
      const body = calculationBodyFor({ skills: skillsWith(id), mainSocketGroup })!;
      return { id, name: itemTitle(record, locale), iconUrl: displayImageUrl(record.icon_url), key: calcKey(body), body };
    });
    const currentName = isMain
      ? skillRecord?.name ?? ""
      : gemChoiceItem(support!.skillId, pool, prefix)?.name ?? (locale === "vi" ? "ô trống" : "empty slot");
    const title = locale === "vi"
      ? (swapsSkill ? `Thử kỹ năng khác thay ${currentName}` : `Gợi ý support thay ${currentName}`)
      : (swapsSkill ? `Other skills instead of ${currentName}` : `Supports to try instead of ${currentName}`);
    return { title, baseBody, baseKey: calcKey(baseBody), options, isMain, skillId: group.id, supportId: support?.id };
  }, [gemStrip, calcPayload, buildSkills, skillGemOptions, supportGemOptions, calculationBodyFor, locale]);

  // Fill the strip in progressively: the base first, then each candidate, one at a time.
  useEffect(() => {
    if (!gemStripModel) return;
    requestCalc(gemStripModel.baseBody, 3);
    for (const option of gemStripModel.options) requestCalc(option.body, 2);
  }, [gemStripModel, requestCalc]);

  const supportValueKeys = (skillId: string, supportId: string) => {
    const groupIndex = buildSkills.findIndex((row) => row.id === skillId);
    if (groupIndex < 0) return null;
    const withBody = calculationBodyFor({ mainSocketGroup: groupIndex + 1 });
    const withoutBody = calculationBodyFor({
      mainSocketGroup: groupIndex + 1,
      skills: buildSkills.map((row) => (row.id === skillId ? { ...row, supportSkills: row.supportSkills.map((item) => (item.id === supportId ? { ...item, disabled: true } : item)) } : row))
    });
    if (!withBody || !withoutBody) return null;
    return { withKey: requestCalc(withBody, 8), withoutKey: requestCalc(withoutBody, 8) };
  };

  const pickStripGem = (gemId: string) => {
    if (!gemStripModel) return;
    const { skillId, supportId, isMain } = gemStripModel;
    setBuildSkills((rows) => rows.map((row) => {
      if (row.id !== skillId) return row;
      if (isMain) return row.skillId === gemId ? row : { ...withoutPobGemDetails(row), skillId: gemId };
      return { ...row, supportSkills: row.supportSkills.map((item) => (item.id === supportId && item.skillId !== gemId ? { ...withoutPobGemDetails(item), skillId: gemId, disabled: false } : item)) };
    }));
    setGemStrip(null);
  };

  const gemStripFor = (skillId: string, supportId: string | "main") => (
    gemStripModel && gemStrip && gemStrip.skillId === skillId && gemStrip.supportId === supportId ? (
      <GemSwapStrip
        queue={compareQueue}
        baseKey={gemStripModel.baseKey}
        options={gemStripModel.options}
        locale={locale}
        title={gemStripModel.title}
        onPick={pickStripGem}
        onMore={gemStripModel.options.length >= (gemStrip.limit ?? 8) ? () => setGemStrip((current) => current && { ...current, limit: (current.limit ?? 10) + 10 }) : undefined}
        onBrowse={() => {
          setGemStrip(null);
          if (supportId === "main") openSkillGemPicker(skillId);
          else openSupportGemPicker(skillId, supportId);
        }}
        onClose={() => setGemStrip(null)}
      />
    ) : null
  );

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
    // A new gem drops the PoB ids/settings of the gem it replaces (level and quality stay).
    const target = activeGemPicker;
    if (target.kind === "skill") {
      const skillId = officialGemId(item, "SkillGem");
      setBuildSkills((rows) => rows.map((row) => row.id === target.skillId && row.skillId !== skillId ? { ...withoutPobGemDetails(row), skillId } : row));
    } else {
      const skillId = officialGemId(item, "SupportGem");
      setBuildSkills((rows) => rows.map((row) => row.id === target.skillId
        ? { ...row, supportSkills: row.supportSkills.map((support) => support.id === target.supportId && support.skillId !== skillId ? { ...withoutPobGemDetails(support), skillId } : support) }
        : row));
    }
    setActiveGemPicker(null);
  };

  const applyLevel = (value: number) => {
    setLevel(value);
    setLevelText(String(value));
  };

  // The level box: a whole number 1-100 updates the build (the calculation waits 350 ms).
  const changeLevelText = (text: string) => {
    setLevelText(text);
    const next = /^\d+$/.test(text.trim()) ? characterLevel(text) : undefined;
    if (next !== undefined) setLevel(next);
  };

  const resetBuildDraft = () => {
    const tree = defaultBuildTree(currentTree);
    setActiveBuildId("");
    setBuildTree(tree);
    setImportedBuild(null);
    setImportError("");
    setName(tree?.name ?? "");
    setAuthor("");
    setDescription(tree ? `${tree.className}${tree.ascendancyName ? ` - ${tree.ascendancyName}` : ""}` : "");
    setActiveWeaponSet(1);
    setInventory(emptyEquipmentChoices());
    setBuildSkills([]);
    setStash([]);
    setLiveStats(null);
    setMainSocketGroup(1);
    applyLevel(DEFAULT_CHARACTER_LEVEL);
    setClassPickerOpen(false);
  };

  const newBuildDraft = () => askBeforeLeaving(() => {
    resetBuildDraft();
    moveTo("/build/new");
  });

  const openBuildLibrary = () => askBeforeLeaving(() => {
    moveTo("/build");
    setActiveSlotId(null);
    setActiveGemPicker(null);
    setTreeChoicesOpen(false);
  });

  const applyBuildProject = (project: BuildProject) => {
    setActiveBuildId(project.id);
    setName(project.name);
    setAuthor(project.author || "");
    setDescription(project.description);
    setBuildTree(project.treeSnapshots[0] ?? null);
    const nextInventory = enrichInventoryChoices(inventoryWithEmptySlots(project.inventory), itemsData, locale);
    setActiveWeaponSet((project.importedPayload && payloadWeaponSet(project.importedPayload)) || preferredWeaponSet(nextInventory));
    setInventory(nextInventory);
    setBuildSkills(project.skills ?? []);
    setStash(project.stash ?? []);
    setImportedBuild(project.importedPayload ? {
      fileName: project.importedFileName || `${project.name}.build`,
      payload: project.importedPayload,
      importedAt: project.updatedAt
    } : null);
    setImportError("");
    setTreeChoicesOpen(false);
    setClassPickerOpen(false);
    applyLevel(buildCharacterLevel(project));
    setLiveStats(null);
    const msg = project.importedPayload?.mainSocketGroup || project.importedPayload?.build?.mainSocketGroup || 1;
    setMainSocketGroup(Number(msg));
  };

  const loadBuildProject = (project: BuildProject) => {
    applyBuildProject(project);
    moveTo(`/build/${encodeURIComponent(project.id)}`);
  };

  const buildDetailPath = (projectId = activeBuildId || buildRoute.projectId) => projectId ? `/build/${encodeURIComponent(projectId)}` : "/build/new";

  const saveCurrentBuild = ({ showDialog = false, navigateAfterSave = true } = {}) => {
    const updatedPayload = importedBuild?.payload ? {
      // With the class picked in the planner, when it was changed.
      ...(basePayload ?? importedBuild.payload),
      mainSocketGroup,
      planner_config_inputs: configInputs ?? undefined
    } : undefined;
    const project = createBuildProject({
      id: activeBuildId || undefined,
      name,
      author,
      description,
      treeSnapshot: effectiveTree,
      inventory,
      skills: buildSkills,
      stash,
      importedPayload: updatedPayload,
      importedFileName: importedBuild?.fileName,
      level,
      createdAt: activeBuildProject?.createdAt
    });
    setSavedBuilds(saveBuildProject(project));
    // The class changed in the planner is now the build's own.
    if (importedBuild && project.importedPayload && basePayload !== importedBuild.payload) {
      setImportedBuild({ ...importedBuild, payload: project.importedPayload });
    }
    setActiveBuildId(project.id);
    setName(project.name);
    setAuthor(project.author || "");
    setDescription(project.description);
    setBuildTree(project.treeSnapshots[0] ?? null);
    const nextInventory = inventoryWithEmptySlots(project.inventory);
    setActiveWeaponSet(preferredWeaponSet(nextInventory));
    setInventory(nextInventory);
    setBuildSkills(project.skills ?? []);
    setStash(project.stash ?? []);
    if (navigateAfterSave && (buildRoute.isNew || !buildRoute.projectId)) moveTo(`/build/${encodeURIComponent(project.id)}`);
    if (showDialog) showInfoDialog(localizedText(copy.savedBuildTitle, "", locale), localizedText(copy.savedBuildBody, "", locale));
    return project;
  };

  saveBeforeLeavingRef.current = () => { saveCurrentBuild({ navigateAfterSave: false }); };

  const deleteBuildNow = (projectId: string) => {
    setSavedBuilds(deleteBuildProject(projectId));
    if (activeBuildId === projectId) {
      resetBuildDraft();
      moveTo("/build");
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

  const classAscendancies = (className: string) => classTree?.classByName.get(className)?.ascendancies.map((row) => row.name) ?? [];

  const pickClass = (className: string) => {
    setPickedClass(className);
    setPickedAscendancy(classAscendancies(className)[0] ?? "");
  };

  // Without a tree the picker is always there; start it on the first class.
  useEffect(() => {
    if (!classTree || pickedClass) return;
    const first = classTree.classes[0] ?? "";
    setPickedClass(first);
    setPickedAscendancy(classTree.classByName.get(first)?.ascendancies[0]?.name ?? "");
  }, [classTree, pickedClass]);

  const openClassPicker = () => {
    if (buildTree && classTree?.classByName.has(buildTree.className)) {
      setPickedClass(buildTree.className);
      setPickedAscendancy(buildTree.ascendancyName);
    }
    setTreeChoicesOpen(false);
    setClassPickerOpen(true);
    window.setTimeout(() => classPickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  /** A new tree for the picked class and ascendancy: only its start nodes, ready for points. */
  const createTreeFromClass = () => {
    if (!classTree || !pickedClass) return;
    const apply = () => {
      const snapshot = createClassTreeSnapshot({
        className: pickedClass,
        ascendancyName: pickedAscendancy,
        startIds: selectedStartNodeIds(classTree, pickedClass, pickedAscendancy),
        treeVersion: plannerData?.version || "0.5"
      });
      const autoDescription = buildTree ? `${buildTree.className}${buildTree.ascendancyName ? ` - ${buildTree.ascendancyName}` : ""}` : "";
      setImportError("");
      setBuildTree(snapshot);
      if (!importedBuild && (!name.trim() || name === buildTree?.name)) setName(snapshot.name);
      if (!description.trim() || description === autoDescription) {
        setDescription(`${snapshot.className}${snapshot.ascendancyName ? ` - ${snapshot.ascendancyName}` : ""}`);
      }
      setClassPickerOpen(false);
      setTreeChoicesOpen(false);
      closeBuildDialog();
    };
    if (buildTree && passiveCount(buildTree) > 0) {
      setBuildDialog({
        title: localizedText(copy.confirmChangeClass, "", locale),
        body: localizedText(copy.confirmChangeClassBody, "", locale),
        actions: [
          { label: localizedText(copy.cancel, "", locale), tone: "neutral", onClick: closeBuildDialog },
          { label: localizedText(copy.changeClass, "", locale), tone: "danger", onClick: apply }
        ]
      });
      return;
    }
    apply();
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
    treeOverride?: BuildTreeSnapshot | null,
    importedStash: BuildStashItem[] = []
  ) => {
    const nextStash = importedStash.map(withStashIcon);
    const importedTree = treeOverride === undefined ? treeSnapshotFromImportedBuild(payload, fileName, data) : treeOverride;
    if (importedTree) {
      setSavedTrees(saveTreeSnapshot(importedTree));
      window.dispatchEvent(new CustomEvent("poe-build-tree-saved", { detail: { source: "build-import", id: importedTree.id } }));
    }
    const nextName = payloadText(payload, "name") || fileName.replace(/\.build$/i, "");
    const nextAuthor = payloadText(payload, "author");
    const nextDescription = payloadText(payload, "description");
    const nextInventory = enrichInventoryChoices(inventoryChoicesFromBuildPayload(payload, equipmentSlotIds), itemsData, locale);
    const nextSkills = skillChoicesFromBuildPayload(payload);
    // Save the import right away so a reload (F5) on /build/<id> brings it back instead of
    // landing on an empty /build/new draft.
    const project = createBuildProject({
      name: nextName,
      author: nextAuthor,
      description: nextDescription,
      treeSnapshot: importedTree,
      inventory: nextInventory,
      skills: nextSkills,
      stash: nextStash,
      importedPayload: payload,
      importedFileName: fileName,
      level: characterLevel(payload.level)
    });
    let saved = false;
    try {
      setSavedBuilds(saveBuildProject(project));
      saved = true;
    } catch (error) {
      // localStorage full or blocked: keep the import in memory and tell the user.
      setImportError(error instanceof Error ? `Không lưu được build vào trình duyệt: ${error.message}` : "Không lưu được build vào trình duyệt.");
    }
    setImportedBuild({ fileName, payload, importedAt: project.updatedAt });
    if (saved) setImportError("");
    setActiveBuildId(saved ? project.id : "");
    setBuildTree(importedTree);
    setName(saved ? project.name : nextName);
    setAuthor(nextAuthor);
    setDescription(nextDescription);
    setActiveWeaponSet(payloadWeaponSet(payload) ?? preferredWeaponSet(nextInventory));
    setInventory(nextInventory);
    setBuildSkills(nextSkills);
    setStash(nextStash);
    setTreeChoicesOpen(false);
    setClassPickerOpen(false);
    // An imported build keeps its own level.
    applyLevel(characterLevel(payload.level) ?? DEFAULT_CHARACTER_LEVEL);
    moveTo(saved ? `/build/${encodeURIComponent(project.id)}` : "/build/new");
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
      applyImportedBuild(payload, buildFileName(pobBuildName(pobData)), data, importedTree, stashFromPobImport(pobData));
      setPobImportOpen(false);
      setPobCode("");
      showInfoDialog(localizedText(copy.importedBuildTitle, "", locale));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Không import được PoB code.");
    } finally {
      setPobImporting(false);
    }
  };

  // The build as a PoB code: the same XML the calculator runs, so PoB shows the same numbers.
  const exportPobCode = async () => {
    const body = currentCalculationBody();
    if (!body) return;
    try {
      const code = await encodePobXmlText(buildPobXml(body));
      let copied = false;
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch {
        copied = false;
      }
      showInfoDialog(
        locale === "vi" ? (copied ? "Đã chép PoB code" : "PoB code của build") : (copied ? "PoB code copied" : "PoB code"),
        copied
          ? (locale === "vi" ? "Mở Path of Building → Import/Export Build → dán code vào ô \"Import from\"." : "In Path of Building: Import/Export Build → paste the code.")
          : code
      );
    } catch (error) {
      showInfoDialog(locale === "vi" ? "Không tạo được PoB code" : "Could not create a PoB code", error instanceof Error ? error.message : "");
    }
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
          {buildTree ? (
            <button type="button" onClick={() => (classPickerOpen ? setClassPickerOpen(false) : openClassPicker())} aria-expanded={classPickerOpen} aria-label={localizedText(copy.changeClass, "", locale)} title={localizedText(copy.changeClass, "", locale)}>
              <span className="material-symbols-rounded" aria-hidden="true">person</span>
            </button>
          ) : null}
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
            <em>{formatNumber(treePoints(buildTree), locale)}</em>
            <button className="build-tree-icon-action build-tree-clear" type="button" onClick={(event) => {
              event.stopPropagation();
              clearBuildTree();
            }} aria-label={localizedText(copy.clearTree, "", locale)}>
              <span className="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </article>
        </div>
      ) : null}
      {!buildTree || classPickerOpen ? (
        <div className="build-class-picker" ref={classPickerRef}>
          <p>{localizedText(copy.startFromClass, "", locale)}</p>
          {classTree ? (
            <div className="build-class-picker-row">
              <label>
                <span>{localizedText(copy.pickClass, "", locale)}</span>
                <select value={pickedClass} onChange={(event) => pickClass(event.target.value)}>
                  {classTree.classes.map((className) => <option value={className} key={className}>{className}</option>)}
                </select>
              </label>
              <label>
                <span>{localizedText(copy.pickAscendancy, "", locale)}</span>
                <select value={pickedAscendancy} onChange={(event) => setPickedAscendancy(event.target.value)}>
                  <option value="">{localizedText(copy.noAscendancyChoice, "", locale)}</option>
                  {classAscendancies(pickedClass).map((ascendancy) => <option value={ascendancy} key={ascendancy}>{ascendancy}</option>)}
                </select>
              </label>
              <div className="build-class-picker-actions">
                <button className="build-class-picker-create" type="button" onClick={createTreeFromClass} disabled={!pickedClass}>
                  <span className="material-symbols-rounded" aria-hidden="true">account_tree</span>
                  {localizedText(copy.createClassTree, "", locale)}
                </button>
                {buildTree ? (
                  <button type="button" onClick={() => setClassPickerOpen(false)}>{localizedText(copy.cancel, "", locale)}</button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="build-class-picker-loading">{localizedText(copy.loadingClasses, "", locale)}</p>
          )}
          {!buildTree && options.length ? <h4>{localizedText(copy.orSavedTree, "", locale)}</h4> : null}
        </div>
      ) : null}
      {showTreeChoices ? (
        <div className="build-tree-source build-tree-source--inline">
          <div className="build-tree-list build-tree-choice-list">
            {options.map((option) => (
              <button className={buildTree?.id === option.snapshot.id ? "is-active" : ""} type="button" onClick={() => chooseTreeForBuild(option)} key={option.key}>
                <span>
                  <strong>{option.snapshot.name}</strong>
                  <small>{option.label} - {option.snapshot.className}{option.snapshot.ascendancyName ? ` / ${option.snapshot.ascendancyName}` : ""}</small>
                </span>
                <em>{formatNumber(treePoints(option.snapshot), locale)}</em>
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
            initialSnapshot={effectiveTree}
            jewels={treeJewelHooks}
            onSnapshotChange={updateBuildTreeFromEditor}
            onSaveSnapshot={saveBuildTreeFromEditor}
            renderNodeExtra={nodePreview.renderNodeExtra}
            onNodeHover={nodePreview.onNodeHover}
            onTreeReady={nodePreview.onTreeReady}
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
                      {project.author ? <p>{project.author}</p> : null}
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
      <section className="build-workbench nj-page">
        {/* Hero header: name, class, actions (poe.ninja character header) */}
        <header className="nj-hero">
          <div className="nj-hero-main">
            <button className="build-back-btn" type="button" onClick={openBuildLibrary}>
              <span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>
              {localizedText(copy.backToBuilds, "", locale)}
            </button>
            <p className="nj-hero-eyebrow">Build Planner · POE2 Việt hóa</p>
            <input
              className="build-name-input nj-hero-title"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tên Build..."
              title={localizedText(copy.buildName, "", locale)}
            />
            <p className="nj-hero-sub">
              {buildTree ? (
                <>
                  {buildTree.className}
                  {buildTree.ascendancyName ? ` ${buildTree.ascendancyName}` : ""}
                  {" · "}
                  {formatNumber(treePoints(buildTree), locale)} {locale === "vi" ? "điểm thụ động" : "passives"}
                </>
              ) : (
                <span className="is-empty">{locale === "vi" ? "Chưa chọn class / cây thụ động" : "No class / passive tree yet"}</span>
              )}
            </p>
            <div className="nj-hero-level-row">
              <label className="build-level-field" title={`${localizedText(copy.characterLevel, "", locale)} (${MIN_CHARACTER_LEVEL}-${MAX_CHARACTER_LEVEL})`}>
                <span>{localizedText(copy.characterLevel, "", locale)}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_CHARACTER_LEVEL}
                  max={MAX_CHARACTER_LEVEL}
                  step={1}
                  value={levelText}
                  onChange={(event) => changeLevelText(event.target.value)}
                  onBlur={() => setLevelText(String(level))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    // Enter applies the level right away (out-of-range numbers are clamped) and
                    // shows the value in use, as leaving the field does.
                    event.preventDefault();
                    const typed = characterLevel(levelText.trim());
                    applyLevel(typed ?? level);
                    const input = event.currentTarget;
                    window.setTimeout(() => input.select(), 0);
                  }}
                  aria-label={localizedText(copy.characterLevel, "", locale)}
                />
              </label>
              <button className="build-change-class" type="button" onClick={openClassPicker}>
                <span className="material-symbols-rounded" aria-hidden="true">person</span>
                {buildTree ? localizedText(copy.changeClass, "", locale) : (locale === "vi" ? "Chọn class" : "Pick a class")}
              </button>
              {/* Stays in this row: the list itself is at the top of the stats panel. */}
              {warningList.length ? (
                <button
                  className="build-warning-chip"
                  type="button"
                  onClick={() => document.querySelector(".build-warnings")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  title={warningList.map((warning) => warning.text).join("\n")}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">warning</span>
                  {locale === "vi" ? `${warningList.length} cảnh báo` : `${warningList.length} warning(s)`}
                </button>
              ) : null}
            </div>
          </div>

          <div className="nj-hero-side">
            <div className="nj-meta">
              <div>
                <span>{locale === "vi" ? "Tác giả" : "Author"}</span>
                <strong>{author.trim() || "—"}</strong>
              </div>
              <div>
                <span>DPS</span>
                <strong>
                  {/* The main skill's card number (one source for header and card). The number stamped in
                      a PoB code comes from another PoB version: it is only shown when ours gave no answer. */}
                  {activeStats && activeStats.CombinedDPS !== undefined
                    ? Math.round(groupSkillDps[mainSocketGroup - 1] || mainSkillDps(activeStats)).toLocaleString("en-US")
                    : stampedStatsUsable({ calculated: Boolean(activeStats), calculating: isCalculating, failed: Boolean(calcError) }) && getBaseDps()
                      ? Math.round(getBaseDps()).toLocaleString("en-US")
                      : (importedBuild?.payload && !calcError ? "…" : "—")}
                </strong>
              </div>
              <div>
                <span>{locale === "vi" ? "Trạng thái" : "Status"}</span>
                <strong className={hasBuildChanges ? "is-changed" : "is-saved"}>
                  {hasBuildChanges ? (locale === "vi" ? "Chưa lưu" : "Unsaved") : (activeBuildId ? (locale === "vi" ? "Đã lưu" : "Saved") : (locale === "vi" ? "Bản nháp" : "Draft"))}
                </strong>
              </div>
            </div>
            <div className="nj-hero-actions">
              <span className="nj-meta-label">{locale === "vi" ? "Thao tác" : "Actions"}</span>
              <div className="build-top-actions build-project-actions">
                <button className={`build-btn build-btn--save ${hasBuildChanges ? "is-changed" : ""}`} type="button" onClick={() => saveCurrentBuild({ showDialog: true })} title={localizedText(copy.saveBuildHint, "", locale)}>
                  <span className="material-symbols-rounded" aria-hidden="true">save</span>
                  {localizedText(copy.saveBuild, "", locale)}
                </button>
                <button className="build-btn build-btn--import" type="button" onClick={openPobImport}>
                  <span className="material-symbols-rounded" aria-hidden="true">data_object</span>
                  {localizedText(copy.importPob, "", locale)}
                </button>
                <button
                  className="build-btn build-btn--export"
                  type="button"
                  onClick={exportPobCode}
                  disabled={!calcPayload}
                  title={locale === "vi" ? "Chép PoB code để mở build này trong Path of Building" : "Copy a PoB code to open this build in Path of Building"}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">content_copy</span>
                  PoB code
                </button>
                <button className="build-btn build-btn--export" type="button" onClick={exportBuild} disabled={!canExport} title={!canExport ? exportDisabledHint : localizedText(copy.export, "", locale)}>
                  <span className="material-symbols-rounded" aria-hidden="true">download</span>
                  .build
                </button>
                {activeBuildId ? (
                  <button className="build-btn build-btn--delete" type="button" onClick={() => removeSavedBuild(activeBuildId)} title={localizedText(copy.deleteBuild, "", locale)}>
                    <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                  </button>
                ) : null}
                <button className="build-help-button build-help-button--panel" type="button" onClick={() => setShowBuildHelp(true)} aria-label={localizedText(copy.howTitle, "", locale)} title={localizedText(copy.howTitle, "", locale)}>
                  <span className="material-symbols-rounded" aria-hidden="true">help</span>
                </button>
              </div>
              <p className="build-save-hint">{localizedText(copy.saveBuildHint, "", locale)}</p>
            </div>
          </div>
        </header>

        {loadError ? <div className="error-panel">{uiText("loadFailed", locale)}: {loadError}</div> : null}

        {/* Row 1: Equipment | Stats */}
        <div className="nj-row nj-row--top">
          <section className="nj-panel nj-equipment">
            <header className="nj-panel-head">
              <h2>{localizedText(copy.equipment, "", locale)}</h2>
              <span className="nj-panel-aside">{formatNumber(selectedInventoryCount, locale)} {localizedText(copy.selected, "", locale)}</span>
            </header>
            <div className="nj-panel-body">
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
                  const record = hasItem ? itemRecordForChoice(choice) : undefined;
                  // Imported items carry their own rolls; the record is only the base.
                  const importedText = hasItem ? choice?.rawText || "" : "";
                  const importedRarity = importedText ? parsePobItemDetails(importedText).rarity : "";
                  const rarity = importedRarity || (record ? itemRarity(record) : (choice?.isUnique ? "unique" : "normal"));
                  const hasTooltip = Boolean(record || importedText);
                  return (
                    <button
                      className={`build-equip-slot build-equip-slot--${slot.area} ${slot.size ? `is-${slot.size}` : ""} ${hasItem ? `has-item is-${rarity}` : ""} ${activeSlotId === slot.id ? "is-selected" : ""} ${dropSlotId === slot.id ? "is-drop-target" : ""}`}
                      type="button"
                      onClick={(event) => {
                        const button = event.currentTarget;
                        // Kept inside the doll: a slot on the right edge opens its menu leftwards.
                        const frameWidth = (button.offsetParent as HTMLElement | null)?.clientWidth ?? 320;
                        const menuWidth = Math.min(260, frameWidth);
                        setSlotMenuAt({ left: Math.max(0, Math.min(button.offsetLeft, frameWidth - menuWidth)), top: button.offsetTop + button.offsetHeight + 6, width: button.offsetWidth });
                        openPicker(slot.id);
                      }}
                      aria-pressed={activeSlotId === slot.id}
                      aria-haspopup="menu"
                      draggable={hasItem}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SLOT_DRAG_TYPE, slot.id);
                        handleMouseLeave();
                      }}
                      onDragOver={(event) => {
                        const types = [...event.dataTransfer.types];
                        // Items from the inventory and items worn in another slot both drop here.
                        if (types.includes(STASH_DRAG_TYPE) || types.includes(SLOT_DRAG_TYPE)) {
                          event.preventDefault();
                          setDropSlotId(slot.id);
                        }
                      }}
                      onDragLeave={() => setDropSlotId(null)}
                      onDrop={(event) => {
                        setDropSlotId(null);
                        const fromSlotId = event.dataTransfer.getData(SLOT_DRAG_TYPE);
                        if (fromSlotId) {
                          event.preventDefault();
                          moveEquippedItem(fromSlotId, slot.id);
                          return;
                        }
                        const itemId = event.dataTransfer.getData(STASH_DRAG_TYPE);
                        const item = stash.find((row) => row.id === itemId);
                        if (!item) return;
                        event.preventDefault();
                        // Every refusal reads the same: one line under the doll.
                        if (slotIdsForCategories(stashCategories(item)).includes(slot.id)) equipItem(itemId, slot.id);
                        else slotRefusal(slot.id);
                      }}
                      onContextMenu={(event) => {
                        if (!hasItem) return;
                        event.preventDefault();
                        unequipItem(slot.id);
                      }}
                      onMouseEnter={(event) => {
                        const content = importedText
                          ? getImportedItemTooltipHtml(importedText, record, locale, baseRecordForText(importedText))
                          : record ? getItemTooltipHtml(record, locale) : "";
                        if (content) setTooltip({ x: event.clientX, y: event.clientY, content, visible: true });
                      }}
                      onMouseMove={hasTooltip ? handleMouseMove : undefined}
                      onMouseLeave={hasTooltip ? handleMouseLeave : undefined}
                      style={{ gridArea: slot.area }}
                      key={slot.id}
                      aria-label={`${slotLabel(slot.id)}${choice?.itemName ? `: ${choice.rareName || choice.itemName}` : ""}`}
                      title={locale === "vi" ? "Bấm để chọn ô (kho đồ lọc theo ô này). Kéo đồ từ kho thả vào để mặc. Chuột phải để tháo." : "Click to select; drop an item to equip; right-click to unequip."}
                    >
                      {hasItem ? (
                        <>
                          {choice?.iconUrl ? <img src={choice.iconUrl} alt="" loading="lazy" /> : <span className="material-symbols-rounded build-slot-fallback" aria-hidden="true">inventory_2</span>}
                          {choice && isItemEdited(choice) ? <span className="pi-edited">{locale === "vi" ? "Đã sửa" : "Edited"}</span> : null}
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-rounded build-slot-silhouette" aria-hidden="true">
                            {slotSilhouetteIcon(slot.area)}
                          </span>
                          <span className="build-slot-label">{slotShortLabel(slot)}</span>
                        </>
                      )}
                    </button>
                  );
                })}
                {activeSlotId && slotMenuAt ? (() => {
                  const vi = locale === "vi";
                  const choice = inventoryBySlot.get(activeSlotId);
                  const filled = Boolean(choice?.itemName);
                  const fitting = stashViews.filter((view) => view.fits).length;
                  // The slot stays selected (the inventory filters to it); only the menu closes.
                  const toInventory = (focusSearch: boolean) => {
                    setSlotMenuAt(null);
                    const panel = document.querySelector<HTMLElement>(".nj-inventory");
                    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
                    if (focusSearch) window.setTimeout(() => panel?.querySelector<HTMLInputElement>(".pi-search input")?.focus({ preventScroll: true }), 350);
                  };
                  return (
                    <div className="build-slot-menu" role="menu" aria-label={slotLabel(activeSlotId)} style={{ left: slotMenuAt.left, top: slotMenuAt.top, minWidth: Math.max(180, slotMenuAt.width) }}>
                      <div className="build-slot-menu-head">
                        <strong>{slotLabel(activeSlotId)}</strong>
                        {filled ? <small>{choice?.rareName || choice?.itemName}</small> : <small>{vi ? "Ô trống" : "Empty"}</small>}
                        <button type="button" className="build-slot-menu-close" aria-label={vi ? "Đóng" : "Close"} onClick={() => setSlotMenuAt(null)}>
                          <span className="material-symbols-rounded" aria-hidden="true">close</span>
                        </button>
                      </div>
                      {filled ? (
                        <>
                          <button type="button" role="menuitem" onClick={() => { editSlotItem(activeSlotId); setActiveSlotId(null); }}>
                            <span className="material-symbols-rounded" aria-hidden="true">edit</span>{vi ? "Sửa chỉ số món này" : "Edit this item"}
                          </button>
                          <button type="button" role="menuitem" onClick={() => { unequipItem(activeSlotId); setActiveSlotId(null); }}>
                            <span className="material-symbols-rounded" aria-hidden="true">move_to_inbox</span>{vi ? "Tháo ra (cất vào kho)" : "Unequip to inventory"}
                          </button>
                        </>
                      ) : null}
                      <button type="button" role="menuitem" onClick={() => toInventory(false)} disabled={!fitting}>
                        <span className="material-symbols-rounded" aria-hidden="true">inventory_2</span>
                        {vi ? (fitting ? `Chọn từ kho (${fitting} món vừa ô này)` : "Kho chưa có món vừa ô này") : (fitting ? `Pick from inventory (${fitting})` : "Nothing in the inventory fits")}
                      </button>
                      <button type="button" role="menuitem" onClick={() => toInventory(true)}>
                        <span className="material-symbols-rounded" aria-hidden="true">search</span>{vi ? "Tìm đồ mới cho ô này" : "Find an item for this slot"}
                      </button>
                    </div>
                  );
                })() : null}
              </div>
              {/* Always there (empty or not) so a message never moves the panels below it. */}
              <p className={`build-equip-notice ${equipNotice ? "is-shown" : ""}`} role="status" aria-live="polite">
                {equipNotice ? (
                  <>
                    <span className="material-symbols-rounded" aria-hidden="true">info</span>
                    <span>{equipNotice.text}</span>
                    <button type="button" onClick={() => setEquipNotice(null)} aria-label={locale === "vi" ? "Đóng thông báo" : "Dismiss"}>
                      <span className="material-symbols-rounded" aria-hidden="true">close</span>
                    </button>
                  </>
                ) : null}
              </p>
            </div>
          </section>

          <section className="nj-panel nj-stats">
            <header className="nj-panel-head">
              <h2>{locale === "vi" ? "Chỉ số" : "Stats"}</h2>
              {isCalculating ? <span className="nj-panel-aside">{locale === "vi" ? "Đang tính..." : "Calculating..."}</span> : null}
              {!isCalculating && calcError ? <span className="nj-panel-aside nj-calc-error" role="alert">{calcError}</span> : null}
            </header>
            {(() => {
              // Numbers stamped in the PoB code are a fallback for when the calculator gave no answer
              // (they come from another PoB version and would change once ours arrives).
              const payloadStats = stampedStatsUsable({ calculated: Boolean(activeStats), calculating: isCalculating, failed: Boolean(calcError) })
                ? importedBuild?.payload?.stats || []
                : [];
              const readStat = (key: string): number | undefined => {
                if (activeStats && typeof activeStats[key] === "number") return activeStats[key];
                const row = payloadStats.find((s) => s.stat === key);
                if (row && typeof row.value === "number") return row.value;
                if (row && typeof row.value === "string" && row.value.trim() !== "" && !Number.isNaN(Number(row.value))) return Number(row.value);
                return undefined;
              };
              const fmtInt = (value: number | undefined) => value === undefined ? undefined : Math.round(value).toLocaleString("en-US");
              const fmtPct = (value: number | undefined) => {
                if (value === undefined) return undefined;
                const pct = Math.abs(value) <= 1 ? value * 100 : value;
                return `${Math.round(pct)}%`;
              };
              const fmtMod = (value: number | undefined) => {
                if (value === undefined) return undefined;
                const pct = Math.abs(value) < 5 ? (value - 1) * 100 : value;
                return `${Math.round(pct) >= 0 ? "+" : ""}${Math.round(pct)}%`;
              };
              const fmtRate = (value: number | undefined) => value === undefined ? undefined : `${Math.round(value).toLocaleString("en-US")}/s`;
              const fmtShort = (value: number) => {
                if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
                if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
                if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
                return Math.round(value).toLocaleString("en-US");
              };
              const row = (label: string, value: string | undefined, node?: React.ReactNode) => (
                <div className="nj-stat-row" key={label}>
                  <span>{label}</span>
                  {node ?? <strong className={value === undefined ? "is-empty" : ""}>{value ?? "-"}</strong>}
                </div>
              );
              const triple = (parts: Array<{ cls: string; value: string | undefined }>) => (
                <strong>
                  {parts.map((part, index) => (
                    <Fragment key={part.cls}>
                      {index ? <span className="nj-stat-sep">/</span> : null}
                      <span className={part.cls}>{part.value ?? "-"}</span>
                    </Fragment>
                  ))}
                </strong>
              );
              const str = readStat("Str");
              const dex = readStat("Dex");
              const int = readStat("Int");
              const fire = readStat("FireResist");
              const cold = readStat("ColdResist");
              const lightning = readStat("LightningResist");
              const chaos = readStat("ChaosResist");
              const lifeRegen = readStat("LifeRegenRecovery") ?? readStat("LifeRegen");
              const manaRegen = readStat("ManaRegenRecovery") ?? readStat("ManaRegen");
              const esRecharge = readStat("EnergyShieldRecharge");
              const mainSkills = buildSkills
                .map((skill, index) => ({ skill, index, dps: skillDps(index), details: activeStats?.skillsDetails?.[index] }))
                .filter((entry) => entry.skill.skillId && !foldedGroups.has(entry.index) && (entry.dps > 0 || entry.index + 1 === mainSocketGroup))
                // Main skill first, then the hardest hitting.
                .sort((a, b) => Number(b.index + 1 === mainSocketGroup) - Number(a.index + 1 === mainSocketGroup) || b.dps - a.dps);
              return (
                <div className="nj-panel-body poe-no-tooltip">
                  {warningList.length ? (
                    <div className="build-warnings" role="status" aria-label={locale === "vi" ? "Cảnh báo về build" : "Build warnings"}>
                      <p className="build-warnings-head">
                        <span className="material-symbols-rounded" aria-hidden="true">warning</span>
                        {locale === "vi"
                          ? `Nhân vật cấp ${level} chưa dùng được hết build này (${warningList.length} cảnh báo)`
                          : `A level ${level} character cannot use all of this build yet (${warningList.length})`}
                      </p>
                      <ul>
                        {warningList.map((warning) => <li key={`${warning.kind}:${warning.text}`}>{warning.text}</li>)}
                      </ul>
                      <p className="build-warnings-note">
                        {locale === "vi"
                          ? "Chỉ là cảnh báo: chỉ số vẫn tính đủ các món này, giống Path of Building."
                          : "Warnings only: the numbers still count these, as Path of Building does."}
                      </p>
                    </div>
                  ) : null}
                  <h3 className="nj-stat-group">{locale === "vi" ? "Nhân vật" : "Character"}</h3>
                  {row(locale === "vi" ? "Thuộc tính" : "Attributes", undefined, triple([
                    { cls: "nj-c-str", value: fmtInt(str) },
                    { cls: "nj-c-dex", value: fmtInt(dex) },
                    { cls: "nj-c-int", value: fmtInt(int) }
                  ]))}
                  {row(locale === "vi" ? "Tốc độ di chuyển" : "Movement speed", fmtMod(readStat("EffectiveMovementSpeedMod")))}

                  <h3 className="nj-stat-group">{locale === "vi" ? "Phòng thủ" : "Defensive"}</h3>
                  {row("Life", fmtInt(readStat("Life")))}
                  {row("Energy shield", fmtInt(readStat("EnergyShield")))}
                  {row("Mana", fmtInt(readStat("Mana")))}
                  {row("Spirit", fmtInt(readStat("Spirit")))}
                  {row("Armour", fmtInt(readStat("Armour")))}
                  {row("Evasion rating", fmtInt(readStat("Evasion")))}
                  {row(locale === "vi" ? "Tỉ lệ né" : "Evade chance", fmtPct(readStat("MeleeEvadeChance")))}
                  {row(locale === "vi" ? "Tỉ lệ chặn" : "Block chance", fmtPct(readStat("BlockChance")))}
                  {row(locale === "vi" ? "Giảm sát thương vật lý" : "Physical damage reduction", fmtPct(readStat("PhysicalDamageReduction")))}
                  {row(locale === "vi" ? "Kháng" : "Resistances", undefined, triple([
                    { cls: "nj-c-fire", value: fire === undefined ? undefined : `${Math.round(fire)}%` },
                    { cls: "nj-c-cold", value: cold === undefined ? undefined : `${Math.round(cold)}%` },
                    { cls: "nj-c-lightning", value: lightning === undefined ? undefined : `${Math.round(lightning)}%` },
                    // As PoB shows it: "Immune" with Chaos Inoculation.
                    { cls: "nj-c-chaos", value: resistanceText(activeStats, "ChaosResist", locale, chaos) }
                  ]))}
                  {row(locale === "vi" ? "Máu hiệu dụng (EHP)" : "Effective Health Pool", readStat("TotalEHP") === undefined ? undefined : fmtShort(readStat("TotalEHP") as number))}

                  {(lifeRegen !== undefined || manaRegen !== undefined || esRecharge !== undefined) ? (
                    <>
                      <h3 className="nj-stat-group">{locale === "vi" ? "Hồi phục" : "Recovery"}</h3>
                      {lifeRegen !== undefined ? row("Life regen", fmtRate(lifeRegen)) : null}
                      {manaRegen !== undefined ? row("Mana regen", fmtRate(manaRegen)) : null}
                      {esRecharge !== undefined ? row("Energy shield recharge", fmtRate(esRecharge)) : null}
                    </>
                  ) : null}

                  <h3 className="nj-stat-group">{locale === "vi" ? "Kỹ năng chính" : "Main skills"}</h3>
                  {mainSkills.length ? mainSkills.map(({ skill, index, dps, details }) => {
                    const icon = gemChoiceIcon(skill.skillId, skillGemOptions, "SkillGem");
                    const parts: React.ReactNode[] = [];
                    if (details?.Speed > 0) parts.push(<Fragment key="speed"><b>{(Math.round(details.Speed * 100) / 100).toFixed(1)}</b>/s</Fragment>);
                    if (details?.CritChance > 0) parts.push(<Fragment key="crit"><b>{Math.round(details.CritChance)}%</b> crit</Fragment>);
                    if (details?.HitChance !== undefined) parts.push(<Fragment key="hit"><b>{Math.round(details.HitChance)}%</b> hit</Fragment>);
                    if (details?.ManaCost > 0) parts.push(<Fragment key="mana"><b>{details.ManaCost}</b> mana</Fragment>);
                    const dmg = details ? [
                      ["nj-dps-phys", (details.PhysicalMin + details.PhysicalMax) / 2],
                      ["nj-dps-fire", (details.FireMin + details.FireMax) / 2],
                      ["nj-dps-cold", (details.ColdMin + details.ColdMax) / 2],
                      ["nj-dps-lightning", (details.LightningMin + details.LightningMax) / 2],
                      ["nj-dps-chaos", (details.ChaosMin + details.ChaosMax) / 2]
                    ].filter((entry) => Number(entry[1]) > 0) as Array<[string, number]> : [];
                    const dmgTotal = dmg.reduce((sum, entry) => sum + entry[1], 0);
                    return (
                      <button
                        type="button"
                        className={`nj-main-skill ${index + 1 === mainSocketGroup ? "is-main" : ""}`}
                        key={skill.id}
                        onClick={() => setMainSocketGroup(index + 1)}
                        aria-pressed={index + 1 === mainSocketGroup}
                        title={locale === "vi" ? (index + 1 === mainSocketGroup ? "Kỹ năng chính: các chỉ số chi tiết tính theo kỹ năng này" : "Bấm để chọn làm kỹ năng chính (chỉ số chi tiết tính theo kỹ năng này)") : "Set as main skill"}
                      >
                        <span className="nj-gem-icon">
                          {icon ? <img src={icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">auto_awesome_motion</span>}
                        </span>
                        <span className="nj-main-skill-copy">
                          <strong>
                            {monsterGemTitle(skill) || gemChoiceLabel(skill.skillId, skillGemOptions, "SkillGem", locale, "Empty")}
                            {/* Whose damage the number is, in PoB's names, when it is not this gem's own skill:
                                the spells in Cast on X, a skill the gem or one of its supports grants. */}
                            {cardDamageNeedsNames(groupDamageLines[index] ?? []) ? (
                              <span className="nj-main-skill-sub"> → {cardDamageOwners(groupDamageLines[index])}</span>
                            ) : groupDamage ? null : skill.supportSkills.filter((support) => support.active && !support.disabled).slice(0, 1).map((support) => (
                              // Older calculator (no per-skill names): the first socketed spell.
                              <span className="nj-main-skill-sub" key={support.id}> → {gemChoiceLabel(support.skillId, skillGemOptions, "SkillGem", locale, support.nameSpec || "")}</span>
                            ))}
                          </strong>
                          {parts.length ? (
                            <small>
                              {parts.map((part, partIndex) => (
                                <Fragment key={partIndex}>{partIndex ? " · " : ""}{part}</Fragment>
                              ))}
                            </small>
                          ) : null}
                        </span>
                        <span className="nj-dps" title={`${Math.round(dps).toLocaleString("en-US")} DPS`}>
                          <span>{dps > 0 ? fmtShort(dps) : "-"}</span>
                          {dmgTotal > 0 ? (
                            <i>
                              {dmg.map(([cls, value]) => <b className={cls} style={{ width: `${(value / dmgTotal) * 100}%` }} key={cls} />)}
                            </i>
                          ) : null}
                        </span>
                      </button>
                    );
                  }) : (
                    <div className="nj-stat-row"><span className="is-empty" style={{ color: "var(--nj-muted)" }}>{locale === "vi" ? "Chọn skill ở phần Skills bên dưới." : "Pick a skill in the Skills panel below."}</span></div>
                  )}
                </div>
              );
            })()}
          </section>

          {/* The build's inventory: its own grid area, under the doll on narrow screens (never beside it). */}
          <section className="nj-panel nj-inventory" aria-label={locale === "vi" ? "Kho đồ" : "Inventory"}>
            <div className="nj-panel-body">
              <BuildInventoryPanel
                locale={locale}
                items={stashViews}
                selectedSlotLabel={activeSlotId ? slotLabel(activeSlotId) : undefined}
                selectedSlotFilled={Boolean(activeSlotId && inventoryBySlot.get(activeSlotId)?.itemName)}
                onClearSlot={() => setActiveSlotId(null)}
                onUnequipSelected={() => activeSlotId && unequipItem(activeSlotId)}
                onItemClick={clickStashItem}
                onItemEnter={enterStashItem}
                onItemMove={handleMouseMove}
                onItemLeave={handleMouseLeave}
                onRemove={(itemId) => setStash((rows) => removeStashItem({ inventory, stash: rows }, itemId).stash)}
                onEdit={editStashItem}
                onDuplicate={(itemId) => setStash((rows) => duplicateStashItem(rows, itemId))}
                onNewItem={openNewItem}
                onEditSelected={() => activeSlotId && editSlotItem(activeSlotId)}
                onDropSlot={unequipItem}
                onPasteText={pasteStashText}
                search={catalogSearch}
                searchHiddenCount={catalogHiddenCount}
                onAddCatalog={addCatalogItem}
                slotChoice={slotChoice ? {
                  itemName: stashViews.find((row) => row.item.id === slotChoice.itemId)?.name ?? "",
                  slots: slotChoice.slots.map((id) => ({ id, label: slotLabel(id) }))
                } : null}
                onChooseSlot={(slotId) => slotChoice && equipItem(slotChoice.itemId, slotId)}
                onCancelChoice={() => setSlotChoice(null)}
                onItemDragStart={(itemId) => {
                  const item = stash.find((row) => row.id === itemId);
                  if (item && isJewelText(item.rawText || "", item.baseName)) setDraggedJewelId(itemId);
                }}
                onItemDragEnd={() => setDraggedJewelId(null)}
              />
            </div>
          </section>
        </div>

        {/* Row 2: Passive tree | Build info */}
        <div className="nj-row nj-row--tree">
          <section className="nj-panel nj-tree">
            <header className="nj-panel-head">
              <h2>{locale === "vi" ? "Cây thụ động" : "Passive tree"}</h2>
              <span className="nj-badge">
                <span className="material-symbols-rounded" aria-hidden="true">radio_button_checked</span>
                {formatNumber(treePoints(buildTree), locale)}
              </span>
            </header>
            <div className="nj-panel-body">
              {linkedTreeCard}
            </div>
          </section>

        </div>

        {/* Row 3: Skills (gem groups) */}
        <section className="nj-panel nj-skills">
          <header className="nj-panel-head">
            <h2>{localizedText(copy.skills, "", locale)}</h2>
            {isCalculating ? <span className="nj-panel-aside">{locale === "vi" ? "Đang tính..." : "Calculating..."}</span> : null}
            <button type="button" onClick={addBuildSkill} className="nj-btn nj-btn--outline">
              <span className="material-symbols-rounded" aria-hidden="true">add</span>
              {localizedText(copy.addSkill, "", locale)}
            </button>
          </header>
          <div className="nj-panel-body">
            {buildSkills.length ? (() => {
              const vi = locale === "vi";
              const arranged = arrangeSkillCards(buildSkills.map((skill, index) => ({
                index,
                hasSkill: Boolean(skill.skillId),
                disabled: Boolean(skill.disabled),
                dps: currentGroupDps?.[index],
                isMain: index + 1 === mainSocketGroup,
                // A Companion / Spectre gem without a monster deals 0: keep it in view to pick one.
                hasChoices: hasGemChoices(gemOptionFor(index)) || Boolean(skill.skillId && monsterLibraryOf(skill))
              })).filter((card) => !foldedGroups.has(card.index)));
              const renderCard = (index: number, compact = false) => {
                const skill = buildSkills[index];
                const isMain = index + 1 === mainSocketGroup;
                const dps = currentGroupDps?.[index];
                const before = previousGroupDps?.[index];
                const delta = dps !== undefined && before !== undefined && before > 0 && Math.abs(dps - before) / before >= 0.0005 ? (dps - before) / before : undefined;
                const icon = skill.skillId ? gemChoiceIcon(skill.skillId, skillGemOptions, "SkillGem") : "";
                const triggered = skill.supportSkills.filter((support) => support.active && !support.disabled);
                const supports = skill.supportSkills.filter((support) => !support.active);
                const freeSockets = Math.max(0, 5 - supports.length);
                const expanded = expandedSkill === skill.id;
                // The skills the card's number belongs to, by PoB's names.
                const damageLines = skill.disabled ? [] : groupDamageLines[index] ?? [];
                // Companion / Spectre gems pick their monster on the card.
                const monsterLibrary = skill.skillId ? monsterLibraryOf(skill) : null;
                const pickMonster = (monsterId: string, gem: MonsterGemPatch) =>
                  updateBuildSkill(skill.id, { ...gem, pobAttrs: withGemOption(skill.pobAttrs, { kind: "minion", value: monsterId }) });
                // Two supports of one family on a skill: only one works (PoB counts the later one).
                const supportName = (support: BuildSupportSkillChoice) => gemChoiceLabel(support.skillId, supportGemOptions, "SupportGem", locale, support.nameSpec || "");
                const familyConflicts = supportFamilyConflicts(supports.map((support) => ({
                  id: support.pobGemId || support.skillId,
                  name: support.nameSpec || gemChoiceItem(support.skillId, supportGemOptions, "SupportGem")?.name,
                  disabled: Boolean(support.disabled) || !support.skillId
                })));
                const supersededSupports = new Set(familyConflicts.flatMap((conflict) => conflict.gems.filter((gem) => gem !== conflict.kept).map((gem) => supports[gem].id)));
                const details = isMain && activeStats ? activeStats : null;
                const damageParts = details ? ([
                  ["nj-dps-phys", vi ? "Vật lý" : "Physical", (Number(details.PhysicalMin) + Number(details.PhysicalMax)) / 2],
                  ["nj-dps-fire", vi ? "Lửa" : "Fire", (Number(details.FireMin) + Number(details.FireMax)) / 2],
                  ["nj-dps-cold", vi ? "Băng" : "Cold", (Number(details.ColdMin) + Number(details.ColdMax)) / 2],
                  ["nj-dps-lightning", vi ? "Sét" : "Lightning", (Number(details.LightningMin) + Number(details.LightningMax)) / 2],
                  ["nj-dps-chaos", vi ? "Hỗn mang" : "Chaos", (Number(details.ChaosMin) + Number(details.ChaosMax)) / 2]
                ] as Array<[string, string, number]>).filter((part) => part[2] > 0) : [];
                const damageTotal = damageParts.reduce((sum, part) => sum + part[2], 0);
                return (
                  <article className={`sk-card ${isMain ? "is-main" : ""} ${skill.disabled ? "is-disabled" : ""} ${compact ? "is-compact" : ""}`} key={skill.id}>
                    <div className="sk-top">
                      <button
                        type="button"
                        className="sk-gem"
                        onClick={() => (skill.skillId ? toggleGemStrip(skill.id, "main") : openSkillGemPicker(skill.id))}
                        onMouseEnter={(event) => {
                          if (!skill.skillId) return;
                          const html = getGemTooltipHtml(skill.skillId, skillGemOptions, "SkillGem", locale, skill.note);
                          if (html) setTooltip({ x: event.clientX, y: event.clientY, content: html, visible: true });
                        }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        title={vi ? "Bấm để đổi kỹ năng" : "Click to swap the skill"}
                      >
                        <span className="sk-gem-icon">
                          {icon ? <img src={icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">add</span>}
                        </span>
                        <span className="sk-name">
                          <strong className={skill.skillId ? "" : "is-empty"}>
                            {skill.skillId ? monsterGemTitle(skill) || gemChoiceLabel(skill.skillId, skillGemOptions, "SkillGem", locale, skill.nameSpec || "Empty") : (vi ? "Chọn kỹ năng" : "Choose a skill")}
                          </strong>
                          {triggered.length ? <small>→ {triggered.map((support) => gemChoiceLabel(support.skillId, skillGemOptions, "SkillGem", locale, support.nameSpec || "")).join(", ")}</small> : null}
                          <span className="sk-badges">
                            {/* Full cards edit level/quality below; compact ones only show them. */}
                            {compact && skill.skillId ? <span className="sk-badge">Lv {skill.gemLevel ?? 20}</span> : null}
                            {compact && skill.gemQuality ? <span className="sk-badge">Q {skill.gemQuality}%</span> : null}
                            {grantedSkillTag(skill)}
                            {skill.skillId ? gemOptionBadges(gemOptionFor(index), skill.pobAttrs, locale).map((badge) => <span className="sk-badge sk-badge--option" key={badge}>{badge}</span>) : null}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="sk-dps"
                        onClick={() => setMainSocketGroup(index + 1)}
                        aria-pressed={isMain}
                        title={vi ? (isMain ? "Kỹ năng chính: chỉ số chi tiết tính theo kỹ năng này" : "Bấm để chọn làm kỹ năng chính") : "Set as main skill"}
                      >
                        <span className="sk-star material-symbols-rounded" aria-hidden="true">{isMain ? "star" : "star_outline"}</span>
                        <b>{skill.disabled ? (vi ? "Tắt" : "Off") : dps === undefined ? (isCalculating ? "…" : "—") : dps > 0 ? formatStat(dps, "short") : "0"}</b>
                        <small>
                          {delta !== undefined ? <em className={delta > 0 ? "is-better" : "is-worse"}>{`${delta > 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(Math.abs(delta) < 0.1 ? 1 : 0)}%`}</em> : null}
                          {perHitGroups.has(index) ? (vi ? "/đòn" : "per hit") : "DPS"}
                        </small>
                      </button>
                    </div>
                    {/* The real reason first: the equipped weapon does not fit the skill. */}
                    {!skill.disabled && skill.skillId && !(dps !== undefined && dps > 0) && weaponHintFor(skill) ? (
                      <p className="sk-hint sk-hint--weapon">{weaponHintFor(skill)}</p>
                    ) : !skill.disabled && skill.skillId && dps === 0 && !compact && (gemOptionFor(index)?.statSets || gemOptionFor(index)?.parts) ? (
                      <p className="sk-hint">
                        {vi
                          ? "0 sát thương ở lựa chọn hiện tại — kỹ năng này có nhiều bộ chỉ số/phần, thử đổi trong «Chi tiết»."
                          : "No damage with the current choice — this skill has other stat sets/parts, try another under Details."}
                      </p>
                    ) : null}

                    {/* A card never shows another skill's damage under its own name: when the number
                        is not (only) this gem's own skill, each skill is listed by PoB's name. */}
                    {cardDamageNeedsNames(damageLines) ? (
                      <ul className="sk-lines poe-no-tooltip" aria-label={vi ? "Sát thương của từng kỹ năng trong nhóm" : "Damage of each skill in the group"}>
                        {damageLines.map((line, lineIndex) => (
                          <li key={`${line.name}:${lineIndex}`}>
                            <span>{line.name}{line.minion ? <small> · minion</small> : null}</span>
                            <b>{formatStat(line.value, "short")}</b>
                            <small>{line.perHit ? (vi ? "/đòn" : "per hit") : "DPS"}</small>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {monsterLibrary && !compact ? (
                      <MonsterPicker library={monsterLibrary} value={skill.pobAttrs?.skillMinion} onPick={pickMonster} locale={locale} />
                    ) : null}
                    {!compact && !skill.disabled ? familyConflicts.map((conflict) => {
                      const names = conflict.gems.map((gem) => supportName(supports[gem]));
                      const kept = supportName(supports[conflict.kept]);
                      return (
                        <p className="sk-hint sk-hint--warn" role="alert" key={conflict.gems.join("-")}>
                          {vi
                            ? `${names.join(" và ")} cùng một họ gem hỗ trợ: trong game mỗi kỹ năng chỉ dùng được một gem của họ này. PoB chỉ tính ${kept}; hãy gỡ gem còn lại.`
                            : `${names.join(" and ")} are the same support family: only one of them works on a skill. PoB counts ${kept} only; remove the other.`}
                        </p>
                      );
                    }) : null}

                    {gemStripFor(skill.id, "main")}

                    {!compact ? (
                      <div className="sk-supports" role="list" aria-label={vi ? "Gem hỗ trợ" : "Supports"}>
                        {supports.map((support) => {
                          const supportIcon = support.skillId ? gemChoiceIcon(support.skillId, supportGemOptions, "SupportGem") : "";
                          const label = support.skillId ? gemChoiceLabel(support.skillId, supportGemOptions, "SupportGem", locale, support.nameSpec || "") : (vi ? "Ô trống" : "Empty");
                          const hovered = hoveredSupport?.skillId === skill.id && hoveredSupport.supportId === support.id;
                          const keys = hovered ? hoveredSupport.keys : null;
                          return (
                            <span className={`sk-support ${support.disabled ? "is-disabled" : ""} ${supersededSupports.has(support.id) ? "is-superseded" : ""} ${gemStrip?.supportId === support.id ? "is-open" : ""}`} role="listitem" key={support.id}
                              title={supersededSupports.has(support.id) ? (vi ? "Không có tác dụng: nhóm đã có gem khác cùng họ" : "No effect: another support of the same family is socketed") : undefined}
                              onMouseEnter={() => setHoveredSupport({
                                skillId: skill.id,
                                supportId: support.id,
                                // Queues "this group with and without the support" (one at a time, cached).
                                keys: support.skillId && !support.disabled && !skill.disabled ? supportValueKeys(skill.id, support.id) : null
                              })}
                              onMouseLeave={() => setHoveredSupport(null)}
                            >
                              <button type="button" className="sk-support-gem" onClick={() => toggleGemStrip(skill.id, support.id)} aria-label={`${label} — ${vi ? "bấm để đổi" : "click to swap"}`}>
                                {/* Initials stay underneath: they show when the icon is missing or fails to load. */}
                                {support.skillId ? <span className="sk-support-initial" aria-hidden="true">{label.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</span> : <span className="material-symbols-rounded" aria-hidden="true">add</span>}
                                {supportIcon ? <img src={supportIcon} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                              </button>
                              <button type="button" className="sk-support-remove" onClick={() => removeSupportSkill(skill.id, support.id)} aria-label={vi ? `Gỡ ${label}` : `Remove ${label}`} title={vi ? "Gỡ gem này" : "Remove"}>
                                <span className="material-symbols-rounded" aria-hidden="true">close</span>
                              </button>
                              {hovered ? (
                                <span className="sk-support-tip" role="tooltip">
                                  <b>{label}</b>
                                  {support.gemLevel ? <small> · Lv {support.gemLevel}</small> : null}
                                  {support.disabled ? <span className="sk-value">{vi ? "Đang tắt" : "Disabled"}</span> : keys ? <SupportValue queue={compareQueue} withKey={keys.withKey} withoutKey={keys.withoutKey} locale={locale} /> : null}
                                </span>
                              ) : null}
                            </span>
                          );
                        })}
                        {freeSockets > 0 ? (
                          <button type="button" className="sk-support-add" onClick={() => addSupportSkill(skill.id)} title={vi ? "Thêm gem hỗ trợ (gợi ý theo DPS tăng thêm)" : "Add a support (ranked by DPS gain)"}>
                            <span className="material-symbols-rounded" aria-hidden="true">add</span>
                            <small>{vi ? `còn ${freeSockets} ô` : `${freeSockets} free`}</small>
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {gemStrip && gemStrip.skillId === skill.id && gemStrip.supportId !== "main" ? gemStripFor(skill.id, gemStrip.supportId) : null}

                    <div className="sk-actions">
                      {skill.skillId ? (
                        <button
                          type="button"
                          className={`sk-toggle ${skill.disabled ? "" : "is-on"}`}
                          onClick={() => updateBuildSkill(skill.id, { disabled: !skill.disabled })}
                          aria-pressed={!skill.disabled}
                          title={vi ? (skill.disabled ? "Nhóm đang tắt — bấm để bật lại" : "Tắt nhóm này (không tính vào chỉ số)") : "Enable / disable"}
                        >
                          <span className="material-symbols-rounded" aria-hidden="true">{skill.disabled ? "toggle_off" : "toggle_on"}</span>
                          {skill.disabled ? (vi ? "Đang tắt" : "Off") : (vi ? "Đang bật" : "On")}
                        </button>
                      ) : null}
                      {skill.skillId && !compact ? gemLevelControls(skill, (patch) => updateBuildSkill(skill.id, patch)) : null}
                      <span className="sk-gap" />
                      {skill.skillId ? (
                        <button type="button" className="sk-link" onClick={() => setExpandedSkill(expanded ? null : skill.id)} aria-expanded={expanded}>
                          {vi ? "Chi tiết" : "Details"}
                          <span className="material-symbols-rounded" aria-hidden="true">{expanded ? "expand_less" : "expand_more"}</span>
                        </button>
                      ) : null}
                      <button type="button" className="nj-icon-btn nj-icon-btn--danger" onClick={() => removeBuildSkill(skill.id)} title={vi ? "Xóa nhóm kỹ năng" : "Remove group"}>
                        <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                      </button>
                    </div>

                    {expanded ? (
                      <div className="sk-details">
                        {details ? (
                          <>
                            {damageTotal > 0 ? (
                              <div className="sk-damage">
                                <i className="sk-damage-bar">
                                  {damageParts.map(([cls, , value]) => <b className={cls} style={{ width: `${(value / damageTotal) * 100}%` }} key={cls} />)}
                                </i>
                                <span>{damageParts.map(([cls, label, value]) => <span className={cls.replace("nj-dps-", "nj-c-")} key={cls}>{label} {Math.round((value / damageTotal) * 100)}%</span>)}</span>
                              </div>
                            ) : null}
                            <dl className="sk-facts">
                              {Number(details.Speed) > 0 ? <><dt>{vi ? "Tốc độ" : "Speed"}</dt><dd>{formatStat(Number(details.Speed), "speed")}</dd></> : null}
                              {Number(details.CritChance) > 0 ? <><dt>{vi ? "Chí mạng" : "Crit"}</dt><dd>{formatStat(Number(details.CritChance), "pct1")}</dd></> : null}
                              {details.HitChance !== undefined ? <><dt>{vi ? "Trúng" : "Hit"}</dt><dd>{formatStat(Number(details.HitChance), "pct")}</dd></> : null}
                              {Number(details.AverageDamage) > 0 ? <><dt>{vi ? "Mỗi đòn" : "Per hit"}</dt><dd>{formatStat(Number(details.AverageDamage), "short")}</dd></> : null}
                              {Number(details.ManaCost) > 0 ? <><dt>Mana</dt><dd>{formatStat(Number(details.ManaCost), "int")}</dd></> : null}
                            </dl>
                          </>
                        ) : (
                          <p className="sk-note">{vi ? "Bấm số DPS (ngôi sao) để chọn làm kỹ năng chính và xem chi tiết sát thương." : "Make it the main skill to see its damage breakdown."}</p>
                        )}
                        {/* Granted skills (from an item or passive) are not gems you can corrupt. */}
                        {hasGemChoices(gemOptionFor(index)) || !(skill.itemSlot || skill.itemSource || gemOptionFor(index)?.grantedSkill) ? (
                          <div className="gx-main">
                            <span className="gx-title">
                              {vi ? "Tuỳ chọn gem" : "Gem options"}
                              <small>{vi ? " — như trong PoB, đổi là tính lại" : " — as in PoB, recalculates on change"}</small>
                            </span>
                            <GemOptionControls option={gemOptionFor(index)} attrs={skill.pobAttrs} locale={locale} corrupt={!(skill.itemSlot || skill.itemSource)} hideMinions={Boolean(monsterLibrary)}
                              onChange={(change: GemOptionChange) => updateBuildSkill(skill.id, { pobAttrs: withGemOption(skill.pobAttrs, change) })} />
                          </div>
                        ) : null}
                        {skill.supportSkills.length ? (
                          <ul className="sk-gem-list">
                            {skill.supportSkills.map((support) => {
                              const options = support.active ? skillGemOptions : supportGemOptions;
                              const prefix = support.active ? "SkillGem" : "SupportGem";
                              return (
                                <li key={support.id} className={support.disabled ? "is-disabled" : ""}>
                                  <span>{support.skillId ? gemChoiceLabel(support.skillId, options, prefix, locale, support.nameSpec || "") : (vi ? "Ô trống" : "Empty")}{support.active ? <small> · {vi ? "kỹ năng" : "skill"}</small> : null}</span>
                                  {support.skillId ? gemLevelControls(support, (patch) => updateSupportSkill(skill.id, support.id, patch)) : null}
                                  {support.skillId ? (
                                    <GemOptionControls option={gemOptionFor(index, support.id)} attrs={support.pobAttrs} locale={locale} corrupt={Boolean(support.active)}
                                      onChange={(change: GemOptionChange) => updateSupportSkill(skill.id, support.id, { pobAttrs: withGemOption(support.pobAttrs, change) })} />
                                  ) : null}
                                  {support.skillId ? (
                                    <button type="button" className={`nj-icon-btn ${support.disabled ? "" : "is-on"}`} onClick={() => updateSupportSkill(skill.id, support.id, { disabled: !support.disabled })} aria-pressed={!support.disabled} title={vi ? "Bật / tắt gem" : "Enable / disable"}>
                                      <span className="material-symbols-rounded" aria-hidden="true">{support.disabled ? "toggle_off" : "toggle_on"}</span>
                                    </button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              };
              return (
                <>
                  <div className="sk-grid">{arranged.primary.map((index) => renderCard(index))}</div>
                  {arranged.secondary.length ? (
                    <details className="sk-secondary">
                      <summary>
                        {vi ? `Kỹ năng phụ (${arranged.secondary.length})` : `Other skills (${arranged.secondary.length})`}
                        <small>{vi ? " — aura, buff, kỹ năng không gây sát thương và nhóm đang tắt" : " — auras, buffs, no-damage and disabled groups"}</small>
                      </summary>
                      <div className="sk-grid sk-grid--compact">{arranged.secondary.map((index) => renderCard(index, true))}</div>
                    </details>
                  ) : null}
                </>
              );
            })() : (
              <div className="build-empty" style={{ padding: "24px" }}>
                <span className="material-symbols-rounded" style={{ fontSize: "36px" }}>auto_awesome_motion</span>
                <p>{localizedText(copy.noSkills, "", locale)}</p>
                <button type="button" onClick={addBuildSkill} className="build-btn build-btn--primary">
                  <span className="material-symbols-rounded">add</span>
                  {localizedText(copy.addSkill, "", locale)}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Row: detailed numbers from Path of Building | the conditions it assumes */}
        <div className="nj-row nj-row--calc">
          <section className="nj-panel nj-calc-details">
            <header className="nj-panel-head">
              <h2>{locale === "vi" ? "Chỉ số chi tiết" : "Detailed stats"}</h2>
              <span className="nj-panel-aside">{isCalculating ? (locale === "vi" ? "Đang tính..." : "Calculating...") : (locale === "vi" ? "Tính bằng Path of Building" : "Calculated by Path of Building")}</span>
            </header>
            <div className="nj-panel-body">
              <BuildSummonStats stats={activeStats} previous={previousStats} locale={locale} />
              <BuildStatDetails stats={activeStats} previous={previousStats} locale={locale} calculating={isCalculating} onExplain={setExplainStat} />
            </div>
          </section>
          <section className="nj-panel nj-calc-config">
            <header className="nj-panel-head">
              <h2>{locale === "vi" ? "Điều kiện tính" : "Conditions"}</h2>
            </header>
            <div className="nj-panel-body">
              <BuildConfigPanel
                inputs={effectiveConfigInputs}
                onChange={setConfigInputs}
                onReset={() => setConfigInputs(null)}
                changed={configInputs !== null}
                locale={locale}
              />
            </div>

        {/* Name and author: a slim full-width row at the end, so the tree above gets the whole width. */}
        <section className="nj-panel nj-info nj-info--row">
          <header className="nj-panel-head">
            <h2>{localizedText(copy.details, "", locale)}</h2>
          </header>
          <div className="nj-panel-body">
            <label className="nj-field">
              <span>{localizedText(copy.buildName, "", locale)}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Titan Slam Leveling" />
            </label>
            <label className="nj-field">
              <span>{localizedText(copy.author, "", locale)}</span>
              <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder={locale === "vi" ? "Tên bạn (không bắt buộc)" : "Your name (optional)"} />
            </label>
            <p className="nj-info-hint">{localizedText(copy.howStepDownload, "", locale)} {localizedText(copy.howStepSave, "", locale)} <code>Documents\My Games\Path of Exile 2\BuildPlanner\</code></p>
          </div>
        </section>
          </section>
        </div>
      </section>
      )}

      {pobImportOpen ? (
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
                <button type="button" onClick={() => setPobImportOpen(false)} disabled={pobImporting}>{locale === "vi" ? "Đóng" : "Close"}</button>
                <button type="button" onClick={importPobCode} disabled={!isPobExportCode(pobCode) || pobImporting}>
                  <span className="material-symbols-rounded" aria-hidden="true">download_for_offline</span>
                  {pobImporting ? (locale === "vi" ? "Đang import..." : "Importing...") : localizedText(copy.pobImportAction, "", locale)}
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
                  <button className="build-picker-result build-gem-result build-gem-choice" type="button" onClick={() => selectGem(item)} key={`${item.menu_key}:${item.slug ?? item.name}`}>
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

      {editorTarget && modPool && editorModel ? (
        <ItemEditor
          key={editorTarget.kind === "stash" ? editorTarget.id : editorTarget.kind === "slot" ? editorTarget.slotId : "new"}
          pool={modPool}
          text={editorModel.text}
          originalText={editorModel.originalText}
          title={editorModel.title}
          locale={locale}
          onLive={editorTarget.kind === "slot" ? (text) => setSlotText(editorTarget.slotId, text) : undefined}
          onSave={saveEditor}
          onCancel={cancelEditor}
          onReset={editorModel.canReset ? resetEditor : undefined}
        />
      ) : null}
      {explainStat ? <StatBreakdownDialog queue={compareQueue} body={currentCalculationBody()} target={explainStat} locale={locale} onClose={() => setExplainStat(null)} /> : null}
      {newItemOpen ? <NewItemDialog choices={newItemChoices} locale={locale} onPick={pickNewItem} onCancel={() => setNewItemOpen(false)} /> : null}

      {tooltip.visible && (
        <div ref={tooltipRef} className="poe-tooltip-float poe-no-tooltip" style={{
          position: "fixed",
          left: 0,
          top: 0,
          pointerEvents: "none",
          zIndex: 9999,
          maxWidth: "400px"
        }}>
          <div dangerouslySetInnerHTML={{ __html: markVietnameseRuns(tooltip.content) }} />
          {tooltip.compare ? <CompareBlock queue={compareQueue} spec={tooltip.compare} locale={locale} /> : null}
        </div>
      )}
    </main>
  );
}
