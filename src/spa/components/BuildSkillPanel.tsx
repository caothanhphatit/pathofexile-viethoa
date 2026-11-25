// Compact in-game style Skills panel for the Build Planner using PoE2's real base-art ratios:
// Desktop (>= 1024px): 52.2% list column (block width W = 86.6% centred) + 47.8% sticky detail column.
// Mobile (< 1024px): single column; detail panel expands inline directly under the open block.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import {
  effectiveSupportSockets,
  MAX_SUPPORT_SOCKETS,
  supportSocketStepperBounds,
  type BuildSkillChoice,
  type BuildSupportSkillChoice
} from "../lib/buildPlanner";
import { cardDamageNeedsNames, cardDamageOwners, type CardDamageLine } from "../lib/buildStats";
import { type PobGemOptions } from "../lib/gemOptions";
import type { CalcQueue } from "../lib/calcQueue";
import { supportFamilyConflicts } from "../../server/pob-gem-families.mjs";
import { monsterLibraryOf } from "../../server/pob-monster-gems.mjs";
import type { SkillUsabilityIssue } from "../lib/skillUsability";
import { SupportValue } from "./BuildInventoryPanel";
import { BuildSkillDetail, formatBadgeNumber, skillDamageBadge, supportInitials, type SkillGemMeta } from "./BuildSkillDetail";
import "../styles/planner-skills.css";

export { formatBadgeNumber, skillDamageBadge, supportInitials } from "./BuildSkillDetail";

const DESKTOP_MEDIA = "(min-width: 1024px)";
const DEFAULT_MIN_SUFFIX_PX = 38;

/**
 * Decides how to allocate the header's name slot between the gem's own name and
 * its optional "→ granted skills" suffix:
 * 1. Gem name always gets full priority and is never truncated while the suffix is shown.
 * 2. When space is tight, the suffix shrinks/ellipsizes first.
 * 3. When remaining space after the full gem name is below minSuffixWidth, the suffix
 *    hides completely (remaining in the title tooltip and detail panel).
 * 4. Only if the gem name itself exceeds availableWidth does the gem name ellipsize.
 */
export function fitSkillNameLayout(input: {
  availableWidth: number;
  nameWidth: number;
  hasSuffix: boolean;
  gap?: number;
  minSuffixWidth?: number;
}): { showSuffix: boolean; namePriority: boolean; suffixMaxWidth: number } {
  const gap = input.gap ?? 5;
  const minSuffix = input.minSuffixWidth ?? DEFAULT_MIN_SUFFIX_PX;
  if (!input.hasSuffix || input.availableWidth <= 0) {
    return { showSuffix: false, namePriority: false, suffixMaxWidth: 0 };
  }
  const leftover = input.availableWidth - input.nameWidth - gap;
  if (leftover >= minSuffix) {
    return { showSuffix: true, namePriority: true, suffixMaxWidth: leftover };
  }
  return { showSuffix: false, namePriority: false, suffixMaxWidth: 0 };
}

