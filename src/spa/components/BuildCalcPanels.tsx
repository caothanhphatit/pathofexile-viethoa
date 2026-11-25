// Build Planner panels fed by Path of Building's output: the detailed stat sheet
// (with what changed since the previous calculation) and the "conditions" panel
// that edits PoB's Configuration inputs. Labels and hints are plain Vietnamese.
import { Fragment, useState } from "react";

import type { PobConfigInput } from "../lib/buildPlanner";
import {
  CONFIG_GROUPS,
  RESISTANCES,
  resistanceText,
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
import { canExplainStat, type ExplainTarget } from "./StatBreakdown";

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

export function BuildStatDetails({ stats, previous, locale, calculating, onExplain }: {
  stats: Stats;
  previous: Stats;
  locale: Locale;
  calculating?: boolean;
  /** Opens "where does this come from" for a stat (StatBreakdownDialog). */
  onExplain?: (target: ExplainTarget) => void;
}) {
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
                      {onExplain && canExplainStat(def.stat) ? (
                        <button type="button" className="pc-explain" onClick={() => onExplain({ stat: def.stat, label: vi ? def.vi : def.en, valueText: formatStat(num(stats, def.stat), def.format) })} title={vi ? "Bấm để xem chỉ số này từ đâu ra" : "Where does this come from?"}>
                          {vi ? def.vi : def.en}
                        </button>
                      ) : (vi ? def.vi : def.en)}
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
                        // As PoB shows it: chaos is "Immune" with Chaos Inoculation.
                        const text = resistanceText(stats, res.stat, locale) ?? "-";
                        const over = text.endsWith("%") ? num(stats, res.overCap) : undefined;
                        return (
                          <Fragment key={res.stat}>
                            {index ? <span className="nj-stat-sep">/</span> : null}
                            <button
                              type="button"
                              className={`pc-explain pc-explain--res ${res.cls}`}
                              disabled={!onExplain}
                              onClick={() => onExplain?.({ stat: res.stat, label: vi ? `Kháng ${res.vi.toLowerCase()}` : `${res.en} resistance`, valueText: text })}
                              title={vi ? `Kháng ${res.vi.toLowerCase()} — bấm để xem từ đâu ra` : res.en}
                            >
                              {text}
                              {over ? <small className="pc-over">({Math.round(over)})</small> : null}
                            </button>
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

function ConfigControl({ option, inputs, onChange, vi, stacked = false }: {
  option: ConfigOption;
  inputs: PobConfigInput[];
  onChange: (next: PobConfigInput[]) => void;
  vi: boolean;
  stacked?: boolean;
}) {
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
  if (stacked) {
    return (
      <label className="pc-config-row pc-config-row--stacked">
        <span className="pc-config-row-head">
          <span>{label}</span>
          <Hint text={option.hint} />
        </span>
        <select value={String(value)} onChange={(event) => onChange(setConfigInput(inputs, option, event.target.value))}>
          {(option.choices ?? []).map((choice) => (
            <option value={choice.value} key={choice.value}>{vi ? choice.vi : choice.en}</option>
          ))}
        </select>
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
  const [questTab, setQuestTab] = useState<"choices" | "all">("choices");
  const others = otherConfigInputs(inputs);
  const choiceQuests = CONFIG_GROUPS.find((group) => group.id === "quests_choice");
  const fixedQuests = CONFIG_GROUPS.find((group) => group.id === "quests_fixed");
  const standardGroups = CONFIG_GROUPS.filter((group) => group.id !== "quests_choice" && group.id !== "quests_fixed");
  const disabledFixedCount = (fixedQuests?.options ?? []).filter((option) => configInputValue(inputs, option) === false).length;

  return (
    <div className="pc-config poe-no-tooltip">
      <p className="pc-legend">
        {vi
          ? "Tình huống và phần thưởng nhiệm vụ Path of Building giả định khi tính DPS và phòng thủ. Đổi ở đây thì số liệu được tính lại ngay."
          : "Conditions and quest rewards Path of Building assumes for DPS and defences. Changing them recalculates right away."}
      </p>
      {choiceQuests ? (
        <fieldset className="pc-config-group pc-config-group--quests">
          <div className="pc-quest-head">
            <legend>{vi ? "Phần thưởng nhiệm vụ" : "Quest rewards"}</legend>
            <div className="pc-quest-tabs" role="tablist" aria-label={vi ? "Chế độ xem phần thưởng nhiệm vụ" : "Quest rewards view"}>
              <button
                type="button"
                role="tab"
                aria-selected={questTab === "choices"}
                className={`pc-quest-tab ${questTab === "choices" ? "is-active" : ""}`}
                onClick={() => setQuestTab("choices")}
              >
                {vi ? "Lựa chọn" : "Choices"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={questTab === "all"}
                className={`pc-quest-tab ${questTab === "all" ? "is-active" : ""}`}
                onClick={() => setQuestTab("all")}
              >
                {vi ? "Tất cả" : "All"}
                {disabledFixedCount > 0 ? <small className="pc-quest-badge">{disabledFixedCount}</small> : null}
              </button>
            </div>
          </div>
          {choiceQuests.options.map((option) => (
            <ConfigControl option={option} inputs={inputs} onChange={onChange} vi={vi} stacked key={option.name} />
          ))}
          {questTab === "choices" ? (
            <p className="pc-quest-note">
              {vi
                ? "9 phần thưởng cốt truyện cố định (+20 & +5% Máu, +100 Spirit, +10% kháng Lửa/Băng/Sét, +5% Mana) mặc định đã bật. Bấm \"Tất cả\" nếu muốn bật/tắt từng mục."
                : "All 9 fixed campaign bonuses (+20 & +5% Life, +100 Spirit, +10% Fire/Cold/Lightning Res, +5% Mana) are enabled by default. Switch to \"All\" to toggle them."}
            </p>
          ) : fixedQuests ? (
            <div className="pc-quest-fixed">
              <div className="pc-quest-subhead">
                {vi ? "Phần thưởng cố định theo cốt truyện (mặc định bật)" : "Fixed campaign quest bonuses (enabled by default)"}
              </div>
              {fixedQuests.options.map((option) => (
                <ConfigControl option={option} inputs={inputs} onChange={onChange} vi={vi} key={option.name} />
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {standardGroups.map((group) => (
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
