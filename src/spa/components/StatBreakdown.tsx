// "Chỉ số này từ đâu ra?": Path of Building's breakdown of one stat (base,
// increases and "more" multipliers, grouped by item / passive / gem / quest),
// in plain Vietnamese. All explainable stats come from one queued PoB run per build
// (src/server/pob-breakdown.mjs), so opening another stat is instant.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { BREAKDOWN_STATS } from "../../server/pob-breakdown.mjs";
import { calcKey, type CalcQueue } from "../lib/calcQueue";
import { breakdownTotals, groupBreakdownByPhase, groupBreakdownSources, translateBreakdownLine, type StatBreakdownEntry } from "../lib/statBreakdown";
import { useQueueVersion } from "./BuildInventoryPanel";

type Locale = "vi" | "en" | string;

export interface ExplainTarget {
  stat: string;
  label: string;
  /** Value as the stat sheet shows it. */
  valueText: string;
}

export interface HoverBreakdownTarget extends ExplainTarget {
  rect: { top: number; bottom: number; left: number; right: number; height: number };
}

/** Stats the stat sheet can open a breakdown for. */
export const canExplainStat = (stat: string) => BREAKDOWN_STATS.includes(stat);

/**
 * Floating poe.ninja-style hover preview for any explainable stat row.
 * Shares the exact same single queued PoB breakdown run as StatBreakdownDialog,
 * so hovering from Life -> ES -> Mana -> Resistances is instant once loaded.
 */
export function StatBreakdownHoverCard({ queue, body, target, locale }: {
  queue: CalcQueue<Record<string, unknown>>;
  body: Record<string, unknown> | null;
  target: HoverBreakdownTarget;
  locale: Locale;
}) {
  useQueueVersion(queue);
  const vi = locale === "vi";
  const request = useMemo(() => (body ? { ...body, full_dps: false, analysis: { breakdown: BREAKDOWN_STATS } } : null), [body]);
  const key = useMemo(() => (request ? calcKey(request) : ""), [request]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (request) queue.request(request, 8);
  }, [queue, request]);

  const entry = key ? queue.get(key) : undefined;
  const breakdown = entry?.status === "done"
    ? (entry.result?.Breakdown as Record<string, StatBreakdownEntry> | undefined)?.[target.stat]
    : undefined;
  const phases = useMemo(() => (breakdown ? groupBreakdownByPhase(breakdown.sources, 4) : []), [breakdown]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    const width = el?.offsetWidth || 320;
    const height = el?.offsetHeight || 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;
    let left = target.rect.left - width - 12;
    if (left < margin) {
      const rightCandidate = target.rect.right + 12;
      left = rightCandidate + width <= vw - margin ? rightCandidate : Math.max(margin, vw - width - margin);
    }
    let top = target.rect.top - 12;
    if (top + height > vh - margin) top = Math.max(margin, vh - height - margin);
    if (top < margin) top = margin;
    setPos({ left, top });
  }, [target, breakdown, phases.length]);

  return (
    <div
      ref={cardRef}
      className="sb-hover poe-no-tooltip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top, opacity: 1 } : { left: Math.max(12, target.rect.left - 332), top: Math.max(12, target.rect.top - 12), opacity: 0 }}
    >
      <div className="sb-hover-head">
        <span className="sb-hover-title">{target.label}</span>
        <strong className="sb-hover-val">{target.valueText}</strong>
      </div>
      <div className="sb-hover-body">
        {!request ? (
          <p className="sb-hover-msg">{vi ? "Chưa có dữ liệu build." : "No build data yet."}</p>
        ) : entry?.status === "error" ? (
          <p className="sb-hover-msg">{vi ? "Không tải được chi tiết chỉ số." : "Could not load breakdown."}</p>
        ) : !breakdown ? (
          <p className="sb-hover-msg"><span className="pi-spinner" aria-hidden="true" />{vi ? "Đang phân tích chỉ số từ PoB…" : "Calculating breakdown in PoB…"}</p>
        ) : phases.length ? (
          phases.map((section) => (
            <div className="sb-hover-section" key={section.phase}>
              <div className="sb-hover-sec-head">
                <span>{vi ? section.titleVi : section.titleEn}</span>
                <strong>{section.totalText}</strong>
              </div>
              <ul className="sb-hover-rows">
                {section.rows.map((row, idx) => (
                  <li className="sb-hover-row" key={`${row.label}-${idx}`}>
                    <span className={`sb-hover-src is-kind-${row.kind}`}>{row.label}</span>
                    <span className="sb-hover-kind">{row.kindBadge}</span>
                    <strong className={`sb-hover-num ${row.value < 0 ? "is-negative" : ""}`}>{row.text}</strong>
                  </li>
                ))}
                {section.restCount > 0 ? (
                  <li className="sb-hover-row is-rest">
                    <span className="sb-hover-src">{vi ? `...${section.restCount} nguồn khác` : `...${section.restCount} more`}</span>
                    <span className="sb-hover-kind" />
                    <strong className="sb-hover-num">{section.restText}</strong>
                  </li>
                ) : null}
              </ul>
            </div>
          ))
        ) : breakdown.lines.length ? (
          <ul className="sb-hover-lines">
            {breakdown.lines.slice(0, 6).map((line, idx) => (
              <li key={idx}>{vi ? translateBreakdownLine(line) : line}</li>
            ))}
          </ul>
        ) : (
          <p className="sb-hover-msg">{vi ? "Không có nguồn chi tiết riêng cho chỉ số này." : "No separate breakdown sources."}</p>
        )}
      </div>
      <div className="sb-hover-foot">
        {vi ? "Bấm vào dòng để xem toàn bộ chi tiết" : "Click the row for the full breakdown"}
      </div>
    </div>
  );
}

