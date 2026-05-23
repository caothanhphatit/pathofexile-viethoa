(() => {
  const routeVersion = "20260522f";
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
    dictionary: {
      title: "Từ điển",
      href: "/dictionary",
      icon: "translate",
      navOrder: 30,
      aliases: ["dictionary", "tu-dien", "glossary", "terms", "analysis", "phan-tich", "phan-tich-patch-note"]
    },
    weapon: {
      title: "Weapon",
      href: "/weapon",
      icon: "swords",
      navOrder: 40,
      aliases: ["weapon", "weapons", "weapon-guide", "equipment", "equipment-guide"]
    },
    skillgems: {
      title: "Skill gems",
      href: "/skill-gems",
      icon: "auto_awesome_motion",
      navOrder: 50,
      aliases: ["skill-gems", "skill_gems", "skill-gem", "skill_gem_detail", "skills", "gems"]
    },
    currency: {
      title: "Currency",
      href: "/currency",
      icon: "toll",
      navOrder: 60,
      aliases: ["currency", "currency-detail", "currency_detail", "currencies", "currency-system"]
    },
    leveling: {
      title: "Leveling",
      href: `/leveling?v=${routeVersion}`,
      icon: "checklist",
      navOrder: 70,
      aliases: ["leveling", "leveling_act1", "leveling_act2", "leveling_act3", "leveling_act4", "leveling_interlude"]
    }
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

  const relativeUrl = (url) => `${url.pathname || "/"}${url.search}${url.hash}`;

  const routeByAlias = (alias) => {
    const key = cleanSegment(alias);
    return Object.entries(routes).find(([, route]) => route.aliases.includes(key))?.[0] || null;
  };

  const currentRoute = () => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("route") || params.get("page") || params.get("project");
    if (requested) return routeByAlias(requested) || "home";
    const file = cleanSegment(window.location.pathname.split("/").pop() || "");
    return routeByAlias(file) || "home";
  };

  const to = (name, params = {}) => {
    const route = routes[name] || routes.home;
    const url = new URL(route.href, window.location.href);
    if (name === "leveling") {
      url.searchParams.set("v", routeVersion);
      if (params.act && params.act !== "all") url.searchParams.set("act", params.act);
      if (params.task) url.searchParams.set("task", params.task);
    }
    if (params.hash) url.hash = params.hash.startsWith("#") ? params.hash : `#${params.hash}`;
    return relativeUrl(url);
  };

  const keyFromHref = (rawHref) => {
    if (!rawHref || rawHref.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(rawHref)) return null;
    const url = new URL(rawHref, window.location.href);
    const routeParam = url.searchParams.get("route") || url.searchParams.get("page") || url.searchParams.get("project");
    if (routeParam) return routeByAlias(routeParam);
    return routeByAlias(cleanSegment(url.pathname.split("/").pop() || ""));
  };

  const canonicalInternalHref = (rawHref) => {
    if (!rawHref || rawHref.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(rawHref)) return rawHref;
    const url = new URL(rawHref, window.location.href);
    if (url.origin !== window.location.origin) return rawHref;

    const last = cleanSegment(url.pathname.split("/").pop() || "");
    if (last === "currency_detail" || last === "currency-detail") {
      return `/currency-detail${url.search}${url.hash}`;
    }
    if (last === "skill_gem_detail" || last === "skill-gem") {
      return `/skill-gem${url.search}${url.hash}`;
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
    return relativeUrl(target);
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
    document.querySelectorAll("a[href]").forEach((link) => {
      const key = link.dataset.route || keyFromHref(link.getAttribute("href"));
      if (!key || !routes[key]) return;
      link.dataset.route = key;
      link.setAttribute("href", canonicalInternalHref(link.getAttribute("href")));
      if (key === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };

  const redirectPrettyRoute = () => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = cleanSegment(segments.at(-1) || "");
    const prev = cleanSegment(segments.at(-2) || "");
    const routeStart = segments.findIndex((segment) => {
      const clean = cleanSegment(segment);
      return routes.home.aliases.includes(clean) ||
        routes.patchnote.aliases.includes(clean) ||
        routes.dictionary.aliases.includes(clean) ||
        routes.weapon.aliases.includes(clean) ||
        routes.skillgems.aliases.includes(clean) ||
        routes.currency.aliases.includes(clean) ||
        routes.leveling.aliases.includes(clean) ||
        Boolean(actAliases[clean]);
    });
    const basePath = routeStart > 0 ? `/${segments.slice(0, routeStart).join("/")}/` : "/";
    let target = routeByAlias(last) || "home";
    const params = {};

    if (prev === "leveling" || last.startsWith("act-") || actAliases[last]) {
      target = "leveling";
      if (actAliases[last]) params.act = actAliases[last];
    }

    window.location.replace(`${basePath.replace(/\/$/, "")}${to(target, params)}`);
  };

  window.PoeRouter = {
    routeVersion,
    routes,
    currentRoute,
    to,
    canonicalInternalHref,
    syncLinks,
    redirectPrettyRoute
  };

  canonicalizeCurrentUrl();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncLinks);
  } else {
    syncLinks();
  }
})();
