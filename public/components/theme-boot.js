(() => {
  const storageKey = "patchnote-theme";
  const root = document.documentElement;
  const palette = {
    dark: { bg: "#060813", fg: "#f8fafc" },
    light: { bg: "#f8fafc", fg: "#0f172a" }
  };

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

  root.classList.toggle("dark", isDark);
  applyCriticalThemePaint(isDark);
  window.PoeTheme = { applyCriticalThemePaint, storageKey };
})();
