(() => {
  const routeVersion = "20260522f";
  const routes = {
    home: {
      title: "Home",
      href: "index.html",
      icon: "home",
      navOrder: 10,
      aliases: ["", "index", "index.html", "home"]
    },
    patchnote: {
      title: "Patch note",
      href: "patchnote_vn.html",
      icon: "article",
      navOrder: 20,
      aliases: ["patchnote", "patch-note", "patchnote_vn", "patchnote_vn.html"]
    },
    dictionary: {
      title: "Từ điển",
      href: "dictionary.html",
      icon: "translate",
      navOrder: 30,
      aliases: ["dictionary", "dictionary.html", "tu-dien", "glossary", "terms", "analysis", "phan-tich", "phan-tich-patch-note", "analysis.html"]
    },
    weapon: {
      title: "Weapon",
      href: "weapon.html",
      icon: "swords",
      navOrder: 40,
      aliases: ["weapon", "weapon.html", "weapons", "weapon-guide", "equipment", "equipment-guide"]
    },
    skillgems: {
      title: "Skill gems",
      href: "skill_gems.html",
      icon: "auto_awesome_motion",
      navOrder: 50,
      aliases: ["skill-gems", "skill_gems", "skill_gems.html", "skill_gem_detail.html", "skills", "gems"]
    },
    currency: {
      title: "Currency",
      href: "currency.html",
      icon: "toll",
      navOrder: 60,
      aliases: ["currency", "currency.html", "currency_detail.html", "currencies", "currency-system"]
    },
    leveling: {
      title: "Leveling",
      href: `leveling.html?v=${routeVersion}`,
      icon: "checklist",
      navOrder: 70,
      aliases: ["leveling", "leveling.html", "leveling_act1.html", "leveling_act2.html", "leveling_act3.html", "leveling_act4.html", "leveling_interlude.html"]
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
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.html$/, ".html");

  const relativeUrl = (url) => `${url.pathname.split("/").pop()}${url.search}${url.hash}`;

  const routeByAlias = (alias) => {
    const key = cleanSegment(alias);
    return Object.entries(routes).find(([, route]) => route.aliases.includes(key))?.[0] || null;
  };

  const currentRoute = () => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("route") || params.get("page") || params.get("project");
    if (requested) return routeByAlias(requested) || "home";
    const file = window.location.pathname.split("/").pop() || "";
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
    return routeByAlias(url.pathname.split("/").pop() || "");
  };

  const syncLinks = () => {
    const active = currentRoute();
    document.querySelectorAll("a[href]").forEach((link) => {
      const key = link.dataset.route || keyFromHref(link.getAttribute("href"));
      if (!key || !routes[key]) return;
      link.dataset.route = key;
      if (key === "leveling" && !link.getAttribute("href").includes("act=") && !link.getAttribute("href").includes("task=")) {
        link.setAttribute("href", to("leveling"));
      }
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

    window.location.replace(`${basePath}${to(target, params)}`);
  };

  window.PoeRouter = {
    routeVersion,
    routes,
    currentRoute,
    to,
    syncLinks,
    redirectPrettyRoute
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncLinks);
  } else {
    syncLinks();
  }
})();
