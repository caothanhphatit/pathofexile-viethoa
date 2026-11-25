// Skill detail panel opened beside the compact skill list on desktop or inline under
// a skill block on narrow screens, using PoE2's base-art ratios (P = 890 reference).
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { type BuildSkillChoice, type BuildSupportSkillChoice } from "../lib/buildPlanner";
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
  /** Builds a calculation request for any skill group (and optional sub-skill index for CoC/Meta). */
  calculationBodyForSkill?: (groupNumber: number, mainActiveSkill?: number) => Record<string, unknown> | null;
  locale: string;
  skillMeta: SkillGemMeta;
  resolveSupportGem: (support: BuildSupportSkillChoice) => SkillGemMeta;
  supports: BuildSupportSkillChoice[];
  triggered: BuildSupportSkillChoice[];
  freeSockets: number;
  familyConflicts: SupportConflict[];
  supersededSupports: Set<string>;
  weaponHint: string | null;
  usabilityIssues?: Array<{ kind: "weapon" | "level" | "attribute" | "spirit"; shortLabel: string; message: string }>;
  grantedTag: ReactNode;
  gemOptionFor: (groupIndex: number, supportId?: string) => PobGemOptions | undefined;
  gemLevelControls: (gem: { gemLevel?: number; gemQuality?: number }, onPatch: (patch: { gemLevel?: number; gemQuality?: number }) => void) => ReactNode;
  activeGemStrip: { skillId: string; supportId: string | "main" } | null;
  renderGemStrip: (skillId: string, supportId: string | "main") => ReactNode;
  onClose: () => void;
  onSelectMain: (groupNumber: number) => void;
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
    calculationBodyForSkill,
    locale,
    skillMeta,
    resolveSupportGem,
    supports,
    triggered,
    freeSockets,
    familyConflicts,
    supersededSupports,
    weaponHint,
    usabilityIssues = [],
    grantedTag,
    gemOptionFor,
    gemLevelControls,
    activeGemStrip,
    renderGemStrip,
    onClose,
    onSelectMain,
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
  const [selectedSubId, setSelectedSubId] = useState<string>("main");
  const firstTriggeredId = triggered[0]?.id ?? "";
  // When opening a CoC / Meta group with socketed spells, focus the first socketed spell
  // right away (matching PoE2's in-game Cast on Critical detail screen).
  useEffect(() => {
    setSelectedSubId(firstTriggeredId || "main");
  }, [skill.id, firstTriggeredId]);

  const selectedTriggeredIndex = selectedSubId === "main"
    ? -1
    : triggered.findIndex((sup) => sup.id === selectedSubId);
  const selectedTriggered = selectedTriggeredIndex >= 0 ? triggered[selectedTriggeredIndex] : null;
  const selectedTriggeredMeta = selectedTriggered ? resolveSupportGem(selectedTriggered) : null;
  const selectedTriggeredOption = selectedTriggered ? gemOptionFor(index, selectedTriggered.id) : undefined;
  const selectedMainActiveSkill = selectedTriggered
    ? (selectedTriggeredOption?.skill ?? (selectedTriggeredIndex + 2))
    : 1;
  const defaultMainActiveSkill = skill.mainActiveSkill ?? 1;
  const canUseActiveStatsDirectly = isMain && selectedMainActiveSkill === defaultMainActiveSkill;

  const perSkillRequest = useMemo(() => {
    if (canUseActiveStatsDirectly || !skill.skillId || skill.disabled || !calculationBodyForSkill) return null;
    return calculationBodyForSkill(index + 1, selectedMainActiveSkill);
  }, [canUseActiveStatsDirectly, skill.skillId, skill.disabled, calculationBodyForSkill, index, selectedMainActiveSkill]);
  const perSkillKey = useMemo(() => (perSkillRequest ? calcKey(perSkillRequest) : ""), [perSkillRequest]);
  useEffect(() => {
    if (compareQueue && perSkillRequest) compareQueue.request(perSkillRequest, 8);
  }, [compareQueue, perSkillRequest]);
  const perSkillEntry = compareQueue && perSkillKey ? compareQueue.get(perSkillKey) : undefined;
  const loadingPerSkill = Boolean(perSkillRequest && (!perSkillEntry || (perSkillEntry.status !== "done" && perSkillEntry.status !== "error")));
  const details: Record<string, unknown> | null = canUseActiveStatsDirectly
    ? activeStats
    : (perSkillEntry?.status === "done" ? (perSkillEntry.result ?? null) : null);

  const mainOption = gemOptionFor(index);
  const activeOption = selectedTriggered ? selectedTriggeredOption : mainOption;
  const activeAttrs = selectedTriggered ? selectedTriggered.pobAttrs : skill.pobAttrs;
  const statSets = activeOption?.statSets && activeOption.statSets.length > 1 ? activeOption.statSets : null;
  const skillParts = !statSets && activeOption?.parts && activeOption.parts.length > 1 ? activeOption.parts : null;
  const activeStatSet = activeOption && statSets ? pickedStatSet(activeAttrs, activeOption.grantedEffect) : 1;
  const activeSkillPart = activeOption && skillParts ? (Number(activeAttrs?.skillPart) || activeOption.part || 1) : 1;
  const activeMeta = selectedTriggeredMeta ?? skillMeta;
  const activeGemLevel = selectedTriggered ? (selectedTriggered.gemLevel ?? 20) : (skill.gemLevel ?? 20);
  const activeGemQuality = selectedTriggered ? (selectedTriggered.gemQuality ?? 0) : (skill.gemQuality ?? 0);
  const monsterLibrary = skill.skillId ? monsterLibraryOf(skill) : null;
  const pickMonster = (monsterId: string, gem: MonsterGemPatch) =>
    onUpdateSkill(skill.id, { ...gem, pobAttrs: withGemOption(skill.pobAttrs, { kind: "minion", value: monsterId }) });

  const subDamageLineFor = (label: string, isOwn: boolean) => {
    if (isOwn) return damageLines.find((line) => line.own);
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return damageLines.find((line) => !line.own && line.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key)
      ?? damageLines.find((line) => !line.own && line.name.toLowerCase().includes(key));
  };

  const minionStats = details && details.Minion && typeof details.Minion === "object"
    ? details.Minion as Record<string, unknown>
    : null;
  const damageTypes = details ? ([
    ["nj-dps-phys", vi ? "Sát thương vật lý" : "Physical damage", vi ? "Vật lý" : "Physical", Number(details.PhysicalMin) || 0, Number(details.PhysicalMax) || 0, Number(details.PhysicalStoredCombinedAvg) || 0],
    ["nj-dps-fire", vi ? "Sát thương lửa" : "Fire damage", vi ? "Lửa" : "Fire", Number(details.FireMin) || 0, Number(details.FireMax) || 0, Number(details.FireStoredCombinedAvg) || 0],
    ["nj-dps-cold", vi ? "Sát thương băng" : "Cold damage", vi ? "Băng" : "Cold", Number(details.ColdMin) || 0, Number(details.ColdMax) || 0, Number(details.ColdStoredCombinedAvg) || 0],
    ["nj-dps-lightning", vi ? "Sát thương sét" : "Lightning damage", vi ? "Sét" : "Lightning", Number(details.LightningMin) || 0, Number(details.LightningMax) || 0, Number(details.LightningStoredCombinedAvg) || 0],
    ["nj-dps-chaos", vi ? "Sát thương hỗn mang" : "Chaos damage", vi ? "Hỗn mang" : "Chaos", Number(details.ChaosMin) || 0, Number(details.ChaosMax) || 0, Number(details.ChaosStoredCombinedAvg) || 0]
  ] as Array<[string, string, string, number, number, number]>)
    .map(([barCls, rowLabel, shortLabel, min, max, fallbackAvg]) => {
      const hasRange = min > 0 || max > 0;
      const avg = hasRange ? (min + max) / 2 : fallbackAvg;
      return { barCls, rowLabel, shortLabel, min, max, hasRange, avg };
    })
    .filter((part) => part.avg > 0) : [];
  const damageTotal = damageTypes.reduce((sum, part) => sum + part.avg, 0);

  type StatRow = { label: string; value: string; cls?: string };
  const damageRows: StatRow[] = [];
  const usageRows: StatRow[] = [];
  const areaDurationRows: StatRow[] = [];
  const critRows: StatRow[] = [];
  const ailmentRows: StatRow[] = [];
  const onHitRows: StatRow[] = [];
  const onKillRows: StatRow[] = [];

  if (details) {
    const num = (key: string) => {
      const v = Number(details[key]);
      return Number.isFinite(v) ? v : 0;
    };
    const combinedDps = num("CombinedDPS");
    const totalDps = num("TotalDPS");
    const avgDamage = num("AverageDamage");
    const speed = num("Speed");
    const castTime = num("Time") || (speed > 0 ? 1 / speed : 0);
    const critChance = num("CritChance");
    const critMult = num("CritMultiplier");
    const hitChance = details.HitChance !== undefined ? Number(details.HitChance) : undefined;
    const igniteDps = num("IgniteDPS");
    const igniteChance = num("IgniteChance");
    const igniteDuration = num("IgniteDuration");
    const poisonDps = num("PoisonDPS");
    const poisonChance = num("PoisonChance");
    const poisonDuration = num("PoisonDuration");
    const poisonStacksMax = num("PoisonStacksMax");
    const bleedDps = num("BleedDPS");
    const bleedChance = num("BleedChance");
    const bleedDuration = num("BleedDuration");
    const totalDotDps = num("TotalDotDPS");
    const shockChance = num("ShockChance");
    const shockDuration = num("ShockDuration");
    const currentChill = num("CurrentChill");
    const freezeBuildup = num("FreezeBuildupAvg");
    const heavyStunBuildup = num("HeavyStunBuildupAvg");
    const projectiles = num("ProjectileCount");
    const projSpeedMod = num("ProjectileSpeedMod");
    const pierceCount = num("PierceCount");
    const sealMax = num("SealMax");
    const aoeRadius = num("AreaOfEffectRadiusMetres");
    const aoeMod = num("AreaOfEffectMod");
    const manaCost = num("ManaCost");
    const manaPerSec = num("ManaPerSecondCost");
    const lifeCost = num("LifeCost");
    const cooldown = num("Cooldown");
    const duration = num("Duration");
    const durationMod = num("DurationMod");
    const moveWhileUsing = num("MovementSpeedWhileUsingSkillPercent");
    const lifeLeechPerHit = num("LifeLeechPerHit");
    const lifeLeechRate = num("LifeLeechGainRate");
    const manaLeechPerHit = num("ManaLeechPerHit");
    const manaLeechRate = num("ManaLeechGainRate");
    const lifeOnHit = num("LifeOnHit");
    const manaOnHit = num("ManaOnHit");
    const armourBreak = num("ArmourBreakPerHit");
    const cullPct = num("CullPercent");
    const rarityMod = num("EffectiveLootRarityMod");
    const lifeOnKill = num("LifeOnKill");
    const manaOnKill = num("ManaOnKill");
    const esOnKill = num("EnergyShieldOnKill");
    const hasHitOrDps = combinedDps >= 0.5 || totalDps >= 0.5 || avgDamage >= 0.5 || damageTypes.length > 0;

    // 1. Damage
    if (combinedDps >= 0.5) damageRows.push({ label: vi ? "Sát thương mỗi giây" : "Damage per second", value: fmtExactDps(combinedDps) });
    if (totalDps >= 0.5 && Math.abs(totalDps - combinedDps) > 1) {
      damageRows.push({ label: vi ? "DPS đòn đánh trực tiếp" : "Hit DPS", value: fmtExactDps(totalDps) });
    }
    if (avgDamage >= 0.5) damageRows.push({ label: vi ? "Sát thương trung bình mỗi đòn" : "Average damage per hit", value: fmtExactDps(avgDamage) });
    const rangedParts = damageTypes.filter((p) => p.hasRange);
    if (rangedParts.length > 1) {
      const totalMin = rangedParts.reduce((sum, p) => sum + p.min, 0);
      const totalMax = rangedParts.reduce((sum, p) => sum + p.max, 0);
      damageRows.push({ label: vi ? "Tổng sát thương mỗi đòn" : "Total damage", value: fmtRange(totalMin, totalMax) });
    }
    for (const part of damageTypes) {
      damageRows.push({
        label: part.rowLabel,
        value: part.hasRange ? fmtRange(part.min, part.max) : fmtExactDps(part.avg),
        cls: part.barCls.replace("nj-dps-", "nj-c-")
      });
    }
    if (combinedDps < 0.5 && minionStats) {
      const mDps = Number(minionStats.CombinedDPS) || 0;
      const mAvg = Number(minionStats.AverageDamage) || 0;
      const mSpeed = Number(minionStats.Speed) || 0;
      const mLife = Number(minionStats.Life) || 0;
      if (mDps > 0) damageRows.push({ label: vi ? "DPS của minion" : "Minion DPS", value: fmtExactDps(mDps) });
      if (mAvg > 0) damageRows.push({ label: vi ? "Mỗi đòn minion" : "Minion average hit", value: fmtExactDps(mAvg) });
      if (mSpeed > 0) usageRows.push({ label: vi ? "Tốc độ minion" : "Minion speed", value: formatStat(mSpeed, "speed") });
      if (mLife > 0) usageRows.push({ label: vi ? "Máu minion" : "Minion life", value: formatStat(mLife, "int") });
    }

    // 2. Usage
    if (hasHitOrDps && castTime > 0) {
      usageRows.push({ label: vi ? "Thời gian mỗi lần dùng" : "Attack / Cast time", value: formatStat(castTime, "seconds") });
    }
    if (hasHitOrDps && speed > 0) {
      usageRows.push({ label: vi ? "Số lần dùng mỗi giây" : "Uses per second", value: formatStat(speed, "speed") });
    }
    if (manaCost > 0) usageRows.push({ label: vi ? "Mana mỗi lần dùng" : "Mana cost", value: formatStat(manaCost, "int") });
    if (manaPerSec > 0 && Math.abs(manaPerSec - manaCost) > 0.5) {
      usageRows.push({ label: vi ? "Mana mỗi giây" : "Mana per second", value: formatStat(manaPerSec, "rate") });
    }
    if (lifeCost > 0) usageRows.push({ label: vi ? "Máu mỗi lần dùng" : "Life cost", value: formatStat(lifeCost, "int") });
    if (cooldown > 0) usageRows.push({ label: vi ? "Thời gian hồi chiêu" : "Cooldown", value: formatStat(cooldown, "seconds") });
    if (projectiles > 0) usageRows.push({ label: vi ? "Số đạn" : "Projectiles", value: formatStat(projectiles, "int") });
    if (projSpeedMod > 0 && Math.abs(projSpeedMod - 1) > 0.005) {
      usageRows.push({ label: vi ? "Tốc độ đạn" : "Projectile speed", value: formatStat(projSpeedMod, "modpct") });
    }
    if (pierceCount > 0) usageRows.push({ label: vi ? "Số mục tiêu xuyên (Pierce)" : "Pierce targets", value: pierceCount >= 99 ? (vi ? "Vô hạn" : "All") : formatStat(pierceCount, "int") });
    if (sealMax > 0) usageRows.push({ label: vi ? "Số Seal tối đa" : "Max seals", value: formatStat(sealMax, "int") });
    if (hasHitOrDps && moveWhileUsing > 0 && moveWhileUsing < 100) {
      usageRows.push({ label: vi ? "Tốc chạy khi dùng kỹ năng" : "Movement speed while using", value: formatStat(moveWhileUsing, "pct") });
    }

    // 3. Area and Duration
    if (aoeRadius > 0) areaDurationRows.push({ label: vi ? "Bán kính vùng ảnh hưởng" : "Area radius", value: formatStat(aoeRadius, "metres") });
    if (aoeMod > 0 && Math.abs(aoeMod - 1) > 0.005) {
      areaDurationRows.push({ label: vi ? "Hệ số vùng ảnh hưởng" : "Area of effect modifier", value: formatStat(aoeMod, "modpct") });
    }
    if (duration > 0) areaDurationRows.push({ label: vi ? "Thời lượng kỹ năng" : "Skill duration", value: formatStat(duration, "seconds") });
    if (durationMod > 0 && Math.abs(durationMod - 1) > 0.005) {
      areaDurationRows.push({ label: vi ? "Hệ số thời lượng" : "Duration modifier", value: formatStat(durationMod, "modpct") });
    }

    // 4. Critical Hits
    if (hasHitOrDps) {
      if (critChance > 0) critRows.push({ label: vi ? "Tỉ lệ chí mạng" : "Critical hit chance", value: formatStat(critChance, "pct1") });
      if (critMult > 1) {
        critRows.push({
          label: vi ? "Sát thương chí mạng cộng thêm" : "Critical damage bonus",
          value: `+${Math.round((critMult - 1) * 100).toLocaleString("en-US")}%`
        });
      }
      if (hitChance !== undefined && Number.isFinite(hitChance)) {
        critRows.push({ label: vi ? "Tỉ lệ đánh trúng" : "Estimated chance to hit", value: formatStat(hitChance, "pct") });
      }
    }

    // 5. Ailments
    if (hasHitOrDps) {
      if (igniteDps >= 0.5) ailmentRows.push({ label: vi ? "DPS đốt ước tính (Ignite)" : "Estimated Ignite DPS", value: fmtExactDps(igniteDps) });
      if (igniteChance >= 0.1 && (igniteDps >= 0.5 || igniteChance >= 1)) {
        ailmentRows.push({ label: vi ? "Tỉ lệ đốt (Ignite)" : "Ignite chance", value: formatStat(igniteChance, "pct1") });
      }
      if (igniteDps >= 0.5 && igniteDuration > 0) {
        ailmentRows.push({ label: vi ? "Thời lượng đốt (Ignite)" : "Ignite duration", value: formatStat(igniteDuration, "seconds") });
      }
      if (bleedDps >= 0.5) ailmentRows.push({ label: vi ? "DPS chảy máu ước tính (Bleed)" : "Estimated Bleed DPS", value: fmtExactDps(bleedDps) });
      if (bleedChance >= 0.1 && (bleedDps >= 0.5 || bleedChance >= 1)) {
        ailmentRows.push({ label: vi ? "Tỉ lệ chảy máu (Bleed)" : "Bleed chance", value: formatStat(bleedChance, "pct1") });
      }
      if (bleedDps >= 0.5 && bleedDuration > 0) {
        ailmentRows.push({ label: vi ? "Thời lượng chảy máu" : "Bleed duration", value: formatStat(bleedDuration, "seconds") });
      }
      if (poisonDps >= 0.5) ailmentRows.push({ label: vi ? "DPS độc ước tính (Poison)" : "Estimated Poison DPS", value: fmtExactDps(poisonDps) });
      if (poisonChance >= 0.1 && (poisonDps >= 0.5 || poisonChance >= 1)) {
        ailmentRows.push({ label: vi ? "Tỉ lệ độc (Poison)" : "Poison chance", value: formatStat(poisonChance, "pct1") });
      }
      if (poisonDps >= 0.5 && poisonDuration > 0) {
        ailmentRows.push({ label: vi ? "Thời lượng độc" : "Poison duration", value: formatStat(poisonDuration, "seconds") });
      }
      if (poisonDps >= 0.5 && poisonStacksMax > 1) {
        ailmentRows.push({ label: vi ? "Số lớp độc tối đa" : "Max Poison stacks", value: formatStat(poisonStacksMax, "int") });
      }
      if (totalDotDps >= 0.5 && !igniteDps && !poisonDps && !bleedDps) {
        ailmentRows.push({ label: vi ? "DPS theo thời gian" : "Damage over time DPS", value: fmtExactDps(totalDotDps) });
      }
      if (shockChance >= 0.1) {
        ailmentRows.push({ label: vi ? "Tỉ lệ sốc (Shock)" : "Shock chance", value: formatStat(shockChance, "pct1") });
        if (shockDuration > 0) ailmentRows.push({ label: vi ? "Thời lượng sốc (Shock)" : "Shock duration", value: formatStat(shockDuration, "seconds") });
      }
      if (currentChill > 0 && damageTypes.some((d) => d.barCls === "nj-dps-cold")) {
        ailmentRows.push({ label: vi ? "Làm lạnh (Chill)" : "Chill magnitude", value: formatStat(currentChill, "pct") });
      }
      if (freezeBuildup >= 0.01) {
        ailmentRows.push({ label: vi ? "Tích tụ đóng băng (Freeze)" : "Freeze buildup / hit", value: `${Math.round(freezeBuildup * 100)}%` });
      }
    }

    // 6. On Hit Effects
    if (hasHitOrDps) {
      if (heavyStunBuildup >= 0.01) {
        onHitRows.push({ label: vi ? "Tích tụ choáng nặng / đòn" : "Heavy Stun buildup / hit", value: `${Math.round(heavyStunBuildup * 100)}%` });
      }
      if (armourBreak > 0) onHitRows.push({ label: vi ? "Phá giáp mỗi đòn" : "Armour break per hit", value: formatStat(armourBreak, "int") });
      if (lifeLeechPerHit >= 0.5) onHitRows.push({ label: vi ? "Hút máu mỗi đòn" : "Life leech per hit", value: formatStat(lifeLeechPerHit, "int") });
      else if (lifeLeechRate >= 0.5) onHitRows.push({ label: vi ? "Tốc độ hút máu" : "Life leech rate", value: formatStat(lifeLeechRate, "rate") });
      if (manaLeechPerHit >= 0.5) onHitRows.push({ label: vi ? "Hút mana mỗi đòn" : "Mana leech per hit", value: formatStat(manaLeechPerHit, "int") });
      else if (manaLeechRate >= 0.5) onHitRows.push({ label: vi ? "Tốc độ hút mana" : "Mana leech rate", value: formatStat(manaLeechRate, "rate") });
      if (lifeOnHit > 0) onHitRows.push({ label: vi ? "Hồi máu khi đánh trúng" : "Life gained on hit", value: formatStat(lifeOnHit, "int") });
      if (manaOnHit > 0) onHitRows.push({ label: vi ? "Hồi mana khi đánh trúng" : "Mana gained on hit", value: formatStat(manaOnHit, "int") });
      if (cullPct > 0) onHitRows.push({ label: vi ? "Kết liễu (Culling Strike)" : "Culling strike threshold", value: formatStat(cullPct, "pct") });
    }

    // 7. On Kill Effects
    if (hasHitOrDps) {
      if (rarityMod > 0 && Math.abs(rarityMod - 1) > 0.005) {
        onKillRows.push({
          label: vi ? "Tỉ lệ hiếm vật phẩm rơi ra (Rarity)" : "Slain monster item drop Rarity",
          value: formatStat(rarityMod, "modpct")
        });
      }
      if (lifeOnKill > 0) onKillRows.push({ label: vi ? "Hồi máu khi hạ gục" : "Life gained on kill", value: formatStat(lifeOnKill, "int") });
      if (manaOnKill > 0) onKillRows.push({ label: vi ? "Hồi mana khi hạ gục" : "Mana gained on kill", value: formatStat(manaOnKill, "int") });
      if (esOnKill > 0) onKillRows.push({ label: vi ? "Hồi ES khi hạ gục" : "Energy Shield on kill", value: formatStat(esOnKill, "int") });
    }
  }

  const hasAnyStatSection = damageRows.length > 0 || usageRows.length > 0 || areaDurationRows.length > 0 || critRows.length > 0 || ailmentRows.length > 0 || onHitRows.length > 0 || onKillRows.length > 0;

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

      {/* Icon band: single medallion normally, or multi-medallion selector for CoC / Meta skills */}
      <div className="sk-detail-band">
        {triggered.length > 0 ? (
          <div className="sk-detail-medallions" role="tablist" aria-label={vi ? "Kỹ năng trong nhóm" : "Skills in this group"}>
            {(() => {
              const mainSelected = !selectedTriggered;
              const mainLine = subDamageLineFor(skillMeta.label, true);
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainSelected}
                  className={`sk-detail-medallion sk-detail-medallion--sub ${mainSelected ? "is-selected" : ""}`}
                  onClick={() => setSelectedSubId("main")}
                  onMouseEnter={(event) => skill.skillId && onHoverMainGem(skill, event)}
                  onMouseMove={onMoveTooltip}
                  onMouseLeave={onLeaveTooltip}
                  title={vi ? `Xem chỉ số ${skillMeta.label}` : `View ${skillMeta.label} breakdown`}
                >
                  <span className="sk-detail-orb-icon">
                    {skillMeta.icon ? <img key={skillMeta.icon} src={skillMeta.icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">add</span>}
                  </span>
                  <span className="sk-detail-medallion-label">
                    <strong>{skillMeta.label}</strong>
                    {mainLine && mainLine.value > 0 ? (
                      <small>{formatBadgeNumber(mainLine.value)}{mainLine.perHit ? (vi ? "/đòn" : "/hit") : " DPS"}</small>
                    ) : null}
                  </span>
                </button>
              );
            })()}
            {triggered.map((sup) => {
              const meta = resolveSupportGem(sup);
              const selected = selectedTriggered?.id === sup.id;
              const line = subDamageLineFor(meta.label, false);
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`sk-detail-medallion sk-detail-medallion--sub ${selected ? "is-selected" : ""}`}
                  key={sup.id}
                  onClick={() => setSelectedSubId(sup.id)}
                  title={vi ? `Xem breakdown của ${meta.label}` : `View ${meta.label} breakdown`}
                >
                  <span className="sk-detail-orb-icon">
                    {meta.icon ? <img key={meta.icon} src={meta.icon} alt="" loading="lazy" /> : <span className="sk-support-initial" aria-hidden="true">{supportInitials(meta.label)}</span>}
                  </span>
                  <span className="sk-detail-medallion-label">
                    <strong>{meta.label}</strong>
                    {line && line.value > 0 ? (
                      <small>{formatBadgeNumber(line.value)}{line.perHit ? (vi ? "/đòn" : "/hit") : " DPS"}</small>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="sk-detail-medallion sk-detail-medallion--static"
            onMouseEnter={(event) => skill.skillId && onHoverMainGem(skill, event)}
            onMouseMove={onMoveTooltip}
            onMouseLeave={onLeaveTooltip}
            aria-label={skillMeta.label}
          >
            <span className="sk-detail-orb-icon">
              {skillMeta.icon ? <img key={skillMeta.icon} src={skillMeta.icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">auto_awesome</span>}
            </span>
          </div>
        )}
        <div className="sk-detail-chips">
          {selectedTriggered ? <span className="sk-badge sk-badge--option">{selectedTriggeredMeta?.label}</span> : null}
          {skill.skillId ? <span className="sk-badge">{vi ? `Cấp ${activeGemLevel}` : `Lv ${activeGemLevel}`}</span> : null}
          {activeGemQuality ? <span className="sk-badge">Q {activeGemQuality}%</span> : null}
          {!selectedTriggered ? grantedTag : null}
          {!selectedTriggered ? optionBadges.map((tag) => <span className="sk-badge sk-badge--option" key={tag}>{tag}</span>) : null}
        </div>
      </div>

      {/* Content frame: inset 3.5% P from both sides, 1px bronze border, internal scroll */}
      <div className="sk-detail-frame">
        {statSets && activeOption ? (
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
                  key={`${activeOption.grantedEffect}:${setIndex}`}
                  onClick={() => {
                    const nextAttrs = withGemOption(activeAttrs, { kind: "statSet", grantedEffect: activeOption.grantedEffect, value: setIndex });
                    if (selectedTriggered) onUpdateSupport(skill.id, selectedTriggered.id, { pobAttrs: nextAttrs });
                    else onUpdateSkill(skill.id, { pobAttrs: nextAttrs });
                  }}
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
                  onClick={() => {
                    const nextAttrs = withGemOption(activeAttrs, { kind: "part", value: partIndex });
                    if (selectedTriggered) onUpdateSupport(skill.id, selectedTriggered.id, { pobAttrs: nextAttrs });
                    else onUpdateSkill(skill.id, { pobAttrs: nextAttrs });
                  }}
                >
                  {optionLabel(name, locale) || `${partIndex}`}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="sk-frame-inner">
          {activeMeta.description ? (
            <p className="sk-detail-desc">{activeMeta.description}</p>
          ) : null}

          {!skill.disabled && skill.skillId && usabilityIssues.length > 0 ? (
            usabilityIssues.map((issue) => (
              <p className="sk-hint sk-hint--unusable sk-frame-pad" role="alert" key={`${issue.kind}:${issue.shortLabel}`}>
                <span className="material-symbols-rounded" aria-hidden="true">error</span>
                <span>{issue.message}</span>
              </p>
            ))
          ) : !skill.disabled && skill.skillId && !(dps !== undefined && dps > 0) && weaponHint ? (
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

          {(activeMeta.description || usabilityIssues.length > 0 || weaponHint || showZeroChoiceHint || familyConflicts.length > 0) ? (
            <hr className="sk-frame-divider" />
          ) : null}

          {/* PoE2 in-game breakdown sections: Damage, Usage, Area & Duration, Critical Hits, Ailments, On Hit, On Kill */}
          {!details && loadingPerSkill ? (
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
          ) : !details && skill.disabled ? (
            <p className="sk-note sk-frame-pad">
              {vi ? "Nhóm kỹ năng đang tắt — bật lại bên dưới để PoB tính chỉ số." : "This skill group is disabled — enable it below to calculate stats."}
            </p>
          ) : details && !hasAnyStatSection ? (
            <p className="sk-note sk-frame-pad">
              {vi ? "Kỹ năng hỗ trợ / duy trì này không có chỉ số sát thương trực tiếp (hiệu ứng đã cộng vào chỉ số nhân vật)." : "This buff/utility skill has no direct damage stats (its effects are applied to character stats)."}
            </p>
          ) : null}

          {/* Section 1: "Sát thương" (Damage) */}
          {(damageRows.length > 0 || damageTotal > 0 || cardDamageNeedsNames(damageLines)) ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Sát thương" : "Damage"}</h4>
              {damageRows.length ? (
                <dl className="sk-stat-list sk-stat-list--primary">
                  {damageRows.map((row) => (
                    <div className="sk-stat-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd className={row.cls}>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
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

          {/* Section 2: "Sử dụng" (Usage) */}
          {usageRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Sử dụng" : "Usage"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {usageRows.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Section 3: "Vùng ảnh hưởng & Thời lượng" (Area and Duration) */}
          {areaDurationRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Vùng ảnh hưởng & Thời lượng" : "Area and Duration"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {areaDurationRows.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Section 4: "Chí mạng" (Critical Hits) */}
          {critRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Chí mạng" : "Critical Hits"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {critRows.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Section 5: "Hiệu ứng bất lợi" (Ailments) */}
          {ailmentRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Hiệu ứng bất lợi" : "Ailments"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {ailmentRows.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Section 6: "Hiệu ứng khi đánh trúng" (On Hit Effects) */}
          {onHitRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Hiệu ứng khi đánh trúng" : "On Hit Effects"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {onHitRows.map((row) => (
                  <div className="sk-stat-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* Section 7: "Hiệu ứng khi hạ gục" (On Kill Effects) */}
          {onKillRows.length ? (
            <div className="sk-section">
              <h4 className="sk-section-heading">{vi ? "Hiệu ứng khi hạ gục" : "On Kill Effects"}</h4>
              <dl className="sk-stat-list sk-stat-list--sub">
                {onKillRows.map((row) => (
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
                {selectedTriggered ? (
                  <div className="sk-opt-row">
                    <span className="sk-opt-label">
                      {vi
                        ? `Cấp & Chất lượng (${selectedTriggeredMeta?.label})`
                        : `${selectedTriggeredMeta?.label} level & quality`}
                    </span>
                    <div className="sk-opt-ctrl">{gemLevelControls(selectedTriggered, (patch) => onUpdateSupport(skill.id, selectedTriggered.id, patch))}</div>
                  </div>
                ) : (
                  <div className="sk-opt-row">
                    <span className="sk-opt-label">{vi ? "Cấp & Chất lượng gem" : "Gem level & quality"}</span>
                    <div className="sk-opt-ctrl">{gemLevelControls(skill, (patch) => onUpdateSkill(skill.id, patch))}</div>
                  </div>
                )}
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
                        hideStatSets={Boolean(selectedTriggered?.id === sup.id && statSets)}
                        hideParts={Boolean(selectedTriggered?.id === sup.id && skillParts)}
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
