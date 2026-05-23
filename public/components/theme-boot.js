(() => {
  const storageKey = "patchnote-theme";
  const root = document.documentElement;

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
  root.style.colorScheme = isDark ? "dark" : "light";
})();
