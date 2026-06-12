// Parse a Path of Building (PoE2) export code or share link into a build:
// allocated passive nodes + items + skill gems.
//
// A POB export code is the build's XML, zlib-deflated, then base64(url)-encoded.
// We decode it entirely in the browser with DecompressionStream — no extra deps.
// Share links (pobb.in / pastebin) are fetched for their raw code first.

export interface PobGem {
  name: string;
  level: number;
  quality: number;
  enabled: boolean;
}

export interface PobSkillGroup {
  slot: string;
  gems: PobGem[];
}

export interface PobItem {
  id: string;
  slot: string;
  rarity: string;
  name: string;
  baseType: string;
  text: string;
}

export interface PobBuild {
  className: string;
  ascendClassName: string;
  level: number;
  treeVersion: string;
  nodeIds: string[];
  items: PobItem[];
  skills: PobSkillGroup[];
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

const parseItemText = (text: string): { rarity: string; name: string; baseType: string } => {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rarityIdx = lines.findIndex((l) => /^Rarity:/i.test(l));
  if (rarityIdx < 0) {
    const first = lines.find(Boolean) || "";
    return { rarity: "", name: first, baseType: "" };
  }
  const rarity = lines[rarityIdx].replace(/^Rarity:\s*/i, "").toUpperCase();
  const name = lines[rarityIdx + 1] || "";
  const baseType = /NORMAL|MAGIC/.test(rarity) ? "" : (lines[rarityIdx + 2] || "");
  return { rarity, name, baseType };
};

const attrNum = (el: Element | null, name: string): number => Number(el?.getAttribute(name)) || 0;

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

  // Active passive-tree spec → allocated node ids.
  const treeEl = doc.querySelector("Tree");
  const specs = [...doc.querySelectorAll("Tree > Spec")];
  const activeSpec = attrNum(treeEl, "activeSpec") || 1;
  const spec = specs[activeSpec - 1] || specs[0] || null;
  const treeVersion = spec?.getAttribute("treeVersion") || "";
  const nodeIds = (spec?.getAttribute("nodes") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Items, mapped to the slots of the active item set.
  const itemsRoot = doc.querySelector("Items");
  const itemsById = new Map<string, PobItem>();
  for (const el of [...doc.querySelectorAll("Items > Item")]) {
    const id = el.getAttribute("id") || "";
    const text = (el.textContent || "").trim();
    if (!id || !text) continue;
    const parsed = parseItemText(text);
    itemsById.set(id, { id, slot: "", text, ...parsed });
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
    items.push({ ...item, slot: slot.getAttribute("name") || "" });
  }
  // Include any items not bound to a slot (e.g. no item set) so nothing is lost.
  for (const item of itemsById.values()) {
    if (!usedIds.has(item.id)) items.push(item);
  }

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
  const groupsFrom = (root: Element | null): PobSkillGroup[] => {
    const out: PobSkillGroup[] = [];
    for (const skill of [...(root?.querySelectorAll("Skill") || [])]) {
      const gems: PobGem[] = [...skill.querySelectorAll("Gem")].map((g) => ({
        name: gemName(g),
        level: attrNum(g, "level"),
        quality: attrNum(g, "quality"),
        enabled: g.getAttribute("enabled") !== "false"
      })).filter((g) => g.name);
      if (gems.length) out.push({ slot: skill.getAttribute("slot") || skill.getAttribute("label") || "", gems });
    }
    return out;
  };
  const skillsRoot = doc.querySelector("Skills");
  const skillSets = [...doc.querySelectorAll("Skills > SkillSet")];
  const activeSkillSetId = skillsRoot?.getAttribute("activeSkillSet");
  const activeSkillSet = skillSets.find((s) => s.getAttribute("id") === activeSkillSetId) || skillSets[0] || null;
  // Active set first; if it yields nothing, fall back to scanning everything so no gem is lost.
  let skills = groupsFrom(activeSkillSet || skillsRoot);
  if (!skills.length && skillsRoot) skills = groupsFrom(skillsRoot);

  return { className, ascendClassName, level, treeVersion, nodeIds, items, skills };
};
