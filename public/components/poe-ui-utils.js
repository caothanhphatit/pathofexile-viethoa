(() => {
  const DEFAULT_LOCALE = "vi";

  const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));

  const i18nText = (entry, fallback = "", locale = DEFAULT_LOCALE) => {
    if (typeof entry === "string") return entry;
    return entry?.[locale] || entry?.en || fallback || "";
  };

  const i18nList = (entries = [], fallback = [], locale = DEFAULT_LOCALE) => {
    const rows = Array.isArray(entries) && entries.length ? entries : [];
    return rows.length ? rows.map((entry, index) => i18nText(entry, fallback[index] || "", locale)) : fallback;
  };

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

  const hasCurrencyDescription = (item) => Boolean(item && firstPresent([
    item.description_en,
    i18nText(item.i18n?.description, ""),
    ...(item.mods || []),
    ...i18nList(item.i18n?.mods, [])
  ]));

  const currencySubtype = (item = {}) => item.subtype || item.family || item.category || "";

  const currencySubtypeLabel = (item = {}) => i18nText(
    item.i18n?.subtype_label,
    item.subtype_label || item.family_label || item.category_label || ""
  );

  const currencyCategoryLabel = (item = {}) => i18nText(item.i18n?.category_label, item.category_label || "");

  window.PoeUi = {
    DEFAULT_LOCALE,
    escapeHtml,
    i18nText,
    i18nList,
    firstPresent,
    truncateText,
    hasCurrencyDescription,
    currencySubtype,
    currencySubtypeLabel,
    currencyCategoryLabel
  };
})();
