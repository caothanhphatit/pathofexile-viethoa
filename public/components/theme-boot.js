(() => {
  const storageKey = "patchnote-theme";
  const localeStorageKey = "poe-locale";
  const root = document.documentElement;
  const palette = {
    dark: { bg: "#0f0d0b", fg: "#eee7db" },
    light: { bg: "#f5f0e6", fg: "#1e1a14" }
  };
  const normalizeLocale = (value = "") => String(value || "").toLowerCase().startsWith("en") ? "en" : "vi";

  const applyCriticalThemePaint = (isDark) => {
    const theme = isDark ? palette.dark : palette.light;
    root.style.backgroundColor = theme.bg;
    root.style.color = theme.fg;
    root.style.colorScheme = isDark ? "dark" : "light";

    let themeColor = document.querySelector('meta[name="theme-color"]');
    if (!themeColor) {
      themeColor = document.createElement("meta");
      themeColor.name = "theme-color";
      document.head?.append(themeColor);
    }
    themeColor.content = theme.bg;
  };

  const savedTheme = (() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  })();

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
  const isDark = savedTheme === "dark" || (!savedTheme && prefersDark);
  const locale = (() => {
    try {
      return normalizeLocale(localStorage.getItem(localeStorageKey) || root.lang || "vi");
    } catch {
      return normalizeLocale(root.lang || "vi");
    }
  })();

  try {
    sessionStorage.removeItem("poe-route-transition");
  } catch {
    // Stale cosmetic navigation flags should never block first paint.
  }

  root.lang = locale;
  root.dataset.locale = locale;
  root.classList.toggle("dark", isDark);
  applyCriticalThemePaint(isDark);
  window.PoeTheme = { applyCriticalThemePaint, storageKey, localeStorageKey };
})();