function SkillNameFit({
  name,
  isEmpty,
  suffix,
  hasWarning,
  vi
}: {
  name: string;
  isEmpty: boolean;
  suffix: string;
  hasWarning: boolean;
  vi: boolean;
}) {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [showSuffix, setShowSuffix] = useState(Boolean(suffix));

  useLayoutEffect(() => {
    if (!suffix) {
      setShowSuffix(false);
      return;
    }
    const recompute = () => {
      const wrap = wrapRef.current;
      const measure = measureRef.current;
      if (!wrap || !measure) return;
      const warnReserve = hasWarning ? 18 : 0;
      const availableWidth = Math.max(0, wrap.clientWidth - warnReserve);
      const nameWidth = measure.offsetWidth;
      const fit = fitSkillNameLayout({
        availableWidth,
        nameWidth,
        hasSuffix: Boolean(suffix)
      });
      setShowSuffix(fit.showSuffix);
    };
    recompute();
    if (typeof ResizeObserver !== "function" || !wrapRef.current) return;
    const observer = new ResizeObserver(recompute);
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [name, suffix, hasWarning]);

  return (
    <span className="sk-row-name-wrap" ref={wrapRef}>
      {/* Hidden intrinsic-width probe matching .sk-row-name typography to measure untruncated width */}
      <span className="sk-row-name sk-row-name-probe" ref={measureRef} aria-hidden="true">{name}</span>
      <strong className={`sk-row-name ${isEmpty ? "is-empty" : ""} ${showSuffix ? "is-priority" : "is-ellipsis"}`}>
        {name}
      </strong>
      {showSuffix && suffix ? <span className="sk-row-owner">→ {suffix}</span> : null}
      {hasWarning ? (
        <span
          className="sk-row-warn material-symbols-rounded"
          aria-label={vi ? "Có lưu ý trong chi tiết" : "Has notice in details"}
          title={vi ? "Mở chi tiết để xem cảnh báo" : "Open details to see warning"}
        >
          warning
        </span>
      ) : null}
    </span>
  );
}

function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_MEDIA).matches
      : true
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DESKTOP_MEDIA);
    const update = () => setDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return desktop;
}

/** Notched PoE2-style arrowhead matching the in-game skill panel toggle. */
function BadgeArrow({ direction }: { direction: "right" | "left" | "down" | "up" }) {
  const rotation = direction === "left" ? 180 : direction === "down" ? 90 : direction === "up" ? -90 : 0;
  return (
    <svg
      className="sk-badge-arrow-svg"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
    >
      <path d="M2.5 1.5L10 6L2.5 10.5L4.4 6Z" fill="currentColor" />
    </svg>
  );
}

export interface BuildSkillPanelProps {
  buildSkills: BuildSkillChoice[];
  foldedGroups: Set<number>;
  currentGroupDps: Array<number | undefined> | undefined;
  previousGroupDps: Array<number | undefined> | undefined;
  perHitGroups: Set<number>;
  groupDamageLines: CardDamageLine[][];
  mainSocketGroup: number;
  activeWeaponSet: 1 | 2;
  activeStats: Record<string, unknown> | null;
  isCalculating: boolean;
  locale: string;
  openSkillId: string | null;
  onOpenSkillChange: (skillId: string | null) => void;
  /** True while a modal picker/dialog is open so Escape closes only the modal. */
  modalOpen?: boolean;
  compareQueue: CalcQueue<Record<string, unknown>>;
  calculationBodyForSkill?: (groupNumber: number, mainActiveSkill?: number) => Record<string, unknown> | null;
  activeGemStrip: { skillId: string; supportId: string | "main" } | null;
  renderGemStrip: (skillId: string, supportId: string | "main") => ReactNode;
  resolveSkillGem: (skill: BuildSkillChoice) => SkillGemMeta;
  resolveSupportGem: (support: BuildSupportSkillChoice) => SkillGemMeta;
  weaponHintFor: (skill: BuildSkillChoice) => string | null;
  usabilityFor?: (skill: BuildSkillChoice, index: number) => SkillUsabilityIssue[];
  grantedSkillTag: (skill: BuildSkillChoice) => ReactNode;
  gemOptionFor: (groupIndex: number, supportId?: string) => PobGemOptions | undefined;
  gemLevelControls: (gem: { gemLevel?: number; gemQuality?: number }, onPatch: (patch: { gemLevel?: number; gemQuality?: number }) => void) => ReactNode;
  supportValueKeys: (skillId: string, supportId: string) => { withKey: string; withoutKey: string } | null;
  onSelectMain: (groupNumber: number) => void;
  onOpenSkillGemPicker: (skillId: string) => void;
  onOpenSupportGemPicker: (skillId: string, supportId: string) => void;
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

export function BuildSkillPanel(props: BuildSkillPanelProps) {
  const {
    buildSkills,
    foldedGroups,
    currentGroupDps,
    previousGroupDps,
    perHitGroups,
    groupDamageLines,
    mainSocketGroup,
    activeWeaponSet,
    activeStats,
    isCalculating,
    locale,
    openSkillId,
    onOpenSkillChange,
    modalOpen = false,
    compareQueue,
    calculationBodyForSkill,
    activeGemStrip,
    renderGemStrip,
    resolveSkillGem,
    resolveSupportGem,
    weaponHintFor,
    usabilityFor,
    grantedSkillTag,
    gemOptionFor,
    gemLevelControls,
    supportValueKeys,
    onSelectMain,
    onOpenSkillGemPicker,
    onOpenSupportGemPicker,
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
  const isDesktop = useDesktopLayout();
  const arrowRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const [hoveredSupport, setHoveredSupport] = useState<{
    skillId: string;
    supportId: string;
    keys: { withKey: string; withoutKey: string } | null;
  } | null>(null);

  const closeDetail = useCallback((restoreFocus = true) => {
    const closingId = openSkillId;
    if (!closingId) return;
    onOpenSkillChange(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        arrowRefs.current.get(closingId)?.focus();
      });
    }
  }, [openSkillId, onOpenSkillChange]);

