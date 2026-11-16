// The menu of a passive tree jewel socket in the Build Planner: the jewel in it
// (take it out to the inventory), and the jewels that fit, each with what it
// would change ("Nếu gắn vào") from the same comparison queue as the inventory.
import { useEffect, useMemo } from "react";
import type { Locale } from "../lib/locale";
import type { BuildInventoryChoice, BuildStashItem } from "../lib/buildPlanner";
import { jewelSocketNodeId, stashItemSummary } from "../lib/buildInventory";
import type { CalcQueue } from "../lib/calcQueue";
import type { PassiveNode } from "../passive/tree";
import { compareRows, useQueueVersion } from "./BuildInventoryPanel";

type Stats = Record<string, unknown>;
type Compare = { base: Record<string, unknown>; body: Record<string, unknown>; baseKey: string; key: string } | null;

const MAX_CANDIDATES = 8;

function CompareLine({ queue, compare, locale }: { queue: CalcQueue<Stats>; compare: Compare; locale: Locale }) {
  const vi = locale === "vi";
  if (!compare) return null;
  const view = compareRows(queue, compare.baseKey, compare.key);
  if (view.state === "waiting") return <span className="sj-cmp is-wait"><span className="pi-spinner" aria-hidden="true" />{vi ? "Đang tính…" : "Calculating…"}</span>;
  if (view.state === "error") return <span className="sj-cmp is-wait">{vi ? "Không tính được" : "Could not calculate"}</span>;
  if (view.state === "same") return <span className="sj-cmp is-wait">{vi ? "Không đổi chỉ số chính" : "No change"}</span>;
  return (
    <span className="sj-cmp">
      {view.rows.slice(0, 3).map((row) => <b key={row.label} className={row.better ? "is-better" : "is-worse"}>{row.label} {row.text}</b>)}
    </span>
  );
}

export function SocketJewelMenu(props: {
  node: PassiveNode;
  allocated: boolean;
  locale: Locale;
  queue: CalcQueue<Stats>;
  current: BuildInventoryChoice | null;
  /** Inventory jewels this socket takes. */
  candidates: BuildStashItem[];
  /** Jewels in other sockets this socket takes (moved here, swapping). */
  others: BuildInventoryChoice[];
  jewelName: (row: BuildInventoryChoice) => string;
  compare: (change: { put?: string; out?: boolean; from?: string }) => Compare;
  requestCalc: (body: Record<string, unknown>, priority: number) => string;
  onPut: (itemId: string) => void;
  onMove: (fromNodeId: string) => void;
  onTakeOut: () => void;
}) {
  useQueueVersion(props.queue);
  const vi = props.locale === "vi";
  const filled = Boolean(props.current && (props.current.itemName || props.current.rawText));
  const candidates = props.candidates.slice(0, MAX_CANDIDATES);
  // Comparisons only mean something while the socket is allocated (PoB ignores the jewel otherwise).
  const { compare, allocated } = props;
  const candidateIds = candidates.map((item) => item.id).join(",");
  const otherIds = props.others.map((row) => row.inventoryId).join(",");
  const compares = useMemo(() => {
    if (!allocated) return null;
    return {
      out: filled ? compare({ out: true }) : null,
      put: new Map(candidates.map((item) => [item.id, compare({ put: item.id })])),
      move: new Map(props.others.map((row) => [row.inventoryId, compare({ from: jewelSocketNodeId(row.inventoryId) })]))
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocated, filled, candidateIds, otherIds, compare]);
  const { requestCalc } = props;
  useEffect(() => {
    if (!compares) return;
    const all = [compares.out, ...compares.put.values(), ...compares.move.values()].filter((row): row is NonNullable<Compare> => Boolean(row));
    if (!all.length) return;
    requestCalc(all[0].base, 9);
    all.forEach((row, index) => requestCalc(row.body, 9 - Math.min(index, 8)));
    // Re-request only when the set of comparisons changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compares && [compares.out?.key, ...[...compares.put.values()].map((row) => row?.key), ...[...compares.move.values()].map((row) => row?.key)].join("|")]);

  return (
    <div className="sj-menu">
      {!props.allocated ? (
        <p className="sj-note">{vi ? "Ô này chưa được chọn điểm: ngọc gắn vào sẽ chưa có tác dụng cho tới khi bạn chọn điểm ô này." : "This socket is not allocated: a jewel here does nothing until it is."}</p>
      ) : null}
      {filled && props.current ? (
        <div className="sj-current">
          <p className="sj-label">{vi ? "Đang gắn" : "Socketed"}</p>
          <div className="sj-row">
            <span className="sj-name" translate="no">{props.jewelName(props.current)}</span>
            <button type="button" className="sj-btn" onClick={props.onTakeOut}>
              <span className="material-symbols-rounded" aria-hidden="true">move_to_inbox</span>
              {vi ? "Tháo ra kho" : "Take out"}
            </button>
          </div>
          {compares?.out ? <div className="sj-row-cmp"><small>{vi ? "Nếu tháo ra:" : "If removed:"}</small><CompareLine queue={props.queue} compare={compares.out} locale={props.locale} /></div> : null}
        </div>
      ) : null}
      <p className="sj-label">{filled ? (vi ? "Đổi sang ngọc khác" : "Swap for") : (vi ? "Gắn ngọc từ kho đồ" : "Socket a jewel")}</p>
      {candidates.length || props.others.length ? (
        <ul className="sj-list">
          {candidates.map((item) => {
            const summary = stashItemSummary(item);
            return (
              <li key={item.id}>
                <button type="button" className={`sj-pick is-${summary.rarity || "normal"}`} onClick={() => props.onPut(item.id)}>
                  <span className="sj-name" translate="no">{summary.name}</span>
                  <CompareLine queue={props.queue} compare={compares?.put.get(item.id) ?? null} locale={props.locale} />
                </button>
              </li>
            );
          })}
          {props.others.map((row) => (
            <li key={row.inventoryId}>
              <button type="button" className="sj-pick" onClick={() => props.onMove(jewelSocketNodeId(row.inventoryId))}>
                <span className="sj-name" translate="no">{props.jewelName(row)} <small>{vi ? "(chuyển từ ô khác)" : "(from another socket)"}</small></span>
                <CompareLine queue={props.queue} compare={compares?.move.get(row.inventoryId) ?? null} locale={props.locale} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sj-note">{vi
          ? (props.node.jewelSocket === "sinister" ? "Kho đồ chưa có ngọc nào hợp ô này (ô này không nhận ngọc độc nhất). Dán ngọc từ game vào Kho đồ." : props.node.jewelSocket === "basic" ? "Kho đồ chưa có ngọc cơ bản (Ruby, Emerald, Sapphire, Diamond) không độc nhất." : "Kho đồ chưa có ngọc nào. Dán ngọc từ game (Ctrl+C) vào Kho đồ.")
          : "No jewel in the inventory fits this socket."}</p>
      )}
      {props.candidates.length > MAX_CANDIDATES ? <p className="sj-note">{vi ? `Còn ${props.candidates.length - MAX_CANDIDATES} ngọc khác trong kho: kéo thả vào ô để gắn.` : "More jewels in the inventory."}</p> : null}
    </div>
  );
}
