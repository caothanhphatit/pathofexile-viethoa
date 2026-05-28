import { type Locale, localizedText } from "../lib/locale";
import { routeForKey, routeText, type RouteKey } from "../lib/routes";

const lookupKeys: RouteKey[] = ["items", "currency", "dictionary", "skillgems"];

const copy = {
  eyebrow: { vi: "Lookup hub", en: "Lookup hub" },
  title: { vi: "Tra cứu dữ liệu POE2", en: "POE2 data lookup" },
  body: {
    vi: "Những bảng dữ liệu lớn được tách thành từng công cụ quét nhanh, chỉ tải data khi bạn mở đúng mục.",
    en: "Large data tables are split into focused, fast-scanning tools and only load when you open that section."
  }
};

export function LookupPage({ locale }: { locale: Locale }) {
  return (
    <main className="page-shell">
      <header className="page-title">
        <p className="eyebrow">{localizedText(copy.eyebrow, "", locale)}</p>
        <h1>{localizedText(copy.title, "", locale)}</h1>
        <p>{localizedText(copy.body, "", locale)}</p>
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
