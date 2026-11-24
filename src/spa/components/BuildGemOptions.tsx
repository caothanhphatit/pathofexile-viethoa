// Skill-card gem choices that Path of Building offers (stat set, skill part, stages,
// minion type, minion skill, corruption) and the minion / totem stat sheet.
import { Fragment, useEffect, useMemo, useState } from "react";

import { formatStat, statChange, formatStatChange } from "../lib/buildStats";
import {
  CORRUPT_CHOICES,
  hasGemChoices,
  corruptChoice,
  optionLabel,
  pickedStatSet,
  type CorruptChoice,
  type GemOptionChange,
  type PobGemOptions
} from "../lib/gemOptions";
import { MINION_RESISTANCES, summonSheets } from "../lib/summonStats";
import type { MonsterLibrary } from "../../server/pob-monster-gems.mjs";
import type { MonsterGemPatch } from "../../server/pob-monsters.mjs";
import "../styles/planner-calc.css";
import "../styles/planner-gems.css";

type Attrs = Record<string, string> | undefined;

function Hint({ text }: { text: string }) {
  return (
    <span className="pc-hint" tabIndex={0} aria-label={text} data-tip={text}>
      <span className="material-symbols-rounded" aria-hidden="true">help</span>
    </span>
  );
}

const HINTS = {
  statSet: "Kỹ năng này có nhiều chế độ (ví dụ đạn hay vụ nổ). PoB tính DPS theo chế độ bạn chọn ở đây.",
  part: "Kỹ năng gồm nhiều phần; PoB tính DPS theo phần được chọn.",
  stages: "Số tầng (stage) đang tích được; nhiều tầng thường mạnh hơn.",
  minion: "Loại minion kỹ năng gọi ra. PoB tính chỉ số minion theo loại này.",
  beast: "Con thú đã thuần (Tame Beast) đi theo bạn. Sát thương, máu và Spirit giữ chỗ của companion tính theo đúng loài thú này.",
  spectre: "Quái vật đã trói hồn (Bind Spectre). Sát thương, máu và Spirit giữ chỗ của spectre tính theo đúng loài quái này.",
  minionSkill: "Kỹ năng của minion mà PoB dùng để tính sát thương minion.",
  corrupt: "Gem đã corrupt bằng Vaal Orb: +1 hoặc −1 cấp gem, hoặc chỉ bị khoá không đổi cấp."
};

