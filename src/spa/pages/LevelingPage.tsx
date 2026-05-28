import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { loadLevelingData } from "../lib/data";
import { formatNumber, type Locale, uiText } from "../lib/locale";
import { asArray, cleanText, stripMarkup } from "../lib/text";

type ActKey = "all" | "act1" | "act2" | "act3" | "act4" | "interlude";
type TaskFilter = "all" | "required" | "reward" | "boss" | "optional" | "tip";

interface LevelingBadge {
  text?: string;
  tone?: string;
}

interface LevelingTask {
  id?: string;
  text?: string;
  note?: string;
  required?: boolean;
  tip?: boolean;
  badges?: LevelingBadge[];
}

interface LevelingZone {
  id?: string;
  act?: string;
  title?: string;
  level?: string;
  meta?: string;
  tasks?: LevelingTask[];
}

interface OverlayPosition {
  left: number;
  top: number;
}

const STORAGE_KEY = "poe2-leveling-v1-progress";
const OVERLAY_POSITION_KEY = "poe2-leveling-overlay-position-v1";

const actRows: { key: ActKey; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "act1", label: "Act I" },
  { key: "act2", label: "Act II" },
  { key: "act3", label: "Act III" },
  { key: "act4", label: "Act IV" },
  { key: "interlude", label: "Interlude" }
];

const taskFilterRows: { key: TaskFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "required", label: "Bắt buộc" },
  { key: "reward", label: "Thưởng" },
  { key: "boss", label: "Boss" },
  { key: "optional", label: "Tùy chọn" },
  { key: "tip", label: "Mẹo" }
];

const normalizeAct = (zone: LevelingZone): Exclude<ActKey, "all"> => {
  const act = cleanText(zone.act).toLowerCase();
  if (act === "act2" || act === "act3" || act === "act4" || act === "interlude") return act;
  return "act1";
};

const taskKey = (task: LevelingTask, fallback = 0): string => cleanText(task.id) || `task-${fallback}`;

const safeTaskHtml = (value: unknown): string =>
  cleanText(value)
    .replace(/<(?!\/?(strong|em|b|i|br)\b)[^>]*>/gi, "")
    .replace(/<(strong|em|b|i)\b[^>]*>/gi, "<$1>")
    .replace(/<br\b[^>]*>/gi, "<br>");

const badgeText = (task: LevelingTask): string =>
  asArray<LevelingBadge>(task.badges).map((badge) => cleanText(badge.text).toLowerCase()).join(" ");

const isBossTask = (task: LevelingTask): boolean =>
  /giết\s+<strong>/i.test(cleanText(task.text)) || badgeText(task).includes("boss");

const isRewardTask = (task: LevelingTask): boolean =>
  /skill|support|spirit|maximum life|max mana|maximum mana|cold res|fire res|lightning res|resistance|salvage|ring|rune|orb|flask|lute|ascendancy|boon|jewel|unique|fragment|torn map|hideout|trading|tattoo|regal|verisium|jeweller/.test(badgeText(task));

const taskMatchesFilter = (task: LevelingTask, filter: TaskFilter): boolean => {
  if (filter === "required") return Boolean(task.required);
  if (filter === "reward") return isRewardTask(task);
  if (filter === "boss") return isBossTask(task);
  if (filter === "optional") return !task.required && !task.tip;
  if (filter === "tip") return Boolean(task.tip);
  return true;
};

const badgeClass = (tone = "") => `badge badge-${cleanText(tone).toLowerCase() || "slate"}`;

function readProgress(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeProgress(value: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...value]));
  } catch {
    // Keep the current in-memory checklist state if storage is blocked.
  }
}

function readOverlayPosition(): OverlayPosition | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(OVERLAY_POSITION_KEY) || "null");
    if (!parsed || typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeOverlayPosition(value: OverlayPosition): void {
  try {
    localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify(value));
  } catch {
    // Drag position is optional.
  }
}

function clampOverlayPosition(left: number, top: number, element: HTMLElement): OverlayPosition {
  const maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop)
  };
}

