import { type Locale, localizedText, uiText } from "../lib/locale";
import { routeForKey, routeText, type RouteKey } from "../lib/routes";

const featureKeys: RouteKey[] = ["patchnote", "lookup", "newbie", "skillgems", "currency", "passiveTree", "leveling"];

const stats: [string, string | { vi: string; en: string }][] = [
  ["31.468", { vi: "Dòng Việt hóa", en: "Localized lines" }],
  ["355", "Skill gems"],
  ["182", "Currency"],
  ["4.701", "Passive nodes"],
  ["2.864", "Items"]
];

const heroCopy = {
  eyebrow: { vi: "Path of Exile 2 tiếng Việt", en: "Path of Exile 2 reference" },
  title: {
    vi: "Kho tra cứu POE2 gọn, nhanh, đủ sâu để dùng hằng ngày.",
    en: "A lightweight POE2 reference app built for fast daily lookup."
  },
  body: {
    vi: "Một app thống nhất cho patch note, từ điển thuật ngữ, skill gems, currency, item, passive tree và leveling checklist.",
    en: "One SPA for patch notes, dictionary terms, skill gems, currency, items, the passive tree, and a leveling checklist."
  },
  statsLabel: { vi: "Thống kê dữ liệu", en: "Data stats" },
  featuresLabel: { vi: "Tính năng chính", en: "Main features" }
};

export function HomePage({ locale }: { locale: Locale }) {
  return (
    <main className="page-shell home-page">
      <section className="home-hero">
        <div>
          <p className="eyebrow">{localizedText(heroCopy.eyebrow, "", locale)}</p>
          <h1>{localizedText(heroCopy.title, "", locale)}</h1>
          <p className="hero-copy">{localizedText(heroCopy.body, "", locale)}</p>
        </div>
        <img src="/assets/img/logo.jpg" alt={uiText("brand", locale)} width="160" height="142" />
      </section>
      <section className="stat-strip" aria-label={localizedText(heroCopy.statsLabel, "", locale)}>
        {stats.map(([value, label]) => (
          <div className="stat-cell" key={value}>
            <strong>{value}</strong>
            <span>{typeof label === "string" ? label : localizedText(label, "", locale)}</span>
          </div>
        ))}
      </section>
      <section className="route-grid" aria-label={localizedText(heroCopy.featuresLabel, "", locale)}>
        {featureKeys.map((key) => {
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
