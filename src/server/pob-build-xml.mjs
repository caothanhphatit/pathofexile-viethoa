// Turns a Build Planner calculation request into the PathOfBuilding2 XML that
// scripts/pob-calculate.lua feeds to Path of Building. Pure (no I/O) so the
// route, the tests and scripts/check-pob-parity.mjs all build the same XML.
//
// Everything here ends up inside XML attributes or text, and the request body
// comes from the browser: every value is escaped, clamped or whitelisted.

export const escapeXml = (value) => {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

/** Site gem ids are either full game paths or short "Arc" / "SupportFoo" names. */
export const mapGemId = (skillId) => {
  const id = String(skillId || "");
  if (/^Metadata\//.test(id)) return id;
  if (id.startsWith("Support")) return `Metadata/Items/Gems/SupportGem${id.replace(/^Support/, "")}`;
  return `Metadata/Items/Gems/SkillGem${id}`;
};

/** Planner inventory id -> PoB item set slot name. */
export const POB_SLOT_NAMES = {
  Weapon1: "Weapon 1",
  Weapon2: "Weapon 2",
  Weapon3: "Weapon 1 Swap",
  Weapon4: "Weapon 2 Swap",
  Helm1: "Helmet",
  BodyArmour1: "Body Armour",
  Gloves1: "Gloves",
  Boots1: "Boots",
  Amulet1: "Amulet",
  Ring1: "Ring 1",
  Ring2: "Ring 2",
  Ring3: "Ring 3",
  Belt1: "Belt",
  LifeFlask1: "Flask 1",
  ManaFlask1: "Flask 2",
  Charm1: "Charm 1",
  Charm2: "Charm 2",
  Charm3: "Charm 3",
  Trinket1: "Trinket"
};

const CLASS_IDS = [
  ["witch", 1], ["ranger", 2], ["warrior", 6], ["sorceress", 7], ["sorcerer", 7],
  ["huntress", 8], ["mercenary", 9], ["monk", 10], ["druid", 11]
];

// [class, ascendancy name fragment, ascendClassId, ascendancyInternalId, PoB ascendancy name]
const ASCENDANCIES = [
  ["witch", "infernalist", 1, "Witch1", "Infernalist"], ["witch", "blood", 2, "Witch2", "Blood Mage"],
  ["witch", "abyssal", 4, "Witch3b", "Abyssal Lich"], ["witch", "lich", 3, "Witch3", "Lich"],
  ["ranger", "deadeye", 1, "Ranger1", "Deadeye"], ["ranger", "pathfinder", 2, "Ranger3", "Pathfinder"],
  ["warrior", "titan", 1, "Warrior1", "Titan"], ["warrior", "warbringer", 2, "Warrior2", "Warbringer"], ["warrior", "smith", 3, "Warrior3", "Smith of Kitava"],
  ["sorce", "stormweaver", 1, "Sorceress1", "Stormweaver"], ["sorce", "chronomancer", 2, "Sorceress2", "Chronomancer"], ["sorce", "disciple", 3, "Sorceress3", "Disciple of Varashta"],
  ["huntress", "amazon", 1, "Huntress1", "Amazon"], ["huntress", "spirit", 2, "Huntress2", "Spirit Walker"], ["huntress", "ritualist", 3, "Huntress3", "Ritualist"],
  ["mercenary", "tactician", 1, "Mercenary1", "Tactician"], ["mercenary", "witchhunter", 2, "Mercenary2", "Witchhunter"], ["mercenary", "gemling", 3, "Mercenary3", "Gemling Legionnaire"],
  ["monk", "martial", 1, "Monk1", "Martial Artist"], ["monk", "invoker", 2, "Monk2", "Invoker"], ["monk", "acolyte", 3, "Monk3", "Acolyte of Chayula"],
  ["druid", "oracle", 1, "Druid1", "Oracle"], ["druid", "shaman", 2, "Druid2", "Shaman"]
];

const classId = (className) => {
  const name = String(className || "").toLowerCase();
  return CLASS_IDS.find(([key]) => name.includes(key))?.[1] ?? 1;
};

/** Accepts the PoB name ("Blood Mage") or the game's internal id ("Witch2", what the planner exports). */
const ascendancy = (className, ascendancyName) => {
  const raw = String(ascendancyName || "").trim();
  const byId = ASCENDANCIES.find((row) => row[3].toLowerCase() === raw.toLowerCase());
  if (byId) return { id: byId[2], internalId: byId[3], name: byId[4] };
  const cls = String(className || "").toLowerCase();
  const asc = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!asc || asc === "none") return { id: 0, internalId: "nil", name: "None" };
  const row = ASCENDANCIES.find(([c, a]) => cls.includes(c) && asc.includes(a));
  return row ? { id: row[2], internalId: row[3], name: row[4] } : { id: 0, internalId: "nil", name: "None" };
};

const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const nodeIds = (value) => (Array.isArray(value) ? value : String(value || "").split(","))
  .map((id) => Number.parseInt(id, 10))
  .filter((id) => Number.isInteger(id) && id > 0);

// PoB ids are word characters plus a few separators; anything else is dropped.
const safeId = (value) => String(value || "").replace(/[^\w/.:-]/g, "");
const isTrue = (value, fallback = true) => (value === undefined || value === null ? fallback : value !== false && value !== "false");

/**
 * Config inputs ({ name, kind, value }) -> <Config>. `kind` is boolean, number or string,
 * as in PoB's ConfigSet <Input boolean=".." / number=".." / string=".."> elements.
 */
export const configXml = (inputs) => {
  if (!Array.isArray(inputs) || !inputs.length) return "";
  const rows = [];
  for (const input of inputs.slice(0, 400)) {
    if (!input || typeof input !== "object") continue;
    const name = String(input.name || "").slice(0, 120);
    if (!name) continue;
    const kind = input.kind === "number" || input.kind === "string" ? input.kind : "boolean";
    let value;
    if (kind === "boolean") {
      if (!isTrue(input.value, false)) continue;
      value = "true";
    } else if (kind === "number") {
      const n = Number(input.value);
      if (!Number.isFinite(n)) continue;
      value = String(n);
    } else {
      value = String(input.value ?? "").slice(0, 400);
    }
    rows.push(`<Input name="${escapeXml(name)}" ${kind}="${escapeXml(value)}"/>`);
  }
  if (!rows.length) return "";
  return `<Config activeConfigSet="1">\n\t\t<ConfigSet id="1" title="Default">\n\t\t\t${rows.join("\n\t\t\t")}\n\t\t</ConfigSet>\n\t</Config>`;
};

/** Keep in sync with POB_GEM_EXTRA_ATTRIBUTES in src/spa/lib/buildPlanner.ts. */
export const POB_GEM_EXTRA_ATTRIBUTES = [
  "corrupted", "corruptLevel", "count", "enableGlobal1", "enableGlobal2",
  "skillPart", "skillPartCalcs", "skillStageCount", "skillStageCountCalcs",
  "skillMineCount", "skillMineCountCalcs", "skillMinion", "skillMinionCalcs",
  "skillMinionItemSet", "skillMinionItemSetCalcs", "skillMinionSkill", "skillMinionSkillCalcs",
  "statSetIndex", "statSetIndexCalcs"
];

const gemXml = (gem) => {
  const siteId = String(gem.skill_id || "");
  // PoB looks a gem up by gemId and only falls back to skillId when gemId is absent,
  // so a granted skill known only by its PoB skillId ("ThornsPlayer") gets no gemId.
  const gemId = safeId(gem.pob_gem_id) || (gem.pob_skill_id ? "" : mapGemId(siteId));
  const attrs = [
    ["gemId", gemId],
    ["variantId", safeId(gem.pob_variant_id)],
    ["skillId", safeId(gem.pob_skill_id) || siteId],
    ["nameSpec", gem.name_spec ? String(gem.name_spec).slice(0, 80) : ""],
    ["level", clampInt(gem.level, 1, 40, 20)],
    ["quality", clampInt(gem.quality, 0, 50, 0)],
    ["count", clampInt(gem.count, 1, 20, 1)],
    ["enabled", isTrue(gem.enabled) ? "true" : "false"],
    ["enableGlobal1", "true"],
    ["enableGlobal2", "true"]
  ].filter(([, value]) => value !== "");
  // PoB's own per-gem settings from an import (corrupt level, skill part, minion...).
  const extra = gem.pob_attrs && typeof gem.pob_attrs === "object" ? gem.pob_attrs : {};
  for (const key of POB_GEM_EXTRA_ATTRIBUTES) {
    if (typeof extra[key] !== "string") continue;
    const value = extra[key].replace(/[^\w./ -]/g, "").slice(0, 80);
    const index = attrs.findIndex(([name]) => name === key);
    if (index >= 0) attrs[index] = [key, value];
    else attrs.push([key, value]);
  }
  return `<Gem ${attrs.map(([key, value]) => `${key}="${escapeXml(value)}"`).join(" ")}/>`;
};

const skillGroupXml = (group, fullDps = false) => {
  const gems = [gemXml(group), ...(Array.isArray(group.support) ? group.support : [])
    .filter((support) => support && support.skill_id)
    .map(gemXml)];
  const mainActive = clampInt(group.main_active_skill, 1, gems.length, 1);
  const attrs = [
    // group_enabled is the socket group; `enabled` on the same row is its own gem.
    ["enabled", isTrue(group.group_enabled ?? group.enabled) ? "true" : "false"],
    ["mainActiveSkill", mainActive],
    ["mainActiveSkillCalcs", mainActive]
  ];
  // PoB then lists this group's skills in SkillDPS, each with its own damage.
  if (fullDps) attrs.push(["includeInFullDPS", "true"]);
  const slotName = group.slot ? String(group.slot).replace(/[^A-Za-z0-9 ]/g, "").slice(0, 30) : "";
  if (slotName) attrs.push(["slot", slotName]);
  if (group.source) attrs.push(["source", String(group.source).slice(0, 160)]);
  return `\t\t\t<Skill ${attrs.map(([key, value]) => `${key}="${escapeXml(value)}"`).join(" ")}>\n\t\t\t\t${gems.join("\n\t\t\t\t")}\n\t\t\t</Skill>`;
};

/** Item text for a slot the user picked by name (no imported text). */
const syntheticItemText = (slot) => [
  `Rarity: ${slot.is_unique ? "Unique" : "Rare"}`,
  slot.item_name,
  ...(slot.note ? String(slot.note).split("\n").map((line) => line.trim()).filter(Boolean) : [])
].join("\n");

export function buildPobXml(build = {}) {
  const level = clampInt(build.level, 1, 100, 90);
  const className = String(build.className || "Witch").replace(/[^A-Za-z ]/g, "") || "Witch";
  const asc = ascendancy(className, String(build.ascendancy || "None").slice(0, 60));
  const ascendClassName = asc.name;
  const cId = classId(className);
  const passives = nodeIds(build.passives);
  const weaponSetPassives = build.weapon_set_passives && typeof build.weapon_set_passives === "object" ? build.weapon_set_passives : {};
  const useSecondWeaponSet = Number(build.activeWeaponSet) === 2;

  const items = [];
  const slots = [];
  const sockets = [];
  let itemCounter = 1;
  for (const slot of Array.isArray(build.inventory_slots) ? build.inventory_slots : []) {
    if (!slot || typeof slot.inventory_id !== "string") continue;
    const text = slot.raw_text || (slot.item_name ? syntheticItemText(slot) : "");
    if (!text) continue;
    const jewelNode = slot.inventory_id.match(/^PassiveJewel:(\d+)$/)?.[1];
    // "PobSlot:Arm 1", "PobSlot:Gloves Jewel Socket 1": PoB slots without a doll position.
    const extraSlot = slot.inventory_id.match(/^PobSlot:((?:Arm|Leg) \d|[A-Za-z ]+ Jewel Socket \d)$/)?.[1];
    const slotName = POB_SLOT_NAMES[slot.inventory_id] || extraSlot;
    if (!jewelNode && !slotName) continue;
    const itemId = itemCounter++;
    items.push(`\t\t<Item id="${itemId}">\n${escapeXml(String(text).slice(0, 20000))}\n\t\t</Item>`);
    if (jewelNode) {
      sockets.push(`<Socket nodeId="${jewelNode}" itemId="${itemId}"/>`);
    } else {
      const usable = /^(Flask|Charm)/.test(slotName);
      const active = usable && isTrue(slot.active) ? ' active="true"' : "";
      slots.push(`<Slot name="${slotName}" itemId="${itemId}"${active}/>`);
    }
  }

  const skillGroups = (Array.isArray(build.skills) ? build.skills : [])
    .filter((group) => group && group.skill_id)
    .map((group) => skillGroupXml(group, build.full_dps !== false));

  const mainSocketGroup = clampInt(build.main_socket_group, 1, Math.max(skillGroups.length, 1), 1);
  const attrOverride = build.attribute_overrides && typeof build.attribute_overrides === "object" ? build.attribute_overrides : null;
  const overridesXml = attrOverride ? `
			<Overrides>
				<AttributeOverride dexNodes="${nodeIds(attrOverride.dexNodes).join(",")}" intNodes="${nodeIds(attrOverride.intNodes).join(",")}" strNodes="${nodeIds(attrOverride.strNodes).join(",")}"/>
			</Overrides>` : "";
  const weaponSetXml = [1, 2]
    .map((set) => nodeIds(weaponSetPassives[set] ?? weaponSetPassives[String(set)]))
    .map((ids, index) => (ids.length ? `\n\t\t\t<WeaponSet${index + 1} nodes="${ids.join(",")}"/>` : ""))
    .join("");

  const config = configXml(build.config_inputs)
    // Older clients send the raw <Config> element from the PoB code.
    || (typeof build.config === "string" && /^\s*<Config[\s>]/.test(build.config) ? build.config : "");

  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
	<Build level="${level}" targetVersion="0_1" className="${escapeXml(className)}" ascendClassName="${escapeXml(ascendClassName)}" viewMode="ITEMS" mainSocketGroup="${mainSocketGroup}">
	</Build>
	<Items activeItemSet="1" useSecondWeaponSet="${useSecondWeaponSet}">
${items.join("\n")}
		<ItemSet id="1" useSecondWeaponSet="${useSecondWeaponSet}">
			${slots.join("\n\t\t\t")}
		</ItemSet>
	</Items>
	<Skills activeSkillSet="1">
		<SkillSet id="1">
${skillGroups.join("\n")}
		</SkillSet>
	</Skills>
	<Tree activeSpec="1">
		<Spec treeVersion="0_5" nodes="${passives.join(",")}" classId="${cId}" classInternalId="${cId}" ascendClassId="${asc.id}" ascendancyInternalId="${asc.internalId}">${weaponSetXml}${overridesXml}
			<Sockets>
				${sockets.join("\n\t\t\t\t")}
			</Sockets>
		</Spec>
	</Tree>
	${config}
</PathOfBuilding2>
`;
}
