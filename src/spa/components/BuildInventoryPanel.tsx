// Build Planner "Kho đồ": the build's personal inventory next to the paper doll,
// the "Nếu mặc vào" comparison shown with an item's tooltip, and the strip of
// gems to try in a skill group. The page owns the state and the calculations;
// these components only draw them.
import { useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type MouseEvent, type ReactNode } from "react";

import type { BuildStashItem } from "../lib/buildPlanner";
import { formatStatChange, statChange, type StatFormat } from "../lib/buildStats";
import type { CalcQueue } from "../lib/calcQueue";
import "../styles/planner-inventory.css";

type Locale = "vi" | "en" | string;
type Stats = Record<string, unknown>;

export const STASH_DRAG_TYPE = "application/x-poe-stash-item";
export const SLOT_DRAG_TYPE = "application/x-poe-equipped-slot";

export interface StashItemView {
  item: BuildStashItem;
  name: string;
  baseName: string;
  rarity: string;
  iconUrl?: string;
  /** Fits the selected slot (or any slot when none is selected). */
  fits: boolean;
  /** Changed or built in the planner. */
  edited?: boolean;
}

export interface CatalogEntry {
  key: string;
  name: string;
  baseName: string;
  rarity: string;
  iconUrl?: string;
}

const RARITY_LABEL: Record<string, string> = { unique: "Độc nhất", rare: "Hiếm", magic: "Ma thuật", normal: "Thường" };

function ItemIcon({ iconUrl, name, rarity }: { iconUrl?: string; name: string; rarity: string }) {
  return iconUrl
    ? <img src={iconUrl} alt="" loading="lazy" draggable={false} />
    : <span className={`pi-initial is-${rarity}`} aria-hidden="true">{name.slice(0, 1).toUpperCase() || "?"}</span>;
}

