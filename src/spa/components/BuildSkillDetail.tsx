// Skill detail panel opened beside the compact skill list on desktop or inline under
// a skill block on narrow screens, using PoE2's base-art ratios (P = 890 reference).
import { useEffect, useMemo, type MouseEvent, type ReactNode } from "react";

import { MAX_SUPPORT_SOCKETS, supportSocketStepperBounds, type BuildSkillChoice, type BuildSupportSkillChoice } from "../lib/buildPlanner";
import { cardDamageNeedsNames, formatStat, type CardDamageLine } from "../lib/buildStats";
import { calcKey, type CalcQueue } from "../lib/calcQueue";
import { hasGemChoices, optionLabel, pickedStatSet, withGemOption, type GemOptionChange, type PobGemOptions } from "../lib/gemOptions";
import { monsterLibraryOf } from "../../server/pob-monster-gems.mjs";
import type { MonsterGemPatch } from "../../server/pob-monsters.mjs";
import { GemOptionControls, MonsterPicker, gemOptionBadges } from "./BuildGemOptions";
import { useQueueVersion } from "./BuildInventoryPanel";

export interface SkillGemMeta {
  label: string;
  icon: string;
  description?: string;
  rawName?: string;
  /** Gem attribute colour from skill-gems-data.js ("red" | "green" | "blue" | "item"). */
  color?: string;
}

export interface SkillDamageBadge {
  kind?: "DPS" | "DMG";
  /** Full number with thousands separators (e.g. "2,656,065"); never abbreviated. */
  value: string;
  /** "/đòn" / "/hit" for per-hit skills (used in tooltips and detail panel). */
  unit?: string;
  deltaText?: string;
  deltaBetter?: boolean;
  exact?: string;
}

export function supportInitials(label: string): string {
  return label
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "?";
}

export function formatBadgeNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function skillDamageBadge(input: {
  dps: number | undefined;
  before?: number;
  perHit: boolean;
  disabled: boolean;
  calculating: boolean;
  locale: string;
}): SkillDamageBadge {
  const vi = input.locale === "vi";
  if (input.disabled) return { value: vi ? "Tắt" : "Off" };
  if (input.dps === undefined) return { value: input.calculating ? "…" : "—" };
  if (!(input.dps > 0)) return { value: "—" };
  const kind: "DPS" | "DMG" = input.perHit ? "DMG" : "DPS";
  const value = formatBadgeNumber(input.dps);
  const unit = input.perHit ? (vi ? "/đòn" : "/hit") : undefined;
  const delta = input.before !== undefined && input.before > 0 && Math.abs(input.dps - input.before) / input.before >= 0.0005
    ? (input.dps - input.before) / input.before
    : undefined;
  const deltaText = delta !== undefined
    ? `${delta > 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(Math.abs(delta) < 0.1 ? 1 : 0)}%`
    : undefined;
  const exact = `${value} ${input.perHit ? (vi ? "sát thương/đòn" : "DMG/hit") : "DPS"}`;
  return { kind, value, unit, deltaText, deltaBetter: delta !== undefined ? delta > 0 : undefined, exact };
}

interface SupportConflict {
  family: string;
  gems: number[];
  kept: number;
}

