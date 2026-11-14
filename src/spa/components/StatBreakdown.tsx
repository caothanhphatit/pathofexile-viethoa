// "Chỉ số này từ đâu ra?": Path of Building's breakdown of one stat (base,
// increases and "more" multipliers, grouped by item / passive / gem / quest),
// in plain Vietnamese. All explainable stats come from one queued PoB run per build
// (src/server/pob-breakdown.mjs), so opening another stat is instant.
import { useEffect, useMemo } from "react";

import { BREAKDOWN_STATS } from "../../server/pob-breakdown.mjs";
import { calcKey, type CalcQueue } from "../lib/calcQueue";
import { breakdownTotals, groupBreakdownSources, translateBreakdownLine, type StatBreakdownEntry } from "../lib/statBreakdown";
import { useQueueVersion } from "./BuildInventoryPanel";

type Locale = "vi" | "en" | string;

export interface ExplainTarget {
  stat: string;
  label: string;
  /** Value as the stat sheet shows it. */
  valueText: string;
}

/** Stats the stat sheet can open a breakdown for. */
export const canExplainStat = (stat: string) => BREAKDOWN_STATS.includes(stat);

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
  // Queued after render (queue updates re-render other components).
  useEffect(() => {
    if (request) queue.request(request, 9);
  }, [queue, request]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const entry = key ? queue.get(key) : undefined;
  const breakdown = (entry?.status === "done" ? (entry.result?.Breakdown as Record<string, StatBreakdownEntry> | undefined)?.[target.stat] : undefined);
  const groups = breakdown ? groupBreakdownSources(breakdown.sources) : [];
  // Totals only when every modifier is the same stat (Life): damage mixes types the skill may not deal.
  const singleKind = breakdown ? new Set(breakdown.sources.filter((row) => row.type !== "BASE").map((row) => row.name)).size <= 1 : false;
  const totals = breakdown && singleKind ? breakdownTotals(breakdown.sources) : null;

  return (
    <div className="sb-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sb-dialog poe-no-tooltip" role="dialog" aria-modal="true" aria-label={vi ? `${target.label} từ đâu ra` : `Where ${target.label} comes from`}>
        <header className="sb-head">
          <div>
            <p className="sb-eyebrow">{vi ? "Chỉ số này từ đâu ra?" : "Where does this come from?"}</p>
            <h2>{target.label} <b>{target.valueText}</b></h2>
          </div>
          <button type="button" className="pi-btn pi-btn--ghost" onClick={onClose} aria-label={vi ? "Đóng" : "Close"}>
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
