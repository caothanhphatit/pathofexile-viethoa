import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import {
  parseSkillGemDetailPage,
  translateSkillDetailLine,
  translateSkillName,
  translateSkillText,
  translateTags
} from "./skill-gems-lib.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://poe2db.tw/us/Support_Gems";
const EXPORT_PATH = path.join(ROOT_DIR, "public/data/skill-gems-data.js");

const hashJson = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const toAbsoluteUrl = (value = "", base = SOURCE_URL) => {
  const clean = String(value || "").trim();
  if (!clean) return "";
  try {
    return new URL(clean, base).toString();
  } catch {
    return clean;
  }
};

const colorByClass = (className = "") => {
  if (/\bgem_red\b/.test(className)) return "red";
  if (/\bgem_green\b/.test(className)) return "green";
  if (/\bgem_blue\b/.test(className)) return "blue";
  return "item";
};

const slugFromHref = (href = "", fallback = "") => {
  const clean = String(href || "").split("?")[0].replace(/^\/us\//, "").replace(/^\/+/, "");
  return decodeURIComponent(clean || fallback.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
};

const i18nText = (value = "", translator = (text) => text) => ({
  en: value,
  vi: value ? translator(value) || value : ""
});

const i18nList = (values = [], translator = (text) => text) => values.map((value) => ({
  en: value,
  vi: value ? translator(value) || value : ""
}));

const extractOfficialSupportId = (html = "") => (
  html.match(/Metadata\/Items\/Gems\/SupportGem[A-Za-z0-9_]+/)?.[0] || ""
);

const supportSuffixFromEffectName = (effectName = "") => {
  const clean = String(effectName || "").trim();
  if (!clean) return "";
  return clean.replace(/Support(One|Two|Three|Four|Five)?$/i, "$1");
};

const supportSuffixFromSlug = (slug = "") => {
  const clean = String(slug || "")
    .replace(/(?:^|_)(I|II|III|IV|V)$/i, (_, tier) => ({
      I: "",
      II: "Two",
      III: "Three",
      IV: "Four",
      V: "Five"
    })[String(tier).toUpperCase()] ?? "")
    .replace(/[^A-Za-z0-9]+/g, "");
  return clean;
};

const supportOfficialId = (gem) => {
  if (gem.official_id) return gem.official_id;
  try {
    const effectPath = new URL(gem.hover_url || "").searchParams.get("s") || "";
    const effectName = decodeURIComponent(effectPath).split(/[\\/]/).pop() || "";
    const suffix = supportSuffixFromEffectName(effectName);
    if (suffix) return `Metadata/Items/Gems/SupportGem${suffix}`;
  } catch {
    // Fall back to slug/name below.
  }
  const suffix = supportSuffixFromSlug(gem.slug || gem.name);
  return suffix ? `Metadata/Items/Gems/SupportGem${suffix}` : "";
};

const supportI18n = (gem, detail) => ({
  name: i18nText(gem.name, translateSkillName),
  tags: i18nList(gem.tags, (tag) => translateTags([tag])[0] || tag),
  summary: i18nText(detail.summary_en || "", translateSkillText),
  properties: i18nList(detail.properties || [], translateSkillDetailLine),
  requirements: i18nList(detail.requirements || [], translateSkillDetailLine),
  mods: i18nList(detail.mods || [], translateSkillDetailLine),
  sections: (detail.sections || []).map((section) => ({
    title: i18nText(section.title || "", translateSkillDetailLine),
    lines: i18nList(section.lines || [], translateSkillDetailLine)
  }))
});

const readCurrentSkillGemData = () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(EXPORT_PATH, "utf8"), sandbox);
  const data = sandbox.window.POE2_SKILL_GEMS;
  if (!data || !Array.isArray(data.gems)) throw new Error(`Could not read ${EXPORT_PATH}`);
  return data;
};

