import { type Locale, localizedText } from "./locale";

export type RouteKey =
  | "home"
  | "patchnote"
  | "lookup"
  | "newbie"
  | "beginner"
  | "items"
  | "dictionary"
  | "weapon"
  | "skillgems"
  | "skillgemDetail"
  | "currency"
  | "currencyDetail"
  | "ggpkSkills"
  | "ggpkData"
  | "passiveTree"
  | "leveling";

export interface AppRoute {
  key: RouteKey;
  path: string;
  title: string;
  shortTitle: string;
  description: string;
  icon: string;
  navOrder?: number;
  navParent?: RouteKey;
  aliases?: string[];
}

export const routes: AppRoute[] = [
  {
    key: "home",
    path: "/",
    title: "POE2 Việt hóa",
    shortTitle: "Home",
    description: "Tra cứu Path of Exile 2 bằng tiếng Việt: patch note, từ điển, skill gems, currency, passive tree và leveling.",
    icon: "home",
    navOrder: 10,
    aliases: ["/home", "/index.html"]
  },
  {
    key: "patchnote",
    path: "/patchnote",
    title: "Patch note POE2 tiếng Việt",
    shortTitle: "Patch note",
    description: "Bản dịch và ghi chú cập nhật Path of Exile 2 được trình bày cho người chơi Việt.",
    icon: "article",
    navOrder: 20,
    aliases: ["/patch-note", "/patchnote_vn.html"]
  },
  {
    key: "lookup",
    path: "/tra-cuu",
    title: "Tra cứu POE2",
    shortTitle: "Tra cứu",
    description: "Trung tâm tra cứu item, currency, skill gems, dictionary và dữ liệu game Path of Exile 2.",
    icon: "travel_explore",
    navOrder: 30,
    aliases: ["/lookup", "/lookup.html"]
  },
  {
    key: "newbie",
    path: "/newbie",
    title: "Newbie POE2",
    shortTitle: "Newbie",
    description: "Bộ hướng dẫn nhập môn Path of Exile 2 dành cho người chơi mới.",
    icon: "school",
    navOrder: 40,
    aliases: ["/newbie.html"]
  },
  {
    key: "beginner",
    path: "/beginner-guide",
    title: "Beginner guide POE2",
    shortTitle: "Beginner guide",
    description: "Hướng dẫn nền tảng giúp người chơi mới hiểu nhịp độ, loot và build trong POE2.",
    icon: "menu_book",
    navParent: "newbie",
    aliases: ["/beginner", "/beginner.html"]
  },
  {
    key: "items",
    path: "/items",
    title: "Item POE2",
    shortTitle: "Item",
    description: "Tra cứu base item và trang bị Path of Exile 2.",
    icon: "inventory_2",
    navParent: "lookup",
    aliases: ["/items.html"]
  },
  {
    key: "dictionary",
    path: "/dictionary",
    title: "Từ điển POE2",
    shortTitle: "Từ điển",
    description: "Từ điển thuật ngữ Path of Exile 2 với nghĩa tiếng Việt và mô tả gốc.",
    icon: "translate",
    navParent: "lookup",
    aliases: ["/tu-dien", "/dictionary.html", "/analysis.html"]
  },
  {
    key: "weapon",
    path: "/weapon",
    title: "Weapon guide POE2",
    shortTitle: "Weapon",
    description: "Giải thích nhóm vũ khí và cách đọc trang bị trong Path of Exile 2.",
    icon: "swords",
    navParent: "newbie",
    aliases: ["/weapon.html"]
  },
  {
    key: "skillgems",
    path: "/skill-gems",
    title: "Skill gems POE2",
    shortTitle: "Skill gems",
    description: "Tra cứu skill gems Path of Exile 2 theo tên, tag, tier và mô tả.",
    icon: "auto_awesome_motion",
    navParent: "lookup",
    aliases: ["/skill_gems", "/skill_gems.html"]
  },
  {
    key: "skillgemDetail",
    path: "/skill-gem",
    title: "Chi tiết Skill Gem",
    shortTitle: "Skill gem",
    description: "Chi tiết một viên skill gem Path of Exile 2.",
    icon: "auto_awesome",
    navParent: "lookup",
    aliases: ["/skill_gem_detail", "/skill_gem_detail.html"]
  },
  {
    key: "currency",
    path: "/currency",
    title: "Currency POE2",
    shortTitle: "Currency",
    description: "Tra cứu currency, essence, catalyst và vật phẩm stackable trong Path of Exile 2.",
    icon: "toll",
    navParent: "lookup",
    aliases: ["/currency.html"]
  },
  {
    key: "currencyDetail",
    path: "/currency-detail",
    title: "Chi tiết Currency",
    shortTitle: "Currency detail",
    description: "Chi tiết một currency Path of Exile 2.",
    icon: "toll",
    navParent: "lookup",
    aliases: ["/currency_detail", "/currency_detail.html"]
  },
  {
    key: "ggpkSkills",
    path: "/ggpk-skills",
    title: "GGPK skills",
    shortTitle: "GGPK skills",
    description: "Tra cứu kỹ năng trích xuất từ dữ liệu GGPK Path of Exile 2.",
    icon: "database",
    navParent: "lookup",
    aliases: ["/ggpk_skills", "/ggpk_skills.html"]
  },
  {
    key: "ggpkData",
    path: "/ggpk-data",
    title: "GGPK data",
    shortTitle: "GGPK data",
    description: "Tra cứu entity, asset và quan hệ dữ liệu game từ GGPK.",
    icon: "dataset",
    navParent: "lookup",
    aliases: ["/ggpk-lookup", "/ggpk_lookup", "/ggpk_lookup.html"]
  },
  {
    key: "passiveTree",
    path: "/passive-tree",
    title: "Passive Tree POE2 tiếng Việt",
    shortTitle: "Passive tree",
    description: "Bản đồ passive tree Path of Exile 2 dạng Canvas, có tìm kiếm, lọc class và build planner.",
    icon: "account_tree",
    navOrder: 65,
    aliases: ["/passive_tree", "/passive_tree.html"]
  },
  {
    key: "leveling",
    path: "/leveling",
    title: "Leveling POE2",
    shortTitle: "Leveling",
    description: "Checklist leveling chiến dịch Path of Exile 2 cho người chơi Việt.",
    icon: "checklist",
    navOrder: 70,
    aliases: ["/leveling.html", "/leveling_act1.html", "/leveling_act2.html", "/leveling_act3.html", "/leveling_act4.html", "/leveling_interlude.html"]
  }
];

