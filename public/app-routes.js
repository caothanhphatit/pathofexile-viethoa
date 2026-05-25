(() => {
  const routeVersion = "20260522f";
  const scriptBasePath = (() => {
    try {
      const scriptUrl = new URL(document.currentScript?.getAttribute("src") || "app-routes.js", window.location.href);
      if (scriptUrl.origin !== window.location.origin) return "";
      return scriptUrl.pathname.replace(/\/app-routes\.js$/, "").replace(/\/$/, "");
    } catch {
      return "";
    }
  })();
  const basePath = scriptBasePath === "/" ? "" : scriptBasePath;
  const routes = {
    home: {
      title: "Home",
      href: "/",
      icon: "home",
      navOrder: 10,
      aliases: ["", "index", "home"]
    },
    patchnote: {
      title: "Patch note",
      href: "/patchnote",
      icon: "article",
      navOrder: 20,
      aliases: ["patchnote", "patch-note", "patchnote_vn"]
    },
    lookup: {
      title: "Tra cứu",
      href: "/tra-cuu",
      icon: "travel_explore",
      navOrder: 30,
      aliases: ["tra-cuu", "lookup", "search", "database"]
    },
    newbie: {
      title: "Newbie",
      href: "/newbie",
      icon: "school",
      navOrder: 40,
      aliases: ["newbie", "beginner", "beginners", "huong-dan-newbie", "nguoi-moi"]
    },
    items: {
      title: "Item",
      href: "/items",
      icon: "inventory_2",
      navParent: "lookup",
      aliases: ["items", "item", "item-data", "trang-bi", "vat-pham"]
    },
    currency: {
      title: "Currency",
      href: "/currency",
      icon: "toll",
      navParent: "lookup",
      aliases: ["currency", "currency-detail", "currency_detail", "currencies", "currency-system"]
    },
    dictionary: {
      title: "Từ điển",
      href: "/dictionary",
      icon: "translate",
      navParent: "lookup",
      aliases: ["dictionary", "tu-dien", "glossary", "terms", "analysis", "phan-tich", "phan-tich-patch-note"]
    },
    weapon: {
      title: "Weapon",
      href: "/weapon",
      icon: "swords",
      navParent: "newbie",
      aliases: ["weapon", "weapons", "weapon-guide", "equipment", "equipment-guide"]
    },
    beginner: {
      title: "Beginner guide",
      href: "/beginner-guide",
      icon: "menu_book",
      navParent: "newbie",
      aliases: ["beginner-guide", "poe2-beginner-guide", "starter-guide", "huong-dan-nhap-mon", "newbie-guide"]
    },
    skillgems: {
      title: "Skill gems",
      href: "/skill-gems",
      icon: "auto_awesome_motion",
      navParent: "lookup",
      aliases: ["skill-gems", "skill_gems", "skill-gem", "skill_gem_detail", "skills", "gems"]
    },
    passivetree: {
      title: "Passive tree",
      href: "/passive-tree",
      icon: "account_tree",
      navOrder: 65,
      aliases: ["passive-tree", "passive_tree", "passives", "tree"]
    },
    leveling: {
      title: "Leveling",
      href: `/leveling?v=${routeVersion}`,
      icon: "checklist",
      navOrder: 70,
      aliases: ["leveling", "leveling_act1", "leveling_act2", "leveling_act3", "leveling_act4", "leveling_interlude"]
    }
  };

  const routeFiles = {
    home: "index.html",
    patchnote: "patchnote_vn.html",
    lookup: "lookup.html",
    newbie: "newbie.html",
    items: "items.html",
    dictionary: "dictionary.html",
    weapon: "weapon.html",
    beginner: "beginner.html",
    skillgems: "skill_gems.html",
    currency: "currency.html",
    passivetree: "passive_tree.html",
    leveling: "leveling.html"
  };

  const detailRouteFiles = {
    "currency-detail": { file: "currency_detail.html", href: "/currency-detail" },
    currency_detail: { file: "currency_detail.html", href: "/currency-detail" },
    "skill-gem": { file: "skill_gem_detail.html", href: "/skill-gem" },
    skill_gem_detail: { file: "skill_gem_detail.html", href: "/skill-gem" }
  };

  const actAliases = {
    "act-1": "act1",
    act1: "act1",
    "act-2": "act2",
    act2: "act2",
    "act-3": "act3",
    act3: "act3",
    "act-4": "act4",
    act4: "act4",
    interlude: "interlude"
  };

  const cleanSegment = (value = "") => value
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.html$/, "");

  const stripBasePath = (pathname = "/") => {
    if (!basePath) return pathname || "/";
    if (pathname === basePath) return "/";
    if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || "/";
    return pathname || "/";
  };
  const withBasePath = (pathname = "/") => {
    const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${basePath}${normalized}` || "/";
  };
  const publicUrl = (url) => `${withBasePath(url.pathname || "/")}${url.search}${url.hash}`;
  const preserveCurrentSearchParams = (url, {
    skip = ["route", "page", "project"]
  } = {}) => {
    const skipped = new Set(skip);
    for (const [paramKey, paramValue] of new URLSearchParams(window.location.search)) {
      if (skipped.has(paramKey)) continue;
      url.searchParams.set(paramKey, paramValue);
    }
    return url;
  };

  const routeByAlias = (alias) => {
    const key = cleanSegment(alias);
    return Object.entries(routes).find(([, route]) => route.aliases.includes(key))?.[0] || null;
  };

  const navActiveRoute = (routeKey = currentRoute()) => routes[routeKey]?.navParent || routeKey;

  const currentRoute = () => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("route") || params.get("page") || params.get("project");
    if (requested) return routeByAlias(requested) || "home";
    const file = cleanSegment(stripBasePath(window.location.pathname).split("/").pop() || "");
    return routeByAlias(file) || "home";
  };

  const to = (name, params = {}) => {
    const route = routes[name] || routes.home;
    const url = new URL(route.href, window.location.origin);
    if (name === "leveling") {
      url.searchParams.set("v", routeVersion);
      if (params.act && params.act !== "all") url.searchParams.set("act", params.act);
      if (params.task) url.searchParams.set("task", params.task);
    }
    if (params.hash) url.hash = params.hash.startsWith("#") ? params.hash : `#${params.hash}`;
    return publicUrl(url);
  };

  const keyFromHref = (rawHref) => {
    if (!rawHref || rawHref.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(rawHref)) return null;
    const url = new URL(rawHref, window.location.href);
    const routeParam = url.searchParams.get("route") || url.searchParams.get("page") || url.searchParams.get("project");
    if (routeParam) return routeByAlias(routeParam);
    return routeByAlias(cleanSegment(stripBasePath(url.pathname).split("/").pop() || ""));
  };

  const canonicalInternalHref = (rawHref) => {
    if (!rawHref || rawHref.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(rawHref)) return rawHref;
    const url = new URL(rawHref, window.location.href);
    if (url.origin !== window.location.origin) return rawHref;

    const appPath = stripBasePath(url.pathname);
    const last = cleanSegment(appPath.split("/").pop() || "");
    if (last === "currency_detail" || last === "currency-detail") {
      return `${withBasePath("/currency-detail")}${url.search}${url.hash}`;
    }
    if (last === "skill_gem_detail" || last === "skill-gem") {
      return `${withBasePath("/skill-gem")}${url.search}${url.hash}`;
    }

    const key = routeByAlias(last);
    if (!key || !routes[key]) return rawHref;
    const target = new URL(routes[key].href, window.location.origin);
    if (key === "leveling") {
      target.searchParams.set("v", routeVersion);
    }
    for (const [paramKey, paramValue] of url.searchParams) {
      if (key === "leveling" && paramKey === "v") continue;
      target.searchParams.set(paramKey, paramValue);
    }
    target.hash = url.hash;
    return publicUrl(target);
  };

  const canonicalizeCurrentUrl = () => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const clean = canonicalInternalHref(current);
    if (clean && clean !== current) {
      window.history.replaceState(null, "", clean);
    }
  };

  const syncLinks = () => {
    const active = currentRoute();
    const activeNav = navActiveRoute(active);
    document.querySelectorAll("a[href]").forEach((link) => {
      const key = link.dataset.route || keyFromHref(link.getAttribute("href"));
      if (!key || !routes[key]) return;
      link.dataset.route = key;
      link.setAttribute("href", canonicalInternalHref(link.getAttribute("href")));
      const isShellNavLink = link.classList.contains("poe-nav-link");
      if (key === active || (key === activeNav && isShellNavLink)) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };

  const resolvePrettyRoute = () => {
    const appPath = stripBasePath(window.location.pathname);
    const segments = appPath.split("/").filter(Boolean);
    const last = cleanSegment(segments.at(-1) || "");
    const prev = cleanSegment(segments.at(-2) || "");
    const detailRoute = detailRouteFiles[last];
    if (detailRoute) {
      return { file: detailRoute.file, targetUrl: `${withBasePath(detailRoute.href)}${window.location.search}${window.location.hash}` };
    }

    let target = routeByAlias(last) || "home";
    const params = {};

    if (prev === "leveling" || last.startsWith("act-") || actAliases[last]) {
      target = "leveling";
      if (actAliases[last]) params.act = actAliases[last];
    }

    const targetUrl = new URL(to(target, params), window.location.origin);
    preserveCurrentSearchParams(targetUrl, {
      skip: target === "leveling" ? ["route", "page", "project", "v"] : ["route", "page", "project"]
    });
    return { file: routeFiles[target] || routeFiles.home, targetUrl: publicUrl(targetUrl) };
  };

  const redirectPrettyRoute = async () => {
    const { file, targetUrl } = resolvePrettyRoute();
    if (file && typeof window.fetch === "function") {
      try {
        const response = await window.fetch(withBasePath(`/${file}`), { cache: "no-store" });
        if (response.ok) {
          const html = await response.text();
          window.history.replaceState(null, "", targetUrl);
          document.open();
          document.write(html);
          document.close();
          return;
        }
      } catch {
        // Fall back to navigation below when static hosts block fetching the route file.
      }
    }

    window.location.replace(targetUrl);
  };

  window.PoeRouter = {
    basePath,
    routeVersion,
    routes,
    currentRoute,
    navActiveRoute,
    to,
    canonicalInternalHref,
    syncLinks,
    withBasePath,
    redirectPrettyRoute
  };

  canonicalizeCurrentUrl();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncLinks);
  } else {
    syncLinks();
  }
})();
