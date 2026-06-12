import { useEffect, useMemo, useState } from "react";
import { type Locale } from "../lib/locale";
import { loadCraftData, loadCraftIndex, loadCurrencyData, useAsyncData } from "../lib/data";
import {
  type CraftItem, type CraftPool, type Rarity,
  CURRENCIES, findCurrency, applyCurrency, prefixCount, suffixCount
} from "../lib/craftEngine";

interface BaseEntry { name: string; slug: string; icon: string | null; attr: string | null; req_level: number; craft_key: string; }
interface ClassEntry { label: string; attr_split: boolean; base_count: number; bases: BaseEntry[]; }
interface GroupEntry { group: string; classes: ClassEntry[]; }

interface CurrencyItem { name: string; icon_url: string | null; category_label: string; family_label: string; description_en?: string; }

const RARITY_NEXT: Record<Rarity, string> = { normal: "rarity-normal", magic: "rarity-magic", rare: "rarity-rare" };

// Stash sub-tabs -> currency category_label in currency-data.
const STASH_TABS: { key: string; label: string; cats: string[] }[] = [
  { key: "currency", label: "Currency", cats: ["Currency"] },
  { key: "essence", label: "Essence", cats: ["Essence"] },
  { key: "catalyst", label: "Catalyst", cats: ["Catalyst"] }
];
// Display order of currency families inside the Currency tab.
const FAMILY_ORDER = ["Crafting Orb", "Socket Currency", "Quality Currency", "Corruption Currency", "Shard", "Utility Currency", "Omen", "Desecration Currency", "Delirium Liquid", "Gem Currency", "Expedition Artifact"];

function makeItem(base: BaseEntry, ilvl: number): CraftItem {
  return {
    baseName: base.name, icon: base.icon, attr: base.attr, itemClass: base.craft_key,
    ilvl, implicit: null, rarity: "normal", corrupted: false, craftKey: base.craft_key, mods: []
  };
}

