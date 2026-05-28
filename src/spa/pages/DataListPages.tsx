import { useEffect, useMemo, useState } from "react";
import { DataCard } from "../components/DataCard";
import { FilterBar } from "../components/FilterBar";
import {
  loadCurrencyData,
  loadDictionaryData,
  loadItemsData,
  loadSkillGemsData
} from "../lib/data";
import {
  dictionaryCategoryLabel,
  dictionaryMeaning,
  formatNumber,
  localizedList,
  localizedText,
  type Locale,
  uiText
} from "../lib/locale";
import { asArray, matchesQuery } from "../lib/text";

type LoadState<T> = { data: T | null; error: string; loading: boolean };
type LocaleProps = { locale: Locale };

const pageCopy = {
  skillGems: {
    title: { vi: "Skill gems", en: "Skill gems" },
    placeholder: { vi: "Tìm gem, tag, mô tả...", en: "Search gems, tags, descriptions..." }
  },
  currency: {
    title: { vi: "Currency có thể stack", en: "Stackable currency" },
    placeholder: { vi: "Tìm currency, essence, catalyst...", en: "Search currency, essences, catalysts..." }
  },
  items: {
    title: { vi: "Item database", en: "Item database" },
    placeholder: { vi: "Tìm item, class, base type...", en: "Search items, classes, base types..." }
  },
  dictionary: {
    title: { vi: "Từ điển thuật ngữ", en: "Terminology dictionary" },
    placeholder: { vi: "Tìm thuật ngữ, nghĩa, ví dụ...", en: "Search terms, meanings, examples..." }
  }
};