export function LevelingPage({ locale }: { locale: Locale }) {
  const [zones, setZones] = useState<LevelingZone[]>([]);
  const [error, setError] = useState("");
  const [activeAct, setActiveAct] = useState<ActKey>("all");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [hideDone, setHideDone] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(() => readOverlayPosition());
  const [pipRoot, setPipRoot] = useState<HTMLElement | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(() => readProgress());
  const overlayRef = useRef<HTMLDivElement>(null);
  const pipWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    let alive = true;
    loadLevelingData().then((data) => {
      if (alive) setZones(asArray<LevelingZone>(data));
    }).catch((err: Error) => {
      if (alive) setError(err.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    writeProgress(completed);
  }, [completed]);

  useEffect(() => {
    if (!overlayOpen || !overlayRef.current || !overlayPosition) return;
    const next = clampOverlayPosition(overlayPosition.left, overlayPosition.top, overlayRef.current);
    if (next.left !== overlayPosition.left || next.top !== overlayPosition.top) {
      setOverlayPosition(next);
      writeOverlayPosition(next);
    }
  }, [overlayOpen]);

  useEffect(() => {
    if (!overlayOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGameOverlay();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [overlayOpen]);

  useEffect(() => () => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) pipWindowRef.current.close();
  }, []);

  const rows = useMemo(() => zones.flatMap((zone) => asArray<LevelingTask>(zone.tasks).map((task, index) => ({
    zone,
    task,
    index,
    id: taskKey(task, index),
    act: normalizeAct(zone)
  }))), [zones]);

  const scopedRows = rows.filter((row) => activeAct === "all" || row.act === activeAct);
  const visibleRows = scopedRows.filter((row) => taskMatchesFilter(row.task, taskFilter));
  const doneCount = scopedRows.filter((row) => !row.task.tip && completed.has(row.id)).length;
  const totalCount = scopedRows.filter((row) => !row.task.tip).length;
  const requiredCount = scopedRows.filter((row) => row.task.required).length;
  const percent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const nextRow = scopedRows.find((row) => !row.task.tip && taskMatchesFilter(row.task, taskFilter) && !completed.has(row.id));
  const overlayBaseRows = scopedRows.filter((row) => !row.task.tip);
  const nextOpenIndex = overlayBaseRows.findIndex((row) => !completed.has(row.id));
  const overlayCurrentIndex = nextOpenIndex >= 0 ? nextOpenIndex : overlayBaseRows.length;
  const overlayRows = [-1, 0, 1, 2, 3].map((offset) => overlayBaseRows[overlayCurrentIndex + offset] || null);

  const visibleZones = zones.map((zone) => {
    const act = normalizeAct(zone);
    const tasks = asArray<LevelingTask>(zone.tasks).map((task, index) => ({
      task,
      index,
      id: taskKey(task, index),
      act
    })).filter((row) => {
      if (activeAct !== "all" && row.act !== activeAct) return false;
      if (!taskMatchesFilter(row.task, taskFilter)) return false;
      if (hideDone && !row.task.tip && completed.has(row.id)) return false;
      return true;
    });
    return { zone, act, tasks };
  }).filter((row) => row.tasks.length);

  const toggleTask = (id: string) => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRequiredInZone = (zone: LevelingZone, checked: boolean) => {
    setCompleted((current) => {
      const next = new Set(current);
      asArray<LevelingTask>(zone.tasks).forEach((task, index) => {
        if (!task.required) return;
        const id = taskKey(task, index);
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const goNext = () => {
    if (!nextRow) return;
    if (activeAct === "all") setActiveAct(nextRow.act);
    requestAnimationFrame(() => {
      document.getElementById(nextRow.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const revealTask = (id: string, act: Exclude<ActKey, "all">) => {
    if (activeAct === "all") setActiveAct(act);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const startOverlayDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, select, label")) return;
    const panel = overlayRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = clampOverlayPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, panel);
      setOverlayPosition(next);
    };
    const stop = () => {
      const finalRect = panel.getBoundingClientRect();
      const next = clampOverlayPosition(finalRect.left, finalRect.top, panel);
      setOverlayPosition(next);
      writeOverlayPosition(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };

    event.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const overlayStyle = overlayPosition
    ? { left: `${overlayPosition.left}px`, top: `${overlayPosition.top}px`, right: "auto", bottom: "auto" }
    : undefined;

  const closeGameOverlay = () => {
    setOverlayOpen(false);
    setPipRoot(null);
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
    }
    pipWindowRef.current = null;
  };

  const openGameOverlay = async () => {
    const pipApi = (window as any).documentPictureInPicture;
    if (pipApi?.requestWindow) {
      try {
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          pipWindowRef.current.focus();
          return;
        }
        const pipWindow = await pipApi.requestWindow({ width: 260, height: 190 });
        pipWindow.document.head.innerHTML = "<title>POE2 Checklist Overlay</title>";
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
          pipWindow.document.head.appendChild(node.cloneNode(true));
        });
        pipWindow.document.documentElement.classList.toggle("dark", document.documentElement.classList.contains("dark"));
        pipWindow.document.body.style.margin = "0";
        const root = pipWindow.document.createElement("div");
        pipWindow.document.body.appendChild(root);
        pipWindowRef.current = pipWindow;
        setPipRoot(root);
        setOverlayOpen(false);
        pipWindow.addEventListener("pagehide", () => {
          pipWindowRef.current = null;
          setPipRoot(null);
        });
        return;
      } catch {
        setOverlayOpen(true);
        return;
      }
    }

    setOverlayOpen(true);
  };

  const renderOverlayInner = (mode: "page" | "pip") => (
    <div className="game-overlay-inner" onPointerDown={mode === "page" ? startOverlayDrag : undefined}>
      {mode === "page" ? (
        <button className="game-overlay-close" type="button" onClick={closeGameOverlay} title="Đóng overlay" aria-label="Đóng overlay">
          <span className="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      ) : null}
      <div className="game-overlay-list">
        {overlayRows.map((row, slotIndex) => {
          const isCurrent = slotIndex === 1;
          if (!row) return <div className="game-overlay-task is-empty" key={`overlay:${mode}:empty:${slotIndex}`} />;
          const done = completed.has(row.id);
          return (
            <div className={`game-overlay-task ${done ? "is-complete" : ""} ${isCurrent ? "is-current" : ""}`} key={`overlay:${mode}:${row.id}`}>
              <input className="game-overlay-check" checked={done} id={`overlay-${mode}-${row.id}`} type="checkbox" onChange={() => toggleTask(row.id)} />
              <label className="game-overlay-task-body" htmlFor={`overlay-${mode}-${row.id}`}>
                <span className="game-overlay-task-title" dangerouslySetInnerHTML={{ __html: safeTaskHtml(row.task.text) }} />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (error) return <main className="page-shell"><div className="error-panel">{error}</div></main>;
  if (!zones.length) return <main className="page-shell"><div className="loading-panel">{uiText("loadingChecklist", locale)}</div></main>;

  return (
    <main className="leveling-v1-shell">
      <section className="leveling-v1-panel" id="route-checklist">
        <div className="leveling-v1-act-panel">
          <div className="leveling-v1-panel-head">
            <div>
              <p>Chọn act</p>
              <h1>Task nhỏ theo từng zone</h1>
            </div>
            <span>Act 1-4 + Interlude</span>
          </div>
          <div className="leveling-v1-act-grid">
            {actRows.map((row) => (
              <button key={row.key} className={`filter-button ${activeAct === row.key ? "is-active" : ""}`} type="button" onClick={() => setActiveAct(row.key)}>
                {row.label}
              </button>
            ))}
          </div>
        </div>

        <div className="leveling-v1-layout">
          <aside className="leveling-v1-sidebar">
            <p className="leveling-v1-sidebar-title">Theo dõi route</p>
            <div className="leveling-v1-stats">
              <div>
                <p>Task</p>
                <strong>{formatNumber(totalCount, locale)}</strong>
              </div>
              <div>
                <p>Xong</p>
                <strong>{formatNumber(doneCount, locale)}</strong>
              </div>
            </div>
            <p className="leveling-v1-required">Route bắt buộc: <span>{formatNumber(requiredCount, locale)}</span> task</p>
            <div className="leveling-v1-progress">
              <div>
                <strong>{formatNumber(doneCount, locale)}/{formatNumber(totalCount, locale)} task đã xong</strong>
                <span>{percent}%</span>
              </div>
              <i><b style={{ width: `${percent}%` }} /></i>
            </div>
            <div className="leveling-v1-actions">
              <button className="leveling-v1-next" type="button" onClick={goNext} disabled={!nextRow}>
                <span className="material-symbols-rounded" aria-hidden="true">flag</span>
                <span>{nextRow ? `Đi tiếp: ${stripMarkup(nextRow.task.text)}` : "Hoàn tất campaign"}</span>
              </button>
              <label className="leveling-v1-toggle">
                <span>Ẩn task xong</span>
                <input className="task-checkbox" checked={hideDone} type="checkbox" onChange={(event) => setHideDone(event.target.checked)} />
              </label>
              <div className="leveling-v1-filter-box">
                <p>Hiển thị</p>
                <div>
                  {taskFilterRows.map((row) => (
                    <button key={row.key} className={`filter-button ${taskFilter === row.key ? "is-active" : ""}`} type="button" onClick={() => setTaskFilter(row.key)}>
                      {row.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="leveling-v1-overlay" type="button" onClick={openGameOverlay}>
                <span className="material-symbols-rounded" aria-hidden="true">picture_in_picture_alt</span>
                <span>Mở overlay chơi game</span>
              </button>
              <button className="leveling-v1-reset" type="button" onClick={() => setCompleted(new Set())} disabled={!completed.size}>
                <span className="material-symbols-rounded" aria-hidden="true">restart_alt</span>
                <span>Reset</span>
              </button>
            </div>
            <div className="leveling-v1-jump">
              <p>Nhảy nhanh</p>
              <div>
                {zones.filter((zone) => activeAct === "all" || normalizeAct(zone) === activeAct).map((zone) => (
                  <a key={zone.id || zone.title} href={`#${zone.id}`} onClick={() => setActiveAct(normalizeAct(zone))}>
                    {actRows.find((row) => row.key === normalizeAct(zone))?.label} - {zone.title}
                  </a>
                ))}
              </div>
            </div>
          </aside>

          <div className="leveling-v1-task-list">
            {visibleZones.map(({ zone, act, tasks }) => {
              const requiredTasks = asArray<LevelingTask>(zone.tasks).map((task, index) => ({ task, id: taskKey(task, index) })).filter((row) => row.task.required);
              const requiredDone = requiredTasks.length > 0 && requiredTasks.every((row) => completed.has(row.id));
              const zoneTasks = asArray<LevelingTask>(zone.tasks).map((task, index) => ({ task, id: taskKey(task, index) })).filter((row) => !row.task.tip);
              const zoneComplete = zoneTasks.length > 0 && zoneTasks.every((row) => completed.has(row.id));
              return (
                <section className={`task-zone ${zoneComplete ? "is-complete" : ""}`} data-act={act} data-zone={zone.id} id={zone.id} key={zone.id || zone.title}>
                  <div className="task-zone-header">
                    <div>
                      <div className="leveling-v1-zone-title-row">
                        <h3 className="task-zone-title">{zone.title}</h3>
                        <span className="badge badge-violet">{actRows.find((row) => row.key === act)?.label}</span>
                        {zone.meta ? <span className="badge badge-violet">{zone.meta}</span> : null}
                        {zone.level ? <span className="badge badge-amber">{zone.level}</span> : null}
                      </div>
                    </div>
                    <label className="zone-actions">
                      <input className="task-checkbox zone-required-toggle" checked={requiredDone} type="checkbox" onChange={(event) => toggleRequiredInZone(zone, event.target.checked)} />
                      <span>tick bắt buộc</span>
                    </label>
                  </div>
                  <div className="task-list">
                    {tasks.map(({ task, index, id }) => {
                      const done = completed.has(id);
                      const badges = [
                        ...(task.required ? [{ text: "bắt buộc", tone: "amber" }] : []),
                        ...asArray<LevelingBadge>(task.badges)
                      ];
                      if (task.tip) {
                        return (
                          <div className="task-row task-info-row" data-act={act} id={id} key={id}>
                            <span className="material-symbols-rounded task-info-icon" aria-hidden="true">info</span>
                            <span className="task-main">
                              <span className="task-title" dangerouslySetInnerHTML={{ __html: safeTaskHtml(task.text) }} />
                              {task.note ? <span className="task-note">{stripMarkup(task.note)}</span> : null}
                            </span>
                            <span className="task-badges">
                              {badges.map((badge, badgeIndex) => <span className={badgeClass(badge.tone)} key={`${id}:${badgeIndex}`}>{badge.text}</span>)}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div className={`task-row ${done ? "is-complete" : ""}`} data-act={act} id={id} key={id}>
                          <input
                            checked={done}
                            className="task-checkbox leveling-checkbox"
                            data-act={act}
                            data-boss={isBossTask(task)}
                            data-optional={!task.required && !task.tip}
                            data-required={Boolean(task.required)}
                            data-reward={isRewardTask(task)}
                            data-tip={Boolean(task.tip)}
                            data-zone={zone.id}
                            id={`check-${id}`}
                            type="checkbox"
                            value={id}
                            onChange={() => toggleTask(id)}
                          />
                          <label className="task-main" htmlFor={`check-${id}`}>
                            <span className="task-title" dangerouslySetInnerHTML={{ __html: safeTaskHtml(task.text) }} />
                            {task.note ? <span className="task-note">{stripMarkup(task.note)}</span> : null}
                          </label>
                          <span className="task-badges">
                            {badges.map((badge, badgeIndex) => <span className={badgeClass(badge.tone)} key={`${id}:${badgeIndex}`}>{badge.text}</span>)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {!visibleRows.length ? <div className="leveling-v1-empty">Không có task khớp filter.</div> : null}
          </div>
        </div>
      </section>
      <div className={`game-overlay ${overlayOpen ? "is-open" : ""}`} aria-hidden={!overlayOpen} ref={overlayRef} style={overlayStyle}>
        <section className="game-overlay-card" aria-label="Checklist overlay">
          {renderOverlayInner("page")}
        </section>
      </div>
      {pipRoot ? createPortal(
        <section className="game-overlay-card game-overlay-card--pip" aria-label="Checklist overlay">
          {renderOverlayInner("pip")}
        </section>,
        pipRoot
      ) : null}
    </main>
  );
}
