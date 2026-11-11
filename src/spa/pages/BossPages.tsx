import { useEffect, useMemo, useState } from "react";
import { type Locale, localizedText } from "../lib/locale";
import { bossGroups, type BossEntry, type BossType, type LocalizedText } from "../lib/bossList";
import { loadBossDetails, loadBossDropItems, loadBossImages, loadPoePrices } from "../lib/data";
import { routeForKey } from "../lib/routes";
import { updateSeo } from "../lib/seo";

type L = LocalizedText;

const t = {
  title: { vi: "Danh sách Boss", en: "Boss list" },
  lead: {
    vi: "Boss optional và boss endgame của Path of Exile 2, kèm hướng dẫn cơ chế, chiến thuật và drop.",
    en: "Optional and endgame bosses in Path of Exile 2, with mechanics, strategy and drops."
  },
  search: { vi: "Tìm boss theo tên, vị trí hoặc ghi chú…", en: "Search by name, location or note…" },
  all: { vi: "Tất cả", en: "All" },
  jump: { vi: "Nhảy tới nhóm", en: "Jump to group" },
  detail: { vi: "Chi tiết", en: "Details" },
  noResults: { vi: "Không tìm thấy boss nào khớp bộ lọc.", en: "No bosses match the current filter." },
  back: { vi: "Danh sách boss", en: "Boss list" },
  loading: { vi: "Đang tải hướng dẫn…", en: "Loading the guide…" },
  loadError: { vi: "Không tải được dữ liệu boss.", en: "Could not load boss data." },
  notFound: { vi: "Không tìm thấy boss", en: "Boss not found" },
  notFoundHint: { vi: "Boss này không có trong dữ liệu hiện tại.", en: "This boss is not in the current data." },
  noData: { vi: "Không có dữ liệu.", en: "No data available." },
  overview: { vi: "Tổng quan", en: "Overview" },
  mechanics: { vi: "Cơ chế", en: "Mechanics" },
  phases: { vi: "Các pha", en: "Phases" },
  strategy: { vi: "Chiến thuật", en: "Strategy" },
  rewards: { vi: "Phần thưởng / Drop", en: "Rewards / Drops" },
  tips: { vi: "Mẹo", en: "Tips" },
  gallery: { vi: "Hình ảnh & cơ chế", en: "Images & mechanics" },
  conditions: { vi: "Điều kiện mở & vào", en: "Access requirements" },
  access: { vi: "Cách vào map boss", en: "How to access" },
  route: { vi: "Lộ trình A→Z", en: "Route A→Z" }
};

const typeLabels: Record<BossType, L> = {
  Optional: { vi: "Optional", en: "Optional" },
  Atlas: { vi: "Atlas", en: "Atlas" },
  Trial: { vi: "Trial", en: "Trial" },
  Ritual: { vi: "Ritual", en: "Ritual" },
  Delirium: { vi: "Delirium", en: "Delirium" },
  Breach: { vi: "Breach", en: "Breach" },
  Abyss: { vi: "Abyss", en: "Abyss" },
  Temple: { vi: "Temple", en: "Temple" },
  Expedition: { vi: "Expedition", en: "Expedition" },
  Pinnacle: { vi: "Pinnacle", en: "Pinnacle" }
};

// Optional bosses are already split by act in their group headings, so they get no chip.
const filterTypes = (Object.keys(typeLabels) as BossType[])
  .filter((type) => type !== "Optional" && bossGroups.some((group) => group.bosses.some((boss) => boss.type === type)));
const totalBosses = bossGroups.reduce((sum, group) => sum + group.bosses.length, 0);

export const bossDetailHref = (slug: string) => `/boss-detail?boss=${encodeURIComponent(slug)}`;

const useText = (locale: Locale) => (value: L | undefined, fallback = "") =>
  value ? localizedText(value, value.vi || fallback, locale) : fallback;

// ── List ─────────────────────────────────────────────────────────────────