function useData<T>(loader: () => Promise<T>): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, error: "", loading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: "", loading: true });
    loader().then((data) => {
      if (alive) setState({ data, error: "", loading: false });
    }).catch((error: Error) => {
      if (alive) setState({ data: null, error: error.message, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [loader]);

  return state;
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="loading-panel">{label}</div>;
}

function ErrorPanel({ message, locale }: { message: string; locale: Locale }) {
  return <div className="error-panel">{uiText("loadFailed", locale)}: {message}</div>;
}

function PageHeader({ eyebrow, title, count, locale }: { eyebrow: string; title: string; count?: number; locale: Locale }) {
  return (
    <header className="page-title tight">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {typeof count === "number" ? <p>{formatNumber(count, locale)} {uiText("recordsReady", locale)}</p> : null}
    </header>
  );
}

function matchesLocalizedQuery(query: string, ...values: unknown[]): boolean {
  const flat = values.flatMap((value) => Array.isArray(value) ? value : [value]);
  return matchesQuery({ values: flat }, query, ["values"]);
}

function localizedSections(row: any, locale: Locale): string[] {
  const rawSections = asArray<any>(row.sections);
  const translatedSections = asArray<any>(row.i18n?.sections);
  const source = translatedSections.length ? translatedSections : rawSections;
  return source.flatMap((section, index) => {
    const rawSection = rawSections[index] ?? {};
    const title = localizedText(section.title, rawSection.title, locale);
    const lines = localizedList(section.lines, rawSection.lines, locale);
    return [title, ...lines].filter(Boolean);
  });
}

export function SkillGemsPage({ locale }: LocaleProps) {
  const { data, loading, error } = useData(loadSkillGemsData);
  const [query, setQuery] = useState("");
  const rows = asArray<any>(data?.gems);
  const filtered = useMemo(() => rows.filter((gem) => matchesLocalizedQuery(
    query,
    localizedText(gem.i18n?.name, gem.name, locale),
    localizedText(gem.i18n?.summary, gem.summary_en, locale),
    localizedList(gem.i18n?.tags, gem.tags, locale),
    localizedList(gem.i18n?.properties, gem.properties, locale)
  )), [rows, query, locale]);

  if (loading) return <LoadingPanel label={uiText("loadingData", locale)} />;
  if (error) return <ErrorPanel message={error} locale={locale} />;

  return (
    <main className="page-shell">
      <PageHeader eyebrow="Skill gems" title={localizedText(pageCopy.skillGems.title, "", locale)} count={rows.length} locale={locale} />
      <FilterBar query={query} onQueryChange={setQuery} placeholder={localizedText(pageCopy.skillGems.placeholder, "", locale)} />
      <section className="data-grid">
        {filtered.slice(0, 96).map((gem) => {
          const title = localizedText(gem.i18n?.name, gem.name, locale);
          const summary = localizedText(gem.i18n?.summary, gem.summary_en, locale);
          const tags = localizedList(gem.i18n?.tags, gem.tags, locale);
          return (
            <DataCard
              key={gem.slug}
              title={title}
              subtitle={summary}
              image={gem.icon_url}
              badges={[`Tier ${gem.tier ?? "?"}`, ...tags]}
              href={`/skill-gem?slug=${encodeURIComponent(gem.slug)}`}
            />
          );
        })}
      </section>
    </main>
  );
}

export function SkillGemDetailPage({ locale }: LocaleProps) {
  const { data, loading, error } = useData(loadSkillGemsData);
  const slug = new URLSearchParams(window.location.search).get("slug") || "";
  const gem = asArray<any>(data?.gems).find((row) => row.slug === slug) ?? asArray<any>(data?.gems)[0];

  if (loading) return <LoadingPanel label={uiText("loadingData", locale)} />;
  if (error) return <ErrorPanel message={error} locale={locale} />;
  if (!gem) return <ErrorPanel message={uiText("notFoundGem", locale)} locale={locale} />;

  const title = localizedText(gem.i18n?.name, gem.name, locale);
  const summary = localizedText(gem.i18n?.summary, gem.summary_en, locale);

  return (
    <main className="page-shell detail-page">
      <a className="back-link" href="/skill-gems">← Skill gems</a>
      <article className="detail-panel">
        <img src={gem.icon_url} alt="" />
        <div>
          <p className="eyebrow">Tier {gem.tier ?? "?"}</p>
          <h1 translate="no">{title}</h1>
          <p>{summary}</p>
          <div className="badges">{localizedList(gem.i18n?.tags, gem.tags, locale).map((tag) => <span key={tag}>{tag}</span>)}</div>
        </div>
      </article>
      <section className="detail-columns">
        <DetailList title={uiText("properties", locale)} rows={localizedList(gem.i18n?.properties, gem.properties, locale)} />
        <DetailList title={uiText("requirements", locale)} rows={localizedList(gem.i18n?.requirements, gem.requirements, locale)} />
        <DetailList title={uiText("mods", locale)} rows={localizedList(gem.i18n?.mods, gem.mods, locale)} />
        <DetailList title={uiText("effects", locale)} rows={localizedSections(gem, locale)} />
      </section>
    </main>
  );
}

export function CurrencyPage({ locale }: LocaleProps) {
  const { data, loading, error } = useData(loadCurrencyData);
  const [query, setQuery] = useState("");
  const rows = asArray<any>(data?.items ?? data?.currency ?? data?.records);
  const filtered = useMemo(() => rows.filter((item) => matchesLocalizedQuery(
    query,
    localizedText(item.i18n?.name, item.name ?? item.title, locale),
    localizedText(item.i18n?.description, item.description_en || item.description || item.effect, locale),
    localizedText(item.i18n?.category_label, item.category_label, locale),
    localizedText(item.i18n?.subtype_label, item.subtype_label, locale),
    localizedList(item.i18n?.properties, item.properties, locale),
    localizedList(item.i18n?.mods, item.mods, locale)
  )), [rows, query, locale]);

  if (loading) return <LoadingPanel label={uiText("loadingData", locale)} />;
  if (error) return <ErrorPanel message={error} locale={locale} />;

  return (
    <main className="page-shell">
      <PageHeader eyebrow="Currency" title={localizedText(pageCopy.currency.title, "", locale)} count={rows.length} locale={locale} />
      <FilterBar query={query} onQueryChange={setQuery} placeholder={localizedText(pageCopy.currency.placeholder, "", locale)} />
      <section className="data-grid">
        {filtered.slice(0, 120).map((item) => {
          const title = localizedText(item.i18n?.name, item.name ?? item.title, locale);
          const description = localizedText(item.i18n?.description, item.description_en || item.description || item.effect, locale);
          const category = localizedText(item.i18n?.category_label, item.category_label, locale);
          const subtype = localizedText(item.i18n?.subtype_label, item.subtype_label, locale);
          return (
            <DataCard
              key={item.slug ?? item.name}
              title={title}
              subtitle={description || item.effect || category}
              image={item.icon_url}
              badges={[category, subtype].filter(Boolean)}
              href={`/currency-detail?slug=${encodeURIComponent(item.slug ?? item.name ?? "")}`}
            />
          );
        })}
      </section>
    </main>
  );
}

export function CurrencyDetailPage({ locale }: LocaleProps) {
  const { data, loading, error } = useData(loadCurrencyData);
  const slug = new URLSearchParams(window.location.search).get("slug") || "";
  const rows = asArray<any>(data?.items ?? data?.currency ?? data?.records);
  const item = rows.find((row) => row.slug === slug || row.name === slug) ?? rows[0];

  if (loading) return <LoadingPanel label={uiText("loadingData", locale)} />;
  if (error) return <ErrorPanel message={error} locale={locale} />;
  if (!item) return <ErrorPanel message={uiText("notFoundCurrency", locale)} locale={locale} />;

  const title = localizedText(item.i18n?.name, item.name ?? item.title, locale);
  const description = localizedText(item.i18n?.description, item.description_en || item.description || item.effect || item.flavour_text, locale);
  const category = localizedText(item.i18n?.category_label, item.category_label, locale);
  const subtype = localizedText(item.i18n?.subtype_label, item.subtype_label, locale);
  const mods = localizedList(item.i18n?.mods, item.mods, locale);

  return (
    <main className="page-shell detail-page">
      <a className="back-link" href="/currency">← Currency</a>
      <article className="detail-panel">
        {item.icon_url ? <img src={item.icon_url} alt="" /> : null}
        <div>
          <p className="eyebrow">{category || "Currency"}</p>
          <h1 translate="no">{title}</h1>
          <p>{description || item.flavour_text}</p>
          <div className="badges">{[subtype, item.rarity].filter(Boolean).map((tag) => <span key={tag}>{tag}</span>)}</div>
        </div>
      </article>
      <section className="detail-columns">
        <DetailList title={uiText("properties", locale)} rows={localizedList(item.i18n?.properties, item.properties, locale)} />
        <DetailList title={uiText("effects", locale)} rows={[description, ...mods, item.flavour_text].filter(Boolean)} />
      </section>
    </main>
  );
}

export function ItemsPage({ locale }: LocaleProps) {
  const { data, loading, error } = useData(loadItemsData);
  const [query, setQuery] = useState("");
  const rows = asArray<any>(data?.items ?? data?.records);
  const filtered = useMemo(() => rows.filter((item) => matchesLocalizedQuery(
    query,
    localizedText(item.i18n?.name, item.name ?? item.base_type, locale),
    item.base_type,
    item.menu_label,
    item.group_label,
    item.item_class,
    localizedList(item.i18n?.properties, item.properties, locale),
    localizedList(item.i18n?.mods, item.mods, locale)
  )), [rows, query, locale]);

  if (loading) return <LoadingPanel label={uiText("loadingData", locale)} />;
  if (error) return <ErrorPanel message={error} locale={locale} />;

  return (
    <main className="page-shell">
      <PageHeader eyebrow="Items" title={localizedText(pageCopy.items.title, "", locale)} count={rows.length} locale={locale} />
      <FilterBar query={query} onQueryChange={setQuery} placeholder={localizedText(pageCopy.items.placeholder, "", locale)} />
      <section className="data-grid">
        {filtered.slice(0, 120).map((item, index) => {
          const title = localizedText(item.i18n?.name, item.name ?? item.base_type ?? "Unnamed item", locale);
          return (
            <DataCard
              key={`${item.slug ?? item.name}-${index}`}
              title={title}
              subtitle={item.base_type ?? item.item_class ?? item.group_label}
              image={item.icon_url}
              badges={[item.group_label, item.menu_label, item.rarity].filter(Boolean)}
            />
          );
        })}
      </section>
    </main>
  );
}

export function DictionaryPage({ locale }: LocaleProps) {
  const { data, loading, error } = useData(loadDictionaryData);
  const [query, setQuery] = useState("");
  const rows = asArray<any>(data?.terms);
  const filtered = useMemo(() => rows.filter((term) => matchesLocalizedQuery(
    query,
    term.term,
    dictionaryMeaning(term, locale),
    asArray<string>(term.variants),
    asArray<string>(term.examples),
    dictionaryCategoryLabel(term.category, locale, data?.categories?.[term.category])
  )), [rows, query, locale, data?.categories]);

  if (loading) return <LoadingPanel label={uiText("loadingData", locale)} />;
  if (error) return <ErrorPanel message={error} locale={locale} />;

  return (
    <main className="page-shell">
      <PageHeader eyebrow="Dictionary" title={localizedText(pageCopy.dictionary.title, "", locale)} count={rows.length} locale={locale} />
      <FilterBar query={query} onQueryChange={setQuery} placeholder={localizedText(pageCopy.dictionary.placeholder, "", locale)} />
      <section className="dictionary-list">
        {filtered.slice(0, 160).map((term) => (
          <article className="dictionary-row" key={term.term}>
            <strong translate="no">{term.term}</strong>
            <p>{dictionaryMeaning(term, locale)}</p>
            <span>{dictionaryCategoryLabel(term.category, locale, data?.categories?.[term.category])}</span>
          </article>
        ))}
      </section>
    </main>
  );
}

function DetailList({ title, rows }: { title: string; rows: unknown }) {
  const list = asArray<string>(rows).filter(Boolean);
  if (!list.length) return null;
  return (
    <article className="detail-list">
      <h2>{title}</h2>
      <ul>{list.slice(0, 24).map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}</ul>
    </article>
  );
}
