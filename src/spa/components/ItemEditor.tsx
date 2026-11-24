// Build Planner item editor: change an item's rolls, add mods from the base's real
// mod pool (never typed in), within the game's rules (src/shared/item-mods.mjs).
// Errors show next to the line in Vietnamese and block saving.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  addSuggestedMod,
  affixLimits,
  availableTiers,
  baseImplicitLines,
  corruptionOptions,
  corruptionState,
  findBase,
  findPoolMod,
  implicitVariantOf,
  lineRanges,
  maxSockets,
  modLineText,
  parseEditableItem,
  requiredLevel,
  serializeEditableItem,
  setCorruption,
  suggestMods,
  tierLabel,
  tierText,
  validateEditableItem,
  withBaseImplicits,
  type EditableItem,
  type ModLine,
  type ModPool,
  type ModSuggestion,
  type PoolBase
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
  // The list is part of the dialog's scrolling body: bring it into view when it opens,
  // so more than one row shows on a small window.
  useEffect(() => {
    if (open) listRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);
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
    setOpen(false);
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
        placeholder={vi ? "Chọn loại chỉ số: gõ \"máu\", \"kháng lửa\", \"tay sai\", \"spell damage\"…" : "Pick a stat type: type \"life\", \"fire res\", \"minion\"…"}
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
              <span className="ie-combo-row">
                <b className={`ie-gen is-${row.gen}`}>{vi ? GEN_VI[row.gen] : row.gen}</b>
                <span className="ie-combo-text">{row.mod.templates.join(" / ")}</span>
              </span>
              {row.blocked ? <small className="ie-combo-reason">{row.blocked}</small> : null}
            </li>
          )) : <li className="ie-combo-empty">{vi ? "Không có mod nào khớp cho loại đồ này." : "No matching mod for this base."}</li>}
        </ul>
      ) : null}
    </div>
  );
}

