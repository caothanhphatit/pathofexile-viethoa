// Parse a Path of Building (PoE2) export code or share link into a build:
// allocated passive nodes + items + skill gems.
//
// A POB export code is the build's XML, zlib-deflated, then base64(url)-encoded.
// We decode it entirely in the browser with DecompressionStream — no extra deps.
// Share links (pobb.in / pastebin) are fetched for their raw code first.

export interface PobStat { stat: string; value: number; }

export interface PobGem {
  name: string;
  level: number;
  quality: number;
  enabled: boolean;
  support: boolean;
}

export interface PobSkillGroup {
  slot: string;
  label: string;
  source: string;
  enabled: boolean;
  gems: PobGem[];
}

export type PobItemCategory = "Weapon" | "Armour" | "Jewellery" | "Belt" | "Flask" | "Jewel" | "Other";

export interface PobItem {
  id: string;
  slot: string;
  category: PobItemCategory;
  rarity: string;
  name: string;
  baseType: string;
  itemLevel: number;
  corrupted: boolean;
  implicits: string[];
  explicits: string[];
  text: string;
}

export interface PobJewel { nodeId: string; itemId: string; name: string; }
export interface PobConfig { name: string; value: string; }

export interface PobBuild {
  className: string;
  ascendClassName: string;
  level: number;
  treeVersion: string;
  nodeIds: string[];
  masteries: string[];
  jewels: PobJewel[];
  stats: PobStat[];
  items: PobItem[];
  skills: PobSkillGroup[];
  configs: PobConfig[];
  spectres: string[];
  notes: string;
}

const base64ToBytes = (value: string): Uint8Array => {
  const norm = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Inflate raw bytes using the browser's streaming decompressor.
const inflate = async (bytes: Uint8Array, format: "deflate" | "deflate-raw"): Promise<string> => {
  const DS: any = (globalThis as any).DecompressionStream;
  if (typeof DS !== "function") throw new Error("Trình duyệt không hỗ trợ giải nén (DecompressionStream)");
  const ds = new DS(format);
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
};

// POB uses zlib (deflate with header); fall back to raw deflate just in case.
const decodePobXml = async (code: string): Promise<string> => {
  const clean = code.trim().replace(/\s+/g, "");
  if (!clean) throw new Error("Build code rỗng");
  const bytes = base64ToBytes(clean);
  try {
    return await inflate(bytes, "deflate");
  } catch {
    return await inflate(bytes, "deflate-raw");
  }
};

// pobb.in / pastebin share links expose a raw endpoint we can fetch the code from.
const rawUrlFor = (input: string): string | null => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const id = url.pathname.split("/").filter(Boolean)[0];
  if (!id) return null;
  if (host === "pobb.in") return `https://pobb.in/${id}/raw`;
  if (host === "pastebin.com") return `https://pastebin.com/raw/${id}`;
  if (host === "poe.ninja" && /\/pob\//.test(url.pathname)) return input;
  return null;
};

const resolveCode = async (input: string): Promise<string> => {
  const trimmed = input.trim();
  const rawUrl = rawUrlFor(trimmed);
  if (!rawUrl) return trimmed;
  let res: Response;
  try {
    res = await fetch(rawUrl);
  } catch {
    throw new Error("Không tải được link build (CORS). Hãy copy build code trực tiếp từ Path of Building rồi dán vào.");
  }
  if (!res.ok) throw new Error(`Link build trả về lỗi ${res.status}`);
  return (await res.text()).trim();
};

// Header/property lines in a POB item block that are not modifiers.
const ITEM_META = /^(Rarity|Unique ID|Item Level|Quality|Sockets|Requires|LevelReq|Implicits|Prefix|Suffix|Crafted|Selected Variant|Variant|League|Source|Limited to|Radius|Talisman Tier|Has |Catalyst|Energy Shield|Armour|Evasion|Ward|Physical Damage|Elemental Damage|Critical|Attacks per Second|Range|Reload|Rune):/i;
const ITEM_FLAGS = /^(Corrupted|Mirrored|Split|Synthesised Item|Fractured Item|Unidentified)$/i;

type ParsedItemText = { rarity: string; name: string; baseType: string; itemLevel: number; corrupted: boolean; implicits: string[]; explicits: string[]; };

const parseItemText = (text: string): ParsedItemText => {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: ParsedItemText = { rarity: "", name: "", baseType: "", itemLevel: 0, corrupted: false, implicits: [], explicits: [] };
  const rarityIdx = lines.findIndex((l) => /^Rarity:/i.test(l));
  if (rarityIdx < 0) {
    out.name = lines.find(Boolean) || "";
    return out;
  }
  out.rarity = lines[rarityIdx].replace(/^Rarity:\s*/i, "").toUpperCase();
  out.name = lines[rarityIdx + 1] || "";
  const named = /NORMAL|MAGIC/.test(out.rarity) === false;
  out.baseType = named ? (lines[rarityIdx + 2] || "") : "";
  let implicitsLeft = -1;            // -1 until we see "Implicits: N"
  for (let i = rarityIdx + (named ? 3 : 2); i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || /^-+$/.test(line)) continue;
    const ilvl = line.match(/^Item Level:\s*(\d+)/i);
    if (ilvl) { out.itemLevel = Number(ilvl[1]); continue; }
    const imp = line.match(/^Implicits:\s*(\d+)/i);
    if (imp) { implicitsLeft = Number(imp[1]); continue; }
    if (ITEM_FLAGS.test(line)) { if (/corrupt/i.test(line)) out.corrupted = true; continue; }
    if (ITEM_META.test(line)) continue;
    if (/^\{.*\}$/.test(line)) continue;           // {variant:...} / {crafted} tags
    if (implicitsLeft > 0) { out.implicits.push(line); implicitsLeft -= 1; continue; }
    out.explicits.push(line);
  }
  return out;
};

