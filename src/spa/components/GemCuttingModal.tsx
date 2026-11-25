// Clean, PoE2 in-game style "Gemcutting" popup modal for Skill Gems & Support Gems.
//
// - Support Gems mode:
//     Left sidebar: build's skill groups (active group shows circular support sockets);
//                   bottom button toggles All Gems (all support gems).
//     Right panel:  Recommended | All Valid tabs, compact search, 4-column stone grid
//                   of circular gem orbs grouped by Uncut Support Tier (I..V, L).
// - Skill Gems mode:
//     Left sidebar: PoE2 weapon/school categories (Spear, Bow, Quarterstaff, Elemental,
//                   Occult, Primal, Mace, Crossbow, Spirit...) + Equipped Gems / All Gems.
//     Right panel:  compact search, 4-column stone grid of square framed skill icons
//                   grouped by Uncut Skill Gem Tier (I, III, V, VII, IX, XI, XIII...).
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";

import {
  effectiveSupportSockets,
  gemNameRank,
  type BuildSkillChoice,
  type BuildSupportSkillChoice
} from "../lib/buildPlanner";
import {
  ACTIVE_SKILL_CATEGORIES,
  activeSkillCategory,
  activeSkillTier,
  isSupportValidForSkill,
  recommendedSupportsForSkill,
  romanTier,
  SUPPORT_TIER_LABELS,
  SUPPORT_TIER_ORDER,
  supportFamilies,
  supportTierBucket,
  type ActiveSkillCategory,
  type GemCompatData,
  type SupportTierBucket
} from "../lib/gemCompat";
import { displayImageUrl } from "../lib/image";
import { localizedText, type Locale } from "../lib/locale";
import { matchesQuery } from "../lib/text";
import type { SkillGemMeta } from "./BuildSkillDetail";
import "../styles/planner-gemcutting.css";

export interface GemCuttingRecord {
  slug?: string;
  name: string;
  official_id?: string | null;
  gem_type?: string;
  color?: string;
  tier?: number | null;
  icon_url?: string;
  tags?: string[];
  summary_en?: string;
  properties?: string[];
  requirements?: string[];
  mods?: string[];
  sections?: Array<{ title?: string; lines?: string[] }>;
  i18n?: any;
}

export type GemCuttingTarget =
  | { kind: "skill"; skillId: string; supportId?: string }
  | { kind: "support"; skillId: string; supportId?: string };

export interface GemCuttingModalProps {
  open: boolean;
  target: GemCuttingTarget | null;
  locale: Locale;
  buildSkills: BuildSkillChoice[];
  skillGemOptions: GemCuttingRecord[];
  supportGemOptions: GemCuttingRecord[];
  gemCompat: GemCompatData | null;
  resolveSkillGem: (skill: BuildSkillChoice) => SkillGemMeta;
  resolveSupportGem: (support: BuildSupportSkillChoice) => SkillGemMeta;
  resolveSkillRecord: (skill: BuildSkillChoice) => GemCuttingRecord | undefined;
  resolveSupportRecord: (support: BuildSupportSkillChoice) => GemCuttingRecord | undefined;
  onChangeTarget: (next: GemCuttingTarget) => void;
  onSelectGem: (record: GemCuttingRecord, target: GemCuttingTarget) => void;
  onRemoveCurrent: (target: GemCuttingTarget) => void;
  onHoverGem: (record: GemCuttingRecord, kind: "skill" | "support", event: MouseEvent) => void;
  onMoveTooltip: (event: MouseEvent) => void;
  onLeaveTooltip: () => void;
  onClose: () => void;
}

type SupportTab = "recommended" | "valid";
type SkillCategoryView = ActiveSkillCategory | "equipped" | "all";

const gemRecordId = (record: GemCuttingRecord, prefix: "SkillGem" | "SupportGem"): string =>
  String(record.official_id || `Metadata/Items/Gems/${prefix}${String(record.slug || record.name || "").replace(/[^A-Za-z0-9]/g, "")}`);

const gemDisplayTitle = (record: GemCuttingRecord, locale: Locale): string =>
  String(record.name || localizedText(record.i18n?.name, "", locale) || "").trim();

const gemDisplaySummary = (record: GemCuttingRecord, locale: Locale): string =>
  localizedText(record.i18n?.summary, record.summary_en || "", locale);