function ModLineRow({ pool, item, line, errors, locked, removable, autoFocusTier, vi, onChange, onRemove }: {
  pool: ModPool;
  item: EditableItem;
  line: ModLine;
  errors: string[];
  locked: boolean;
  removable: boolean;
  autoFocusTier?: boolean;
  vi: boolean;
  onChange: (line: ModLine) => void;
  onRemove: () => void;
}) {
  const tierSelectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!autoFocusTier) return;
    tierSelectRef.current?.focus();
    tierSelectRef.current?.scrollIntoView({ block: "nearest" });
  }, [autoFocusTier]);
  const ranges = lineRanges(pool, item, line);
  const mod = line.kind === "pool" ? findPoolMod(pool, item, line.modKey) : null;
  const allowed = mod ? availableTiers(mod, item) : [];
  // The line's own tier stays in the list even when the item level is too low for it:
  // the dropdown then shows the tier the error talks about, not a different one.
  const current = mod && line.kind === "pool" ? mod.tiers.find((row) => row.tier === line.tier) : undefined;
  const tiers = current && !allowed.includes(current) ? [current, ...allowed] : allowed;
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
  const text = modLineText(pool, item, line).join(" · ");
  return (
    <li className={`ie-line ${errors.length ? "has-error" : ""} ${line.kind === "fixed" ? "is-fixed" : ""}`}>
      <div className="ie-line-head">
        {line.kind === "pool" ? <b className={`ie-gen is-${line.gen}`}>{vi ? GEN_VI[line.gen] : line.gen}</b> : null}
        {line.kind === "pool" && tiers.length && !locked ? (
          <select ref={tierSelectRef} value={line.tier} onChange={(event) => setTier(Number(event.target.value))} aria-label={vi ? "Bậc mod" : "Tier"}>
            {tiers.map((tier) => (
              <option value={tier.tier} key={tier.tier}>
                {tierText(tier)}{allowed.includes(tier) ? "" : vi ? ` (cần cấp vật phẩm ${tier.ilvl})` : ` (needs item level ${tier.ilvl})`}
              </option>
            ))}
          </select>
        ) : line.kind === "pool" ? <span className="ie-tier">{tierLabel(pool, item, line)}</span> : null}
        <span className="ie-line-text">{text}</span>
        {line.flags.length ? <small className="ie-flags">{line.flags.join(", ")}</small> : null}
        {removable ? (
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
      {line.kind === "fixed" && item.rarity !== "unique" ? <small className="ie-note">{vi ? "Dòng gốc của món đồ (không có trong các mod thường của base này) — chỉ xem, không sửa được." : "Original line, not in this base's normal mods — read only."}</small> : null}
      {errors.map((message) => <p className="ie-error" key={message}>{message}</p>)}
    </li>
  );
}

const ARMOUR_LABELS: Array<[string, string, string]> = [["Armour", "Giáp", "Armour"], ["Evasion", "Né tránh", "Evasion"], ["EnergyShield", "Khiên năng lượng", "Energy Shield"], ["Ward", "Ward", "Ward"], ["BlockChance", "Tỉ lệ chặn %", "Block %"]];
const DAMAGE_TYPES: Array<[string, string, string]> = [["Physical", "Sát thương vật lý", "Physical damage"], ["Fire", "Sát thương lửa", "Fire damage"], ["Cold", "Sát thương băng", "Cold damage"], ["Lightning", "Sát thương sét", "Lightning damage"], ["Chaos", "Sát thương hỗn mang", "Chaos damage"]];

/** The base's own numbers (before quality and mods), from PoB's base data. */
function baseStatRows(base: PoolBase | null, vi: boolean): string[] {
  if (!base) return [];
  const rows: string[] = [];
  for (const [key, viLabel, enLabel] of ARMOUR_LABELS) {
    if (base.armour?.[key]) rows.push(`${vi ? viLabel : enLabel} ${base.armour[key]}`);
  }
  const weapon = base.weapon;
  if (weapon) {
    for (const [key, viLabel, enLabel] of DAMAGE_TYPES) {
      if (weapon[`${key}Max`]) rows.push(`${vi ? viLabel : enLabel} ${weapon[`${key}Min`] ?? 0}–${weapon[`${key}Max`]}`);
    }
    if (weapon.CritChanceBase) rows.push(`${vi ? "Chí mạng" : "Crit"} ${weapon.CritChanceBase}%`);
    if (weapon.AttackRateBase) rows.push(`${vi ? "Đòn/giây" : "Attacks/s"} ${weapon.AttackRateBase}`);
    if (weapon.ReloadTimeBase) rows.push(`${vi ? "Nạp đạn" : "Reload"} ${weapon.ReloadTimeBase}s`);
  }
  if (base.spirit) rows.push(`Spirit ${base.spirit}`);
  return rows;
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
  // An item built in the planner starts with its base's implicit, as the game gives it.
  const [item, setItem] = useState<EditableItem>(() => {
    const parsed = parseEditableItem(text, pool);
    const hasOwnImplicit = parsed.implicits.some((line) => !line.flags.includes("rune") && !line.flags.includes("enchant"));
    return originalText || hasOwnImplicit ? parsed : withBaseImplicits(parsed, pool);
  });
  const original = useMemo(() => (originalText ? parseEditableItem(originalText, pool) : null), [originalText, pool]);
  const errors = useMemo(() => validateEditableItem(item, pool, original), [item, pool, original]);
  const output = useMemo(() => serializeEditableItem(item, pool), [item, pool]);
  const locked = Boolean(original?.corrupted) || item.corrupted;
  const unique = item.rarity === "unique";
  const lineErrors = (id: string) => errors.filter((error) => error.lineId === id).map((error) => error.message);
  const generalErrors = errors.filter((error) => !error.lineId).map((error) => error.message);
  const base = useMemo(() => findBase(pool, item.baseName), [pool, item.baseName]);
  const baseStats = baseStatRows(unique ? null : base, vi);
  const levelReq = requiredLevel(item, pool);
  const attributeReq = !unique && base?.req ? ([["Str", base.req.str], ["Dex", base.req.dex], ["Int", base.req.int]] as Array<[string, number]>).filter(([, value]) => value > 0) : [];

  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const lastLive = useRef(text);
  useEffect(() => {
    if (!onLive || errors.length || output === lastLive.current) return;
    lastLive.current = output;
    onLive(output);
  }, [onLive, errors, output]);

  const update = (patch: Partial<EditableItem>) => setItem((current) => ({ ...current, ...patch }));
  const counts = (gen: string) => item.mods.filter((line) => line.kind === "pool" && line.gen === gen).length;
  const limits = affixLimits(item);
  const socketMax = Math.max(maxSockets(base ?? "", item.corrupted), original?.sockets ?? 0);

  const corruption = corruptionOptions(pool, item, original);
  const corruptionNow = corruptionState(pool, item, original);
  const corruptionValue = corruptionNow.kind === "enchant" ? `enchant:${corruptionNow.key}` : corruptionNow.kind;
  const chosenEnchant = corruptionNow.kind === "enchant" ? corruption.enchants.find((row) => row.key === corruptionNow.key) : undefined;
  const chooseCorruption = (value: string, values?: number[]) => setItem((current) => setCorruption(pool, current, original, value.startsWith("enchant:")
    ? { kind: "enchant", key: value.slice("enchant:".length), values }
    : { kind: value as "none" | "plain" | "socket" }));

  // A built item on a base with alternative implicits (an amulet granting one skill of a list).
  const variants = !original && !unique ? base?.implicitVariants ?? [] : [];
  const variantNow = variants.length && base ? Math.max(0, implicitVariantOf(item, base)) : 0;

  return (
    <div className="ie-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="ie-dialog poe-no-tooltip" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ie-head">
          <div>
            <p className="ie-eyebrow">{title}</p>
            <h2 className={`ie-name is-${item.rarity}`}>{item.name || item.baseName}</h2>
            {item.baseName !== item.name ? <p className="ie-base">{item.baseName}{base ? ` · ${base.itemClass}` : ""}</p> : null}
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
              <select value={item.rarity} disabled={locked || unique} onChange={(event) => update({ rarity: event.target.value as EditableItem["rarity"] })}>
                {(unique ? ["unique"] : ["normal", "magic", "rare"]).map((rarity) => <option value={rarity} key={rarity}>{vi ? RARITY_VI[rarity] : rarity}</option>)}
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
            {socketMax > 0 || item.sockets > 0 ? (
              <label title={vi ? "Số lỗ để gắn rune / soul core. Lỗ cuối cùng chỉ có khi corrupt ra lỗ." : "Rune sockets; the last one only comes from corruption."}>
                <span>{vi ? `Số lỗ rune (tối đa ${socketMax})` : `Sockets (max ${socketMax})`}</span>
                <input type="number" min={0} max={socketMax} value={item.sockets} disabled={locked} onChange={(event) => update({ sockets: Number(event.target.value) || 0 })} />
              </label>
            ) : null}
            <label className="ie-corrupt" title={vi ? "Vaal Orb: corrupt khóa món đồ lại và cho một kết quả. Không bỏ corrupt được trong game." : "Vaal Orb: locks the item and gives one outcome."}>
              <span>Corrupt (Vaal Orb)</span>
              <select value={corruptionValue} disabled={corruption.locked} onChange={(event) => chooseCorruption(event.target.value)}>
                {corruption.locked ? <option value={corruptionValue}>{vi ? "Đã corrupt (đồ gốc)" : "Corrupted (original)"}</option> : (
                  <>
                    <option value="none">{vi ? "Chưa corrupt" : "Not corrupted"}</option>
                    <option value="plain">{vi ? "Corrupt — không đổi gì" : "Corrupted — no change"}</option>
                    {corruption.socket ? <option value="socket">{vi ? "Corrupt — thêm 1 lỗ rune" : "Corrupted — one more socket"}</option> : null}
                    {corruption.enchants.length ? (
                      <optgroup label={vi ? "Corrupt — thêm 1 dòng enchant" : "Corrupted — one enchant"}>
                        {corruption.enchants.map((row) => <option value={`enchant:${row.key}`} key={row.key}>{row.text}</option>)}
                      </optgroup>
                    ) : null}
                    {corruptionNow.kind === "enchant" && !chosenEnchant ? <option value={corruptionValue}>{vi ? "Enchant không hợp lệ" : "Unknown enchant"}</option> : null}
                  </>
                )}
              </select>
            </label>
            {chosenEnchant && !corruption.locked ? chosenEnchant.ranges.map(([a, b], index) => (a === b ? null : (
              <label key={index}>
                <span>{vi ? `Giá trị enchant (${Math.min(a, b)}–${Math.max(a, b)})` : `Enchant roll (${Math.min(a, b)}–${Math.max(a, b)})`}</span>
                <input
                  type="number"
                  min={Math.min(a, b)}
                  max={Math.max(a, b)}
                  value={corruptionNow.values?.[index] ?? Math.max(a, b)}
                  onChange={(event) => {
                    const next = [...(corruptionNow.values ?? chosenEnchant.ranges.map(([x, y]) => Math.max(x, y)))];
                    next[index] = Number(event.target.value) || Math.min(a, b);
                    chooseCorruption(corruptionValue, next);
                  }}
                />
              </label>
            ))) : null}
            {variants.length ? (
              <label>
                <span>{vi ? "Kỹ năng của base" : "Base skill"}</span>
                <select value={variantNow} onChange={(event) => setItem((current) => withBaseImplicits(current, pool, Number(event.target.value)))}>
                  {variants.map((line, index) => <option value={index} key={line}>{baseImplicitLines({ ...base!, implicit: [], implicitVariants: [line] })[0].text}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {!unique && (baseStats.length || levelReq !== null || attributeReq.length) ? (
            <p className="ie-base-stats">
              {baseStats.length ? <span><b>{vi ? "Chỉ số gốc của base: " : "Base stats: "}</b>{baseStats.join(" · ")}</span> : null}
              {levelReq !== null || attributeReq.length ? (
                <span title={vi ? "Cấp yêu cầu = cấp của base, hoặc 80% cấp của mod cao nhất (làm tròn xuống), lấy số lớn hơn." : "Base level, or 80% of the highest mod level."}>
                  <b>{vi ? "Yêu cầu: " : "Requires: "}</b>
                  {[levelReq !== null ? `${vi ? "Cấp" : "Level"} ${levelReq}` : "", ...attributeReq.map(([name, value]) => `${value} ${name}`)].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </p>
          ) : null}
          {item.runes.length ? <p className="ie-runes">{vi ? "Rune đang gắn: " : "Runes: "}{item.runes.join(", ")}</p> : null}

          {item.implicits.length ? (
            <>
              <h3 className="ie-section">{vi ? "Dòng ẩn (implicit, enchant, rune) — không sửa được" : "Implicits, enchants and runes (read only)"}</h3>
              <ul className="ie-implicits">
                {item.implicits.map((line, index) => (
                  <li key={index}>
                    {line.text}
                    {line.flags.includes("rune") ? <small> · rune</small> : line.flags.includes("enchant") ? <small> · enchant</small> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3 className="ie-section">
            {vi ? "Dòng mod" : "Mods"}
            {limits.prefix || limits.suffix ? <small>{vi ? ` · Tiền tố ${counts("prefix")}/${limits.prefix} · Hậu tố ${counts("suffix")}/${limits.suffix}` : ` · Prefixes ${counts("prefix")}/${limits.prefix} · Suffixes ${counts("suffix")}/${limits.suffix}`}</small> : null}
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
                removable={!locked && !unique}
                autoFocusTier={line.id === justAddedId}
                vi={vi}
                onChange={(next) => update({ mods: item.mods.map((row) => (row.id === line.id ? next : row)) })}
                onRemove={() => update({ mods: item.mods.filter((row) => row.id !== line.id) })}
              />
            ))}
            {!item.mods.length ? (
              <li className="ie-note">
                {item.rarity === "rare" || item.rarity === "magic"
                  ? vi ? "Chưa có dòng mod. Vẫn lưu được (trong game, đồ bị xóa hết mod vẫn giữ độ hiếm), nhưng món đồ sẽ không cho chỉ số nào ngoài base." : "No mods yet. It can be saved, but gives nothing beyond its base."
                  : vi ? "Chưa có dòng mod." : "No mods yet."}
              </li>
            ) : null}
          </ul>
          {!locked && !unique ? (
            <ModCombobox
              pool={pool}
              item={item}
              locale={locale}
              onAdd={(row) => {
                setItem((current) => {
                  const next = addSuggestedMod(current, row);
                  const added = next.mods[next.mods.length - 1];
                  if (added && next.mods.length > current.mods.length) setJustAddedId(added.id);
                  return next;
                });
              }}
            />
          ) : null}
          {unique ? <p className="ie-note">{vi ? "Đồ độc nhất có mod cố định: không thêm hay xóa dòng được, chỉ chỉnh giá trị trong khoảng roll." : "Uniques have fixed mods: lines cannot be added or removed, only rolls change."}</p> : null}

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
export function NewItemDialog({ choices, slotLabel, locale, onPick, onCancel }: {
  choices: NewItemChoice[];
  slotLabel?: string;
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
            <p className="ie-eyebrow">{slotLabel ? (vi ? `Tạo đồ mới · ${slotLabel}` : `New item · ${slotLabel}`) : (vi ? "Tạo đồ mới" : "New item")}</p>
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
