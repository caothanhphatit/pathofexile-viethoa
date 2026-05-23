(() => {
  const brandTitle = "POE2 Việt hóa";
  const defaultSubtitle = "0.5.0 · Return of the Ancients";
  const fallbackRoutes = {
    home: { title: "Home", href: "/", icon: "home", navOrder: 10 },
    patchnote: { title: "Patch note", href: "/patchnote", icon: "article", navOrder: 20 },
    dictionary: { title: "Từ điển", href: "/dictionary", icon: "translate", navOrder: 30 },
    weapon: { title: "Weapon", href: "/weapon", icon: "swords", navOrder: 40 },
    skillgems: { title: "Skill gems", href: "/skill-gems", icon: "auto_awesome_motion", navOrder: 50 },
    currency: { title: "Currency", href: "/currency", icon: "toll", navOrder: 60 },
    leveling: { title: "Leveling", href: "/leveling", icon: "checklist", navOrder: 70 }
  };

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));

  const router = () => window.PoeRouter || {};
  const routes = () => (window.PoeRouter && window.PoeRouter.routes) || fallbackRoutes;
  const activeRoute = () => router().currentRoute?.() || "home";
  const routeHref = (key) => router().to?.(key) || routes()[key]?.href || fallbackRoutes[key]?.href || "/";
  const navRoutes = () => Object.entries(routes())
    .filter(([, route]) => Number.isFinite(route.navOrder))
    .sort(([, a], [, b]) => a.navOrder - b.navOrder);

  const desktopClass = (active) => `poe-nav-link${active ? " poe-nav-link-active" : ""}`;
  const mobileClass = (active) => `poe-nav-link poe-nav-link-mobile${active ? " poe-nav-link-mobile-active" : ""}`;

  const renderNavLink = ([key, route], mode, active) => `
    <a class="${mode === "desktop" ? desktopClass(active) : mobileClass(active)}" href="${escapeHtml(routeHref(key))}" data-route="${escapeHtml(key)}"${active ? " aria-current=\"page\"" : ""}>
      <span class="material-symbols-rounded poe-nav-icon" aria-hidden="true">${escapeHtml(route.icon || "circle")}</span>${escapeHtml(route.title)}
    </a>
  `;

  const renderSiteHeader = (target) => {
    const active = activeRoute();
    const desktopBreakpoint = target.dataset.desktopBreakpoint || "lg";
    const subtitle = target.dataset.subtitle || routes()[active]?.title || defaultSubtitle;
    const desktopNavClass = `poe-nav-rail ${desktopBreakpoint}:flex`;
    const mobileNavClass = `nav-scroll -mx-1 flex gap-1 overflow-x-auto pb-3 ${desktopBreakpoint}:hidden`;
    const links = navRoutes();

    target.outerHTML = `
      <header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95" data-component="site-header">
        <div class="poe-shell-container">
          <div class="flex h-16 items-center justify-between gap-3">
            <a class="flex min-w-0 items-center gap-3 no-underline" href="${escapeHtml(routeHref("home"))}" data-route="home" aria-label="Về trang chủ">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-950 text-white shadow-md1 dark:bg-white dark:text-slate-950">
                <span class="material-symbols-rounded" aria-hidden="true">auto_stories</span>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-black leading-tight text-slate-950 sm:text-base dark:text-white">${escapeHtml(brandTitle)}</span>
                <span class="hidden truncate text-xs font-semibold text-slate-500 sm:block dark:text-slate-400">${escapeHtml(subtitle)}</span>
              </span>
            </a>
            <div class="flex items-center gap-2">
              <nav class="${desktopNavClass}" aria-label="Điều hướng chính">
                ${links.map((entry) => renderNavLink(entry, "desktop", entry[0] === active)).join("")}
              </nav>
              <button class="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-800 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800" id="themeToggle" type="button" aria-label="Đổi giao diện sang tối">
                <span class="material-symbols-rounded" id="themeIcon" aria-hidden="true">dark_mode</span>
              </button>
            </div>
          </div>
          <nav class="${mobileNavClass}" aria-label="Điều hướng chính mobile">
            ${links.map((entry) => renderNavLink(entry, "mobile", entry[0] === active)).join("")}
          </nav>
        </div>
      </header>
    `;
  };

  const applyThemeState = (themeToggle, themeIcon) => {
    const isDark = document.documentElement.classList.contains("dark");
    if (window.PoeTheme?.applyCriticalThemePaint) {
      window.PoeTheme.applyCriticalThemePaint(isDark);
    } else {
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      document.documentElement.style.backgroundColor = isDark ? "#060813" : "#f8fafc";
    }
    themeIcon.textContent = isDark ? "light_mode" : "dark_mode";
    themeToggle.setAttribute("aria-label", isDark ? "Đổi giao diện sang sáng" : "Đổi giao diện sang tối");
    window.dispatchEvent(new CustomEvent("poe-theme-change", { detail: { isDark } }));
  };

  const initTheme = () => {
    const themeToggle = document.getElementById("themeToggle");
    const themeIcon = document.getElementById("themeIcon");
    if (!themeToggle || !themeIcon || themeToggle.dataset.themeReady === "true") return;

    const savedTheme = localStorage.getItem("patchnote-theme");
    if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    }
    applyThemeState(themeToggle, themeIcon);

    themeToggle.dataset.themeReady = "true";
    themeToggle.addEventListener("click", () => {
      document.documentElement.classList.toggle("dark");
      const isDark = document.documentElement.classList.contains("dark");
      localStorage.setItem("patchnote-theme", isDark ? "dark" : "light");
      applyThemeState(themeToggle, themeIcon);
    });
  };

  const scheduleIdleWork = (callback) => {
    if (typeof window.requestIdleCallback === "function") {
      return window.requestIdleCallback(callback, { timeout: 1800 });
    }
    return window.setTimeout(callback, 350);
  };

  const init = () => {
    document.querySelectorAll('[data-component="site-header"]').forEach(renderSiteHeader);
    initTheme();
    router().syncLinks?.();
    scheduleIdleWork(loadDictionaryAndInitTooltips);
  };

  // PoE Tooltip Engine - Automatically hover dictionary terms
  let poeTermsRegex = null;
  const poeTermsMap = new Map();
  let tooltipEl = null;
  let termModalEl = null;
  let termModalContentEl = null;
  let lastFocusedTermEl = null;
  let observer = null;

  const initPoeTermsData = () => {
    if (poeTermsRegex) return;
    const terms = window.POE2_DICTIONARY_TERMS?.terms || [];
    const patterns = [];

    for (const termObj of terms) {
      const mainTerm = termObj.term;
      if (mainTerm) {
        poeTermsMap.set(mainTerm.toLowerCase(), termObj);
        patterns.push(escapeRegex(mainTerm));
      }
      if (termObj.variants) {
        for (const variant of termObj.variants) {
          if (variant) {
            poeTermsMap.set(variant.toLowerCase(), termObj);
            patterns.push(escapeRegex(variant));
          }
        }
      }
    }

    patterns.sort((a, b) => b.length - a.length);

    if (patterns.length > 0) {
      poeTermsRegex = new RegExp(`\\b(${patterns.join("|")})\\b`, "gi");
    }
  };

  const escapeRegex = (string) => string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  const findPoeTerm = (term) => {
    if (!term) return null;
    initPoeTermsData();
    const normalizedTerm = term.toLowerCase();
    return poeTermsMap.get(normalizedTerm)
      || (window.POE2_DICTIONARY_TERMS?.terms || []).find((item) => item.term?.toLowerCase() === normalizedTerm)
      || null;
  };

  const getTermCategoryLabel = (termObj) => (
    window.POE2_DICTIONARY_TERMS?.categories?.[termObj.category] || termObj.category || "General"
  );

  const isPoeTermUiElement = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return node.classList.contains("poe-tooltip-box")
      || node.closest(".poe-tooltip-box")
      || node.classList.contains("poe-term-modal")
      || node.closest(".poe-term-modal");
  };

  const walkTextNodes = (parent, callback) => {
    const walk = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parentEl = node.parentElement;
        if (!parentEl) return NodeFilter.FILTER_REJECT;

        // Comprehensive selector to exclude interactive components, filter controls, navigation items,
        // and item/skill/currency names/headings where dictionary tooltips should not interfere.
        const EXCLUDE_SELECTOR = [
          // Standard interactive tags
          "a", "button", "select", "option", "input", "textarea", "[role='button']",

          // Header & Title tags
          "h1", "h2", "h3", "h4", "h5", "h6",

          // Navigation, CTA, and filter/pill buttons and containers
          ".btn", ".button", ".poe-nav-link", ".poe-nav-rail", ".subtype-pill", ".filter-btn",
          ".filter-button", ".reset-btn", ".skill-cta", ".currency-cta", ".item-cta", ".cta",
          ".filter-group", ".filters", ".filter-section", "#resetFilters",

          // Item, Gem, Currency, or Weapon titles/names (lists or detail headers)
          ".card-title", ".card-header", ".item-name", ".gem-name", ".currency-name", ".weapon-name",
          ".card-name", ".item-title", ".currency-card-title", ".detail-title", ".modal-title",
          ".dialog-title", "#modalTitle", "#cmodalTitle", "#poeTermModalTitle",

          // Custom attributes or classes to explicitly disable tooltips
          "[translate='no']", "[data-no-tooltip]", ".no-tooltip", ".poe-no-tooltip",

          // Tooltip container itself
          ".poe-term", ".poe-tooltip-box", ".poe-term-modal"
        ].join(", ");

        if (parentEl.closest(EXCLUDE_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walk.nextNode()) {
      nodes.push(walk.currentNode);
    }

    for (const node of nodes) {
      callback(node);
    }
  };

  const wrapPoeTermsInTextNode = (node) => {
    if (!poeTermsRegex) return;
    const text = node.nodeValue;
    poeTermsRegex.lastIndex = 0;

    let match;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let hasMatches = false;

    while ((match = poeTermsRegex.exec(text)) !== null) {
      hasMatches = true;
      const matchText = match[0];
      const matchIndex = match.index;

      if (matchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
      }

      const termObj = poeTermsMap.get(matchText.toLowerCase());
      if (termObj) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "poe-term inline cursor-help border-b border-dotted border-blue-500/60 hover:text-blue-600 dark:border-blue-400/60 dark:hover:text-blue-400 transition-all duration-150 font-bold p-0 bg-transparent align-baseline";
        btn.dataset.term = termObj.term;
        btn.textContent = matchText;
        fragment.appendChild(btn);
      } else {
        fragment.appendChild(document.createTextNode(matchText));
      }

      lastIndex = poeTermsRegex.lastIndex;
    }

    if (hasMatches) {
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      node.parentNode.replaceChild(fragment, node);
    }
  };

  const applyTooltips = (rootElement) => {
    initPoeTermsData();
    walkTextNodes(rootElement, (node) => {
      wrapPoeTermsInTextNode(node);
    });
  };

  const initTooltipElement = () => {
    if (tooltipEl) return;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "poe-tooltip-box fixed z-[9999] hidden max-w-[260px] rounded-lg border border-amber-500/20 bg-[#0c0f19]/95 p-2.5 text-[11px] font-semibold leading-snug text-slate-100 shadow-lg dark:border-amber-500/30 dark:bg-[#070b14]/95 pointer-events-none border-l-2 border-l-amber-500 backdrop-blur-md transition-all duration-150";
    document.body.appendChild(tooltipEl);
  };

  const initPoeTermModalElement = () => {
    if (termModalEl) return;

    termModalEl = document.createElement("div");
    termModalEl.className = "poe-term-modal fixed inset-0 z-[10000] hidden items-center justify-center bg-slate-950/35 px-3 py-4 backdrop-blur-sm";
    termModalEl.innerHTML = `
      <section class="w-full max-w-[430px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 transition dark:border-slate-800 dark:bg-slate-950" role="dialog" aria-modal="true" aria-labelledby="poeTermModalTitle" data-poe-term-modal-panel>
        <div class="flex items-start justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
          <div class="min-w-0">
            <div class="mb-1 inline-flex rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-700 dark:text-amber-300" id="poeTermModalCategory"></div>
            <h2 class="truncate text-base font-black leading-tight text-slate-950 dark:text-white" id="poeTermModalTitle" translate="no"></h2>
          </div>
          <button class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white" type="button" aria-label="Đóng" data-poe-term-close>
            <span class="material-symbols-rounded text-xl" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="max-h-[68vh] overflow-y-auto px-4 py-3">
          <p class="text-sm font-semibold leading-relaxed text-slate-800 dark:text-slate-200" id="poeTermModalMeaning"></p>

          <div class="mt-3 hidden rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70" id="poeTermModalOriginalWrap">
            <p class="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">Gốc PoE2DB</p>
            <p class="mt-1 text-xs font-semibold leading-relaxed text-slate-600 dark:text-slate-400" id="poeTermModalOriginal" translate="no"></p>
          </div>

          <div class="mt-3 hidden text-xs font-bold leading-relaxed text-slate-500 dark:text-slate-400" id="poeTermModalKeepWrap">
            <span class="text-slate-700 dark:text-slate-200">Quy chuẩn:</span>
            <span id="poeTermModalKeep"></span>
          </div>

          <div class="mt-3 hidden" id="poeTermModalVariantsWrap">
            <p class="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">Biến thể / ví dụ</p>
            <div class="mt-1.5 flex flex-wrap gap-1.5" id="poeTermModalVariants"></div>
          </div>
        </div>
      </section>
    `;

    termModalContentEl = termModalEl.querySelector("[data-poe-term-modal-panel]");
    termModalEl.addEventListener("click", (event) => {
      if (event.target === termModalEl || event.target.closest("[data-poe-term-close]")) {
        closePoeTermModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && termModalEl && !termModalEl.classList.contains("hidden")) {
        closePoeTermModal();
      }
    });
    document.body.appendChild(termModalEl);
  };

  const setOptionalTextBlock = (wrap, contentEl, value) => {
    if (value) {
      contentEl.textContent = value;
      wrap.classList.remove("hidden");
    } else {
      contentEl.textContent = "";
      wrap.classList.add("hidden");
    }
  };

  const openPoeTermModal = (term) => {
    const termObj = findPoeTerm(term);
    if (!termObj) return;

    if (tooltipEl) {
      tooltipEl.classList.add("hidden");
    }

    initPoeTermModalElement();

    const category = termModalEl.querySelector("#poeTermModalCategory");
    const title = termModalEl.querySelector("#poeTermModalTitle");
    const meaning = termModalEl.querySelector("#poeTermModalMeaning");
    const originalWrap = termModalEl.querySelector("#poeTermModalOriginalWrap");
    const original = termModalEl.querySelector("#poeTermModalOriginal");
    const keepWrap = termModalEl.querySelector("#poeTermModalKeepWrap");
    const keep = termModalEl.querySelector("#poeTermModalKeep");
    const variantsWrap = termModalEl.querySelector("#poeTermModalVariantsWrap");
    const variants = termModalEl.querySelector("#poeTermModalVariants");

    category.textContent = getTermCategoryLabel(termObj);
    title.textContent = termObj.term || term;
    meaning.textContent = termObj.meaning || "Chưa có mô tả Việt hóa.";
    setOptionalTextBlock(originalWrap, original, termObj.description_en);
    setOptionalTextBlock(keepWrap, keep, termObj.keep);

    const variantList = [...new Set([
      ...(termObj.variants || []),
      ...(termObj.examples || [])
    ])].filter((item) => item && item.toLowerCase() !== (termObj.term || "").toLowerCase()).slice(0, 3);

    if (variantList.length > 0) {
      variants.innerHTML = variantList.map((item) => `
        <span class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300" translate="no">${escapeHtml(item)}</span>
      `).join("");
      variantsWrap.classList.remove("hidden");
    } else {
      variants.innerHTML = "";
      variantsWrap.classList.add("hidden");
    }

    lastFocusedTermEl = document.activeElement?.closest?.(".poe-term") || null;
    termModalContentEl.classList.remove("scale-95");
    termModalEl.classList.remove("hidden");
    termModalEl.classList.add("flex");
    termModalEl.querySelector("[data-poe-term-close]")?.focus();
  };

  const closePoeTermModal = () => {
    if (!termModalEl) return;
    termModalEl.classList.add("hidden");
    termModalEl.classList.remove("flex");
    lastFocusedTermEl?.focus?.();
    lastFocusedTermEl = null;
  };

  const positionTooltip = (target) => {
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    let top = targetRect.top - tooltipRect.height - 8;
    let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;

    if (top < 8) {
      top = targetRect.bottom + 8;
    }

    const viewportWidth = window.innerWidth;
    if (left < 8) {
      left = 8;
    } else if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }

    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
  };

  const startObserver = () => {
    if (observer) return;

    applyTooltips(document.body);

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (!isPoeTermUiElement(node)) {
                applyTooltips(node);
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  };

  const loadDictionaryAndInitTooltips = () => {
    if (router().currentRoute?.() === "dictionary" || window.location.pathname.includes("dictionary.html")) return;
    if (window.POE2_DICTIONARY_TERMS) {
      startObserver();
      return;
    }
    const script = document.createElement("script");
    script.src = "data/dictionary-data.js";
    script.defer = true;
    script.onload = () => {
      startObserver();
    };
    script.onerror = () => {
      console.warn("Failed to load dictionary-data.js for PoE Tooltips");
    };
    document.head.appendChild(script);
  };

  // Add event delegation listeners for tooltip display
  document.addEventListener("mouseenter", (e) => {
    const target = e.target.closest?.(".poe-term");
    if (!target) return;

    const term = target.dataset.term;
    const termObj = findPoeTerm(term);
    if (!termObj) return;

    initTooltipElement();

    const categoryLabel = getTermCategoryLabel(termObj);

    tooltipEl.innerHTML = `
      <div class="flex items-center justify-between gap-2 border-b border-amber-500/15 pb-1 mb-1">
        <span class="font-display font-black text-white text-[12px]" translate="no">${escapeHtml(termObj.term)}</span>
        <span class="rounded border border-amber-500/15 bg-amber-500/10 text-[8px] font-black text-amber-400 px-1.5 py-0.5 uppercase tracking-wide">${escapeHtml(categoryLabel)}</span>
      </div>
      <p class="text-slate-300 leading-snug font-semibold text-[11px]">${escapeHtml(termObj.meaning)}</p>
    `;

    tooltipEl.classList.remove("hidden");
    positionTooltip(target);
  }, true);

  document.addEventListener("mouseleave", (e) => {
    const target = e.target.closest?.(".poe-term");
    if (!target) return;

    if (tooltipEl) {
      tooltipEl.classList.add("hidden");
    }
  }, true);

  // Click on poe-term button to open the compact dictionary popup in the same page
  document.addEventListener("click", (e) => {
    const target = e.target.closest?.(".poe-term");
    if (target) {
      const term = target.dataset.term;
      if (term) {
        e.preventDefault();
        e.stopPropagation();
        openPoeTermModal(term);
      }
    }
  });

  window.PoeAppShell = {
    renderSiteHeader,
    initTheme,
    init
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
