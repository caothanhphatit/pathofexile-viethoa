import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBaseItems,
  compareWithWeb,
  expectedLines,
  iconUrlFromDds,
  isPoe2Id,
  isUniqueOnlyBase,
  pickCanonical
} from "../scripts/ggpk/extract-base-items.mjs";
import { columnLayout, parseTable } from "../scripts/ggpk/reader.mjs";

// Synthetic tables shaped like the decoded GGPK rows (foreign keys are row indexes).
const tables = () => ({
  ItemClasses: [{ _index: 0, Name: "Helmets" }, { _index: 1, Name: "One Hand Maces" }, { _index: 2, Name: "Stackable Currency" }],
  Tags: [{ _index: 0, Id: "str_dex_armour" }],
  Stats: [{ _index: 0, Id: "local_weapon_implicit_hidden_%_base_damage_is_fire" }],
  Mods: [{ _index: 0, Id: "MaceImplicitFireDamage1", Stat1: 0, Stat1Value: 50 }],
  ItemVisualIdentity: [{ _index: 0, DDSFile: "Art/2DItems/Armours/Helmets/Basetypes/HelmetStrDex08.dds" }, { _index: 1, DDSFile: "Art/2DItems/Weapons/OneHandWeapons/OneHandMaces/OneHandMace2.dds" }],
  BaseItemTypes: [
    { _index: 0, Id: "Metadata/Items/Armours/Helmets/FourHelmetStrDexUnique1", Name: "Ancient Visor", ItemClass: 0, Width: 2, Height: 2, DropLevel: 65, Tags: [0], Implicit_Mods: [], ItemVisualIdentity: 0 },
    { _index: 1, Id: "Metadata/Items/Armours/Helmets/FourHelmetStrDex8", Name: "Ancient Visor", ItemClass: 0, Width: 2, Height: 2, DropLevel: 65, Tags: [0], Implicit_Mods: [], ItemVisualIdentity: 0 },
    { _index: 2, Id: "Metadata/Items/Weapons/OneHandWeapons/OneHandMaces/FourOneHandMace2Cruel", Name: "Calescent Hammer", ItemClass: 1, Width: 2, Height: 3, DropLevel: 45, Tags: [], Implicit_Mods: [0], ItemVisualIdentity: 1 },
    { _index: 3, Id: "Metadata/Items/Currency/CurrencyRerollRare", Name: "Chaos Orb", ItemClass: 2, Width: 1, Height: 1, DropLevel: 1, Tags: [], Implicit_Mods: [], ItemVisualIdentity: null }
  ],
  ArmourTypes: [{ BaseItemType: 1, Armour: 179, Evasion: 163, EnergyShield: 0, IncreasedMovementSpeed: 0 }],
  WeaponTypes: [{ BaseItemType: 2, CritChance: 500, Speed: 690, DamageMin: 44, DamageMax: 74, RangeMax: 13, ReloadTime: 0 }],
  ShieldTypes: [],
  AttributeRequirements: [{ BaseItemType: 1, ReqStr: 59, ReqDex: 59, ReqInt: 0 }, { BaseItemType: 2, ReqStr: 80, ReqDex: 0, ReqInt: 0 }]
});

test("id helpers recognise PoE2 ids and unique-only bases", () => {
  assert.ok(isPoe2Id("Metadata/Items/Armours/Helmets/FourHelmetStrDex8"));
  assert.ok(!isPoe2Id("Metadata/Items/Weapons/OneHandWeapons/OneHandSwords/StormBladeOneHand"));
  assert.ok(isUniqueOnlyBase("Metadata/Items/Armours/Helmets/FourHelmetStrDexUnique1"));
  assert.ok(isUniqueOnlyBase("Metadata/Items/Weapons/OneHandWeapons/OneHandMaces/FourOneHandMace13VerisiumUnique3"));
  assert.ok(!isUniqueOnlyBase("Metadata/Items/Armours/Helmets/FourHelmetStrDex8"));
  assert.equal(iconUrlFromDds("Art/2DItems/Rings/Ring1.dds"), "https://cdn.poe2db.tw/image/Art/2DItems/Rings/Ring1.webp");
});

test("pickCanonical prefers the plain PoE2 base over unique-only and Cruel copies", () => {
  const picked = pickCanonical([
    { Id: "Metadata/Items/Armours/BodyArmours/FourBodyDexInt1Cruel", DropLevel: 45 },
    { Id: "Metadata/Items/Armours/BodyArmours/FourBodyDexInt8", DropLevel: 51 },
    { Id: "Metadata/Items/Armours/BodyArmours/FourBodyDexIntUnique1", DropLevel: 40 }
  ]);
  assert.equal(picked.Id, "Metadata/Items/Armours/BodyArmours/FourBodyDexInt8");
});

