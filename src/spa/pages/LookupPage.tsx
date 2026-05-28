import { type Locale, localizedText } from "../lib/locale";
import { routeForKey, routeText, type RouteKey } from "../lib/routes";

const lookupKeys: RouteKey[] = ["items", "currency", "dictionary", "skillgems"];

const copy = {
  eyebrow: { vi: "Lookup hub", en: "Lookup hub" },
  title: { vi: "Tra cứu dữ liệu POE2", en: "POE2 data lookup" }
};

export function LookupPage({ locale }: { locale: Locale }) {
  return (
    <main className="page-shell lookup-page">
      <header className="page-title tight lookup-title">
        <p className="eyebrow">{localizedText(copy.eyebrow, "", locale)}</p>
        <h1>{localizedText(copy.title, "", locale)}</h1>
      </header>
      <section className="route-grid compact">
        {lookupKeys.map((key) => {
          const route = routeForKey(key);
          const text = routeText(route, locale);
          return (
            <a className="route-card" href={route.path} key={route.key}>
              <span className="material-symbols-rounded" aria-hidden="true">{route.icon}</span>
              <h2>{text.shortTitle}</h2>
              <p>{text.description}</p>
            </a>
          );
        })}
      </section>
    </main>
  );
}