export function parseSupportGemsPage(html, sourceUrl = SOURCE_URL) {
  const $ = load(html);
  const rows = new Map();

  $("table").slice(0, 3).find("tbody tr").each((_, row) => {
    const tags = $(row).find("a.KeywordPopups").map((__, tag) => $(tag).text().trim()).get().filter(Boolean);
    $(row).find("a.gem_red, a.gem_green, a.gem_blue").each((__, link) => {
      const name = $(link).text().replace(/\s+/g, " ").trim();
      if (!name) return;
      const href = $(link).attr("href") || "";
      const hover = $(link).attr("data-hover") || "";
      const icon = $(row).find(`a[data-hover="${hover.replace(/"/g, '\\"')}"] img`).first().attr("src") || "";
      const slug = slugFromHref(href, name);
      const gem = {
        slug,
        name,
        gem_type: "support",
        tier: null,
        color: colorByClass($(link).attr("class") || ""),
        source_url: toAbsoluteUrl(href, sourceUrl),
        icon_url: toAbsoluteUrl(icon, sourceUrl),
        icon_alt: name,
        hover_url: toAbsoluteUrl(hover, sourceUrl),
        tags
      };
      gem.source_hash = hashJson(gem);
      rows.set(slug, gem);
    });
  });

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "poe2-vietnamese-gem-sot/1.0"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
};

const hydrateDetails = async (gems, { concurrency = 10 } = {}) => {
  const results = new Array(gems.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < gems.length) {
      const index = cursor;
      cursor += 1;
      const gem = gems[index];
      try {
      const html = await fetchText(gem.source_url);
      const detail = parseSkillGemDetailPage(html);
      results[index] = { ...gem, detail, official_id: extractOfficialSupportId(html) };
      } catch (error) {
        console.warn(`Failed to hydrate ${gem.name}: ${error.message}`);
        results[index] = { ...gem, detail: { summary_en: "", properties: [], requirements: [], mods: [], sections: [], source_hash: null } };
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
};

export const mergeSupportGemsIntoSkillData = async () => {
  const current = readCurrentSkillGemData();
  const supportRows = parseSupportGemsPage(await fetchText(SOURCE_URL), SOURCE_URL);
  if (supportRows.length < 300) throw new Error(`Expected support gem data, got ${supportRows.length} rows.`);

  const supports = (await hydrateDetails(supportRows)).map((gem) => {
    const detail = gem.detail || {};
    const row = {
      slug: gem.slug,
      name: gem.name,
      gem_type: "support",
      tier: gem.tier,
      color: gem.color,
      source_url: gem.source_url,
      icon_url: gem.icon_url,
      icon_alt: gem.icon_alt,
      hover_url: gem.hover_url,
      official_id: supportOfficialId(gem),
      tags: gem.tags,
      source_hash: gem.source_hash,
      status: "active",
      summary_en: detail.summary_en || "",
      properties: detail.properties || [],
      requirements: detail.requirements || [],
      mods: detail.mods || [],
      sections: detail.sections || [],
      i18n: supportI18n(gem, detail),
      detail_hash: detail.source_hash || null,
      updated_at: current.generated_at || new Date().toISOString()
    };
    return row;
  });

  const active = current.gems
    .filter((gem) => gem.gem_type !== "support")
    .map((gem) => ({ ...gem, gem_type: gem.gem_type || "skill" }));
  const gems = [...active, ...supports].sort((a, b) =>
    (a.gem_type === b.gem_type ? 0 : a.gem_type === "skill" ? -1 : 1) ||
    (a.tier ?? 999) - (b.tier ?? 999) ||
    a.name.localeCompare(b.name)
  );
  const data = {
    ...current,
    generated_at: new Date().toISOString(),
    source_url: current.source_url || "https://poe2db.tw/us/Skill_Gems",
    support_source_url: SOURCE_URL,
    total: gems.length,
    active_total: active.length,
    support_total: supports.length,
    gems
  };

  fs.writeFileSync(EXPORT_PATH, `window.POE2_SKILL_GEMS = ${JSON.stringify(data, null, 2)};\n`, "utf8");
  return { exportPath: EXPORT_PATH, active: active.length, support: supports.length, total: gems.length };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  mergeSupportGemsIntoSkillData().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