type RouteText = Pick<AppRoute, "title" | "shortTitle" | "description">;

const routeCopy: Partial<Record<RouteKey, Partial<Record<Locale, Partial<RouteText>>>>> = {
  home: {
    en: {
      title: "POE2 Reference",
      shortTitle: "Home",
      description: "A lightweight Path of Exile 2 reference app for patch notes, dictionary terms, skill gems, currency, passive tree planning, and leveling."
    }
  },
  patchnote: {
    en: {
      title: "POE2 Patch Notes",
      shortTitle: "Patch notes",
      description: "Path of Exile 2 patch notes and update notes."
    }
  },
  lookup: {
    en: {
      title: "POE2 Lookup",
      shortTitle: "Lookup",
      description: "A lookup hub for Path of Exile 2 items, currency, skill gems, dictionary terms, and extracted game data."
    }
  },
  newbie: {
    en: {
      title: "POE2 New Player Guide",
      shortTitle: "New player",
      description: "An entry point for new Path of Exile 2 players."
    }
  },
  beginner: {
    en: {
      title: "POE2 Beginner Guide",
      shortTitle: "Beginner guide",
      description: "A beginner guide covering game flow, loot, builds, and core Path of Exile 2 systems."
    }
  },
  items: {
    en: {
      title: "POE2 Items",
      shortTitle: "Items",
      description: "Search Path of Exile 2 base items and equipment."
    }
  },
  dictionary: {
    en: {
      title: "POE2 Dictionary",
      shortTitle: "Dictionary",
      description: "Path of Exile 2 terminology with source descriptions and translated notes."
    }
  },
  weapon: {
    en: {
      title: "POE2 Weapon Guide",
      shortTitle: "Weapons",
      description: "A quick guide to weapon groups and reading equipment in Path of Exile 2."
    }
  },
  skillgems: {
    en: {
      title: "POE2 Skill Gems",
      shortTitle: "Skill gems",
      description: "Search Path of Exile 2 skill gems by name, tags, tier, and description."
    }
  },
  skillgemDetail: {
    en: {
      title: "Skill Gem Details",
      shortTitle: "Skill gem",
      description: "Details for a Path of Exile 2 skill gem."
    }
  },
  currency: {
    en: {
      title: "POE2 Currency",
      shortTitle: "Currency",
      description: "Search Path of Exile 2 currency, essences, catalysts, and stackable items."
    }
  },
  currencyDetail: {
    en: {
      title: "Currency Details",
      shortTitle: "Currency detail",
      description: "Details for a Path of Exile 2 currency item."
    }
  },
  ggpkSkills: {
    en: {
      title: "GGPK Skills",
      shortTitle: "GGPK skills",
      description: "Search extracted Path of Exile 2 skills from GGPK data."
    }
  },
  ggpkData: {
    en: {
      title: "GGPK Data",
      shortTitle: "GGPK data",
      description: "Search extracted Path of Exile 2 entities, assets, and data relationships."
    }
  },
  passiveTree: {
    en: {
      title: "POE2 Passive Tree",
      shortTitle: "Passive tree",
      description: "A canvas-based Path of Exile 2 passive tree with search, class filters, change highlights, and build planning."
    }
  },
  leveling: {
    en: {
      title: "POE2 Leveling",
      shortTitle: "Leveling",
      description: "A campaign leveling checklist for Path of Exile 2."
    }
  }
};

const routeByPath = new Map<string, AppRoute>();
for (const route of routes) {
  routeByPath.set(route.path, route);
  for (const alias of route.aliases ?? []) routeByPath.set(alias, route);
}

export const navRoutes = routes.filter((route) => Number.isFinite(route.navOrder)).sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0));

export function normalizePath(pathname = "/"): string {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return clean.endsWith(".html") ? clean : clean;
}

export function routeFromLocation(locationLike: Pick<Location, "pathname"> = window.location): AppRoute {
  const path = normalizePath(locationLike.pathname);
  return routeByPath.get(path) ?? routes[0];
}

export function activeNavKey(route: AppRoute): RouteKey {
  return route.navParent ?? route.key;
}

export function canonicalPath(route: AppRoute): string {
  return route.path;
}

export function navigateTo(path: string): void {
  const next = path || "/";
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function routeForKey(key: RouteKey): AppRoute {
  return routes.find((route) => route.key === key) ?? routes[0];
}

export function routeText(route: AppRoute, locale: Locale): RouteText {
  const copy = routeCopy[route.key];
  return {
    title: localizedText({ vi: copy?.vi?.title ?? route.title, en: copy?.en?.title }, route.title, locale),
    shortTitle: localizedText({ vi: copy?.vi?.shortTitle ?? route.shortTitle, en: copy?.en?.shortTitle }, route.shortTitle, locale),
    description: localizedText({ vi: copy?.vi?.description ?? route.description, en: copy?.en?.description }, route.description, locale)
  };
}
