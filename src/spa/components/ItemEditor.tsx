// Build Planner item editor: change an item's rolls, add mods from the base's real
// mod pool (never typed in), within the game's rules (src/shared/item-mods.mjs).
// Errors show next to the line in Vietnamese and block saving.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  addSuggestedMod,
  availableTiers,
  findPoolMod,
  lineRanges,
  modLineText,
  parseEditableItem,
  serializeEditableItem,
  suggestMods,
  tierLabel,
  validateEditableItem,
  type EditableItem,
  type ModLine,
  type ModPool,
  type ModSuggestion
} from "../../shared/item-mods.mjs";

type Locale = "vi" | "en" | string;

const RECENT_KEY = "poe2-planner-recent-mods-v1";
const readRecent = (): string[] => {
  try {
    const rows = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(rows) ? rows.filter((row) => typeof row === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
};
const writeRecent = (rows: string[]) => {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(rows.slice(0, 20)));
  } catch {
    // Private mode: recent picks are a convenience only.
  }
};

const GEN_VI: Record<string, string> = { prefix: "Tiền tố", suffix: "Hậu tố" };
const RARITY_VI: Record<string, string> = { normal: "Thường", magic: "Ma thuật", rare: "Hiếm", unique: "Độc nhất" };

function ModCombobox({ pool, item, locale, onAdd }: { pool: ModPool; item: EditableItem; locale: Locale; onAdd: (suggestion: ModSuggestion) => void }) {
  const vi = locale === "vi";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo(() => (open ? suggestMods(pool, item, query, { recent, limit: 40 }) : []), [open, pool, item, query, recent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (row: ModSuggestion | undefined) => {
    if (!row || row.blocked) return;
    onAdd(row);
    const next = [row.mod.key, ...recent.filter((key) => key !== row.mod.key)];
    setRecent(next);
    writeRecent(next);
    setQuery("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(rows[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="ie-combo">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls="ie-mod-list"
        aria-activedescendant={open && rows[active] ? `ie-mod-${active}` : undefined}
        value={query}
        placeholder={vi ? "Thêm mod: gõ \"máu\", \"kháng lửa\", \"crit\", \"54 life\"…" : "Add a mod: type \"life\", \"fire res\", \"54 life\"…"}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul className="ie-combo-list" id="ie-mod-list" role="listbox" ref={listRef}>
          {rows.length ? rows.map((row, index) => (
            <li
              key={row.mod.key}
              id={`ie-mod-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              aria-disabled={Boolean(row.blocked)}
              className={`${index === active ? "is-active" : ""} ${row.blocked ? "is-blocked" : ""}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); pick(row); }}
            >
              <span className="ie-combo-text">{row.display}</span>
              <span className="ie-combo-meta">
                <b className={`ie-gen is-${row.gen}`}>{vi ? GEN_VI[row.gen] : row.gen}</b>
                <span>{row.tierLabel}</span>
                <span className="ie-family">{row.family}</span>
              </span>
              {row.blocked ? <small className="ie-combo-reason">{row.blocked}</small> : null}
            </li>
          )) : <li className="ie-combo-empty">{vi ? "Không có mod nào khớp cho loại đồ này." : "No matching mod for this base."}</li>}
        </ul>
      ) : null}
    </div>
  );
}