function Select({ label, hint, value, options, onChange }: {
  label: string;
  hint: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="gx-field">
      <span>{label}<Hint text={hint} /></span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

type MonsterModule = typeof import("../../server/pob-monsters.mjs");
let monsterModule: Promise<MonsterModule> | null = null;
/** PoB's monster list, fetched the first time a selector is shown. */
const loadMonsters = () => (monsterModule ??= import("../../server/pob-monsters.mjs").catch((error) => {
  monsterModule = null;
  throw error;
}));

/**
 * The monster of a Companion / Spectre gem (Tame Beast, Bind Spectre): PoB's own list,
 * its recommended picks first, with a name filter. Picking one hands back the monster id
 * (the gem's skillMinion) and the gem fields that make it PoB's "Companion: <monster>" /
 * "Spectre: <monster>" gem.
 */
export function MonsterPicker({ library, value, onPick, locale }: {
  library: MonsterLibrary;
  /** The picked monster id (pobAttrs.skillMinion), if any. */
  value?: string;
  onPick: (monsterId: string, gem: MonsterGemPatch) => void;
  locale: string;
}) {
  const vi = locale === "vi";
  const [data, setData] = useState<MonsterModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    loadMonsters().then((module) => { if (live) setData(module); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  const monsters = useMemo(() => (data ? data.monstersForLibrary(library) : []), [data, library]);
  const current = data && value ? data.monsterById(value) : null;
  const needle = query.trim().toLowerCase();
  const shown = needle ? monsters.filter((monster) => monster.name.toLowerCase().includes(needle)) : monsters;
  const recommended = data ? shown.filter((monster) => data.isRecommendedMonster(monster, library)) : [];
  const others = data ? shown.filter((monster) => !data.isRecommendedMonster(monster, library)) : [];
  const label = library === "beast" ? (vi ? "Thú đồng hành" : "Companion beast") : (vi ? "Quái spectre" : "Spectre monster");
  const option = (monster: { id: string; name: string; category: string }) => (
    <option value={monster.id} key={monster.id}>{library === "beast" ? monster.name : `${monster.name} (${monster.category})`}</option>
  );
  return (
    <span className="gx-monster poe-no-tooltip">
      <label className="gx-field">
        <span>{label}<Hint text={library === "beast" ? HINTS.beast : HINTS.spectre} /></span>
        <input type="search" className="gx-monster-search" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder={vi ? "Lọc theo tên (tiếng Anh)" : "Filter by name"} aria-label={vi ? "Lọc danh sách quái" : "Filter monsters"} />
        <select
          value={current?.id ?? ""}
          disabled={!data}
          aria-label={label}
          onChange={(event) => {
            const gem = data?.monsterGemPatch(library, event.target.value);
            if (gem) onPick(event.target.value, gem);
          }}
        >
          <option value="">{failed ? (vi ? "Không tải được danh sách" : "List failed to load") : !data ? (vi ? "Đang tải..." : "Loading...") : (vi ? "— Chọn quái —" : "— Choose a monster —")}</option>
          {current && !shown.some((monster) => monster.id === current.id) ? option(current) : null}
          {recommended.length ? <optgroup label={vi ? "PoB gợi ý" : "Recommended by PoB"}>{recommended.map(option)}</optgroup> : null}
          {others.length ? <optgroup label={vi ? `Tất cả (${others.length})` : `All (${others.length})`}>{others.map(option)}</optgroup> : null}
        </select>
      </label>
      {data && !current ? (
        <small className="gx-monster-note">
          {value
            ? (vi ? "Quái đã lưu không còn trong dữ liệu PoB — hãy chọn lại." : "The saved monster is not in PoB's data any more — pick again.")
            : (vi ? "Chưa chọn quái: PoB tính 0 sát thương cho kỹ năng này." : "No monster picked: PoB calculates no damage for this skill.")}
        </small>
      ) : null}
    </span>
  );
}

/**
 * The choices of one gem: PoB's options for it (when it has any) and, for skill gems,
 * corruption (PoE2 support gems have no level to corrupt).
 */
export function GemOptionControls({ option, attrs, onChange, locale, corrupt = true, hideMinions = false }: {
  option?: PobGemOptions;
  attrs: Attrs;
  onChange: (change: GemOptionChange) => void;
  locale: string;
  corrupt?: boolean;
  /** The card has its own monster selector (Companion / Spectre gems). */
  hideMinions?: boolean;
}) {
  // PoB resets corruption on skills it grants (item, tree, weapon).
  const showCorrupt = corrupt && !option?.grantedSkill;
  if (!hasGemChoices(option) && !showCorrupt) return null;
  const vi = locale === "vi";
  const list = (names: string[]) => names.map((name, index) => ({ value: String(index + 1), label: optionLabel(name, locale) || `${index + 1}` }));
  // poe-no-tooltip: the site's dictionary links would split these short labels.
  return (
    <span className="gx-controls poe-no-tooltip">
      {option?.statSets ? (
        <Select label={vi ? "Chế độ" : "Stat set"} hint={HINTS.statSet} value={String(pickedStatSet(attrs, option.grantedEffect))} options={list(option.statSets)}
          onChange={(value) => onChange({ kind: "statSet", grantedEffect: option.grantedEffect, value: Number(value) })} />
      ) : null}
      {option?.parts ? (
        <Select label={vi ? "Phần kỹ năng" : "Skill part"} hint={HINTS.part} value={String(Number(attrs?.skillPart) || option.part || 1)} options={list(option.parts)}
          onChange={(value) => onChange({ kind: "part", value: Number(value) })} />
      ) : null}
      {option?.maxStages ? (
        <label className="gx-field">
          <span>{vi ? "Số tầng" : "Stages"}<Hint text={HINTS.stages} /></span>
          <input type="number" min={1} max={option.maxStages} value={Number(attrs?.skillStageCount) || option.stages || 1}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(value)) onChange({ kind: "stages", value: Math.min(Math.max(value, 1), option.maxStages ?? value) });
            }} />
        </label>
      ) : null}
      {option?.minions && !hideMinions ? (
        <Select label="Minion" hint={HINTS.minion} value={attrs?.skillMinion || option.minion || option.minions[0]?.id || ""}
          options={option.minions.map((minion) => ({ value: minion.id, label: minion.name }))}
          onChange={(value) => onChange({ kind: "minion", value })} />
      ) : null}
      {option?.minionSkills ? (
        <Select label={vi ? "Kỹ năng minion" : "Minion skill"} hint={HINTS.minionSkill} value={String(Number(attrs?.skillMinionSkill) || option.minionSkill || 1)} options={list(option.minionSkills)}
          onChange={(value) => onChange({ kind: "minionSkill", value: Number(value) })} />
      ) : null}
      {showCorrupt ? <Select label="Corrupt" hint={HINTS.corrupt} value={corruptChoice(attrs)}
        options={CORRUPT_CHOICES.map((choice) => ({ value: choice.value, label: vi ? choice.vi : choice.en }))}
        onChange={(value) => onChange({ kind: "corrupt", value: value as CorruptChoice })} /> : null}
    </span>
  );
}

/** Short tag for the card face when a gem is not on PoB's defaults ("Nổ", "C+1"). */
export function gemOptionBadges(option: PobGemOptions | undefined, attrs: Attrs, locale: string): string[] {
  const badges: string[] = [];
  if (option?.statSets) {
    const index = pickedStatSet(attrs, option.grantedEffect);
    if (index > 1 && option.statSets[index - 1]) badges.push(optionLabel(option.statSets[index - 1], locale).replace(/ \(.*\)$/, ""));
  }
  if (option?.parts) {
    const index = Number(attrs?.skillPart) || 1;
    if (index > 1 && option.parts[index - 1]) badges.push(option.parts[index - 1]);
  }
  if (option?.minionSkills) {
    const index = Number(attrs?.skillMinionSkill) || 1;
    if (index > 1 && option.minionSkills[index - 1]) badges.push(option.minionSkills[index - 1]);
  }
  const corrupt = corruptChoice(attrs);
  if (corrupt === "plus") badges.push("C+1");
  else if (corrupt === "minus") badges.push("C−1");
  return badges;
}

/** Minion / totem numbers of the main skill; nothing for a plain skill. */
export function BuildSummonStats({ stats, previous, locale }: { stats: Record<string, unknown> | null | undefined; previous: Record<string, unknown> | null | undefined; locale: string }) {
  const vi = locale === "vi";
  const sheets = summonSheets(stats, locale);
  if (!sheets.length) return null;
  const before = summonSheets(previous, locale);
  return (
    <div className="pc-sheet poe-no-tooltip gx-summon">
      {sheets.map((sheet) => {
        const old = before.find((row) => row.kind === sheet.kind)?.values ?? {};
        const rows = sheet.defs.filter((def) => sheet.values[def.stat] !== undefined && !(def.hideZero && sheet.values[def.stat] === 0));
        return (
          <section className="pc-section" key={sheet.kind}>
            <div className="pc-section-head gx-summon-head">
              <span>{sheet.title}</span>
              {sheet.subtitle ? <small>{sheet.subtitle}</small> : null}
            </div>
            <div className="pc-rows">
              {rows.map((def) => {
                const change = statChange(def, sheet.values[def.stat], old[def.stat]);
                return (
                  <div className="pc-row" key={def.stat}>
                    <span className="pc-label">{vi ? def.vi : def.en}<Hint text={def.hint} /></span>
                    <strong>
                      {formatStat(sheet.values[def.stat], def.format)}
                      {change ? <span className={`pc-change ${change.better ? "is-better" : "is-worse"}`}>{formatStatChange(change, def.format)}</span> : null}
                    </strong>
                  </div>
                );
              })}
              {sheet.kind === "minion" && MINION_RESISTANCES.some((stat) => sheet.values[stat] !== undefined) ? (
                <div className="pc-row pc-row--res">
                  <span className="pc-label">
                    {vi ? "Kháng của minion" : "Minion resistances"}
                    <Hint text="Kháng lửa / băng / sét / hỗn mang của minion. Tối đa thường 75%; kháng thấp làm minion chết nhanh." />
                  </span>
                  <strong>
                    {MINION_RESISTANCES.map((stat, index) => (
                      <Fragment key={stat}>
                        {index ? <span className="nj-stat-sep">/</span> : null}
                        <span className={`nj-c-${stat.replace("Resist", "").toLowerCase()}`}>
                          {sheet.values[stat] === undefined ? "-" : `${Math.round(sheet.values[stat])}%`}
                        </span>
                      </Fragment>
                    ))}
                  </strong>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
