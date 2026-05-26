export type Locale = "vi" | "en";

export const DEFAULT_LOCALE: Locale = "vi";
export const SUPPORTED_LOCALES: Locale[] = ["vi", "en"];

type LocalizedValue = {
  en?: unknown;
  vi?: unknown;
};

const cleanText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export function normalizeLocale(value: unknown): Locale {
  const normalized = String(value || "").toLowerCase().slice(0, 2);
  return normalized === "en" ? "en" : DEFAULT_LOCALE;
}

export function localeNumberCode(locale: unknown): string {
  return normalizeLocale(locale) === "en" ? "en-US" : "vi-VN";
}

export function formatNumber(value: number, locale: unknown): string {
  return new Intl.NumberFormat(localeNumberCode(locale)).format(value);
}

export function localizedText(entry: unknown, fallback = "", locale: unknown = DEFAULT_LOCALE): string {
  if (typeof entry === "string") return cleanText(entry);
  const cleanLocale = normalizeLocale(locale);
  const row = (entry && typeof entry === "object" ? entry : {}) as LocalizedValue;
  const rawFallback = cleanText(fallback);
  const english = cleanText(row.en);
  const vietnamese = cleanText(row.vi);

  if (cleanLocale === "en") return english || rawFallback || vietnamese || "";
  return vietnamese || english || rawFallback || "";
}

export function localizedList(entries: unknown, fallback: unknown = [], locale: unknown = DEFAULT_LOCALE): string[] {
  const rawFallback = Array.isArray(fallback) ? fallback.map(cleanText).filter(Boolean) : [];
  if (!Array.isArray(entries) || !entries.length) return rawFallback;

  return entries
    .map((entry, index) => localizedText(entry, rawFallback[index] || "", locale))
    .filter(Boolean);
}

export function dictionaryMeaning(term: Record<string, unknown>, locale: unknown = DEFAULT_LOCALE): string {
  const english = cleanText(term.description_en);
  const vietnamese = cleanText(term.meaning);
  return normalizeLocale(locale) === "en" ? english || vietnamese : vietnamese || english;
}

const dictionaryCategories: Record<string, Record<Locale, string>> = {
  combat: { vi: "Chiến đấu", en: "Combat" },
  damage: { vi: "Sát thương & ailment", en: "Damage & ailments" },
  resource: { vi: "Tài nguyên", en: "Resources" },
  defense: { vi: "Phòng thủ", en: "Defence" },
  skill: { vi: "Skill & minion", en: "Skills & minions" },
  item: { vi: "Trang bị & craft", en: "Items & crafting" },
  endgame: { vi: "Endgame", en: "Endgame" }
};

export function dictionaryCategoryLabel(key: unknown, locale: unknown, fallback = ""): string {
  const id = cleanText(key);
  const labels = dictionaryCategories[id];
  if (labels) return labels[normalizeLocale(locale)];
  return cleanText(fallback) || id;
}

const uiCopy = {
  brand: { vi: "POE2 Việt hóa", en: "POE2 Reference" },
  language: { vi: "Ngôn ngữ", en: "Language" },
  mainNav: { vi: "Điều hướng chính", en: "Main navigation" },
  toggleTheme: { vi: "Đổi theme", en: "Toggle theme" },
  loadingData: { vi: "Đang tải dữ liệu...", en: "Loading data..." },
  loadingChecklist: { vi: "Đang tải checklist...", en: "Loading checklist..." },
  loadingPassiveTree: { vi: "Đang tải passive tree...", en: "Loading passive tree..." },
  loadingLegacy: { vi: "Đang tải nội dung...", en: "Loading content..." },
  loadFailed: { vi: "Không tải được dữ liệu", en: "Could not load data" },
  oldPageFailed: { vi: "Không tải được trang cũ", en: "Could not load the legacy page" },
  recordsReady: { vi: "bản ghi đang sẵn sàng tra cứu.", en: "records ready to search." },
  searchDefault: { vi: "Tìm kiếm...", en: "Search..." },
  notFoundGem: { vi: "Không tìm thấy skill gem.", en: "Skill gem not found." },
  notFoundCurrency: { vi: "Không tìm thấy currency.", en: "Currency not found." },
  properties: { vi: "Thuộc tính", en: "Properties" },
  requirements: { vi: "Yêu cầu", en: "Requirements" },
  mods: { vi: "Mods", en: "Mods" },
  effects: { vi: "Hiệu ứng", en: "Effects" }
} as const;

export type UiCopyKey = keyof typeof uiCopy;

export function uiText(key: UiCopyKey, locale: unknown, fallback = ""): string {
  return localizedText(uiCopy[key], fallback || key, locale);
}