function ModLineRow({ pool, item, line, errors, locked, vi, onChange, onRemove }: {
  pool: ModPool;
  item: EditableItem;
  line: ModLine;
  errors: string[];
  locked: boolean;
  vi: boolean;
  onChange: (line: ModLine) => void;
  onRemove: () => void;
}) {
  const ranges = lineRanges(pool, item, line);
  const mod = line.kind === "pool" ? findPoolMod(pool, item, line.modKey) : null;
  const tiers = mod ? availableTiers(mod, item) : [];
  const editable = !locked && (line.kind === "pool" || line.kind === "unique");
  const values = line.kind === "fixed" ? [] : line.values;
  const setValue = (index: number, raw: number) => {
    if (line.kind === "fixed") return;
    const next = [...line.values];
    next[index] = raw;
    onChange({ ...line, values: next });
  };
  const setTier = (tierNumber: number) => {
    if (!mod || line.kind !== "pool") return;
    const tier = mod.tiers.find((row) => row.tier === tierNumber);
    if (!tier) return;
    const next = tier.lines.flatMap((row) => row.ranges).map(([a, b]) => Math.max(a, b));
    onChange({ ...line, tier: tierNumber, values: next });
  };
  const text = modLineText(pool, item, line).join(" / ");
  return (
    <li className={`ie-line ${errors.length ? "has-error" : ""} ${line.kind === "fixed" ? "is-fixed" : ""}`}>
      <div className="ie-line-head">
        {line.kind === "pool" ? <b className={`ie-gen is-${line.gen}`}>{vi ? GEN_VI[line.gen] : line.gen}</b> : null}
        {line.kind === "pool" && tiers.length && !locked ? (
          <select value={line.tier} onChange={(event) => setTier(Number(event.target.value))} aria-label={vi ? "Bậc mod" : "Tier"}>
            {tiers.map((tier) => {
              const [a, b] = tier.lines[0].ranges[0] ?? [0, 0];
              return <option value={tier.tier} key={tier.tier}>{`T${tier.tier} · ${a}–${b}`}</option>;
            })}
          </select>
        ) : line.kind === "pool" ? <span className="ie-tier">{tierLabel(pool, item, line)}</span> : null}
        <span className="ie-line-text">{text}</span>
        {line.flags.length ? <small className="ie-flags">{line.flags.join(", ")}</small> : null}
        {!locked ? (
          <button type="button" className="pi-btn pi-btn--ghost" onClick={onRemove} aria-label={vi ? "Xóa dòng" : "Remove line"} title={vi ? "Xóa dòng" : "Remove"}>
            <span className="material-symbols-rounded" aria-hidden="true">delete</span>
          </button>
        ) : null}
      </div>
      {editable && ranges.length ? (
        <div className="ie-values">
          {ranges.map(([a, b], index) => {
            const min = Math.min(a, b);
            const max = Math.max(a, b);
            if (min === max) return null;
            const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : 0.01;
            return (
              <label key={index}>
                <input type="range" min={min} max={max} step={step} value={values[index] ?? min} onChange={(event) => setValue(index, Number(event.target.value))} aria-label={vi ? `Giá trị ${index + 1}` : `Value ${index + 1}`} />
                <input type="number" min={min} max={max} step={step} value={values[index] ?? min} onChange={(event) => setValue(index, Number(event.target.value))} />
                <small>{min}–{max}</small>
              </label>
            );
          })}
        </div>
      ) : null}
      {line.kind === "fixed" ? <small className="ie-note">{vi ? "Dòng gốc của món đồ (không nhận diện được trong dữ liệu mod) — chỉ xem, không sửa được." : "Original line, not in the mod data — read only."}</small> : null}
      {errors.map((message) => <p className="ie-error" key={message}>{message}</p>)}
    </li>
  );
}

