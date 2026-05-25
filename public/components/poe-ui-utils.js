(() => {
  const DEFAULT_LOCALE = "vi";
  const LOCALE_STORAGE_KEY = "poe-locale";
  const PUBLIC_SITE_ORIGIN = "https://poeviethoa.net";
  const SUPPORTED_LOCALES = ["vi", "en"];
  const UI_TEXT = {
    allGroups: { vi: "Tất cả nhóm", en: "All groups" },
    allItemGroups: { vi: "Tất cả nhóm item", en: "All item groups" },
    allSubtypes: { vi: "Tất cả subtype", en: "All subtypes" },
    allTags: { vi: "Tất cả tag", en: "All tags" },
    allTiers: { vi: "Tất cả tier", en: "All tiers" },
    all: { vi: "Tất cả", en: "All" },
    backLookup: { vi: "Tra cứu", en: "Lookup" },
    close: { vi: "Đóng", en: "Close" },
    detail: { vi: "Chi tiết", en: "Details" },
    emptyCurrency: { vi: "Không có currency nào khớp bộ lọc.", en: "No currency matches the filters." },
    emptyGem: { vi: "Không có skill gem nào khớp bộ lọc.", en: "No skill gems match the filters." },
    emptyItem: { vi: "Không tìm thấy item phù hợp.", en: "No matching items found." },
    feedback: { vi: "Góp ý dịch", en: "Suggest translation" },
    loadMore: { vi: "Tải thêm", en: "Load more" },
    noGemDescription: { vi: "Xem chi tiết để đọc mô tả và chỉ số của skill này.", en: "Open details to read this skill gem's description and stats." },
    noGemModalDescription: { vi: "Không có mô tả cho skill gem này.", en: "No description is available for this skill gem." },
    noItemSummary: { vi: "Chưa có mô tả thuộc tính cho item này.", en: "No item property summary is available yet." },
    properties: { vi: "Chỉ số thuộc tính", en: "Properties" },
    requirements: { vi: "Yêu cầu", en: "Requirements" },
    resetFilters: { vi: "Xóa bộ lọc", en: "Reset filters" },
    source: { vi: "Nguồn", en: "Source" },
    skillDescription: { vi: "Mô tả kỹ năng", en: "Skill description" },
    skillEffects: { vi: "Hiệu ứng chi tiết", en: "Detailed effects" }
  };

  const normalizeLocale = (locale = "") => {
    const normalized = String(locale || "").toLowerCase().slice(0, 2);
    return SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE;
  };

  const storedLocale = () => {
    try {
      return localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      return null;
    }
  };

  const currentLocale = () => normalizeLocale(
    window.PoeLocale?.current?.()
      || document.documentElement.dataset.locale
      || document.documentElement.lang
      || storedLocale()
      || DEFAULT_LOCALE
  );

  const applyLocaleToDocument = (locale) => {
    const clean = normalizeLocale(locale);
    document.documentElement.lang = clean;
    document.documentElement.dataset.locale = clean;
    return clean;
  };

  const setLocale = (locale) => {
    const clean = applyLocaleToDocument(locale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, clean);
    } catch {
      // Locale switching still works for the current page if storage is blocked.
    }
    window.dispatchEvent(new CustomEvent("poe-locale-change", { detail: { locale: clean } }));
    return clean;
  };

  const onLocaleChange = (callback) => {
    const listener = (event) => callback(event.detail || { locale: currentLocale() });
    window.addEventListener("poe-locale-change", listener);
    return () => window.removeEventListener?.("poe-locale-change", listener);
  };

  const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));

  const i18nText = (entry, fallback = "", locale = currentLocale()) => {
    if (typeof entry === "string") return entry;
    const clean = normalizeLocale(locale);
    return entry?.[clean] || entry?.en || fallback || "";
  };

  const i18nList = (entries = [], fallback = [], locale = currentLocale()) => {
    const rows = Array.isArray(entries) && entries.length ? entries : [];
    return rows.length ? rows.map((entry, index) => i18nText(entry, fallback[index] || "", locale)) : fallback;
  };

  const localeText = (key, fallback = "", locale = currentLocale()) => i18nText(UI_TEXT[key], fallback || key, locale);

  const localeNumberCode = (locale = currentLocale()) => normalizeLocale(locale) === "en" ? "en-US" : "vi-VN";

  const formatNumber = (value, locale = currentLocale()) => new Intl.NumberFormat(localeNumberCode(locale)).format(value);

  const firstPresent = (values = []) => values.find((value) => String(value || "").trim());

  const truncateText = (value = "", { maxLength = 220, minBoundary = 110 } = {}) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (clean.length <= maxLength) return clean;
    const slice = clean.slice(0, maxLength - 3);
    const boundary = Math.max(
      slice.lastIndexOf("."),
      slice.lastIndexOf(";"),
      slice.lastIndexOf(","),
      slice.lastIndexOf(" ")
    );
    return `${slice.slice(0, boundary > minBoundary ? boundary : maxLength - 3).trim()}...`;
  };

  const setMetaContent = (selector, value) => {
    const element = document.querySelector(selector);
    const clean = String(value || "").trim();
    if (element && clean) element.setAttribute("content", clean);
  };

  const setLinkHref = (selector, value) => {
    const element = document.querySelector(selector);
    const clean = String(value || "").trim();
    if (element && clean) element.setAttribute("href", clean);
  };

  const absoluteUrl = (path = "/") => {
    try {
      return new URL(path, PUBLIC_SITE_ORIGIN).href;
    } catch {
      return String(path || "");
    }
  };

  const updateDocumentSeo = ({ title = "", description = "", canonicalPath = "", image = "" } = {}) => {
    const cleanTitle = String(title || "").trim();
    const cleanDescription = truncateText(description, { maxLength: 158, minBoundary: 90 });
    const canonicalUrl = canonicalPath ? absoluteUrl(canonicalPath) : "";
    const imageUrl = image ? absoluteUrl(image) : "";

    if (cleanTitle) document.title = cleanTitle;
    setMetaContent('meta[name="description"]', cleanDescription);
    setMetaContent('meta[property="og:title"]', cleanTitle);
    setMetaContent('meta[property="og:description"]', cleanDescription);
    setMetaContent('meta[name="twitter:title"]', cleanTitle);
    setMetaContent('meta[name="twitter:description"]', cleanDescription);
    setMetaContent('meta[property="og:url"]', canonicalUrl);
    setLinkHref('link[rel="canonical"]', canonicalUrl);
    setLinkHref('link[rel="alternate"][hreflang="vi"]', canonicalUrl);
    setMetaContent('meta[property="og:image"]', imageUrl);
    setMetaContent('meta[name="twitter:image"]', imageUrl);
  };

  const hasCurrencyDescription = (item) => {
    if (!item) return false;
    if (item.subtype || item.family) return true;
    return Boolean(firstPresent([
      item.description_en,
      i18nText(item.i18n?.description, ""),
      ...(item.mods || []),
      ...i18nList(item.i18n?.mods, [])
    ]));
  };

  const currencySubtype = (item = {}) => item.subtype || item.family || item.category || "";

  const currencySubtypeLabel = (item = {}) => i18nText(
    item.i18n?.subtype_label,
    item.subtype_label || item.family_label || item.category_label || ""
  );

  const currencyCategoryLabel = (item = {}) => i18nText(item.i18n?.category_label, item.category_label || "");

  window.PoeUi = {
    DEFAULT_LOCALE,
    LOCALE_STORAGE_KEY,
    PUBLIC_SITE_ORIGIN,
    SUPPORTED_LOCALES,
    normalizeLocale,
    currentLocale,
    setLocale,
    onLocaleChange,
    localeText,
    formatNumber,
    escapeHtml,
    i18nText,
    i18nList,
    firstPresent,
    truncateText,
    updateDocumentSeo,
    hasCurrencyDescription,
    currencySubtype,
    currencySubtypeLabel,
    currencyCategoryLabel
  };
})();
