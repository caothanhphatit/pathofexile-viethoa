// Compact action bar on the Build Planner detail page: opens Passive Tree,
// Conditions ("Điều kiện"), and Detailed Stats ("Chỉ số chi tiết") as modals.
import type { RefObject } from "react";

import type { PobConfigInput } from "../lib/buildPlanner";
import { CONFIG_OPTIONS, configInputValue } from "../lib/buildStats";
import { formatNumber, type Locale } from "../lib/locale";

export type BuildModalKind = "tree" | "config" | "stats";

/** Count how many known PoB configuration options differ from PoB's default. */
export function countChangedConditions(inputs: PobConfigInput[] | undefined): number {
  let count = 0;
  for (const option of CONFIG_OPTIONS) {
    if (configInputValue(inputs, option) !== option.defaultValue) count += 1;
  }
  return count;
}

export interface BuildDrawerBarProps {
  locale: Locale;
  activeModal: BuildModalKind | null;
  onOpenModal: (kind: BuildModalKind) => void;
  treeBtnRef: RefObject<HTMLButtonElement>;
  configBtnRef: RefObject<HTMLButtonElement>;
  statsBtnRef: RefObject<HTMLButtonElement>;
  treeName: string;
  treePoints: number;
  weaponSet1Points: number;
  weaponSet2Points: number;
  treeOverLimit: boolean;
  changedConditions: number;
  isCalculating: boolean;
}

export function BuildDrawerBar({
  locale,
  activeModal,
  onOpenModal,
  treeBtnRef,
  configBtnRef,
  statsBtnRef,
  treeName,
  treePoints,
  weaponSet1Points,
  weaponSet2Points,
  treeOverLimit,
  changedConditions,
  isCalculating
}: BuildDrawerBarProps) {
  const vi = locale === "vi";
  const hasWeaponSetPoints = weaponSet1Points > 0 || weaponSet2Points > 0;
  const pointsText = `${formatNumber(treePoints, locale)} ${vi ? "điểm" : "pts"}`;
  const weaponSetText = hasWeaponSetPoints ? `I: ${weaponSet1Points} · II: ${weaponSet2Points}` : "";

  return (
    <nav className="nj-drawer-bar poe-no-tooltip" aria-label={vi ? "Chi tiết build" : "Build detail panels"}>
      <button
        ref={treeBtnRef}
        type="button"
        className={`nj-drawer-btn ${activeModal === "tree" ? "is-active" : ""}`}
        onClick={() => onOpenModal("tree")}
        aria-haspopup="dialog"
        aria-expanded={activeModal === "tree"}
      >
        <span className="nj-drawer-icon material-symbols-rounded" aria-hidden="true">account_tree</span>
        <span className="nj-drawer-copy">
          <span className="nj-drawer-title">
            <strong>{vi ? "Cây thụ động" : "Passive tree"}</strong>
            <span className={`nj-drawer-pill ${treeOverLimit ? "is-warn" : ""}`}>
              {treeOverLimit ? (
                <span
                  className="nj-drawer-warn-dot"
                  aria-label={vi ? "Vượt giới hạn điểm" : "Over point limit"}
                  title={vi ? "Số điểm vượt giới hạn" : "Points over limit"}
                />
              ) : null}
              {pointsText}
              {weaponSetText ? <small> · {weaponSetText}</small> : null}
            </span>
          </span>
          {treeName ? <span className="nj-drawer-sub">{treeName}</span> : null}
        </span>
        <span className="nj-drawer-open material-symbols-rounded" aria-hidden="true">open_in_full</span>
      </button>

      <button
        ref={configBtnRef}
        type="button"
        className={`nj-drawer-btn ${activeModal === "config" ? "is-active" : ""}`}
        onClick={() => onOpenModal("config")}
        aria-haspopup="dialog"
        aria-expanded={activeModal === "config"}
      >
        <span className="nj-drawer-icon material-symbols-rounded" aria-hidden="true">tune</span>
        <span className="nj-drawer-copy">
          <span className="nj-drawer-title">
            <strong>{vi ? "Điều kiện" : "Conditions"}</strong>
            <span className={`nj-drawer-pill ${changedConditions > 0 ? "is-accent" : ""}`}>
              {changedConditions > 0
                ? (vi ? `${changedConditions} tuỳ chỉnh` : `${changedConditions} active`)
                : (vi ? "Mặc định" : "Default")}
            </span>
          </span>
          <span className="nj-drawer-sub">
            {vi ? "Boss, trạng thái kẻ địch & buff nhân vật" : "Enemy type, ailments & character buffs"}
          </span>
        </span>
        <span className="nj-drawer-open material-symbols-rounded" aria-hidden="true">open_in_new</span>
      </button>

      <button
        ref={statsBtnRef}
        type="button"
        className={`nj-drawer-btn ${activeModal === "stats" ? "is-active" : ""}`}
        onClick={() => onOpenModal("stats")}
        aria-haspopup="dialog"
        aria-expanded={activeModal === "stats"}
      >
        <span className="nj-drawer-icon material-symbols-rounded" aria-hidden="true">analytics</span>
        <span className="nj-drawer-copy">
          <span className="nj-drawer-title">
            <strong>{vi ? "Chỉ số chi tiết" : "Detailed stats"}</strong>
            {isCalculating ? (
              <span className="nj-drawer-pill is-accent">{vi ? "Đang tính..." : "Calculating..."}</span>
            ) : null}
          </span>
          <span className="nj-drawer-sub">
            {vi ? "Tấn công, phòng thủ, hồi phục & minion (PoB)" : "Offence, defence, recovery & summons (PoB)"}
          </span>
        </span>
        <span className="nj-drawer-open material-symbols-rounded" aria-hidden="true">open_in_new</span>
      </button>
    </nav>
  );
}