test("buildBaseItems keeps equipment only and resolves stats, icons and variants", () => {
  const records = buildBaseItems(tables());
  assert.deepEqual(records.map((r) => r.name), ["Ancient Visor", "Calescent Hammer"]);
  const visor = records.find((r) => r.name === "Ancient Visor");
  assert.equal(visor.id, "Metadata/Items/Armours/Helmets/FourHelmetStrDex8");
  assert.deepEqual(visor.defences, { armour: 179, evasion: 163, energy_shield: 0, movement_speed: 0 });
  assert.deepEqual(visor.requirements, { level: 65, str: 59, dex: 59, int: 0 });
  assert.deepEqual(visor.tags, ["str_dex_armour"]);
  assert.equal(visor.icon_url, "https://cdn.poe2db.tw/image/Art/2DItems/Armours/Helmets/Basetypes/HelmetStrDex08.webp");
  assert.deepEqual(visor.variant_ids, ["Metadata/Items/Armours/Helmets/FourHelmetStrDexUnique1"]);
});

test("weapon damage subtracts the share an implicit converts to an element", () => {
  const hammer = buildBaseItems(tables()).find((r) => r.name === "Calescent Hammer");
  assert.equal(hammer.weapon.physical_min, 22);
  assert.equal(hammer.weapon.physical_max, 37);
  assert.deepEqual(hammer.weapon.converted_damage, { fire: { percent: 50, min: 22, max: 37 } });
  assert.equal(hammer.weapon.crit_chance, 5);
  assert.equal(hammer.weapon.attacks_per_second, 1.45);
  assert.equal(hammer.weapon.range, 1.3);
  assert.deepEqual(hammer.implicit_mod_ids, ["MaceImplicitFireDamage1"]);
  assert.equal(expectedLines(hammer)["Physical Damage"], "22-37");
  assert.equal(expectedLines(hammer).Requires, "Level 45, 80 Str");
});

test("compareWithWeb counts agreements, variants and game-only bases", () => {
  const records = buildBaseItems(tables());
  const diff = compareWithWeb(records, [
    { name: "Ancient Visor", rarity: "", properties: ["Armour: 179", "Evasion Rating: 163"], requirements: ["Requires: Level 65, 59 Str, 59 Dex"], icon_url: "https://cdn.poe2db.tw/image/Art/2DItems/Armours/Helmets/Basetypes/HelmetStrDex08.webp" },
    { name: "Calescent Hammer", rarity: "", properties: ["Physical Damage: 22-37", "Critical Hit Chance: 5%", "Attacks per Second: 1.45"], requirements: [] }
  ]);
  assert.equal(diff.compared, 2);
  assert.equal(diff.identical, 2);
  assert.deepEqual(diff.onlyInGame, []);
  assert.deepEqual(diff.fieldDiffs, {});
});

test("reader parses fixed rows, strings and arrays and tolerates appended columns", () => {
  const table = { name: "T", columns: [{ name: "Id", type: "string" }, { name: "Level", type: "i32" }, { name: "Refs", type: "foreignrow", array: true }] };
  const layout = columnLayout(table);
  const width = layout.reduce((sum, c) => sum + c.width, 0) + 4; // 4 unknown trailing bytes
  const marker = Buffer.alloc(8, 0xbb);
  const str = Buffer.concat([Buffer.from("Abc", "utf16le"), Buffer.alloc(4)]);
  const refs = Buffer.alloc(32);
  refs.writeBigUInt64LE(7n, 0);
  refs.writeBigUInt64LE(9n, 16);
  const row = Buffer.alloc(width);
  row.writeBigUInt64LE(8n, 0); // string offset (after marker)
  row.writeInt32LE(42, 8);
  row.writeBigUInt64LE(2n, 12); // array count
  row.writeBigUInt64LE(BigInt(8 + str.length), 20); // array offset
  const head = Buffer.alloc(4);
  head.writeUInt32LE(1, 0);
  const buf = Buffer.concat([head, row, marker, str, refs]);
  const parsed = parseTable(buf, table);
  assert.equal(parsed.trailingBytes, 4);
  assert.deepEqual(parsed.rows[0], { _index: 0, Id: "Abc", Level: 42, Refs: [7, 9] });
});