const gemSearchLines = (record: GemCuttingRecord, locale: Locale): string[] => {
  const out: string[] = [];
  if (Array.isArray(record.i18n?.mods)) {
    for (const row of record.i18n.mods.slice(0, 4)) {
      const txt = localizedText(row, "", locale);
      if (txt) out.push(txt);
    }
  } else if (Array.isArray(record.mods)) {
    out.push(...record.mods.slice(0, 4));
  }
  return out;
};

const gemColorClass = (color: string | undefined): string => {
  if (color === "red" || color === "green" || color === "blue") return `is-color-${color}`;
  return "is-color-item";
};

export function GemCuttingModal(props: GemCuttingModalProps) {
  const {
    open,
    target,
    locale,
    buildSkills,
    skillGemOptions,
    supportGemOptions,
    gemCompat,
    resolveSkillGem,
    resolveSupportGem,
    resolveSkillRecord,
    resolveSupportRecord,
    onChangeTarget,
    onSelectGem,
    onRemoveCurrent,
    onHoverGem,
    onMoveTooltip,
    onLeaveTooltip,
    onClose
  } = props;

  const vi = locale === "vi";
  const titleId = useId();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const backdropDownRef = useRef(false);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SupportTab>("recommended");
  const [showAllSupports, setShowAllSupports] = useState(false);
  const [skillCategory, setSkillCategory] = useState<SkillCategoryView>("all");

  const activeGroup = useMemo(
    () => (target ? buildSkills.find((row) => row.id === target.skillId) ?? null : null),
    [buildSkills, target]
  );

  // For trigger meta groups (e.g. Cast on Critical + Comet), validate supports against the socketed spell when present.
  const damageSkillRecord = useMemo(() => {
    if (!activeGroup) return undefined;
    const activeChildren = activeGroup.supportSkills.filter((row) => row.active && row.skillId);
    const pickedChild = (activeGroup.mainActiveSkill ?? 1) > 1
      ? activeChildren[(activeGroup.mainActiveSkill ?? 1) - 2]
      : undefined;
    if (pickedChild) {
      const childRec = resolveSkillRecord({ ...activeGroup, skillId: pickedChild.skillId });
      if (childRec) return childRec;
    }
    return resolveSkillRecord(activeGroup);
  }, [activeGroup, resolveSkillRecord]);

  const isGrantedSkill = Boolean(activeGroup?.itemSlot || activeGroup?.itemSource);
  const isTriggeredGroup = Boolean(
    activeGroup && activeGroup.supportSkills.some((row) => row.active && row.skillId) && (activeGroup.mainActiveSkill ?? 1) > 1
  );

  // Active skill categories that actually have gems in our dataset (for clean Skill Gems sidebar).
  const activeCategoryCounts = useMemo(() => {
    const counts = new Map<ActiveSkillCategory, number>();
    for (const gem of skillGemOptions) {
      const cat = activeSkillCategory(gem, gemCompat);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return counts;
  }, [skillGemOptions, gemCompat]);

  const visibleSkillCategories = useMemo(
    () => ACTIVE_SKILL_CATEGORIES.filter((cat) => (activeCategoryCounts.get(cat.key) ?? 0) > 0),
    [activeCategoryCounts]
  );

  const equippedSkillNames = useMemo(() => {
    const set = new Set<string>();
    for (const group of buildSkills) {
      if (group.skillId) {
        const rec = resolveSkillRecord(group);
        if (rec?.name) set.add(rec.name.trim().toLowerCase());
      }
      for (const sup of group.supportSkills) {
        if (!sup.active || !sup.skillId) continue;
        const rec = resolveSupportRecord(sup);
        if (rec?.name) set.add(rec.name.trim().toLowerCase());
      }
    }
    return set;
  }, [buildSkills, resolveSkillRecord, resolveSupportRecord]);

  // Official GGG Recommended Supports + exact PoB All Valid supports for the selected skill group.
  const recommendedResult = useMemo(
    () => recommendedSupportsForSkill(damageSkillRecord, supportGemOptions, gemCompat, {
      isGrantedSkill,
      triggered: isTriggeredGroup
    }),
    [damageSkillRecord, supportGemOptions, gemCompat, isGrantedSkill, isTriggeredGroup]
  );

  const validSupports = useMemo(() => {
    if (!damageSkillRecord) return supportGemOptions;
    return supportGemOptions.filter((sup) =>
      isSupportValidForSkill(damageSkillRecord, sup, gemCompat, {
        isGrantedSkill,
        triggered: isTriggeredGroup
      })
    );
  }, [damageSkillRecord, supportGemOptions, gemCompat, isGrantedSkill, isTriggeredGroup]);

  const validSupportNames = useMemo(
    () => new Set(validSupports.map((g) => g.name.trim().toLowerCase())),
    [validSupports]
  );

  // Reset search/tab cleanly when opening or switching skill/mode.
  const prevTargetKeyRef = useRef<string>("");
  useEffect(() => {
    if (!open || !target) {
      prevTargetKeyRef.current = "";
      onLeaveTooltip();
      return;
    }
    const key = `${target.kind}:${target.skillId}:${target.supportId || "new"}`;
    if (prevTargetKeyRef.current !== key) {
      prevTargetKeyRef.current = key;
      setQuery("");
      setShowAllSupports(false);
      onLeaveTooltip();
      if (target.kind === "support") {
        setTab(recommendedResult.source === "ggpk" && recommendedResult.items.length > 0 ? "recommended" : "valid");
      } else {
        const sub = target.supportId && activeGroup
          ? activeGroup.supportSkills.find((s) => s.id === target.supportId)
          : undefined;
        const currentRec = sub ? resolveSupportRecord(sub) : damageSkillRecord;
        const currentCat = currentRec ? activeSkillCategory(currentRec, gemCompat) : null;
        setSkillCategory(currentCat || "all");
      }
    }
  }, [open, target, activeGroup, recommendedResult.source, recommendedResult.items.length, damageSkillRecord, resolveSupportRecord, gemCompat, onLeaveTooltip]);

  // Body scroll lock & Escape handler.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  // Names & families already socketed in this skill group (excluding the slot currently being swapped).
  const { socketedNames, socketedFamilies, currentSelectedId } = useMemo(() => {
    const names = new Set<string>();
    const families = new Set<string>();
    let currentId = "";
    if (!activeGroup || !target) return { socketedNames: names, socketedFamilies: families, currentSelectedId: currentId };
    if (target.kind === "skill") {
      const sub = target.supportId
        ? activeGroup.supportSkills.find((sup) => sup.id === target.supportId)
        : undefined;
      currentId = sub ? (sub.skillId || "") : (activeGroup.skillId || "");
      return { socketedNames: names, socketedFamilies: families, currentSelectedId: currentId };
    }
    for (const sup of activeGroup.supportSkills) {
      if (target.supportId && sup.id === target.supportId) {
        currentId = sup.skillId || "";
        continue;
      }
      if (sup.active) continue;
      if (!sup.skillId) continue;
      const rec = resolveSupportRecord(sup);
      const name = rec?.name || sup.nameSpec || "";
      if (name) {
        names.add(name.trim().toLowerCase());
        for (const fam of supportFamilies(name, gemCompat)) families.add(fam);
      }
    }
    return { socketedNames: names, socketedFamilies: families, currentSelectedId: currentId };
  }, [activeGroup, target, resolveSupportRecord, gemCompat]);

  // Filter + search + rank visible gems.
  const filteredGems = useMemo(() => {
    if (!target) return [];
    const isSupport = target.kind === "support";
    const prefix = isSupport ? "SupportGem" : "SkillGem";
    const q = query.trim().toLowerCase();

    let basePool: GemCuttingRecord[];
    if (!isSupport) {
      if (q) {
        // Searching in Skill mode searches across ALL skills so typing any skill name works immediately.
        basePool = skillGemOptions;
      } else if (skillCategory === "all") {
        basePool = skillGemOptions;
      } else if (skillCategory === "equipped") {
        basePool = skillGemOptions.filter((g) => equippedSkillNames.has(g.name.trim().toLowerCase()));
      } else {
        basePool = skillGemOptions.filter((g) => activeSkillCategory(g, gemCompat) === skillCategory);
      }
    } else if (showAllSupports) {
      basePool = supportGemOptions;
    } else if (tab === "recommended") {
      basePool = q ? validSupports : recommendedResult.items;
    } else {
      basePool = validSupports;
    }

    const filtered = q
      ? basePool.filter((item) => matchesQuery({
          title: gemDisplayTitle(item, locale),
          id: gemRecordId(item, prefix),
          tags: item.tags ?? [],
          summary: gemDisplaySummary(item, locale),
          lines: gemSearchLines(item, locale)
        }, query, ["title", "id", "tags", "summary", "lines"]))
      : basePool;

    if (q) {
      return [...filtered].sort((a, b) =>
        gemNameRank(gemDisplayTitle(a, locale), q) - gemNameRank(gemDisplayTitle(b, locale), q)
        || gemDisplayTitle(a, locale).localeCompare(gemDisplayTitle(b, locale))
      );
    }
    if (isSupport && !showAllSupports && tab === "recommended") return filtered;
    return [...filtered].sort((a, b) => gemDisplayTitle(a, locale).localeCompare(gemDisplayTitle(b, locale)));
  }, [target, query, tab, showAllSupports, skillCategory, locale, skillGemOptions, supportGemOptions, validSupports, recommendedResult.items, equippedSkillNames, gemCompat]);

  // Group into clean PoE2 tier blocks (I, III, V, VII, IX, XI, XIII... for skills; I..V, L for supports).
  const groupedSections = useMemo(() => {
    if (!target) return [];
    const isSupport = target.kind === "support";
    const q = query.trim();

    if (q) {
      return [{ key: "search", roman: "", items: filteredGems }];
    }

    if (!isSupport) {
      // Group active skills by Uncut Skill Gem Tier (I, III, V, VII, IX, XI, XIII... + untiered at end).
      const byTier = new Map<number, GemCuttingRecord[]>();
      const untiered: GemCuttingRecord[] = [];
      for (const item of filteredGems) {
        const t = activeSkillTier(item, gemCompat);
        if (t !== null) {
          if (!byTier.has(t)) byTier.set(t, []);
          byTier.get(t)!.push(item);
        } else {
          untiered.push(item);
        }
      }
      const sections = [...byTier.keys()]
        .sort((a, b) => a - b)
        .map((t) => ({ key: `t-${t}`, roman: romanTier(t), items: byTier.get(t)! }));
      if (untiered.length) {
        sections.push({ key: "t-other", roman: "★", items: untiered });
      }
      return sections;
    }

    if (!showAllSupports && tab === "recommended") {
      return [{ key: "rec", roman: "★", items: filteredGems }];
    }

    const buckets = new Map<SupportTierBucket, GemCuttingRecord[]>();
    for (const item of filteredGems) {
      const bucket = supportTierBucket(item, gemCompat);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(item);
    }
    return SUPPORT_TIER_ORDER
      .filter((key) => (buckets.get(key)?.length ?? 0) > 0)
      .map((key) => ({
        key,
        roman: SUPPORT_TIER_LABELS[key].roman,
        items: buckets.get(key)!
      }));
  }, [target, query, tab, showAllSupports, filteredGems, gemCompat]);

  if (!open || !target) return null;

  const isSupport = target.kind === "support";
  const canRemove = Boolean(currentSelectedId);

  const renderGemCard = (record: GemCuttingRecord) => {
    const title = gemDisplayTitle(record, locale);
    const icon = displayImageUrl(record.icon_url);
    const prefix = isSupport ? "SupportGem" : "SkillGem";
    const id = gemRecordId(record, prefix);
    const keyLower = record.name.trim().toLowerCase();
    const isCurrent = Boolean(currentSelectedId && (currentSelectedId === id || currentSelectedId.toLowerCase() === keyLower));
    const isAlreadySocketed = isSupport
      ? socketedNames.has(keyLower)
      : equippedSkillNames.has(keyLower);
    const hasFamilyConflict = isSupport && !isAlreadySocketed
      && supportFamilies(record.name, gemCompat).some((fam) => socketedFamilies.has(fam));
    const isIncompatible = isSupport && showAllSupports && damageSkillRecord && !validSupportNames.has(keyLower);

    const isDuplicateSupport = isSupport && isAlreadySocketed;

    return (
      <button
        key={`${record.slug || record.name}-${id}`}
        type="button"
        aria-disabled={isDuplicateSupport || undefined}
        className={[
          "gc-card",
          isSupport ? "gc-card--support" : "gc-card--skill",
          gemColorClass(record.color),
          isCurrent ? "is-current" : "",
          isAlreadySocketed ? "is-socketed" : "",
          hasFamilyConflict ? "is-conflict" : "",
          isIncompatible ? "is-invalid" : ""
        ].filter(Boolean).join(" ")}
        onClick={() => {
          if (isDuplicateSupport) return;
          onLeaveTooltip();
          onSelectGem(record, target);
        }}
        onMouseEnter={(event) => onHoverGem(record, isSupport ? "support" : "skill", event)}
        onMouseMove={onMoveTooltip}
        onMouseLeave={onLeaveTooltip}
      >
        <span className={`${isSupport ? "gc-orb" : "gc-square"} ${gemColorClass(record.color)}`}>
          {icon ? (
            <img src={icon} alt="" loading="lazy" />
          ) : (
            <span className="gc-orb-fallback" aria-hidden="true">{title.slice(0, 2).toUpperCase()}</span>
          )}
        </span>
        <span className="gc-card-name">{title}</span>
        {isCurrent ? (
          <span className="gc-dot-mark is-current" title={vi ? "Đang chọn" : "Current"} />
        ) : isAlreadySocketed ? (
          <span className="gc-dot-mark is-socketed" title={vi ? "Đã gắn" : "Equipped"} />
        ) : hasFamilyConflict ? (
          <span className="gc-dot-mark is-conflict" title={vi ? "Cùng họ support" : "Same family"} />
        ) : null}
      </button>
    );
  };

  return (
    <div
      className="gc-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        backdropDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropDownRef.current && event.target === event.currentTarget) onClose();
        backdropDownRef.current = false;
      }}
    >
      <div className="gc-shell poe-no-tooltip" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* Left Sidebar: Skill categories (in Skill mode) OR Build's skills + sockets (in Support mode) */}
        <aside className="gc-sidebar" aria-label={isSupport ? (vi ? "Kỹ năng trong build" : "Build skills") : (vi ? "Nhóm kỹ năng" : "Skill categories")}>
          {isSupport ? (
            <>
              <div className="gc-sidebar-list">
                {buildSkills.map((group) => {
                  const meta = resolveSkillGem(group);
                  const isSelected = !showAllSupports && group.id === target.skillId;
                  const supports = group.supportSkills;
                  const socketCount = effectiveSupportSockets(group);
                  const freeCount = Math.max(0, socketCount - supports.length);

                  return (
                    <div key={group.id} className={`gc-skill-item ${isSelected ? "is-selected" : ""}`}>
                      <button
                        type="button"
                        className="gc-skill-btn"
                        onClick={() => {
                          setShowAllSupports(false);
                          if (group.skillId) onChangeTarget({ kind: "support", skillId: group.id });
                          else onChangeTarget({ kind: "skill", skillId: group.id });
                        }}
                      >
                        <span className={`gc-skill-icon ${gemColorClass(meta.color)}`}>
                          {meta.icon ? (
                            <img src={meta.icon} alt="" loading="lazy" />
                          ) : (
                            <span className="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
                          )}
                        </span>
                        <span className="gc-skill-name">{meta.label}</span>
                      </button>

                      {isSelected && group.skillId ? (
                        <div className="gc-skill-sockets" role="list">
                          {supports.map((sup) => {
                            const supMeta = resolveSupportGem(sup);
                            const isTargetSlot = target.supportId === sup.id;
                            return (
                              <button
                                key={sup.id}
                                type="button"
                                className={`gc-mini-socket is-filled ${sup.active ? "is-triggered" : gemColorClass(supMeta.color)} ${isTargetSlot ? "is-active" : ""}`}
                                onClick={() => onChangeTarget({ kind: sup.active ? "skill" : "support", skillId: group.id, supportId: sup.id })}
                                title={supMeta.label}
                                aria-label={supMeta.label}
                              >
                                {supMeta.icon ? <img src={supMeta.icon} alt="" /> : null}
                              </button>
                            );
                          })}
                          {Array.from({ length: freeCount }).map((_, idx) => {
                            const isAddingHere = target.kind === "support" && !target.supportId && idx === 0;
                            return (
                              <button
                                key={`free-${idx}`}
                                type="button"
                                className={`gc-mini-socket is-empty ${isAddingHere ? "is-active" : ""}`}
                                onClick={() => onChangeTarget({ kind: "support", skillId: group.id })}
                                title={vi ? "Thêm gem hỗ trợ" : "Add support gem"}
                                aria-label={vi ? "Ô support trống" : "Empty support socket"}
                              />
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="gc-sidebar-foot">
                <button
                  type="button"
                  className={`gc-foot-btn ${showAllSupports ? "is-selected" : ""}`}
                  onClick={() => setShowAllSupports((prev) => !prev)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">sell</span>
                  <span>All Gems</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="gc-sidebar-list">
                {visibleSkillCategories.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    className={`gc-cat-btn ${skillCategory === cat.key && !query ? "is-selected" : ""}`}
                    onClick={() => {
                      setQuery("");
                      setSkillCategory(cat.key);
                    }}
                  >
                    <span className="gc-cat-icon material-symbols-rounded" aria-hidden="true">{cat.icon}</span>
                    <span className="gc-cat-label">{cat.label}</span>
                  </button>
                ))}
              </div>

              <div className="gc-sidebar-foot">
                {equippedSkillNames.size > 0 ? (
                  <button
                    type="button"
                    className={`gc-foot-btn ${skillCategory === "equipped" && !query ? "is-selected" : ""}`}
                    onClick={() => {
                      setQuery("");
                      setSkillCategory("equipped");
                    }}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">auto_awesome</span>
                    <span>{vi ? "Equipped Gems" : "Equipped Gems"}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`gc-foot-btn ${skillCategory === "all" && !query ? "is-selected" : ""}`}
                  onClick={() => {
                    setQuery("");
                    setSkillCategory("all");
                  }}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">sell</span>
                  <span>{vi ? "All Gems" : "All Gems"}</span>
                </button>
              </div>
            </>
          )}
        </aside>

        {/* Right Main Gemcutting Panel */}
        <section className="gc-panel">
          <header className="gc-header">
            <div className="gc-plaque">
              <h2 id={titleId} className="gc-title">Gemcutting</h2>
              <p className="gc-subtitle">
                {isSupport
                  ? (showAllSupports ? "Support Gems" : (damageSkillRecord?.name ? `Support Gems · ${damageSkillRecord.name}` : "Support Gems"))
                  : (target.supportId && activeGroup ? `Skill Gems · ${resolveSkillGem(activeGroup).label}` : "Skill Gems")}
              </p>
            </div>
            <button
              type="button"
              className="gc-close"
              onClick={() => {
                onLeaveTooltip();
                onClose();
              }}
              aria-label={vi ? "Đóng" : "Close"}
              title={vi ? "Đóng (Esc)" : "Close (Esc)"}
            >
              <span className="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </header>

          {/* Compact single-area bar: Recommended / All Valid tabs (support mode) + Search */}
          <div className="gc-bar">
            {isSupport && !showAllSupports ? (
              <div className="gc-tabs" role="tablist" aria-label={vi ? "Bộ lọc Support Gem" : "Support filter"}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "recommended"}
                  className={`gc-tab ${tab === "recommended" ? "is-active" : ""}`}
                  onClick={() => setTab("recommended")}
                >
                  Recommended
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "valid"}
                  className={`gc-tab ${tab === "valid" ? "is-active" : ""}`}
                  onClick={() => setTab("valid")}
                >
                  All Valid
                </button>
              </div>
            ) : null}

            <div className="gc-search-wrap">
              <label className="gc-search">
                <span className="material-symbols-rounded" aria-hidden="true">search</span>
                <input
                  ref={searchInputRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={isSupport
                    ? (vi ? "Tìm support gem..." : "Search support gems...")
                    : (vi ? "Tìm skill gem..." : "Search skill gems...")}
                />
                {query ? (
                  <button
                    type="button"
                    className="gc-search-clear"
                    onClick={() => {
                      setQuery("");
                      searchInputRef.current?.focus();
                    }}
                    aria-label={vi ? "Xoá từ khoá" : "Clear"}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                  </button>
                ) : null}
              </label>

              {canRemove ? (
                <button
                  type="button"
                  className="gc-remove-btn"
                  onClick={() => {
                    onLeaveTooltip();
                    onRemoveCurrent(target);
                  }}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">delete_outline</span>
                  <span>{vi ? "Tháo gem" : "Remove"}</span>
                </button>
              ) : null}
            </div>
          </div>

          {/* Scrollable 4-column PoE2 stone grid grouped by Roman Tier badges */}
          <div className="gc-body">
            {filteredGems.length ? (
              groupedSections.map((section) => {
                const centered = !isSupport && !query && section.items.length < 4;
                return (
                  <div key={section.key} className="gc-tier-block">
                    {section.roman ? <span className="gc-tier-badge" aria-hidden="true">{section.roman}</span> : null}
                    <div className={`gc-grid ${centered ? "is-centered" : ""}`}>
                      {section.items.map((record) => renderGemCard(record))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="gc-empty">
                <p>{query ? (vi ? `Không tìm thấy "${query}".` : `No gems match "${query}".`) : (vi ? "Không có gem phù hợp." : "No gems found.")}</p>
                {isSupport && !showAllSupports ? (
                  <button type="button" className="gc-empty-btn" onClick={() => setShowAllSupports(true)}>
                    {vi ? "Xem tất cả Support Gems" : "Show all supports"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