export function ItemEditor({ pool, text, originalText, title, locale, onLive, onSave, onCancel, onReset }: {
  pool: ModPool;
  /** The item as it is now. */
  text: string;
  /** The item before any edit (game / PoB text); empty for items built in the planner. */
  originalText: string;
  title: string;
  locale: Locale;
  /** Called with each valid change (equipped items recalculate as you edit). */
  onLive?: (text: string) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onReset?: () => void;
}) {
  const vi = locale === "vi";
  const [item, setItem] = useState<EditableItem>(() => parseEditableItem(text, pool));
  const original = useMemo(() => (originalText ? parseEditableItem(originalText, pool) : null), [originalText, pool]);
  const errors = useMemo(() => validateEditableItem(item, pool, original), [item, pool, original]);
  const output = useMemo(() => serializeEditableItem(item, pool), [item, pool]);
  const locked = Boolean(original?.corrupted) || item.corrupted;
  const lineErrors = (id: string) => errors.filter((error) => error.lineId === id).map((error) => error.message);
  const generalErrors = errors.filter((error) => !error.lineId).map((error) => error.message);

  const lastLive = useRef(text);
  useEffect(() => {
    if (!onLive || errors.length || output === lastLive.current) return;
    lastLive.current = output;
    onLive(output);
  }, [onLive, errors, output]);

  const update = (patch: Partial<EditableItem>) => setItem((current) => ({ ...current, ...patch }));
  const counts = (gen: string) => item.mods.filter((line) => line.kind === "pool" && line.gen === gen).length;
  const limit = item.rarity === "magic" ? 1 : item.rarity === "rare" ? 3 : 0;

  return (
    <div className="ie-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="ie-dialog poe-no-tooltip" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ie-head">
          <div>
            <p className="ie-eyebrow">{title}</p>
            <h2 className={`ie-name is-${item.rarity}`}>{item.name || item.baseName}</h2>
            {item.baseName !== item.name ? <p className="ie-base">{item.baseName}</p> : null}
          </div>
          <button type="button" className="pi-btn pi-btn--ghost" onClick={onCancel} aria-label={vi ? "Đóng" : "Close"}>
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="ie-body">
          {locked ? <p className="ie-lock">{vi ? "Đồ đã corrupt: trong game không đổi được mod, chất lượng hay số lỗ nữa." : "Corrupted: mods, quality and sockets are locked."}</p> : null}
          <div className="ie-fields">
            <label>
              <span>{vi ? "Độ hiếm" : "Rarity"}</span>
              <select value={item.rarity} disabled={locked || item.rarity === "unique"} onChange={(event) => update({ rarity: event.target.value as EditableItem["rarity"] })}>
                {(item.rarity === "unique" ? ["unique"] : ["normal", "magic", "rare"]).map((rarity) => <option value={rarity} key={rarity}>{vi ? RARITY_VI[rarity] : rarity}</option>)}
              </select>
            </label>
            {item.rarity === "rare" ? (
              <label>
                <span>{vi ? "Tên" : "Name"}</span>
                <input value={item.name} maxLength={40} onChange={(event) => update({ name: event.target.value.replace(/[\r\n]/g, "") })} />
              </label>
            ) : null}
            <label title={vi ? "Cấp vật phẩm quyết định bậc mod cao nhất có thể ra." : "Item level limits the best tier."}>
              <span>{vi ? "Cấp vật phẩm" : "Item level"}</span>
              <input type="number" min={1} max={100} value={item.itemLevel ?? ""} disabled={locked} onChange={(event) => update({ itemLevel: event.target.value ? Number(event.target.value) : undefined })} />
            </label>
            <label>
              <span>{vi ? "Chất lượng %" : "Quality %"}</span>
              <input type="number" min={0} max={20} value={item.quality} disabled={locked} onChange={(event) => update({ quality: Number(event.target.value) || 0 })} />
            </label>
            <label title={vi ? "Số lỗ để gắn rune / soul core." : "Rune sockets"}>
              <span>{vi ? "Số lỗ rune" : "Sockets"}</span>
              <input type="number" min={0} max={3} value={item.sockets} disabled={locked} onChange={(event) => update({ sockets: Number(event.target.value) || 0 })} />
            </label>
            <label className="ie-check" title={vi ? "Corrupt khóa món đồ lại, không bỏ được." : "Corruption cannot be undone."}>
              <input type="checkbox" checked={item.corrupted} disabled={Boolean(original?.corrupted)} onChange={(event) => update({ corrupted: event.target.checked })} />
              <span>Corrupted</span>
            </label>
          </div>
          {item.runes.length ? <p className="ie-runes">{vi ? "Rune đang gắn: " : "Runes: "}{item.runes.join(", ")}</p> : null}

          {item.implicits.length ? (
            <>
              <h3 className="ie-section">{vi ? "Dòng ẩn (implicit, rune)" : "Implicits and runes"}</h3>
              <ul className="ie-implicits">{item.implicits.map((line, index) => <li key={index}>{line.text}</li>)}</ul>
            </>
          ) : null}

          <h3 className="ie-section">
            {vi ? "Dòng mod" : "Mods"}
            {limit ? <small>{vi ? ` · Tiền tố ${counts("prefix")}/${limit} · Hậu tố ${counts("suffix")}/${limit}` : ` · Prefixes ${counts("prefix")}/${limit} · Suffixes ${counts("suffix")}/${limit}`}</small> : null}
          </h3>
          <ul className="ie-lines">
            {item.mods.map((line) => (
              <ModLineRow
                key={line.id}
                pool={pool}
                item={item}
                line={line}
                errors={lineErrors(line.id)}
                locked={locked}
                vi={vi}
                onChange={(next) => update({ mods: item.mods.map((row) => (row.id === line.id ? next : row)) })}
                onRemove={() => update({ mods: item.mods.filter((row) => row.id !== line.id) })}
              />
            ))}
            {!item.mods.length ? <li className="ie-note">{vi ? "Chưa có dòng mod." : "No mods yet."}</li> : null}
          </ul>
          {!locked && item.rarity !== "unique" ? <ModCombobox pool={pool} item={item} locale={locale} onAdd={(row) => setItem((current) => addSuggestedMod(current, row))} /> : null}
          {item.rarity === "unique" ? <p className="ie-note">{vi ? "Đồ độc nhất có mod cố định: chỉ chỉnh được giá trị trong khoảng roll." : "Uniques have fixed mods; only rolls change."}</p> : null}

          {generalErrors.length ? <ul className="ie-errors">{generalErrors.map((message) => <li key={message}>{message}</li>)}</ul> : null}
        </div>

        <footer className="ie-foot">
          {onReset ? (
            <button type="button" className="pi-btn" onClick={onReset}>
              <span className="material-symbols-rounded" aria-hidden="true">restart_alt</span>
              {vi ? "Khôi phục bản gốc" : "Reset to original"}
            </button>
          ) : null}
          <span className="ie-foot-gap" />
          {errors.length ? <span className="ie-blocked">{vi ? `Còn ${errors.length} lỗi, chưa lưu được` : `${errors.length} error(s)`}</span> : null}
          <button type="button" className="pi-btn" onClick={onCancel}>{vi ? "Hủy" : "Cancel"}</button>
          <button type="button" className="pi-btn pi-btn--primary" disabled={errors.length > 0} onClick={() => onSave(output)}>
            <span className="material-symbols-rounded" aria-hidden="true">save</span>
            {vi ? "Lưu" : "Save"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export interface NewItemChoice {
  key: string;
  name: string;
  /** Base type, or the unique's base. */
  baseName: string;
  itemClass: string;
  unique: boolean;
  iconUrl?: string;
  /** Item text to start the editor with. */
  text: string;
}

/** "Tạo đồ mới": pick a base (to roll mods on) or a unique (to set its rolls). */
export function NewItemDialog({ choices, locale, onPick, onCancel }: {
  choices: NewItemChoice[];
  locale: Locale;
  onPick: (choice: NewItemChoice) => void;
  onCancel: () => void;
}) {
  const vi = locale === "vi";
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"base" | "unique">("base");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = choices
    .filter((row) => row.unique === (kind === "unique"))
    .filter((row) => words.every((word) => `${row.name} ${row.baseName} ${row.itemClass}`.toLowerCase().includes(word)))
    .slice(0, 60);
  return (
    <div className="ie-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="ie-dialog ie-dialog--small poe-no-tooltip" role="dialog" aria-modal="true" aria-label={vi ? "Tạo đồ mới" : "New item"}>
        <header className="ie-head">
          <div>
            <p className="ie-eyebrow">{vi ? "Tạo đồ mới" : "New item"}</p>
            <h2>{vi ? "Chọn loại đồ để bắt đầu" : "Pick a base to start from"}</h2>
          </div>
          <button type="button" className="pi-btn pi-btn--ghost" onClick={onCancel} aria-label={vi ? "Đóng" : "Close"}>
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="ie-body">
          <div className="ie-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={kind === "base"} className={kind === "base" ? "is-active" : ""} onClick={() => setKind("base")}>{vi ? "Base (tự thêm mod)" : "Base (add mods)"}</button>
            <button type="button" role="tab" aria-selected={kind === "unique"} className={kind === "unique" ? "is-active" : ""} onClick={() => setKind("unique")}>{vi ? "Đồ độc nhất" : "Unique"}</button>
          </div>
          <input className="ie-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={vi ? "Tìm: \"ring\", \"boots\", \"Blackflame\"…" : "Search…"} />
          <ul className="ie-pick-list">
            {rows.map((row) => (
              <li key={row.key}>
                <button type="button" onClick={() => onPick(row)}>
                  {row.iconUrl ? <img src={row.iconUrl} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">inventory_2</span>}
                  <span className={row.unique ? "pi-result-name is-unique" : ""}>{row.name}</span>
                  <small>{row.unique ? row.baseName : row.itemClass}</small>
                </button>
              </li>
            ))}
            {!rows.length ? <li className="ie-note">{vi ? "Không tìm thấy." : "Nothing found."}</li> : null}
          </ul>
        </div>
      </section>
    </div>
  );
}
