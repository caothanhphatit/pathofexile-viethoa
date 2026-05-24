(() => {
  const DEFAULT_LOCALE = "vi";
  const PUBLIC_SITE_ORIGIN = "https://poeviethoa.net";

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
    PUBLIC_SITE_ORIGIN,
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
