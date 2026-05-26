import { useEffect, useState } from "react";
import { loadLevelingData } from "../lib/data";
import { formatNumber, localizedText, type Locale, uiText } from "../lib/locale";
import { asArray, stripMarkup } from "../lib/text";

const copy = {
  eyebrow: { vi: "Campaign route", en: "Campaign route" },
  title: { vi: "Leveling checklist", en: "Leveling checklist" },
  body: {
    vi: "khu vực và cụm nhiệm vụ được gom thành một checklist dễ scan.",
    en: "zones and task clusters grouped into a scannable checklist."
  }
};

export function LevelingPage({ locale }: { locale: Locale }) {
  const [zones, setZones] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadLevelingData().then((data) => {
      if (alive) setZones(asArray(data));
    }).catch((err: Error) => {
      if (alive) setError(err.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <main className="page-shell"><div className="error-panel">{error}</div></main>;
  if (!zones.length) return <main className="page-shell"><div className="loading-panel">{uiText("loadingChecklist", locale)}</div></main>;

  return (
    <main className="page-shell leveling-page">
      <header className="page-title tight">
        <p className="eyebrow">{localizedText(copy.eyebrow, "", locale)}</p>
        <h1>{localizedText(copy.title, "", locale)}</h1>
        <p>{formatNumber(zones.length, locale)} {localizedText(copy.body, "", locale)}</p>
      </header>
      <section className="leveling-list">
        {zones.map((zone) => (
          <article className="leveling-zone" key={zone.id}>
            <header>
              <h2>{zone.title}</h2>
              <span>{zone.level || zone.meta || "Route"}</span>
            </header>
            <ul>
              {asArray<any>(zone.tasks).map((task) => (
                <li key={task.id} className={task.required ? "is-required" : task.tip ? "is-tip" : ""}>
                  <span className="material-symbols-rounded" aria-hidden="true">{task.tip ? "tips_and_updates" : task.required ? "radio_button_checked" : "radio_button_unchecked"}</span>
                  <p>{stripMarkup(task.text)}</p>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