export function BuildInventoryPanel(props: {
  locale: Locale;
  items: StashItemView[];
  selectedSlotLabel?: string;
  selectedSlotFilled?: boolean;
  onClearSlot: () => void;
  onUnequipSelected: () => void;
  onItemClick: (itemId: string) => void;
  onItemEnter: (itemId: string, event: MouseEvent) => void;
  onItemMove: (event: MouseEvent) => void;
  onItemLeave: () => void;
  onRemove: (itemId: string) => void;
  onEdit: (itemId: string) => void;
  onDuplicate: (itemId: string) => void;
  /** "Tạo đồ mới": build an item from a base or a unique. */
  onNewItem: () => void;
  /** Edit the item in the selected slot. */
  onEditSelected: () => void;
  /** An equipped item dropped on the panel. */
  onDropSlot: (slotId: string) => void;
  /** Returns how many items were added, or an error message. */
  onPasteText: (text: string) => number | string;
  search: (query: string) => CatalogEntry[];
  onAddCatalog: (entry: CatalogEntry) => void;
  /** An item waiting for the player to pick one of several slots. */
  slotChoice?: { itemName: string; slots: Array<{ id: string; label: string }> } | null;
  onChooseSlot: (slotId: string) => void;
  onCancelChoice: () => void;
}) {
  const vi = props.locale === "vi";
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const results = query.trim().length >= 2 ? props.search(query) : [];
  const shown = props.selectedSlotLabel ? props.items.filter((row) => row.fits) : props.items;

  const addPasted = (text: string) => {
    const result = props.onPasteText(text);
    if (typeof result === "number") {
      setMessage(vi ? `Đã thêm ${result} món vào kho.` : `Added ${result} item(s).`);
      setPasteText("");
      setPasteOpen(false);
    } else {
      setMessage(result);
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    // Ctrl+V anywhere in the panel except the search box.
    if ((event.target as HTMLElement).closest(".pi-search")) return;
    const text = event.clipboardData.getData("text");
    if (!/Rarity:/i.test(text)) return;
    event.preventDefault();
    addPasted(text);
  };

  const onDrop = (event: DragEvent) => {
    setDropActive(false);
    const slotId = event.dataTransfer.getData(SLOT_DRAG_TYPE);
    if (slotId) {
      event.preventDefault();
      props.onDropSlot(slotId);
    }
  };

  return (
    <section
      className={`pi-panel poe-no-tooltip ${dropActive ? "is-drop" : ""}`}
      tabIndex={0}
      onPaste={onPaste}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes(SLOT_DRAG_TYPE)) {
          event.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      aria-label={vi ? "Kho đồ của build" : "Build inventory"}
    >
      <header className="pi-head">
        <h3>{vi ? "Kho đồ" : "Inventory"}</h3>
        <span className="pi-count">{props.items.length}</span>
        <button type="button" className="pi-btn" onClick={props.onNewItem}>
          <span className="material-symbols-rounded" aria-hidden="true">add_box</span>
          {vi ? "Tạo đồ mới" : "New item"}
        </button>
        <button type="button" className="pi-btn pi-btn--paste" onClick={() => setPasteOpen((open) => !open)} aria-expanded={pasteOpen}>
          <span className="material-symbols-rounded" aria-hidden="true">content_paste</span>
          {vi ? "Dán đồ từ game" : "Paste from game"}
        </button>
        <button type="button" className="pi-btn pi-btn--ghost" onClick={() => setHelpOpen((open) => !open)} aria-expanded={helpOpen} aria-label={vi ? "Cách dùng kho đồ" : "How to use"} title={vi ? "Cách dùng" : "How to use"}>
          <span className="material-symbols-rounded" aria-hidden="true">help</span>
        </button>
      </header>

      {props.selectedSlotLabel ? (
        <div className="pi-filter">
          <span>{vi ? "Ô đang chọn:" : "Selected slot:"} <b>{props.selectedSlotLabel}</b> — {vi ? "chỉ hiện đồ vừa ô này" : "showing items that fit"}</span>
          {props.selectedSlotFilled ? (
            <button type="button" className="pi-btn" onClick={props.onEditSelected}>
              <span className="material-symbols-rounded" aria-hidden="true">edit</span>
              {vi ? "Sửa đồ" : "Edit"}
            </button>
          ) : null}
          {props.selectedSlotFilled ? (
            <button type="button" className="pi-btn" onClick={props.onUnequipSelected}>
              <span className="material-symbols-rounded" aria-hidden="true">move_to_inbox</span>
              {vi ? "Tháo ra" : "Unequip"}
            </button>
          ) : null}
          <button type="button" className="pi-btn pi-btn--ghost" onClick={props.onClearSlot} aria-label={vi ? "Bỏ chọn ô" : "Clear slot"}>
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      ) : null}

      {props.slotChoice ? (
        <div className="pi-choice" role="group">
          <span>{vi ? `Mặc "${props.slotChoice.itemName}" vào:` : `Equip "${props.slotChoice.itemName}" in:`}</span>
          {props.slotChoice.slots.map((slot) => (
            <button type="button" className="pi-btn" key={slot.id} onClick={() => props.onChooseSlot(slot.id)}>{slot.label}</button>
          ))}
          <button type="button" className="pi-btn pi-btn--ghost" onClick={props.onCancelChoice}>{vi ? "Hủy" : "Cancel"}</button>
        </div>
      ) : null}

      {pasteOpen ? (
        <div className="pi-paste">
          <p>{vi ? "Trong game: rê chuột lên món đồ, bấm Ctrl+C. Rồi dán vào đây (có thể dán nhiều món một lúc). Đồ copy từ Path of Building cũng được." : "In game: hover an item, press Ctrl+C, then paste here."}</p>
          <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={5} placeholder={"Item Class: Rings\nRarity: Rare\n..."} spellCheck={false} />
          <button type="button" className="pi-btn pi-btn--primary" disabled={!pasteText.trim()} onClick={() => addPasted(pasteText)}>
            {vi ? "Thêm vào kho" : "Add to inventory"}
          </button>
        </div>
      ) : null}
      {message ? <p className="pi-message" role="status">{message}</p> : null}

      {shown.length ? (
        <div className="pi-grid" role="list">
          {shown.map((row) => (
            <div className="pi-cell-wrap" role="listitem" key={row.item.id}>
              <button
                type="button"
                className={`pi-cell is-${row.rarity}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(STASH_DRAG_TYPE, row.item.id);
                  event.dataTransfer.effectAllowed = "move";
                  props.onItemLeave();
                }}
                onClick={() => props.onItemClick(row.item.id)}
                onMouseEnter={(event) => props.onItemEnter(row.item.id, event)}
                onMouseMove={props.onItemMove}
                onMouseLeave={props.onItemLeave}
                onFocus={(event) => props.onItemEnter(row.item.id, event as unknown as MouseEvent)}
                onBlur={props.onItemLeave}
                aria-label={`${row.name} (${vi ? RARITY_LABEL[row.rarity] ?? row.rarity : row.rarity}) — ${vi ? "bấm để mặc" : "click to equip"}`}
              >
                <ItemIcon iconUrl={row.iconUrl} name={row.name} rarity={row.rarity} />
                {row.edited ? <span className="pi-edited">{vi ? "Đã sửa" : "Edited"}</span> : null}
              </button>
              <span className="pi-cell-actions">
                <button type="button" onClick={() => props.onEdit(row.item.id)} aria-label={vi ? `Sửa ${row.name}` : `Edit ${row.name}`} title={vi ? "Sửa chỉ số" : "Edit"}>
                  <span className="material-symbols-rounded" aria-hidden="true">edit</span>
                </button>
                <button type="button" onClick={() => props.onDuplicate(row.item.id)} aria-label={vi ? `Nhân bản ${row.name}` : `Duplicate ${row.name}`} title={vi ? "Nhân bản để thử biến thể" : "Duplicate"}>
                  <span className="material-symbols-rounded" aria-hidden="true">content_copy</span>
                </button>
              </span>
              <button type="button" className="pi-remove" onClick={() => props.onRemove(row.item.id)} aria-label={vi ? `Bỏ ${row.name} khỏi kho` : `Remove ${row.name}`} title={vi ? "Bỏ khỏi kho" : "Remove"}>
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="pi-empty">
          {props.selectedSlotLabel
            ? (vi ? "Kho chưa có món nào vừa ô này. Tìm đồ bên dưới hoặc dán đồ từ game." : "Nothing in the inventory fits this slot.")
            : (vi ? "Kho đồ trống. Đồ dự phòng trong PoB code, đồ bạn tháo ra, đồ dán từ game và đồ tìm bên dưới sẽ nằm ở đây." : "Empty. Spare items from the PoB code, unequipped items, pasted and searched items go here.")}
        </p>
      )}
      {helpOpen ? <p className="pi-help">
        {vi
          ? "Bấm một món để mặc vào (hoặc kéo thả lên ô đồ). Rê chuột để xem nếu mặc vào thì sát thương, máu, kháng đổi bao nhiêu. Nút bút để sửa chỉ số, nút copy để nhân bản. Bấm chuột phải vào ô đồ để tháo ra."
          : "Click an item to equip it (or drag it onto a slot). Hover to see how damage, life and resistances would change. Right-click a slot to unequip."}
      </p> : null}

      <label className="pi-search">
        <span className="material-symbols-rounded" aria-hidden="true">search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={vi ? (props.selectedSlotLabel ? `Tìm đồ cho ô ${props.selectedSlotLabel}...` : "Tìm đồ (base hoặc unique) để thêm vào kho...") : "Search items to add..."} />
      </label>
      {results.length ? (
        <ul className="pi-results">
          {results.map((entry) => (
            <li key={entry.key}>
              <button type="button" onClick={() => { props.onAddCatalog(entry); setMessage(vi ? `Đã thêm ${entry.name}.` : `Added ${entry.name}.`); }}>
                <span className={`pi-result-icon is-${entry.rarity}`}><ItemIcon iconUrl={entry.iconUrl} name={entry.name} rarity={entry.rarity} /></span>
                <span className={`pi-result-name is-${entry.rarity}`}>{entry.name}</span>
                {entry.baseName && entry.baseName !== entry.name ? <small>{entry.baseName}</small> : null}
                <span className="material-symbols-rounded pi-add" aria-hidden="true">add</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── "Nếu mặc vào" / gem comparison ─────────────────────────────────────────

export interface CompareSpec {
  title: string;
  baseKey: string;
  /** One entry per candidate slot (two rings: both). */
  entries: Array<{ label?: string; key: string }>;
  /** Shown instead of numbers (e.g. the item fits no slot). */
  note?: string;
}

const COMPARE_ROWS: Array<{ stat: string; vi: string; format: StatFormat; higherIsBetter?: boolean }> = [
  { stat: "CombinedDPS", vi: "DPS", format: "short" },
  { stat: "Life", vi: "Máu", format: "int" },
  { stat: "EnergyShield", vi: "ES", format: "int" },
  { stat: "FireResist", vi: "Kháng lửa", format: "pct" },
  { stat: "ColdResist", vi: "Kháng băng", format: "pct" },
  { stat: "LightningResist", vi: "Kháng sét", format: "pct" },
  { stat: "ChaosResist", vi: "Kháng hỗn mang", format: "pct" },
  { stat: "TotalEHP", vi: "Máu hiệu dụng", format: "short" }
];

export function useQueueVersion(queue: CalcQueue<Stats>): number {
  return useSyncExternalStore((listener) => queue.subscribe(listener), () => queue.snapshot, () => 0);
}

/** Changes for one candidate against the base build, or a "calculating" line. */
export function compareRows(queue: CalcQueue<Stats>, baseKey: string, key: string): { state: "waiting" | "error" | "same" | "done"; rows: Array<{ label: string; text: string; better: boolean }>; error?: string } {
  const base = queue.get(baseKey);
  const entry = queue.get(key);
  if (entry?.status === "error" || base?.status === "error") return { state: "error", rows: [], error: entry?.error || base?.error };
  if (entry?.status !== "done" || base?.status !== "done") return { state: "waiting", rows: [] };
  const rows = COMPARE_ROWS.flatMap((row) => {
    const now = Number(base.result?.[row.stat]);
    const next = Number(entry.result?.[row.stat]);
    const change = statChange(row, Number.isFinite(next) ? next : undefined, Number.isFinite(now) ? now : undefined);
    return change ? [{ label: row.vi, text: formatStatChange(change, row.format), better: change.better }] : [];
  });
  return { state: rows.length ? "done" : "same", rows };
}

export function CompareBlock({ queue, spec, locale }: { queue: CalcQueue<Stats>; spec: CompareSpec; locale: Locale }) {
  useQueueVersion(queue);
  const vi = locale === "vi";
  let body: ReactNode;
  if (spec.note) {
    body = <p className="pc-cmp-note">{spec.note}</p>;
  } else {
    body = spec.entries.map((entry) => {
      const view = compareRows(queue, spec.baseKey, entry.key);
      return (
        <div className="pc-cmp-entry" key={entry.key}>
          {entry.label ? <p className="pc-cmp-label">{entry.label}</p> : null}
          {view.state === "waiting" ? (
            <p className="pc-cmp-note"><span className="pi-spinner" aria-hidden="true" />{vi ? `Đang tính…${queue.queuedCount ? ` (còn ${queue.queuedCount} phép tính chờ)` : ""}` : "Calculating…"}</p>
          ) : view.state === "error" ? (
            <p className="pc-cmp-note">{vi ? "Không tính được: " : "Could not calculate: "}{view.error}</p>
          ) : view.state === "same" ? (
            <p className="pc-cmp-note">{vi ? "Không thay đổi chỉ số chính." : "No change to the main stats."}</p>
          ) : (
            <ul className="pc-cmp-rows">
              {view.rows.map((row) => (
                <li key={row.label}><span>{row.label}</span><b className={row.better ? "is-better" : "is-worse"}>{row.text}</b></li>
              ))}
            </ul>
          )}
        </div>
      );
    });
  }
  return (
    <div className="pc-cmp">
      <p className="pc-cmp-title">{spec.title}</p>
      {body}
    </div>
  );
}

// ── Gems to try in a group ─────────────────────────────────────────────────

export interface GemOptionView {
  id: string;
  name: string;
  iconUrl?: string;
  key: string;
}

export function GemSwapStrip({ queue, baseKey, options, locale, title, onPick, onMore, onBrowse, onClose }: {
  queue: CalcQueue<Stats>;
  baseKey: string;
  options: GemOptionView[];
  locale: Locale;
  title: string;
  onPick: (id: string) => void;
  /** Try the next gems of the list; undefined when there are no more. */
  onMore?: () => void;
  onBrowse: () => void;
  onClose: () => void;
}) {
  useQueueVersion(queue);
  const vi = locale === "vi";
  const base = queue.get(baseKey);
  const baseDps = base?.status === "done" ? Number(base.result?.CombinedDPS) || 0 : undefined;
  const rows = options.map((option) => {
    const entry = queue.get(option.key);
    const dps = entry?.status === "done" ? Number(entry.result?.CombinedDPS) || 0 : undefined;
    const delta = dps !== undefined && baseDps !== undefined ? dps - baseDps : undefined;
    return { option, entry, delta };
  });
  // A gem that leaves the group with no damage at all does not work in it: hide it.
  const unusable = rows.filter((row) => baseDps && row.entry?.status === "done" && !(Number(row.entry.result?.CombinedDPS) > 0));
  // Best first once known; the rest keep their order (most fitting tags first).
  const sorted = rows.filter((row) => !unusable.includes(row)).sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  const waiting = rows.filter((row) => row.entry?.status !== "done" && row.entry?.status !== "error").length;
  return (
    <div className="pg-strip poe-no-tooltip" role="group" aria-label={title}>
      <div className="pg-strip-head">
        <span>{title}</span>
        {waiting ? <small><span className="pi-spinner" aria-hidden="true" />{vi ? `Đang thử ${waiting} gem…` : `Trying ${waiting}…`}</small> : <small>{vi ? "Xếp theo DPS tăng thêm" : "Sorted by DPS gain"}</small>}
        <button type="button" className="pi-btn pi-btn--ghost" onClick={onClose} aria-label={vi ? "Đóng" : "Close"}>
          <span className="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      </div>
      <div className="pg-strip-list">
        {sorted.map(({ option, entry, delta }) => {
          const deltaText = delta === undefined
            ? (entry?.status === "error" ? (vi ? "lỗi" : "error") : "…")
            : baseDps && Math.abs(delta / baseDps) < 0.0005
              ? (vi ? "không đổi" : "no change")
            : baseDps
              ? `${delta >= 0 ? "+" : "−"}${Math.abs((delta / baseDps) * 100).toFixed(Math.abs(delta / baseDps) < 0.1 ? 1 : 0)}%`
              : `${delta >= 0 ? "+" : "−"}${Math.round(Math.abs(delta))}`;
          const tone = delta === undefined || Math.abs(delta) < 1 ? "" : delta > 0 ? "is-better" : "is-worse";
          return (
            <button type="button" className="pg-chip" key={option.id} onClick={() => onPick(option.id)} title={vi ? `Dùng ${option.name}` : `Use ${option.name}`}>
              {option.iconUrl ? <img src={option.iconUrl} alt="" loading="lazy" /> : null}
              <span>{option.name}</span>
              <b className={tone}>{deltaText}</b>
            </button>
          );
        })}
        {onMore && !waiting ? (
          <button type="button" className="pg-chip pg-chip--more" onClick={onMore}>
            <span className="material-symbols-rounded" aria-hidden="true">add</span>
            <span>{vi ? "Thử thêm 10 gem" : "Try 10 more"}</span>
          </button>
        ) : null}
        <button type="button" className="pg-chip pg-chip--more" onClick={onBrowse}>
          <span className="material-symbols-rounded" aria-hidden="true">search</span>
          <span>{vi ? "Tìm gem khác…" : "More gems…"}</span>
        </button>
      </div>
      <p className="pg-strip-help">
        {vi ? "Số % là DPS kỹ năng của nhóm này thay đổi nếu đổi sang gem đó. Bấm để đổi." : "Change in this group's DPS if you switch. Click to switch."}
        {unusable.length ? (vi ? ` Đã ẩn ${unusable.length} gem không dùng được trong nhóm này.` : ` ${unusable.length} gem(s) that do nothing here are hidden.`) : ""}
      </p>
    </div>
  );
}

/**
 * What one support adds to its group: the group's DPS with it against without it
 * (both calculated through the queue). "Cần thiết" when the skill does nothing without it.
 */
export function SupportValue({ queue, withKey, withoutKey, locale }: { queue: CalcQueue<Stats>; withKey: string; withoutKey: string; locale: Locale }) {
  useQueueVersion(queue);
  const vi = locale === "vi";
  const withEntry = queue.get(withKey);
  const withoutEntry = queue.get(withoutKey);
  if (withEntry?.status === "error" || withoutEntry?.status === "error") return <span className="sk-value">{vi ? "Không tính được" : "Could not calculate"}</span>;
  if (withEntry?.status !== "done" || withoutEntry?.status !== "done") {
    return <span className="sk-value"><span className="pi-spinner" aria-hidden="true" />{vi ? "Đang tính gem này thêm bao nhiêu DPS…" : "Calculating…"}</span>;
  }
  const withDps = Number(withEntry.result?.CombinedDPS) || 0;
  const withoutDps = Number(withoutEntry.result?.CombinedDPS) || 0;
  if (withDps <= 0) return <span className="sk-value">{vi ? "Nhóm này chưa gây sát thương." : "This group deals no damage."}</span>;
  if (withoutDps <= 0) return <span className="sk-value is-better">{vi ? "Cần thiết: bỏ gem này thì kỹ năng không gây sát thương." : "Required for the skill to deal damage."}</span>;
  const ratio = withDps / withoutDps - 1;
  if (Math.abs(ratio) < 0.0005) return <span className="sk-value">{vi ? "Gem này không đổi DPS (có thể giúp mana, tốc độ, phòng thủ…)." : "No DPS change."}</span>;
  const pct = `${ratio > 0 ? "+" : "−"}${Math.abs(ratio * 100).toFixed(Math.abs(ratio) < 0.1 ? 1 : 0)}%`;
  return <span className={`sk-value ${ratio > 0 ? "is-better" : "is-worse"}`}>{vi ? `Gem này ${ratio > 0 ? "thêm" : "làm giảm"} ${pct} DPS` : `${pct} DPS`}</span>;
}