export function CraftSimPage({ locale }: { locale: Locale }) {
  void locale;
  const [index, setIndex] = useState<{ tree: GroupEntry[] } | null>(null);
  const [craft, setCraft] = useState<{ classes: Record<string, CraftPool> } | null>(null);
  const [currency, setCurrency] = useState<CurrencyItem[]>([]);
  const [err, setErr] = useState("");

  const [item, setItem] = useState<CraftItem | null>(null);
  const [ilvl, setIlvl] = useState(82);
  const [held, setHeld] = useState<CurrencyItem | null>(null);
  const [tab, setTab] = useState("currency");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => useAsyncData(loadCraftIndex, (d) => setIndex(d), (e) => setErr(e.message)), []);
  useEffect(() => useAsyncData(loadCraftData, (d) => setCraft(d), (e) => setErr(e.message)), []);
  useEffect(() => useAsyncData(loadCurrencyData, (d) => setCurrency(d.items || []), (e) => setErr(e.message)), []);

  const pool = item && craft ? craft.classes[item.craftKey] : null;

  const stashItems = useMemo(() => {
    const cats = STASH_TABS.find((t) => t.key === tab)?.cats || [];
    const list = currency.filter((c) => cats.includes(c.category_label));
    const groups = new Map<string, CurrencyItem[]>();
    for (const c of list) {
      const fam = tab === "currency" ? c.family_label : c.category_label;
      if (!groups.has(fam)) groups.set(fam, []);
      groups.get(fam)!.push(c);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      const ia = FAMILY_ORDER.indexOf(a[0]); const ib = FAMILY_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ordered;
  }, [currency, tab]);

  const showFlash = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(""), 1800); };

  const pickBase = (base: BaseEntry) => {
    setItem(makeItem(base, ilvl));
    setPickerOpen(false);
    setLog([`Chọn base: ${base.name} (ilvl ${ilvl})`]);
    setHeld(null);
  };

  const useCurrencyOnItem = () => {
    if (!held || !item || !pool) return;
    const spec = findCurrency(held.name);
    if (!spec) { showFlash(`"${held.name}" chưa hỗ trợ craft`); return; }
    const next: CraftItem = { ...item, mods: item.mods.map((m) => ({ ...m })) };
    const error = applyCurrency(spec, held.name, pool, next);
    if (error) { showFlash(error); return; }
    setItem(next);
    setLog((l) => [`${held.name} → ${next.rarity}${next.corrupted ? " (corrupted)" : ""}, ${next.mods.length} mod`, ...l].slice(0, 12));
  };

  const reset = () => { if (item) setItem(makeItem({ name: item.baseName, slug: "", icon: item.icon, attr: item.attr, req_level: 0, craft_key: item.craftKey }, ilvl)); setHeld(null); setLog([]); };

  const prefixes = item ? item.mods.filter((m) => m.gen === "prefix") : [];
  const suffixes = item ? item.mods.filter((m) => m.gen === "suffix") : [];

  return (
    <main className="page-shell craft-sim" onClick={() => held && useCurrencyOnItem()}>
      <header className="craft-sim__head">
        <div>
          <p className="eyebrow">Crafting Simulator</p>
          <h1>Bàn Craft</h1>
        </div>
        <div className="craft-sim__controls">
          <label className="craft-ilvl">iLvl
            <input type="number" min={1} max={100} value={ilvl}
              onChange={(e) => setIlvl(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
          </label>
          <button className="craft-btn" type="button" onClick={(e) => { e.stopPropagation(); reset(); }}>↺ Reset</button>
        </div>
      </header>

      {err ? <p className="craft-error">Lỗi tải dữ liệu: {err}</p> : null}

      <div className="craft-layout">
        {/* ITEM PANEL */}
        <section className="craft-item-col">
          <div translate="no" className={`craft-item ${item ? RARITY_NEXT[item.rarity] : ""} ${held ? "is-target" : ""}`}
            onClick={(e) => { e.stopPropagation(); if (held) useCurrencyOnItem(); else if (!item) setPickerOpen(true); }}>
            {item ? (
              <>
                <div className="craft-item__title">
                  {item.icon ? <img src={item.icon} alt="" loading="lazy" /> : null}
                  <div>
                    <strong translate="no">{item.baseName}</strong>
                    <small>{item.itemClass} · {item.corrupted ? "Corrupted" : item.rarity}</small>
                  </div>
                </div>
                <div className="craft-item__body">
                  <div className="craft-item__meta">Item Level: {item.ilvl}{item.attr ? ` · ${item.attr}` : ""}</div>
                  {prefixes.length ? <div className="craft-item__group-label">Prefix ({prefixCount(item)}/3)</div> : null}
                  {prefixes.map((m, i) => (
                    <div className="craft-mod" key={`p${i}`}><span className="craft-mod__tier">T{m.tierLabel}</span><span dangerouslySetInnerHTML={{ __html: m.text }} />{m.fractured ? <span className="craft-mod__frac">fractured</span> : null}</div>
                  ))}
                  {suffixes.length ? <div className="craft-item__group-label">Suffix ({suffixCount(item)}/3)</div> : null}
                  {suffixes.map((m, i) => (
                    <div className="craft-mod" key={`s${i}`}><span className="craft-mod__tier">T{m.tierLabel}</span><span dangerouslySetInnerHTML={{ __html: m.text }} /></div>
                  ))}
                  {!item.mods.length ? <div className="craft-item__empty">Item trắng — right-click một currency rồi bấm vào đây để craft.</div> : null}
                </div>
              </>
            ) : (
              <button className="craft-item__choose" type="button">
                <span className="material-symbols-rounded">add_circle</span>
                <span>Chọn base để craft</span>
                <small>Mở cây category → class → base</small>
              </button>
            )}
          </div>
          {item ? <button className="craft-btn craft-btn--ghost" type="button" onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}>Đổi base</button> : null}
          {log.length ? <ul className="craft-log" translate="no">{log.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        </section>

        {/* STASH */}
        <section className="craft-stash" onClick={(e) => e.stopPropagation()}>
          <div className="craft-stash__tabs">
            {STASH_TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? "is-active" : ""} type="button" onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="craft-stash__grid">
            {stashItems.map(([fam, items]) => (
              <div className="craft-fam" key={fam}>
                <div className="craft-fam__label">{fam}</div>
                <div className="craft-fam__cells">
                  {items.map((c) => {
                    const supported = !!findCurrency(c.name);
                    return (
                      <button
                        key={c.name}
                        className={`craft-cell ${supported ? "is-supported" : ""} ${held?.name === c.name ? "is-held" : ""}`}
                        title={`${c.name}${supported ? "" : " (chưa hỗ trợ craft)"}`}
                        type="button"
                        onContextMenu={(e) => { e.preventDefault(); setHeld(held?.name === c.name ? null : c); }}
                        onClick={() => { if (held) { setHeld(null); } else setHeld(c); }}
                      >
                        {c.icon_url ? <img src={c.icon_url} alt={c.name} loading="lazy" /> : <span className="craft-cell__abbr">{c.name.slice(0, 2)}</span>}
                        <span className="craft-cell__stack">∞</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!stashItems.length ? <p className="craft-item__empty">Đang tải currency…</p> : null}
          </div>
        </section>
      </div>

      {/* HELD CURSOR BANNER */}
      {held ? (
        <div className="craft-held" translate="no" onClick={(e) => e.stopPropagation()}>
          {held.icon_url ? <img src={held.icon_url} alt="" /> : null}
          <span>Đang cầm <strong>{held.name}</strong> — bấm vào item để dùng</span>
          <button type="button" onClick={() => setHeld(null)}>✕</button>
        </div>
      ) : null}

      {flash ? <div className="craft-flash" onClick={(e) => e.stopPropagation()}>{flash}</div> : null}

      {/* CATEGORY TREE PICKER */}
      {pickerOpen && index ? (
        <div className="craft-picker" onClick={() => setPickerOpen(false)}>
          <div className="craft-picker__panel" onClick={(e) => e.stopPropagation()}>
            <div className="craft-picker__head"><strong>Chọn base</strong><button type="button" onClick={() => setPickerOpen(false)}>✕</button></div>
            <div className="craft-picker__body">
              {index.tree.map((g) => (
                <details className="craft-picker__group" key={g.group} open>
                  <summary>{g.group}</summary>
                  {g.classes.map((c) => (
                    <details className="craft-picker__class" key={c.label}>
                      <summary>{c.label} <span>({c.base_count})</span></summary>
                      <div className="craft-picker__bases">
                        {c.bases.map((b) => (
                          <button className="craft-picker__base" type="button" key={b.slug || b.name} onClick={() => pickBase(b)}>
                            {b.icon ? <img src={b.icon} alt="" loading="lazy" /> : null}
                            <span translate="no">{b.name}</span>
                            <small>{b.attr || "—"}{b.req_level ? ` · Lv${b.req_level}` : ""}</small>
                          </button>
                        ))}
                      </div>
                    </details>
                  ))}
                </details>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export { CURRENCIES };