export function BossListPage({ locale }: { locale: Locale }) {
  const text = useText(locale);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<BossType | "all">("all");
  const [images, setImages] = useState<Record<string, { hero?: string }>>({});

  useEffect(() => {
    let alive = true;
    loadBossImages().then((value) => { if (alive) setImages(value || {}); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (boss: BossEntry) => {
      if (type !== "all" && boss.type !== type) return false;
      if (!q) return true;
      return [boss.name, boss.location, boss.note?.vi, boss.note?.en].filter(Boolean).join(" ").toLowerCase().includes(q);
    };
    return bossGroups
      .map((group) => ({ ...group, bosses: group.bosses.filter(matches) }))
      .filter((group) => group.bosses.length > 0);
  }, [query, type]);

  const shown = groups.reduce((sum, group) => sum + group.bosses.length, 0);

  return (
    <main className="page-shell boss-page">
      <header className="page-title tight boss-title">
        <div>
          <h1>{text(t.title)}</h1>
          <p>{text(t.lead)}</p>
        </div>
        <span className="boss-count">{shown === totalBosses ? totalBosses : `${shown}/${totalBosses}`} boss</span>
      </header>

      <section className="boss-toolbar">
        <label className="boss-search">
          <span className="material-symbols-rounded" aria-hidden="true">search</span>
          <input type="search" value={query} placeholder={text(t.search)} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="boss-chips" role="group">
          <button type="button" className={type === "all" ? "is-active" : ""} onClick={() => setType("all")}>{text(t.all)}</button>
          {filterTypes.map((item) => (
            <button type="button" key={item} className={type === item ? "is-active" : ""} onClick={() => setType(item)}>
              {text(typeLabels[item])}
            </button>
          ))}
        </div>
        {groups.length > 1 ? (
          <nav className="boss-jump" aria-label={text(t.jump)}>
            <span className="boss-jump-label">{text(t.jump)}</span>
            {groups.map((group) => (
              <a key={group.id} href={`#group-${group.id}`}>
                {text(group.label)} <b>{group.bosses.length}</b>
              </a>
            ))}
          </nav>
        ) : null}
      </section>

      {groups.length === 0 ? (
        <p className="boss-empty">{text(t.noResults)}</p>
      ) : groups.map((group) => (
        <section className="boss-group" id={`group-${group.id}`} key={group.id}>
          <header>
            <h2>{text(group.label)}</h2>
            <span className="boss-group-count">{group.bosses.length}</span>
          </header>
          <ul>
            {group.bosses.map((boss) => {
              const hero = boss.slug ? images[boss.slug]?.hero : undefined;
              const href = boss.slug ? bossDetailHref(boss.slug) : undefined;
              return (
                <li className={`boss-row${boss.type === "Pinnacle" ? " is-pinnacle" : ""}`} key={`${group.id}-${boss.name}`}>
                  {href && hero ? (
                    <a className="boss-thumb" href={href}><img src={hero} alt="" loading="lazy" /></a>
                  ) : (
                    <span className="boss-thumb is-empty"><span className="material-symbols-rounded" aria-hidden="true">skull</span></span>
                  )}
                  <div className="boss-row-main">
                    <div className="boss-row-head">
                      {href ? <a className="boss-name" href={href} translate="no">{boss.name}</a> : <span className="boss-name" translate="no">{boss.name}</span>}
                      <span className={`boss-type type-${boss.type.toLowerCase()}`}>{text(typeLabels[boss.type])}</span>
                      {href ? <a className="boss-detail-link" href={href}>{text(t.detail)}</a> : null}
                    </div>
                    <div className="boss-location">
                      <span className="material-symbols-rounded" aria-hidden="true">location_on</span>
                      {boss.location}
                    </div>
                  </div>
                  {boss.note ? <p className="boss-note">{text(boss.note)}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────

type Drop = { name: string; image?: string | null };
type Phase = { name?: string; points?: string[]; vi?: string; en?: string };
type DropItem = { base?: string; requires?: string; implicit?: string[]; explicit?: string[]; flavour?: string };
type Price = { divine?: number; chaos?: number };
type BossDetail = {
  name: string;
  group?: string;
  location?: string;
  vi?: { overview?: string; mechanics?: string[]; phases?: Phase[]; strategy?: string; rewards?: string[]; tips?: string[] };
  drops?: Drop[];
  conditions?: string[];
  access?: { method?: string; obtain?: string; items?: { name: string; image?: string; source?: string }[] };
  guide?: boolean;
  flow?: string[];
  parts?: { name: string; subtitle?: string; image?: string; access?: string; phases?: Phase[]; drops?: Drop[] }[];
};
type BossImages = { hero?: string; images?: { url: string; alt?: string }[] };

type DetailData = {
  boss: BossDetail | null;
  images: BossImages | null;
  dropItems: Record<string, DropItem>;
  prices: Record<string, Price>;
};

const normText = (value: string | undefined) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function priceLabel(price: Price | undefined): string {
  if (!price) return "";
  if (price.divine && price.divine >= 1) return `${price.divine} Div`;
  if (price.chaos && price.chaos >= 1) return `${price.chaos}c`;
  if (price.divine && price.divine > 0) return `${price.divine} Div`;
  if (price.chaos) return `${price.chaos}c`;
  return "";
}

function Section({ title, icon, tone, children }: { title: string; icon?: string; tone?: "accent" | "warn"; children: React.ReactNode }) {
  return (
    <section className={`boss-section${tone ? ` is-${tone}` : ""}`}>
      <h2>{icon ? <span className="material-symbols-rounded" aria-hidden="true">{icon}</span> : null}{title}</h2>
      {children}
    </section>
  );
}

function PhaseList({ phases }: { phases: Phase[] }) {
  return (
    <ul className="boss-lines">
      {phases.map((phase, index) => (
        <li key={`${phase.name}-${index}`}>
          <strong translate="no">{phase.name}</strong>
          {phase.points?.length ? (
            <ul className="boss-points">{phase.points.map((point) => <li key={point}>{point}</li>)}</ul>
          ) : <p>{phase.vi || phase.en}</p>}
        </li>
      ))}
    </ul>
  );
}

function DropRows({ drops, dropItems, prices }: { drops: Drop[]; dropItems: Record<string, DropItem>; prices: Record<string, Price> }) {
  return (
    <div className="boss-drops">
      {drops.map((drop) => {
        const stats = dropItems[drop.name];
        const price = priceLabel(prices[drop.name]);
        const head = (
          <>
            {drop.image ? <img src={drop.image} alt="" loading="lazy" /> : <span className="boss-drop-icon material-symbols-rounded" aria-hidden="true">inventory_2</span>}
            <span className="boss-drop-name">{drop.name}</span>
            {price ? <span className="boss-price"><span className="material-symbols-rounded" aria-hidden="true">payments</span>{price}</span> : null}
          </>
        );
        if (!stats) return <div className="boss-drop" key={drop.name}>{head}</div>;
        const mods = [...(stats.implicit || []), ...(stats.explicit || [])];
        return (
          <details className="boss-drop" key={drop.name}>
            <summary>{head}<span className="material-symbols-rounded boss-drop-toggle" aria-hidden="true">expand_more</span></summary>
            <div className="boss-item-card">
              {stats.base ? <div className="boss-item-base">{stats.base}</div> : null}
              {stats.requires ? <div className="boss-item-req">{stats.requires}</div> : null}
              {mods.length ? <div className="boss-item-mods">{mods.map((mod) => <div key={mod}>{mod}</div>)}</div> : null}
              {stats.flavour ? <div className="boss-item-flavour">{stats.flavour}</div> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function BossDetailPage({ locale }: { locale: Locale }) {
  const text = useText(locale);
  const slug = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("boss") || params.get("id") || "";
  }, []);
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadBossDetails(),
      loadBossImages().catch(() => ({})),
      loadBossDropItems().catch(() => ({})),
      loadPoePrices().catch(() => ({}))
    ]).then(([details, images, dropItems, prices]) => {
      if (!alive) return;
      setData({ boss: details?.[slug] || null, images: images?.[slug] || null, dropItems: dropItems || {}, prices: prices || {} });
    }).catch((err: Error) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    if (!data?.boss) return;
    updateSeo(routeForKey("bossDetail"), locale, {
      title: `${data.boss.name} - Boss POE2`,
      description: data.boss.vi?.overview?.slice(0, 300) || undefined,
      canonicalPath: bossDetailHref(slug)
    });
  }, [data, locale, slug]);

  const back = (
    <a className="boss-back" href="/boss"><span className="material-symbols-rounded" aria-hidden="true">arrow_back</span>{text(t.back)}</a>
  );

  if (error) return <main className="page-shell boss-detail">{back}<p className="boss-empty">{text(t.loadError)} ({error})</p></main>;
  if (!data) return <main className="page-shell boss-detail">{back}<p className="boss-empty">{text(t.loading)}</p></main>;
  if (!data.boss) {
    return (
      <main className="page-shell boss-detail">
        {back}
        <section className="boss-section"><h2>{text(t.notFound)}</h2><p>{text(t.notFoundHint)}</p></section>
      </main>
    );
  }

  const { boss, images, dropItems, prices } = data;
  const vi = boss.vi || {};
  const hero = images?.hero;
  const badges = (
    <div className="boss-badges">
      {boss.group ? <span><span className="material-symbols-rounded" aria-hidden="true">category</span>{boss.group}</span> : null}
      {boss.location ? <span><span className="material-symbols-rounded" aria-hidden="true">location_on</span>{boss.location}</span> : null}
    </div>
  );
  const heroBlock = hero ? (
    <section className="boss-hero">
      <img src={hero} alt={boss.name} loading="eager" decoding="async" />
      <div className="boss-hero-shade" />
      <div className="boss-hero-top">{back}</div>
      <div className="boss-hero-body"><h1 translate="no">{boss.name}</h1>{badges}</div>
    </section>
  ) : (
    <section className="boss-hero is-plain">
      {back}
      <h1 translate="no">{boss.name}</h1>
      {badges}
    </section>
  );
  const overview = <Section title={text(t.overview)}><p>{vi.overview || text(t.noData)}</p></Section>;

  // Combined guide for a chain of related bosses (for example Ritual).
  if (boss.guide) {
    return (
      <main className="page-shell boss-detail">
        {heroBlock}
        {overview}
        {boss.flow?.length ? (
          <Section title={text(t.route)} icon="route" tone="accent">
            <ol className="boss-flow">{boss.flow.map((step) => <li key={step}>{step}</li>)}</ol>
          </Section>
        ) : null}
        {(boss.parts || []).map((part) => (
          <section className="boss-section boss-part" key={part.name}>
            <header className="boss-part-head">
              {part.image ? <img src={part.image} alt="" loading="lazy" /> : null}
              <div><h2 translate="no">{part.name}</h2>{part.subtitle ? <small>{part.subtitle}</small> : null}</div>
            </header>
            {part.access ? <p className="boss-part-access"><span className="material-symbols-rounded" aria-hidden="true">key</span>{part.access}</p> : null}
            {part.phases?.length ? <PhaseList phases={part.phases} /> : null}
            {part.drops?.length ? <><h3 className="boss-subhead">Drop</h3><DropRows drops={part.drops} dropItems={dropItems} prices={prices} /></> : null}
          </section>
        ))}
      </main>
    );
  }

  const allImages = images?.images || [];
  // Curated drops (name + image) first; otherwise reward text matched to gallery images by alt text.
  const drops: Drop[] = boss.drops?.length
    ? boss.drops
    : (vi.rewards || []).map((reward) => {
        const wanted = normText(reward);
        const hit = allImages.find((image) => {
          const alt = normText(image.alt);
          return alt.length > 2 && (wanted.includes(alt) || alt.includes(wanted.split("(")[0].trim()));
        });
        return { name: reward, image: hit?.url ?? null };
      });
  const gallery = allImages.slice(0, 12);

  return (
    <main className="page-shell boss-detail">
      {heroBlock}
      {overview}
      <Section title={text(t.rewards)}>
        {drops.length ? <DropRows drops={drops} dropItems={dropItems} prices={prices} /> : <p>{text(t.noData)}</p>}
      </Section>
      {boss.access ? (
        <Section title={text(t.access)} icon="map" tone="warn">
          {boss.access.method ? <p>{boss.access.method}</p> : null}
          {boss.access.items?.length ? (
            <div className="boss-access-items">
              {boss.access.items.map((item) => (
                <div key={item.name}>
                  {item.image ? <img src={item.image} alt="" loading="lazy" /> : null}
                  <div><strong translate="no">{item.name}</strong>{item.source ? <small>{item.source}</small> : null}</div>
                </div>
              ))}
            </div>
          ) : null}
          {boss.access.obtain ? <p className="boss-access-obtain">{boss.access.obtain}</p> : null}
        </Section>
      ) : boss.conditions?.length ? (
        <Section title={text(t.conditions)} icon="key" tone="warn">
          <ul className="boss-points">{boss.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>
        </Section>
      ) : null}
      {vi.phases?.length ? (
        <Section title={text(t.phases)}><PhaseList phases={vi.phases} /></Section>
      ) : (
        <Section title={text(t.mechanics)}>
          {vi.mechanics?.length ? <ul className="boss-points">{vi.mechanics.map((line) => <li key={line}>{line}</li>)}</ul> : <p>{text(t.noData)}</p>}
        </Section>
      )}
      <Section title={text(t.strategy)}><p>{vi.strategy || text(t.noData)}</p></Section>
      <Section title={text(t.tips)}>
        {vi.tips?.length ? <ul className="boss-points">{vi.tips.map((line) => <li key={line}>{line}</li>)}</ul> : <p>{text(t.noData)}</p>}
      </Section>
      {gallery.length ? (
        <Section title={text(t.gallery)}>
          <div className="boss-gallery">
            {gallery.map((image) => (
              <a key={image.url} href={image.url} target="_blank" rel="noopener noreferrer">
                <img src={image.url} alt={image.alt || ""} loading="lazy" />
                {image.alt ? <span>{image.alt}</span> : null}
              </a>
            ))}
          </div>
        </Section>
      ) : null}
    </main>
  );
}