export interface BuildSkillDetailProps {
  id: string;
  skill: BuildSkillChoice;
  index: number;
  isMain: boolean;
  dps: number | undefined;
  badge: SkillDamageBadge;
  damageLines: CardDamageLine[];
  activeStats: Record<string, unknown> | null;
  compareQueue?: CalcQueue<Record<string, unknown>>;
  /** Calculation body with main_socket_group pointing to this skill (for non-main breakdown). */
  skillCalcBody?: Record<string, unknown> | null;
  locale: string;
  skillMeta: SkillGemMeta;
  resolveSupportGem: (support: BuildSupportSkillChoice) => SkillGemMeta;
  supports: BuildSupportSkillChoice[];
  triggered: BuildSupportSkillChoice[];
  freeSockets: number;
  familyConflicts: SupportConflict[];
  supersededSupports: Set<string>;
  weaponHint: string | null;
  grantedTag: ReactNode;
  gemOptionFor: (groupIndex: number, supportId?: string) => PobGemOptions | undefined;
  gemLevelControls: (gem: { gemLevel?: number; gemQuality?: number }, onPatch: (patch: { gemLevel?: number; gemQuality?: number }) => void) => ReactNode;
  activeGemStrip: { skillId: string; supportId: string | "main" } | null;
  renderGemStrip: (skillId: string, supportId: string | "main") => ReactNode;
  onClose: () => void;
  onSelectMain: (groupNumber: number) => void;
  onOpenSkillGemPicker: (skillId: string) => void;
  onToggleGemStrip: (skillId: string, supportId: string | "main") => void;
  onUpdateSkill: (skillId: string, patch: Partial<BuildSkillChoice>) => void;
  onRemoveSkill: (skillId: string) => void;
  onAddSupport: (skillId: string) => void;
  onUpdateSupport: (skillId: string, supportId: string, patch: Partial<BuildSupportSkillChoice>) => void;
  onRemoveSupport: (skillId: string, supportId: string) => void;
  onHoverMainGem: (skill: BuildSkillChoice, event: MouseEvent) => void;
  onMoveTooltip: (event: MouseEvent) => void;
  onLeaveTooltip: () => void;
}

