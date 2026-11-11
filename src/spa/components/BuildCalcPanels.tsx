// Build Planner panels fed by Path of Building's output: the detailed stat sheet
// (with what changed since the previous calculation) and the "conditions" panel
// that edits PoB's Configuration inputs. Labels and hints are plain Vietnamese.
import { Fragment, useState } from "react";

import type { PobConfigInput } from "../lib/buildPlanner";
import {
  CONFIG_GROUPS,
  RESISTANCES,
  STAT_SECTIONS,
  configInputValue,
  formatStat,
  formatStatChange,
  otherConfigInputs,
  setConfigInput,
  statChange,
  type ConfigOption,
  type StatDefinition
} from "../lib/buildStats";
import "../styles/planner-calc.css";

type Locale = "vi" | "en" | string;
type Stats = Record<string, unknown> | null | undefined;

const num = (stats: Stats, key: string): number | undefined => {
  const value = stats?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

function Hint({ text }: { text: string }) {
  return (
    <span className="pc-hint" tabIndex={0} aria-label={text} data-tip={text}>
      <span className="material-symbols-rounded" aria-hidden="true">help</span>
    </span>
  );
}

function ChangeBadge({ def, current, previous }: { def: StatDefinition; current?: number; previous?: number }) {
  const change = statChange(def, current, previous);
  if (!change) return null;
  return (
    <span className={`pc-change ${change.better ? "is-better" : "is-worse"}`} title="So với lần tính trước">
      {formatStatChange(change, def.format)}
    </span>
  );
}

export function BuildStatDetails({ stats, previous, locale, calculating }: { stats: Stats; previous: Stats; locale: Locale; calculating?: boolean }) {
  const vi = locale === "vi";
  const [open, setOpen] = useState<Record<string, boolean>>({ offence: true, defence: true, recovery: false });
  if (!stats) {
    return (
      <p className="pc-empty">
        {vi
          ? "Chưa có số liệu. Nhập PoB code hoặc chọn class, cây thụ động và skill — Planner sẽ tự tính bằng Path of Building."
          : "No numbers yet. Import a PoB code or pick a class, tree and skill — the planner calculates with Path of Building."}
      </p>
    );
  }
  return (
    // poe-no-tooltip: the site's dictionary links would break these short labels apart.
    <div className={`pc-sheet poe-no-tooltip ${calculating ? "is-calculating" : ""}`}>
      {previous ? (
        <p className="pc-legend">
          {vi ? "Số nhỏ màu xanh/đỏ: thay đổi so với lần tính trước (sau khi bạn đổi đồ, gem, cây hoặc điều kiện)." : "Small green/red numbers: change since the previous calculation."}
        </p>
      ) : null}
      {STAT_SECTIONS.map((section) => {
        const rows = section.stats.filter((def) => {
          const value = num(stats, def.stat);
          if (value === undefined || (def.hideZero && value === 0)) return false;
          // Triggered skills: PoB's per-hit DPS ignores the trigger rate and would read higher than the total.
          if (def.stat === "TotalDPS" && value > (num(stats, "CombinedDPS") ?? Infinity)) return false;
          return true;
        });
        if (!rows.length) return null;
        const isOpen = open[section.id] !== false;
        return (
          <section className="pc-section" key={section.id}>
            <button type="button" className="pc-section-head" aria-expanded={isOpen} onClick={() => setOpen((prev) => ({ ...prev, [section.id]: !isOpen }))}>
              <span>{vi ? section.vi : section.en}</span>
              <span className="material-symbols-rounded" aria-hidden="true">{isOpen ? "expand_less" : "expand_more"}</span>
            </button>
            {isOpen ? (
              <div className="pc-rows">
                {rows.map((def) => (
                  <div className="pc-row" key={def.stat}>
                    <span className="pc-label">
                      {vi ? def.vi : def.en}
                      <Hint text={def.hint} />
                    </span>
                    <strong>
                      {formatStat(num(stats, def.stat), def.format)}
                      <ChangeBadge def={def} current={num(stats, def.stat)} previous={num(previous, def.stat)} />
                    </strong>
                  </div>
                ))}
                {section.id === "defence" ? (
                  <div className="pc-row pc-row--res">
                    <span className="pc-label">
                      {vi ? "Kháng (vượt trần)" : "Resistances (over cap)"}
                      <Hint text="Kháng lửa/băng/sét tối đa 75% (trừ khi có chỉ số tăng trần). Số trong ngoặc là phần dư trên trần — dư nhiều thì yên tâm khi bị giảm kháng. Kháng hỗn mang thường thấp hơn." />
                    </span>
                    <strong>
                      {RESISTANCES.map((res, index) => {
                        const value = num(stats, res.stat);
                        const over = num(stats, res.overCap);
                        return (
                          <Fragment key={res.stat}>
                            {index ? <span className="nj-stat-sep">/</span> : null}
                            <span className={res.cls} title={vi ? res.vi : res.en}>
                              {value === undefined ? "-" : `${Math.round(value)}%`}
                              {over ? <small className="pc-over">({Math.round(over)})</small> : null}
                            </span>
                          </Fragment>
                        );
                      })}
                    </strong>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ConfigControl({ option, inputs, onChange, vi }: { option: ConfigOption; inputs: PobConfigInput[]; onChange: (next: PobConfigInput[]) => void; vi: boolean }) {
  const value = configInputValue(inputs, option);
  const label = vi ? option.vi : option.en;
  if (option.kind === "boolean") {
    return (
      <label className="pc-config-row pc-config-row--check">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(setConfigInput(inputs, option, event.target.checked))} />
        <span>{label}</span>
        <Hint text={option.hint} />
      </label>
    );
  }
  if (option.kind === "number") {
    return (
      <label className="pc-config-row">
        <span>{label}</span>
        <Hint text={option.hint} />
        <input
          type="number"
          inputMode="numeric"
          min={option.min}
          max={option.max}
          value={Number(value)}
          onChange={(event) => onChange(setConfigInput(inputs, option, event.target.value === "" ? 0 : Number(event.target.value)))}
        />
      </label>
    );
  }
  return (
    <label className="pc-config-row">
      <span>{label}</span>
      <Hint text={option.hint} />
      <select value={String(value)} onChange={(event) => onChange(setConfigInput(inputs, option, event.target.value))}>
        {(option.choices ?? []).map((choice) => (
          <option value={choice.value} key={choice.value}>{vi ? choice.vi : choice.en}</option>
        ))}
      </select>
    </label>
  );
}

export function BuildConfigPanel({ inputs, onChange, onReset, changed, locale }: {
  inputs: PobConfigInput[];
  onChange: (next: PobConfigInput[]) => void;
  /** Back to the build's own config (the imported one); undefined hides the button. */
  onReset?: () => void;
  changed?: boolean;
  locale: Locale;
}) {
  const vi = locale === "vi";
  const others = otherConfigInputs(inputs);
  return (
    <div className="pc-config poe-no-tooltip">
      <p className="pc-legend">
        {vi
          ? "Tình huống Path of Building giả định khi tính DPS và phòng thủ. Đổi ở đây thì số liệu được tính lại ngay."
          : "The situation Path of Building assumes for DPS and defences. Changing it recalculates right away."}
      </p>
      {CONFIG_GROUPS.map((group) => (
        <fieldset className="pc-config-group" key={group.id}>
          <legend>{vi ? group.vi : group.en}</legend>
          {group.options.map((option) => (
            <ConfigControl option={option} inputs={inputs} onChange={onChange} vi={vi} key={option.name} />
          ))}
        </fieldset>
      ))}
      {others.length ? (
        <p className="pc-note">
          {vi
            ? `Giữ nguyên ${others.length} điều kiện khác có sẵn trong PoB code (vd. ${others.slice(0, 2).map((row) => row.name).join(", ")}).`
            : `Keeping ${others.length} other conditions from the PoB code.`}
        </p>
      ) : null}
      {onReset && changed ? (
        <button type="button" className="nj-btn nj-btn--outline pc-reset" onClick={onReset}>
          <span className="material-symbols-rounded" aria-hidden="true">restart_alt</span>
          {vi ? "Về điều kiện gốc của build" : "Back to the build's conditions"}
        </button>
      ) : null}
    </div>
  );
}