const SLOT_CATEGORY = (slot: string, baseType: string): PobItemCategory => {
  const s = `${slot} ${baseType}`.toLowerCase();
  if (/weapon|bow|wand|staff|sceptre|mace|axe|sword|dagger|claw|spear|flail|crossbow|quarterstaff/.test(s)) return "Weapon";
  if (/helmet|body armour|gloves|boots|shield|focus|quiver|buckler/.test(s)) return "Armour";
  if (/amulet|ring/.test(s)) return "Jewellery";
  if (/belt/.test(s)) return "Belt";
  if (/flask|charm/.test(s)) return "Flask";
  if (/jewel|socket/.test(s)) return "Jewel";
  return "Other";
};

const attrNum = (el: Element | null, name: string): number => Number(el?.getAttribute(name)) || 0;
const attrStr = (el: Element | null, name: string): string => el?.getAttribute(name) || "";

export const parsePobBuild = async (input: string): Promise<PobBuild> => {
  const code = await resolveCode(input);
  const xml = await decodePobXml(code);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  // PoE2 exports use <PathOfBuilding2>; PoE1 uses <PathOfBuilding>. This is a
  // PoE2 site, so only accept PoE2 codes (and explain if a PoE1 code is pasted).
  const root = doc.documentElement;
  const tag = (root?.tagName || "").toLowerCase();
  if (doc.querySelector("parsererror") || !root) {
    throw new Error("Không đọc được code — không phải Path of Building code hợp lệ");
  }
  if (tag === "pathofbuilding") {
    throw new Error("Đây là code Path of Building 1 (PoE1). Web này chỉ hỗ trợ POB của PoE2.");
  }
  if (tag !== "pathofbuilding2") {
    throw new Error("Không phải Path of Building (PoE2) code hợp lệ");
  }

  const buildEl = doc.querySelector("Build");
  const className = buildEl?.getAttribute("className") || "";
  const ascRaw = buildEl?.getAttribute("ascendClassName") || "";
  const ascendClassName = ascRaw && ascRaw !== "None" ? ascRaw : "";
  const level = attrNum(buildEl, "level");

  // Build-level player stats (DPS, Life, resistances, …).
  const stats: PobStat[] = [...doc.querySelectorAll("Build > PlayerStat")]
    .map((el) => ({ stat: attrStr(el, "stat"), value: Number(el.getAttribute("value")) || 0 }))
    .filter((s) => s.stat);

  // Active passive-tree spec → allocated node ids + masteries + jewel sockets.
  const treeEl = doc.querySelector("Tree");
  const specs = [...doc.querySelectorAll("Tree > Spec")];
  const activeSpec = attrNum(treeEl, "activeSpec") || 1;
  const spec = specs[activeSpec - 1] || specs[0] || null;
  const treeVersion = spec?.getAttribute("treeVersion") || "";
  const nodeIds = (spec?.getAttribute("nodes") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const masteries = (spec?.getAttribute("masteryEffects") || "").split(",").map((s) => s.trim()).filter(Boolean);

  // Items, mapped to the slots of the active item set.
  const itemsRoot = doc.querySelector("Items");
  const itemsById = new Map<string, PobItem>();
  for (const el of [...doc.querySelectorAll("Items > Item")]) {
    const id = el.getAttribute("id") || "";
    const text = (el.textContent || "").trim();
    if (!id || !text) continue;
    const parsed = parseItemText(text);
    itemsById.set(id, { id, slot: "", category: SLOT_CATEGORY("", parsed.baseType || parsed.name), text, ...parsed });
  }
  const itemSets = [...doc.querySelectorAll("Items > ItemSet")];
  const activeSetId = itemsRoot?.getAttribute("activeItemSet");
  const activeSet = itemSets.find((s) => s.getAttribute("id") === activeSetId) || itemSets[0] || null;
  const items: PobItem[] = [];
  const usedIds = new Set<string>();
  for (const slot of [...(activeSet?.querySelectorAll("Slot") || [])]) {
    const itemId = slot.getAttribute("itemId") || "";
    if (itemId === "0" || !itemId) continue;
    const item = itemsById.get(itemId);
    if (!item || usedIds.has(itemId)) continue;
    usedIds.add(itemId);
    const slotName = slot.getAttribute("name") || "";
    items.push({ ...item, slot: slotName, category: SLOT_CATEGORY(slotName, item.baseType || item.name) });
  }
  // Include any items not bound to a slot (e.g. no item set) so nothing is lost.
  for (const item of itemsById.values()) {
    if (!usedIds.has(item.id)) items.push(item);
  }

  // Jewels socketed into tree nodes → resolve to their item names.
  const jewels: PobJewel[] = [...(spec?.querySelectorAll("Sockets > Socket") || [])]
    .map((sock) => {
      const nodeId = attrStr(sock, "nodeId");
      const itemId = attrStr(sock, "itemId");
      return { nodeId, itemId, name: itemsById.get(itemId)?.name || "" };
    })
    .filter((j) => j.itemId && j.itemId !== "0" && j.name);

  // Config inputs (resistances cap, enemy level, flask/charge toggles, …).
  const configs: PobConfig[] = [...doc.querySelectorAll("Config Input")].map((el) => ({
    name: attrStr(el, "name"),
    value: attrStr(el, "number") || attrStr(el, "string") || attrStr(el, "boolean")
  })).filter((c) => c.name && c.value);

  // Spectres / companions declared at build level.
  const spectres = [...doc.querySelectorAll("Spectre")].map((el) => (el.textContent || attrStr(el, "id")).trim()).filter(Boolean);

  const notes = (doc.querySelector("Notes")?.textContent || "").trim();

  // Turn an internal id ("RighteousDescentPlayer", "Metadata/.../WildProtector")
  // into a readable name when a gem has no nameSpec (granted / companion skills).
  const prettifyId = (id: string): string => id
    .replace(/^.*[/.]/, "")                       // drop Metadata/.../ path
    .replace(/(Player|Support|Skill|Active)$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")       // camelCase -> spaced
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  const gemName = (g: Element): string => {
    const spec = (g.getAttribute("nameSpec") || "").trim();
    if (spec) return spec;
    const id = g.getAttribute("skillId") || g.getAttribute("gemId") || g.getAttribute("variantId")
      || g.getAttribute("skillMinionSkill") || g.getAttribute("skillMinion") || "";
    return prettifyId(id);
  };
  const groupFrom = (skill: Element): PobSkillGroup | null => {
    const grpEnabled = skill.getAttribute("enabled") !== "false";
    const gems: PobGem[] = [...skill.querySelectorAll("Gem")].map((g) => ({
      name: gemName(g),
      level: attrNum(g, "level"),
      quality: attrNum(g, "quality"),
      enabled: g.getAttribute("enabled") !== "false",
      support: /support/i.test(g.getAttribute("nameSpec") || "") || /support/i.test(g.getAttribute("skillId") || "")
    })).filter((g) => g.name);
    const label = skill.getAttribute("label") || "";
    const source = skill.getAttribute("source") || "";
    // Granted-from-tree/item groups (source set) often have no real gem — surface
    // the group label itself so the skill still shows up.
    if (!gems.length && (label || source)) {
      const granted = prettifyId(label || source);
      if (granted) gems.push({ name: granted, level: 0, quality: 0, enabled: grpEnabled, support: false });
    }
    if (!gems.length) return null;
    return { slot: skill.getAttribute("slot") || label || (source ? "Granted" : ""), label, source, enabled: grpEnabled, gems };
  };
  // Scan every skill set (not just the active one) so granted/extra skills are not missed.
  const skillsRoot = doc.querySelector("Skills");
  const seenGroup = new Set<string>();
  const skills: PobSkillGroup[] = [];
  for (const skill of [...doc.querySelectorAll("Skills Skill")]) {
    const group = groupFrom(skill);
    if (!group) continue;
    const sig = `${group.slot}|${group.gems.map((x) => x.name).join(",")}`;
    if (seenGroup.has(sig)) continue;
    seenGroup.add(sig);
    skills.push(group);
  }

  return { className, ascendClassName, level, treeVersion, nodeIds, masteries, jewels, stats, items, skills, configs, spectres, notes };
};