const fmtRange = (min: number, max: number) => `${Math.round(min).toLocaleString("en-US")} – ${Math.round(max).toLocaleString("en-US")}`;
const fmtExactDps = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function BuildSkillDetail(props: BuildSkillDetailProps) {
  const {
    id,
    skill,
    index,
    isMain,
    dps,
    badge,
    damageLines,
    activeStats,
    compareQueue,
    skillCalcBody,
    locale,
    skillMeta,
    resolveSupportGem,
    supports,
    triggered,
    freeSockets,
    familyConflicts,
    supersededSupports,
    weaponHint,
    grantedTag,
    gemOptionFor,
    gemLevelControls,
    activeGemStrip,
    renderGemStrip,
    onClose,
    onSelectMain,
    onOpenSkillGemPicker,
    onToggleGemStrip,
    onUpdateSkill,
    onRemoveSkill,
    onAddSupport,
    onUpdateSupport,
    onRemoveSupport,
    onHoverMainGem,
    onMoveTooltip,
    onLeaveTooltip
  } = props;

  const vi = locale === "vi";
  useQueueVersion(compareQueue);
  const perSkillRequest = useMemo(
    () => (!isMain && skill.skillId && !skill.disabled && skillCalcBody ? skillCalcBody : null),
    [isMain, skill.skillId, skill.disabled, skillCalcBody]
  );
  const perSkillKey = useMemo(() => (perSkillRequest ? calcKey(perSkillRequest) : ""), [perSkillRequest]);
  useEffect(() => {
    if (compareQueue && perSkillRequest) compareQueue.request(perSkillRequest, 8);
  }, [compareQueue, perSkillRequest]);
  const perSkillEntry = compareQueue && perSkillKey ? compareQueue.get(perSkillKey) : undefined;
  const loadingPerSkill = Boolean(perSkillRequest && (!perSkillEntry || (perSkillEntry.status !== "done" && perSkillEntry.status !== "error")));
  const details: Record<string, unknown> | null = isMain
    ? activeStats
    : (perSkillEntry?.status === "done" ? (perSkillEntry.result ?? null) : null);

  const mainOption = gemOptionFor(index);
  const statSets = mainOption?.statSets && mainOption.statSets.length > 1 ? mainOption.statSets : null;
  const skillParts = !statSets && mainOption?.parts && mainOption.parts.length > 1 ? mainOption.parts : null;
  const activeStatSet = mainOption && statSets ? pickedStatSet(skill.pobAttrs, mainOption.grantedEffect) : 1;
  const activeSkillPart = mainOption && skillParts ? (Number(skill.pobAttrs?.skillPart) || mainOption.part || 1) : 1;
  const monsterLibrary = skill.skillId ? monsterLibraryOf(skill) : null;
  const pickMonster = (monsterId: string, gem: MonsterGemPatch) =>
    onUpdateSkill(skill.id, { ...gem, pobAttrs: withGemOption(skill.pobAttrs, { kind: "minion", value: monsterId }) });

  const minionStats = details && details.Minion && typeof details.Minion === "object"
    ? details.Minion as Record<string, unknown>
    : null;
  const damageTypes = details ? ([
    ["nj-dps-phys", vi ? "Sát thương vật lý" : "Physical damage", vi ? "Vật lý" : "Physical", Number(details.PhysicalMin) || 0, Number(details.PhysicalMax) || 0],
    ["nj-dps-fire", vi ? "Sát thương lửa" : "Fire damage", vi ? "Lửa" : "Fire", Number(details.FireMin) || 0, Number(details.FireMax) || 0],
    ["nj-dps-cold", vi ? "Sát thương băng" : "Cold damage", vi ? "Băng" : "Cold", Number(details.ColdMin) || 0, Number(details.ColdMax) || 0],
    ["nj-dps-lightning", vi ? "Sát thương sét" : "Lightning damage", vi ? "Sét" : "Lightning", Number(details.LightningMin) || 0, Number(details.LightningMax) || 0],
    ["nj-dps-chaos", vi ? "Sát thương hỗn mang" : "Chaos damage", vi ? "Hỗn mang" : "Chaos", Number(details.ChaosMin) || 0, Number(details.ChaosMax) || 0]
  ] as Array<[string, string, string, number, number]>)
    .map(([barCls, rowLabel, shortLabel, min, max]) => ({ barCls, rowLabel, shortLabel, min, max, avg: (min + max) / 2 }))
    .filter((part) => part.avg > 0) : [];
  const damageTotal = damageTypes.reduce((sum, part) => sum + part.avg, 0);

  const primaryStats: Array<{ label: string; value: string }> = [];
  const damageSectionRows: Array<{ label: string; value: string }> = [];
  const usageSectionRows: Array<{ label: string; value: string }> = [];

  if (details) {
    const combinedDps = Number(details.CombinedDPS) || 0;
    const totalDps = Number(details.TotalDPS) || 0;
    const avgDamage = Number(details.AverageDamage) || 0;
    const speed = Number(details.Speed) || 0;
    const critChance = Number(details.CritChance) || 0;
    const critMult = Number(details.CritMultiplier) || 0;
    const hitChance = details.HitChance !== undefined ? Number(details.HitChance) : undefined;
    const igniteDps = Number(details.IgniteDPS) || 0;
    const poisonDps = Number(details.PoisonDPS) || 0;
    const bleedDps = Number(details.BleedDPS) || 0;
    const totalDotDps = Number(details.TotalDotDPS) || 0;
    const projectiles = Number(details.ProjectileCount) || 0;
    const aoeRadius = Number(details.AreaOfEffectRadiusMetres) || 0;
    const aoeMod = Number(details.AreaOfEffectMod) || 0;
    const manaCost = Number(details.ManaCost) || 0;
    const manaPerSec = Number(details.ManaPerSecondCost) || 0;
    const lifeCost = Number(details.LifeCost) || 0;
    const cooldown = Number(details.Cooldown) || 0;
    const duration = Number(details.Duration) || 0;
    const durationMod = Number(details.DurationMod) || 0;
    const hasHitOrDps = combinedDps >= 0.5 || totalDps >= 0.5 || avgDamage >= 0.5 || damageTypes.length > 0;

    if (combinedDps >= 0.5) primaryStats.push({ label: vi ? "Sát thương mỗi giây" : "Damage per second", value: fmtExactDps(combinedDps) });
    if (avgDamage >= 0.5) primaryStats.push({ label: vi ? "Sát thương trung bình mỗi lần dùng" : "Average damage per use", value: fmtExactDps(avgDamage) });
    if (damageTypes.length > 1) {
      const totalMin = damageTypes.reduce((sum, p) => sum + p.min, 0);
      const totalMax = damageTypes.reduce((sum, p) => sum + p.max, 0);
      primaryStats.push({ label: vi ? "Tổng sát thương mỗi đòn" : "Total damage", value: fmtRange(totalMin, totalMax) });
    }
    for (const part of damageTypes) {
      primaryStats.push({ label: part.rowLabel, value: fmtRange(part.min, part.max) });
    }
    if (hasHitOrDps && speed > 0) {
      primaryStats.push({ label: vi ? "Thời gian mỗi lần dùng" : "Attack / Cast time", value: formatStat(1 / speed, "seconds") });
      primaryStats.push({ label: vi ? "Số lần dùng mỗi giây" : "Uses per second", value: formatStat(speed, "speed") });
    }
    if (igniteDps > 0) primaryStats.push({ label: vi ? "DPS đốt (Ignite)" : "Estimated Ignite DPS", value: fmtExactDps(igniteDps) });
    if (poisonDps > 0) primaryStats.push({ label: vi ? "DPS độc (Poison)" : "Estimated Poison DPS", value: fmtExactDps(poisonDps) });
    if (bleedDps > 0) primaryStats.push({ label: vi ? "DPS chảy máu (Bleed)" : "Estimated Bleed DPS", value: fmtExactDps(bleedDps) });
    if (totalDotDps > 0 && !igniteDps && !poisonDps && !bleedDps) {
      primaryStats.push({ label: vi ? "DPS theo thời gian" : "Damage over time DPS", value: fmtExactDps(totalDotDps) });
    }

    if (combinedDps < 0.5 && minionStats) {
      const mDps = Number(minionStats.CombinedDPS) || 0;
      const mAvg = Number(minionStats.AverageDamage) || 0;
      const mSpeed = Number(minionStats.Speed) || 0;
      const mLife = Number(minionStats.Life) || 0;
      if (mDps > 0) primaryStats.push({ label: vi ? "DPS của minion" : "Minion DPS", value: fmtExactDps(mDps) });
      if (mAvg > 0) primaryStats.push({ label: vi ? "Mỗi đòn minion" : "Minion average hit", value: fmtExactDps(mAvg) });
      if (mSpeed > 0) primaryStats.push({ label: vi ? "Tốc độ minion" : "Minion speed", value: formatStat(mSpeed, "speed") });
      if (mLife > 0) primaryStats.push({ label: vi ? "Máu minion" : "Minion life", value: formatStat(mLife, "int") });
    }

    if (hasHitOrDps) {
      if (totalDps >= 0.5 && Math.abs(totalDps - combinedDps) > 1) {
        damageSectionRows.push({ label: vi ? "DPS đòn đánh trực tiếp" : "Hit DPS", value: fmtExactDps(totalDps) });
      }
      if (critChance > 0) damageSectionRows.push({ label: vi ? "Tỉ lệ chí mạng" : "Critical hit chance", value: formatStat(critChance, "pct1") });
      if (critMult > 0) damageSectionRows.push({ label: vi ? "Hệ số chí mạng" : "Critical multiplier", value: formatStat(critMult, "mult") });
      if (hitChance !== undefined && Number.isFinite(hitChance)) {
        damageSectionRows.push({ label: vi ? "Tỉ lệ đánh trúng" : "Estimated chance to hit", value: formatStat(hitChance, "pct") });
      }
    }

    if (manaCost > 0) usageSectionRows.push({ label: vi ? "Mana mỗi lần dùng" : "Mana cost", value: formatStat(manaCost, "int") });
    if (manaPerSec > 0 && Math.abs(manaPerSec - manaCost) > 0.5) {
      usageSectionRows.push({ label: vi ? "Mana mỗi giây" : "Mana per second", value: formatStat(manaPerSec, "rate") });
    }
    if (lifeCost > 0) usageSectionRows.push({ label: vi ? "Máu mỗi lần dùng" : "Life cost", value: formatStat(lifeCost, "int") });
    if (cooldown > 0) usageSectionRows.push({ label: vi ? "Thời gian hồi chiêu" : "Cooldown", value: formatStat(cooldown, "seconds") });
    if (duration > 0) usageSectionRows.push({ label: vi ? "Thời lượng" : "Duration", value: formatStat(duration, "seconds") });
    if (projectiles > 0) usageSectionRows.push({ label: vi ? "Số đạn" : "Projectiles", value: formatStat(projectiles, "int") });
    if (aoeRadius > 0) usageSectionRows.push({ label: vi ? "Bán kính vùng ảnh hưởng" : "Area radius", value: formatStat(aoeRadius, "metres") });
    else if (aoeMod > 0 && Math.abs(aoeMod - 1) > 0.005) {
      usageSectionRows.push({ label: vi ? "Vùng ảnh hưởng" : "Area of effect", value: formatStat(aoeMod, "modpct") });
    }
    if (duration <= 0 && durationMod > 0 && Math.abs(durationMod - 1) > 0.005 && !hasHitOrDps) {
      usageSectionRows.push({ label: vi ? "Hệ số thời lượng" : "Skill effect duration", value: formatStat(durationMod, "modpct") });
    }
  }

  const showZeroChoiceHint = !skill.disabled && Boolean(skill.skillId) && dps === 0 && Boolean(mainOption?.statSets || mainOption?.parts);
  const showGemOptions = hasGemChoices(mainOption) || !(skill.itemSlot || skill.itemSource || mainOption?.grantedSkill);
  const optionBadges = skill.skillId ? gemOptionBadges(mainOption, skill.pobAttrs, locale) : [];

  return (
    <section
      id={id}
      className="sk-detail poe-no-tooltip"
      aria-label={vi ? `Chi tiết kỹ năng ${skillMeta.label}` : `${skillMeta.label} details`}
    >
      {/* Title strip: 90% P width, 5.6% P height (800 x 50 at P=890), centred title, close X at right */}
      <header className="sk-detail-titlebar">
        <div className="sk-detail-strip-inner">
          <h3 className={`sk-detail-title ${skill.skillId ? "" : "is-empty"}`}>{skillMeta.label}</h3>
        </div>
        <button
          type="button"
          className="sk-detail-close"
          onClick={onClose}
          aria-label={vi ? "Đóng chi tiết kỹ năng" : "Close skill details"}
          title={vi ? "Đóng (Esc)" : "Close (Esc)"}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      {/* Icon band: gem medallion 17.4% P (155x155 @ P=890) with ~11% P circular icon inside */}
      <div className="sk-detail-band">
        <button
          type="button"
          className="sk-detail-medallion"
          onClick={() => onOpenSkillGemPicker(skill.id)}
          onMouseEnter={(event) => skill.skillId && onHoverMainGem(skill, event)}
          onMouseMove={onMoveTooltip}
          onMouseLeave={onLeaveTooltip}
          aria-label={vi ? `Đổi kỹ năng ${skillMeta.label}` : `Swap ${skillMeta.label}`}
          title={vi ? "Bấm để đổi kỹ năng" : "Click to swap skill"}
        >
          <span className="sk-detail-orb-icon">
            {skillMeta.icon ? <img key={skillMeta.icon} src={skillMeta.icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">add</span>}
          </span>
        </button>
        <div className="sk-detail-chips">
          {skill.skillId ? <span className="sk-badge">{vi ? `Cấp ${skill.gemLevel ?? 20}` : `Lv ${skill.gemLevel ?? 20}`}</span> : null}
          {skill.gemQuality ? <span className="sk-badge">Q {skill.gemQuality}%</span> : null}
          {grantedTag}
          {optionBadges.map((tag) => <span className="sk-badge sk-badge--option" key={tag}>{tag}</span>)}
        </div>
        {triggered.length ? (
          <p className="sk-detail-triggered">
            → {triggered.map((sup) => resolveSupportGem(sup).label).join(", ")}
          </p>
        ) : null}
      </div>

      {/* Content frame: inset 3.5% P from both sides, 1px bronze border, internal scroll */}
      <div className="sk-detail-frame">
        {statSets && mainOption ? (
          <div className="sk-tabs" role="tablist" aria-label={vi ? "Chế độ chỉ số" : "Stat sets"}>
            {statSets.map((name, idx) => {
              const setIndex = idx + 1;
              const selected = activeStatSet === setIndex;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`sk-tab ${selected ? "is-active" : ""}`}
                  key={`${mainOption.grantedEffect}:${setIndex}`}
                  onClick={() => onUpdateSkill(skill.id, {
                    pobAttrs: withGemOption(skill.pobAttrs, { kind: "statSet", grantedEffect: mainOption.grantedEffect, value: setIndex })
                  })}
                >
                  {optionLabel(name, locale) || `${setIndex}`}
                </button>
              );
            })}
          </div>
        ) : skillParts ? (
          <div className="sk-tabs" role="tablist" aria-label={vi ? "Phần kỹ năng" : "Skill parts"}>
            {skillParts.map((name, idx) => {
              const partIndex = idx + 1;
              const selected = activeSkillPart === partIndex;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`sk-tab ${selected ? "is-active" : ""}`}
                  key={`part:${partIndex}`}
                  onClick={() => onUpdateSkill(skill.id, {
                    pobAttrs: withGemOption(skill.pobAttrs, { kind: "part", value: partIndex })
                  })}
                >
                  {optionLabel(name, locale) || `${partIndex}`}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="sk-frame-inner">
          {skillMeta.description ? (
            <p className="sk-detail-desc">{skillMeta.description}</p>
          ) : null}

          {!skill.disabled && skill.skillId && !(dps !== undefined && dps > 0) && weaponHint ? (
            <p className="sk-hint sk-hint--weapon sk-frame-pad">{weaponHint}</p>
          ) : showZeroChoiceHint ? (
            <p className="sk-hint sk-frame-pad">
              {vi
                ? "0 sát thương ở lựa chọn hiện tại — kỹ năng này có nhiều chế độ/phần, thử chuyển tab phía trên hoặc đổi trong «Tuỳ chọn»."
                : "No damage with the current choice — this skill has other stat sets/parts, try another tab above or under Options."}
            </p>
          ) : null}

          {!skill.disabled ? familyConflicts.map((conflict) => {
            const names = conflict.gems.map((gemIdx) => resolveSupportGem(supports[gemIdx]).label);
            const kept = resolveSupportGem(supports[conflict.kept]).label;
            return (
              <p className="sk-hint sk-hint--warn sk-frame-pad" role="alert" key={conflict.gems.join("-")}>
                {vi
                  ? `${names.join(" và ")} cùng một họ gem hỗ trợ: trong game mỗi kỹ năng chỉ dùng được một gem của họ này. PoB chỉ tính ${kept}; hãy gỡ gem còn lại.`
                  : `${names.join(" and ")} are the same support family: only one of them works on a skill. PoB counts ${kept} only; remove the other.`}
              </p>
            );
          }) : null}

          {(skillMeta.description || weaponHint || showZeroChoiceHint || familyConflicts.length > 0) ? (
            <hr className="sk-frame-divider" />
          ) : null}

          {/* Primary two-column periwinkle (#8888ff) stat list */}
          {details ? (
            primaryStats.length ? (
              <dl className="sk-stat-list sk-stat-list--primary">
                {primaryStats.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : !usageSectionRows.length ? (
              <p className="sk-note sk-frame-pad">{vi ? "Kỹ năng hỗ trợ / duy trì này không có chỉ số sát thương trực tiếp (hiệu ứng đã cộng vào chỉ số nhân vật)." : "This buff/utility skill has no direct damage stats (its effects are applied to character stats)."}</p>
            ) : null
          ) : loadingPerSkill ? (
            <>
              {badge.kind ? (
                <dl className="sk-stat-list sk-stat-list--primary">
                  <div className="sk-stat-row">
                    <dt>{badge.kind === "DMG" ? (vi ? "Sát thương mỗi đòn" : "Damage per hit") : (vi ? "Sát thương mỗi giây" : "Damage per second")}</dt>
                    <dd title={badge.exact}>
                      {badge.value}{badge.unit ? ` ${badge.unit}` : ""}
                      {badge.deltaText ? <em className={badge.deltaBetter ? "is-better" : "is-worse"}> ({badge.deltaText})</em> : null}
                    </dd>
                  </div>
                </dl>
              ) : null}
              <p className="sk-note sk-frame-pad">
                <span className="pi-spinner" aria-hidden="true" />{" "}
                {vi ? "Đang tính chi tiết kỹ năng từ Path of Building…" : "Calculating skill breakdown in Path of Building…"}
              </p>
            </>
          ) : skill.disabled ? (
            <p className="sk-note sk-frame-pad">
              {vi ? "Nhóm kỹ năng đang tắt — bật lại bên dưới để PoB tính chỉ số." : "This skill group is disabled — enable it below to calculate stats."}
            </p>
          ) : null}

          {/* Section: "Sát thương" (Damage) */}
          {(damageTotal > 0 || damageSectionRows.length > 0 || cardDamageNeedsNames(damageLines)) ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Sát thương" : "Damage"}</h4>
              {damageTotal > 0 ? (
                <div className="sk-damage sk-frame-pad">
                  <i className="sk-damage-bar">
                    {damageTypes.map((part) => (
                      <b className={part.barCls} style={{ width: `${(part.avg / damageTotal) * 100}%` }} key={part.barCls} />
                    ))}
                  </i>
                  <span>
                    {damageTypes.map((part) => (
                      <span className={part.barCls.replace("nj-dps-", "nj-c-")} key={part.barCls}>
                        {part.shortLabel} {Math.round((part.avg / damageTotal) * 100)}%
                      </span>
                    ))}
                  </span>
                </div>
              ) : null}
              {damageSectionRows.length ? (
                <dl className="sk-stat-list sk-stat-list--sub">
                  {damageSectionRows.map((row) => (
                    <div className="sk-stat-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {cardDamageNeedsNames(damageLines) ? (
                <ul className="sk-lines poe-no-tooltip" aria-label={vi ? "Sát thương của từng kỹ năng trong nhóm" : "Damage of each skill in the group"}>
                  {damageLines.map((line, lineIndex) => (
                    <li key={`${line.name}:${lineIndex}`}>
                      <span>{line.name}{line.minion ? <small> · minion</small> : null}</span>
                      <b>{formatBadgeNumber(line.value)}</b>
                      <small>{line.perHit ? (vi ? "/đòn" : "per hit") : "DPS"}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* Section: "Sử dụng" (Usage) */}
          {usageSectionRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Sử dụng" : "Usage"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {usageSectionRows.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Section: "Tuỳ chọn" (Options) */}
          {skill.skillId ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Tuỳ chọn" : "Options"}</h4>
              <div className="sk-options-rows">
                <div className="sk-opt-row">
                  <span className="sk-opt-label">{vi ? "Cấp & Chất lượng gem" : "Gem level & quality"}</span>
                  <div className="sk-opt-ctrl">{gemLevelControls(skill, (patch) => onUpdateSkill(skill.id, patch))}</div>
                </div>
                {(() => {
                  const bounds = supportSocketStepperBounds(skill);
                  return (
                    <div className="sk-opt-row sk-sockets-stepper-row">
                      <span className="sk-opt-label">{vi ? "Số ô support" : "Support sockets"}</span>
                      <div className="sk-socket-stepper" role="group" aria-label={vi ? "Số ô support" : "Support sockets"}>
                        <button
                          type="button"
                          className="sk-step-btn"
                          disabled={!bounds.canDecrease}
                          onClick={() => onUpdateSkill(skill.id, { supportSockets: bounds.current - 1 })}
                          aria-label={vi ? "Giảm số ô support" : "Decrease support sockets"}
                        >
                          −
                        </button>
                        <span className="sk-step-val" aria-live="polite">{bounds.current}</span>
                        <button
                          type="button"
                          className="sk-step-btn"
                          disabled={!bounds.canIncrease}
                          onClick={() => onUpdateSkill(skill.id, { supportSockets: bounds.current + 1 })}
                          aria-label={vi ? "Tăng số ô support" : "Increase support sockets"}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {monsterLibrary ? (
                  <div className="sk-opt-block">
                    <MonsterPicker library={monsterLibrary} value={skill.pobAttrs?.skillMinion} onPick={pickMonster} locale={locale} />
                  </div>
                ) : null}
                {showGemOptions ? (
                  <div className="sk-opt-block">
                    <GemOptionControls
                      option={mainOption}
                      attrs={skill.pobAttrs}
                      locale={locale}
                      corrupt={!(skill.itemSlot || skill.itemSource)}
                      hideMinions={Boolean(monsterLibrary)}
                      hideStatSets={Boolean(statSets)}
                      hideParts={Boolean(skillParts)}
                      onChange={(change: GemOptionChange) => onUpdateSkill(skill.id, { pobAttrs: withGemOption(skill.pobAttrs, change) })}
                    />
                  </div>
                ) : null}
                {triggered.map((sup) => (
                  sup.skillId ? (
                    <div className="sk-opt-block" key={sup.id}>
                      <GemOptionControls
                        option={gemOptionFor(index, sup.id)}
                        attrs={sup.pobAttrs}
                        locale={locale}
                        corrupt={Boolean(sup.active)}
                        onChange={(change: GemOptionChange) => onUpdateSupport(skill.id, sup.id, { pobAttrs: withGemOption(sup.pobAttrs, change) })}
                      />
                    </div>
                  ) : null
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bottom toggles: one row per toggle separated by 1px lines, label left, control right */}
      <footer className="sk-detail-foot">
        {skill.skillId ? (
          <div className="sk-foot-row">
            <span className="sk-foot-label">{vi ? "Bật nhóm kỹ năng" : "Enable skill group"}</span>
            <button
              type="button"
              className={`sk-toggle ${skill.disabled ? "" : "is-on"}`}
              onClick={() => onUpdateSkill(skill.id, { disabled: !skill.disabled })}
              aria-pressed={!skill.disabled}
              aria-label={vi ? (skill.disabled ? "Bật nhóm kỹ năng" : "Tắt nhóm kỹ năng") : "Enable / disable group"}
            >
              <span className="material-symbols-rounded" aria-hidden="true">{skill.disabled ? "toggle_off" : "toggle_on"}</span>
              <span>{skill.disabled ? (vi ? "Đang tắt" : "Off") : (vi ? "Đang bật" : "On")}</span>
            </button>
          </div>
        ) : null}
        {skill.skillId ? (
          <div className="sk-foot-row">
            <span className="sk-foot-label">{vi ? "Kỹ năng chính" : "Main skill"}</span>
            <button
              type="button"
              className={`sk-toggle ${isMain ? "is-on" : ""}`}
              onClick={() => onSelectMain(index + 1)}
              aria-pressed={isMain}
              aria-label={vi ? (isMain ? "Đang là kỹ năng chính" : "Đặt làm kỹ năng chính") : "Set as main skill"}
            >
              <span className="material-symbols-rounded" aria-hidden="true">{isMain ? "star" : "star_outline"}</span>
              <span>{isMain ? (vi ? "Đang chọn" : "Selected") : (vi ? "Chọn" : "Select")}</span>
            </button>
          </div>
        ) : null}
        <div className="sk-foot-row sk-foot-row--danger">
          <span className="sk-foot-label">{vi ? "Xóa nhóm kỹ năng" : "Remove skill group"}</span>
          <button
            type="button"
            className="sk-delete-btn"
            onClick={() => {
              onClose();
              onRemoveSkill(skill.id);
            }}
            aria-label={vi ? `Xóa nhóm ${skillMeta.label}` : `Remove ${skillMeta.label}`}
          >
            <span className="material-symbols-rounded" aria-hidden="true">delete</span>
            <span>{vi ? "Xóa nhóm" : "Remove"}</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