export function StatBreakdownDialog({ queue, body, target, locale, onClose }: {
  queue: CalcQueue<Record<string, unknown>>;
  /** The build's calculation body (null before there is a build to calculate). */
  body: Record<string, unknown> | null;
  target: ExplainTarget;
  locale: Locale;
  onClose: () => void;
}) {
  useQueueVersion(queue);
  const vi = locale === "vi";
  // Every explainable stat in one run: switching stats needs no new calculation.
  const request = useMemo(() => (body ? { ...body, full_dps: false, analysis: { breakdown: BREAKDOWN_STATS } } : null), [body]);
  const key = useMemo(() => (request ? calcKey(request) : ""), [request]);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const backdropDownRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Move focus into the breakdown dialog on open and synchronously restore it on close.
  useLayoutEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus({ preventScroll: true });
    return () => {
      if (prevActive && typeof prevActive.focus === "function" && prevActive.isConnected) {
        prevActive.focus({ preventScroll: true });
      }
    };
  }, []);

  // Queued after render (queue updates re-render other components).
  useEffect(() => {
    if (request) queue.request(request, 9);
  }, [queue, request]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, []);

  const entry = key ? queue.get(key) : undefined;
  const breakdown = (entry?.status === "done" ? (entry.result?.Breakdown as Record<string, StatBreakdownEntry> | undefined)?.[target.stat] : undefined);
  const groups = breakdown ? groupBreakdownSources(breakdown.sources) : [];
  // Totals only when every modifier is the same stat (Life): damage mixes types the skill may not deal.
  const singleKind = breakdown ? new Set(breakdown.sources.filter((row) => row.type !== "BASE").map((row) => row.name)).size <= 1 : false;
  const totals = breakdown && singleKind ? breakdownTotals(breakdown.sources) : null;

  return (
    <div
      className="sb-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        backdropDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropDownRef.current && event.target === event.currentTarget) {
          backdropDownRef.current = false;
          onClose();
        }
      }}
    >
      <section className="sb-dialog poe-no-tooltip" role="dialog" aria-modal="true" aria-label={vi ? `${target.label} từ đâu ra` : `Where ${target.label} comes from`}>
        <header className="sb-head">
          <div>
            <p className="sb-eyebrow">{vi ? "Chỉ số này từ đâu ra?" : "Where does this come from?"}</p>
            <h2>{target.label} <b>{target.valueText}</b></h2>
          </div>
          <button ref={closeBtnRef} type="button" className="pi-btn pi-btn--ghost" onClick={onClose} aria-label={vi ? "Đóng" : "Close"}>
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>
        <div className="sb-body">
          {!request ? (
            <p className="sb-note">{vi ? "Chưa có build để tính." : "No build to calculate."}</p>
          ) : entry?.status === "error" ? (
            <p className="sb-note">{vi ? "Không tính được: " : "Could not calculate: "}{entry.error}</p>
          ) : !breakdown ? (
            <p className="sb-note"><span className="pi-spinner" aria-hidden="true" />{vi ? "Path of Building đang phân tích chỉ số…" : "Path of Building is working it out…"}</p>
          ) : (
            <>
              {breakdown.lines.length ? (
                <div className="sb-calc">
                  <h3>{vi ? "Cách PoB tính" : "How PoB calculates it"}</h3>
                  <ol>{breakdown.lines.map((line, index) => <li key={index}>{vi ? translateBreakdownLine(line) : line}</li>)}</ol>
                </div>
              ) : null}
              {totals && (totals.increased || totals.more !== 1) ? (
                <p className="sb-summary">
                  {vi ? "Tổng cộng: " : "In total: "}
                  {totals.increased ? <span>{`${totals.increased >= 0 ? "+" : "−"}${Math.round(Math.abs(totals.increased))}% ${vi ? (totals.increased >= 0 ? "tăng" : "giảm") : "increased"}`}</span> : null}
                  {totals.more !== 1 ? <span>{`× ${(Math.round(totals.more * 100) / 100).toLocaleString("en-US")} ${vi ? "nhân thêm" : "more"}`}</span> : null}
                </p>
              ) : null}
              {groups.length ? groups.map((group) => (
                <div className="sb-group" key={group.kind}>
                  <h3>{vi ? group.title : group.kind}</h3>
                  <ul>
                    {group.rows.map((row, index) => (
                      <li key={`${row.label}-${row.name}-${index}`}>
                        <span className="sb-source">
                          {row.label || (vi ? "Gốc" : "Base")}
                          {group.rows.some((other) => other.name !== row.name) || row.name !== group.rows[0]?.name ? <small> · {vi ? row.nameVi : row.name}</small> : null}
                        </span>
                        <b className={`sb-value is-${row.type.toLowerCase()} ${row.value < 0 ? "is-negative" : ""}`}>{row.text}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )) : <p className="sb-note">{vi ? "PoB không liệt kê nguồn riêng cho chỉ số này." : "PoB lists no separate sources for this stat."}</p>}
              <p className="sb-help">
                {vi
                  ? "“Tăng” cộng dồn với nhau rồi nhân một lần; “nhân thêm” nhân riêng từng cái, nên thường mạnh hơn. Số liệu do Path of Building tính cho kỹ năng chính."
                  : "Increases add together; “more” multipliers each multiply separately. Calculated by Path of Building for the main skill."}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
