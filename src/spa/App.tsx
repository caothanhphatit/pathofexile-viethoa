import { useEffect, useMemo, useState } from "react";
import {
  activeNavKey,
  navRoutes,
  navigateTo,
  routeText,
  routeFromLocation,
  routes,
  type AppRoute
} from "./lib/routes";
import { normalizeLocale, type Locale, uiText } from "./lib/locale";
import { usePoeTermTooltips } from "./lib/poeTerms";
import { updateSeo } from "./lib/seo";
import { HomePage } from "./pages/HomePage";
import { LookupPage } from "./pages/LookupPage";
import { StaticGuidePage } from "./pages/StaticGuidePages";
import {
  CurrencyDetailPage,
  CurrencyPage,
  DictionaryPage,
  ItemsPage,
  SkillGemDetailPage,
  SkillGemsPage
} from "./pages/DataListPages";
import { LevelingPage } from "./pages/LevelingPage";
import { PassiveTreePage } from "./pages/PassiveTreePage";

function useRoute() {
  const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());
  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [locale, setLocale] = useState<Locale>(() => normalizeLocale(localStorage.getItem("poe-locale") || document.documentElement.lang));
  const activeNav = activeNavKey(route);
  const isPassive = route.key === "passiveTree";
  const currentRouteText = routeText(route, locale);

  usePoeTermTooltips(locale, route.key);

  useEffect(() => {
    updateSeo(route, locale);
  }, [route, locale]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(href)) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      navigateTo(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    localStorage.setItem("patchnote-theme", isDark ? "dark" : "light");
    window.dispatchEvent(new CustomEvent("poe-theme-change", { detail: { isDark } }));
  }, [isDark]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    localStorage.setItem("poe-locale", locale);
    window.dispatchEvent(new CustomEvent("poe-locale-change", { detail: { locale } }));
  }, [locale]);

  const content = useMemo(() => renderRoute(route, locale), [route, locale]);

  return (
    <div className={isPassive ? "app app--passive" : "app"}>
      <header className="app-header">
        <a className="brand" href="/">
          <img src="/assets/img/logo.jpg" width="42" height="38" alt="" />
          <span>
            <strong>{uiText("brand", locale)}</strong>
            <small>{currentRouteText.shortTitle}</small>
          </span>
        </a>
        <nav className="nav-rail" aria-label={uiText("mainNav", locale)}>
          {navRoutes.map((item) => {
            const itemText = routeText(item, locale);
            return (
              <a className={activeNav === item.key ? "is-active" : ""} href={item.path} key={item.key}>
                <span className="material-symbols-rounded" aria-hidden="true">{item.icon}</span>
                {itemText.shortTitle}
              </a>
            );
          })}
        </nav>
        <div className="app-actions">
          <div className="segmented" role="group" aria-label={uiText("language", locale)}>
            <button className={locale === "vi" ? "is-active" : ""} type="button" onClick={() => setLocale("vi")}>VI</button>
            <button className={locale === "en" ? "is-active" : ""} type="button" onClick={() => setLocale("en")}>EN</button>
          </div>
          <button className="icon-button" type="button" onClick={() => setIsDark((value) => !value)} aria-label={uiText("toggleTheme", locale)}>
            <span className="material-symbols-rounded" aria-hidden="true">{isDark ? "light_mode" : "dark_mode"}</span>
          </button>
        </div>
      </header>
      {content}
    </div>
  );
}

function renderRoute(route: AppRoute, locale: Locale) {
  switch (route.key) {
    case "home":
      return <HomePage locale={locale} />;
    case "lookup":
      return <LookupPage locale={locale} />;
    case "patchnote":
    case "newbie":
    case "beginner":
    case "weapon":
      return <StaticGuidePage routeKey={route.key} locale={locale} />;
    case "items":
      return <ItemsPage locale={locale} />;
    case "dictionary":
      return <DictionaryPage locale={locale} />;
    case "skillgems":
      return <SkillGemsPage locale={locale} />;
    case "skillgemDetail":
      return <SkillGemDetailPage locale={locale} />;
    case "currency":
      return <CurrencyPage locale={locale} />;
    case "currencyDetail":
      return <CurrencyDetailPage locale={locale} />;
    case "passiveTree":
      return <PassiveTreePage locale={locale} />;
    case "leveling":
      return <LevelingPage locale={locale} />;
    default:
      return <HomePage locale={locale} />;
  }
}

export { routes };