  useEffect(() => {
    if (!openSkillId || modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeDetail(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSkillId, modalOpen, closeDetail]);

  const openIndex = openSkillId ? buildSkills.findIndex((skill, idx) => skill.id === openSkillId && !foldedGroups.has(idx)) : -1;
  useEffect(() => {
    if (openSkillId && openIndex < 0) onOpenSkillChange(null);
  }, [openSkillId, openIndex, onOpenSkillChange]);

  // Keep the build's exact skill order (no auto-reordering by DPS or tucking rows away).
  const visibleIndices = buildSkills
    .map((_, index) => index)
    .filter((index) => !foldedGroups.has(index));

  const weaponSetRoman = activeWeaponSet === 2 ? "II" : "I";

  const buildRowModel = (index: number) => {
    const skill = buildSkills[index];
    const isMain = index + 1 === mainSocketGroup;
    const dps = currentGroupDps?.[index];
    const before = previousGroupDps?.[index];
    const perHit = perHitGroups.has(index);
    const badge = skillDamageBadge({
      dps,
      before,
      perHit,
      disabled: Boolean(skill.disabled),
      calculating: isCalculating,
      locale
    });
    const skillMeta = resolveSkillGem(skill);
    const triggered = skill.supportSkills.filter((support) => support.active && !support.disabled);
    const socketedGems = skill.supportSkills;
    const pureSupports = skill.supportSkills.filter((support) => !support.active);
    // Real unlocked sockets (2-5): positions 1..socketCount are rings, socketCount+1..5 are recesses.
    // In PoE2, spells socketed into Meta/CoC skills (e.g. Comet in Cast on Critical) occupy a socket too.
    const socketCount = effectiveSupportSockets(skill);
    const freeSockets = Math.max(0, socketCount - socketedGems.length);
    const lockedRecesses = Math.max(0, MAX_SUPPORT_SOCKETS - Math.max(socketCount, socketedGems.length));
    const damageLines = skill.disabled ? [] : groupDamageLines[index] ?? [];
    const familyConflicts = supportFamilyConflicts(pureSupports.map((support) => {
      const meta = resolveSupportGem(support);
      return {
        id: support.pobGemId || support.skillId,
        name: meta.rawName || support.nameSpec,
        disabled: Boolean(support.disabled) || !support.skillId
      };
    }));
    const supersededSupports = new Set(
      familyConflicts.flatMap((conflict) => conflict.gems.filter((gem) => gem !== conflict.kept).map((gem) => pureSupports[gem].id))
    );
    const supports = socketedGems;
    const weaponHint = weaponHintFor(skill);
    const usabilityIssues = usabilityFor ? usabilityFor(skill, index) : [];
    const hasWeaponError = usabilityIssues.some((issue) => issue.kind === "weapon");
    const isUnusable = !skill.disabled && usabilityIssues.length > 0;
    const displayBadge = hasWeaponError
      ? { kind: undefined, value: "—", unit: "", exact: usabilityIssues[0]?.message || weaponHint || "" }
      : badge;
    const missingMonster = Boolean(skill.skillId && monsterLibraryOf(skill) && !skill.pobAttrs?.skillMinion);
    const hasWarning = !skill.disabled && Boolean(
      isUnusable ||
      (skill.skillId && !(dps !== undefined && dps > 0) && weaponHint) ||
      familyConflicts.length > 0 ||
      missingMonster
    );
    return {
      skill,
      index,
      isMain,
      dps: hasWeaponError ? 0 : dps,
      badge: displayBadge,
      skillMeta,
      triggered,
      supports,
      socketCount,
      freeSockets,
      lockedRecesses,
      damageLines: hasWeaponError ? [] : damageLines,
      familyConflicts,
      supersededSupports,
      weaponHint,
      usabilityIssues,
      isUnusable,
      hasWarning
    };
  };

  const renderDetailFor = (index: number) => {
    const model = buildRowModel(index);
    return (
      <BuildSkillDetail
        id={`sk-detail-${model.skill.id}`}
        skill={model.skill}
        index={index}
        isMain={model.isMain}
        dps={model.dps}
        badge={model.badge}
        damageLines={model.damageLines}
        activeStats={activeStats}
        compareQueue={compareQueue}
        calculationBodyForSkill={calculationBodyForSkill}
        locale={locale}
        skillMeta={model.skillMeta}
        resolveSupportGem={resolveSupportGem}
        supports={model.supports}
        triggered={model.triggered}
        familyConflicts={model.familyConflicts}
        weaponHint={model.weaponHint}
        usabilityIssues={model.usabilityIssues}
        grantedTag={grantedSkillTag(model.skill)}
        gemOptionFor={gemOptionFor}
        gemLevelControls={gemLevelControls}
        onClose={() => closeDetail(true)}
        onSelectMain={onSelectMain}
        onUpdateSkill={onUpdateSkill}
        onRemoveSkill={onRemoveSkill}
        onUpdateSupport={onUpdateSupport}
        onHoverMainGem={onHoverMainGem}
        onMoveTooltip={onMoveTooltip}
        onLeaveTooltip={onLeaveTooltip}
      />
    );
  };

  const renderRow = (index: number) => {
    const model = buildRowModel(index);
    const {
      skill,
      isMain,
      badge,
      skillMeta,
      triggered,
      supports,
      socketCount,
      freeSockets,
      lockedRecesses,
      damageLines,
      supersededSupports,
      usabilityIssues,
      isUnusable,
      hasWarning
    } = model;
    const primaryIssue = usabilityIssues[0] ?? null;
    const isOpen = openSkillId === skill.id;
    const detailId = `sk-detail-${skill.id}`;
    const toggleDetail = () => {
      if (isOpen) closeDetail(true);
      else onOpenSkillChange(skill.id);
    };
    const ownerSuffix = cardDamageNeedsNames(damageLines)
      ? cardDamageOwners(damageLines, 2)
      : triggered.length
        ? triggered.slice(0, 2).map((sup) => resolveSupportGem(sup).label).join(", ")
        : "";
    const fullHeaderTitle = [
      ownerSuffix ? `${skillMeta.label} → ${ownerSuffix}` : skillMeta.label,
      ...usabilityIssues.map((issue) => issue.message)
    ].join("\n");
    const arrowDirection: "right" | "left" | "down" | "up" = isDesktop
      ? (isOpen ? "left" : "right")
      : (isOpen ? "up" : "down");
    const dmgLenClass = badge.value.length >= 9 ? "is-long" : badge.value.length >= 7 ? "is-med" : "";

    const set1On = skill.weaponSet1 !== false;
    const set2On = skill.weaponSet2 !== false;
    const activeOnCurrentSet = (!set1On && !set2On) || (activeWeaponSet === 1 ? set1On : set2On);
    const skillSetBadge = set1On && !set2On ? "I" : (!set1On && set2On ? "II" : weaponSetRoman);

    return (
      <div className="sk-item" key={skill.id}>
        <article className={`sk-row ${isMain ? "is-main" : ""} ${skill.disabled ? "is-disabled" : ""} ${!activeOnCurrentSet ? "is-other-set" : ""} ${isUnusable ? "is-unusable" : ""} ${isOpen ? "is-open" : ""}`}>
          {/* Header bar (840 x 80 = 9.52% W): flush above socket bar, icon 7.6% W @ 8.7% W */}
          <div className="sk-row-head">
            <span className="sk-collapse-stub" aria-hidden="true" />
            <button
              type="button"
              className="sk-head-main"
              onClick={toggleDetail}
              aria-expanded={isOpen}
              aria-controls={isOpen ? detailId : undefined}
              title={fullHeaderTitle}
            >
              <span className="sk-row-icon">
                {skillMeta.icon ? <img src={skillMeta.icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">add</span>}
              </span>
              <SkillNameFit
                name={skillMeta.label}
                isEmpty={!skill.skillId}
                suffix={ownerSuffix}
                hasWarning={hasWarning && !primaryIssue}
                vi={vi}
              />
              {primaryIssue ? (
                <span className="sk-unusable-pill" title={usabilityIssues.map((i) => i.message).join("\n")}>
                  <span className="material-symbols-rounded" aria-hidden="true">error</span>
                  <span>{primaryIssue.shortLabel}</span>
                </span>
              ) : null}
              {skill.skillId ? (
                <span className="sk-row-lvl">
                  <span className="sk-lvl-label">
                    <span className="sk-lvl-full">LEVEL:</span>
                    <span className="sk-lvl-short">Lv</span>
                  </span>{" "}
                  <b className="sk-lvl-num">{skill.gemLevel ?? 20}</b>
                </span>
              ) : null}
            </button>

            <button
              type="button"
              className={`sk-star-btn ${isMain ? "is-main" : ""}`}
              onClick={() => onSelectMain(index + 1)}
              aria-pressed={isMain}
              aria-label={vi
                ? (isMain ? `${skillMeta.label}: đang là kỹ năng chính` : `Chọn ${skillMeta.label} làm kỹ năng chính`)
                : (isMain ? `${skillMeta.label}: main skill` : `Set ${skillMeta.label} as main skill`)}
              title={vi ? (isMain ? "Kỹ năng chính: chỉ số chi tiết tính theo kỹ năng này" : "Đặt làm kỹ năng chính") : "Set as main skill"}
            >
              <span className="material-symbols-rounded" aria-hidden="true">{isMain ? "star" : "star_outline"}</span>
            </button>

            <button
              type="button"
              className={`sk-dmg-badge ${isOpen ? "is-open" : ""}`}
              ref={(node) => {
                if (node) arrowRefs.current.set(skill.id, node);
                else arrowRefs.current.delete(skill.id);
              }}
              onClick={toggleDetail}
              aria-expanded={isOpen}
              aria-controls={isOpen ? detailId : undefined}
              aria-label={vi
                ? (isOpen ? `Đóng chi tiết ${skillMeta.label}` : `Mở chi tiết ${skillMeta.label}${badge.exact ? ` (${badge.exact})` : ""}`)
                : (isOpen ? `Close ${skillMeta.label} details` : `Open ${skillMeta.label} details${badge.exact ? ` (${badge.exact})` : ""}`)}
              title={badge.exact || (vi ? (isOpen ? "Đóng chi tiết" : "Mở chi tiết") : (isOpen ? "Close details" : "Open details"))}
            >
              <span className="sk-dmg-set" aria-hidden="true">{skillSetBadge}</span>
              <span className={`sk-dmg-val ${dmgLenClass}`}>
                {badge.kind ? <span className="sk-dmg-kind">{badge.kind}: </span> : null}
                <b>{badge.value}</b>
              </span>
              <span className="sk-dmg-arrow" aria-hidden="true">
                <BadgeArrow direction={arrowDirection} />
              </span>
            </button>
          </div>

          {/* Socket bar (840 x 110 = 13.1% W): flush under header, active socket 11.7% W,
              support sockets 8.7% W @ pitch 14.1% W (positions 1..socketCount rings, rest recesses). */}
          <div className="sk-sockets-bar">
            <button
              type="button"
              className="sk-socket sk-socket--active"
              onClick={() => onOpenSkillGemPicker(skill.id)}
              onMouseEnter={(event) => skill.skillId && onHoverMainGem(skill, event)}
              onMouseMove={onMoveTooltip}
              onMouseLeave={onLeaveTooltip}
              aria-label={skill.skillId
                ? (vi ? `${skillMeta.label} — bấm để đổi kỹ năng` : `${skillMeta.label} — click to swap skill`)
                : (vi ? "Chọn kỹ năng" : "Choose a skill")}
              title={skill.skillId ? (vi ? `${skillMeta.label} — bấm để đổi kỹ năng` : `${skillMeta.label} — click to swap`) : (vi ? "Chọn kỹ năng" : "Choose a skill")}
            >
              <span className="sk-socket-disc">
                {skillMeta.icon ? <img key={skillMeta.icon} src={skillMeta.icon} alt="" loading="lazy" /> : <span className="material-symbols-rounded" aria-hidden="true">add</span>}
              </span>
            </button>

            <div className="sk-socket-group" role="list" aria-label={vi ? "Ô gem hỗ trợ" : "Support sockets"}>
              {supports.map((support) => {
                const meta = resolveSupportGem(support);
                const hovered = hoveredSupport?.skillId === skill.id && hoveredSupport.supportId === support.id;
                const keys = hovered ? hoveredSupport.keys : null;
                const superseded = supersededSupports.has(support.id);
                const colorCls = support.skillId && (meta.color === "red" || meta.color === "green" || meta.color === "blue")
                  ? `is-color-${meta.color}`
                  : "";
                return (
                  <span
                    className={`sk-socket-wrap ${support.disabled ? "is-disabled" : ""} ${superseded ? "is-superseded" : ""}`}
                    role="listitem"
                    key={support.id}
                    onMouseEnter={() => setHoveredSupport({
                      skillId: skill.id,
                      supportId: support.id,
                      keys: !support.active && support.skillId && !support.disabled && !skill.disabled ? supportValueKeys(skill.id, support.id) : null
                    })}
                    onMouseLeave={() => setHoveredSupport(null)}
                  >
                    <button
                      type="button"
                      className={`sk-socket sk-socket--support ${support.active ? "sk-socket--triggered" : ""} ${colorCls}`}
                      onClick={() => onOpenSupportGemPicker(skill.id, support.id)}
                      aria-label={`${meta.label} — ${vi ? "bấm để đổi hoặc tháo" : "click to swap or remove"}`}
                      title={superseded
                        ? (vi ? `${meta.label} — Không có tác dụng: nhóm đã có gem khác cùng họ` : `${meta.label} — No effect: another support of the same family is socketed`)
                        : undefined}
                    >
                      <span className="sk-socket-disc">
                        {support.skillId ? (
                          <span className="sk-support-initial" aria-hidden="true">{supportInitials(meta.label)}</span>
                        ) : (
                          <span className="sk-socket-plus material-symbols-rounded" aria-hidden="true">add</span>
                        )}
                        {meta.icon ? (
                          <img key={meta.icon} src={meta.icon} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                        ) : null}
                      </span>
                    </button>
                    {hovered ? (
                      <span className="sk-support-tip" role="tooltip">
                        <b>{meta.label}</b>
                        {support.gemLevel ? <small> · Lv {support.gemLevel}</small> : null}
                        {support.active ? (
                          <span className="sk-value">{vi ? "Kỹ năng được gắn" : "Socketed skill"}</span>
                        ) : support.disabled ? (
                          <span className="sk-value">{vi ? "Đang tắt" : "Disabled"}</span>
                        ) : keys ? (
                          <SupportValue queue={compareQueue} withKey={keys.withKey} withoutKey={keys.withoutKey} locale={locale} />
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                );
              })}
              {Array.from({ length: freeSockets }).map((_, slotIdx) => {
                const socketBounds = supportSocketStepperBounds(skill);
                const canRemoveSocket = slotIdx === freeSockets - 1 && socketBounds.canDecrease;
                const shrinkSocket = () => onUpdateSkill(skill.id, { supportSockets: socketBounds.current - 1 });
                return (
                  <span className="sk-socket-wrap" role="listitem" key={`free-${slotIdx}`}>
                    <button
                      type="button"
                      className="sk-socket sk-socket--empty"
                      onClick={() => onAddSupport(skill.id)}
                      onContextMenu={canRemoveSocket ? (event) => {
                        event.preventDefault();
                        shrinkSocket();
                      } : undefined}
                      aria-label={vi ? `Thêm gem hỗ trợ vào ${skillMeta.label}` : `Add support gem to ${skillMeta.label}`}
                      title={canRemoveSocket
                        ? (vi ? "Thêm gem hỗ trợ (chuột phải hoặc bấm − để giảm ô support)" : "Add support (right-click or press − to remove this socket)")
                        : (vi ? "Thêm gem hỗ trợ (gợi ý theo DPS tăng thêm)" : "Add a support (ranked by DPS gain)")}
                    >
                      <span className="sk-socket-disc">
                        <span className="sk-socket-plus material-symbols-rounded" aria-hidden="true">add</span>
                      </span>
                    </button>
                    {canRemoveSocket ? (
                      <button
                        type="button"
                        className="sk-socket-shrink"
                        onClick={shrinkSocket}
                        aria-label={vi ? `Giảm số ô support của ${skillMeta.label}` : `Decrease support sockets for ${skillMeta.label}`}
                        title={vi ? "Giảm 1 ô support" : "Remove 1 support socket"}
                      >
                        −
                      </button>
                    ) : null}
                  </span>
                );
              })}
              {Array.from({ length: lockedRecesses }).map((_, slotIdx) => (
                <span className="sk-socket-wrap" role="listitem" key={`recess-${slotIdx}`}>
                  <button
                    type="button"
                    className="sk-socket-recess"
                    onClick={() => onUpdateSkill(skill.id, { supportSockets: Math.min(MAX_SUPPORT_SOCKETS, socketCount + 1) })}
                    aria-label={vi ? `Thêm ô support cho ${skillMeta.label}` : `Add support socket to ${skillMeta.label}`}
                    title={vi ? "Thêm ô support" : "Add support socket"}
                  >
                    <span className="sk-recess-plus material-symbols-rounded" aria-hidden="true">add</span>
                  </button>
                </span>
              ))}
            </div>
          </div>
        </article>

        {!isDesktop && isOpen ? (
          <div className="sk-inline-detail">{renderDetailFor(index)}</div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`sk-layout ${openIndex >= 0 ? "has-detail" : ""}`}>
      <div className="sk-list-col">
        <div className="sk-list-stage">
          <div className="sk-list" role="list" aria-label={vi ? "Danh sách kỹ năng" : "Skills"}>
            {visibleIndices.map((index) => renderRow(index))}
          </div>
        </div>
      </div>

      {isDesktop ? (
        <div className="sk-detail-col">
          {openIndex >= 0 ? (
            renderDetailFor(openIndex)
          ) : (
            <div className="sk-detail-empty" aria-hidden="true">
              <span className="material-symbols-rounded">touch_app</span>
              <p>
                {vi
                  ? "Bấm vào một kỹ năng hoặc mũi tên ▶ để xem chỉ số, tuỳ chọn và gem hỗ trợ."
                  : "Click a skill or its ▶ arrow to view stats, options, and support gems."}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
