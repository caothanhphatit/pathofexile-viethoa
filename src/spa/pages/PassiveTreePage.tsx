import { useEffect, useMemo, useState } from "react";
import { loadPassiveTreeChanges, loadPassiveTreeData } from "../lib/data";
import { formatNumber, localizedText, type Locale, uiText } from "../lib/locale";
import { matchesQuery } from "../lib/text";
import { TreeCanvas, type CanvasCommand } from "../passive/TreeCanvas";
import {
  CHANGE_COLORS,
  CHANGE_LABELS,
  changeMatchesView,
  changePreview,
  changeTitle,
  changeToPassiveNode,
  parsePassiveTreeChanges,
  type PassiveChangeStatus,
  type PassiveTreeChangeMarker,
  type PassiveTreeChanges
} from "../passive/changes";
import {
  allStartNodeIds,
  allocatePathToNode,
  buildPassiveGraph,
  refundAllocatedNodeIds,
  selectedStartNodeIds,
  syncSelectedStartNodeIds
} from "../passive/planner";
import { filteredTreeNodes, parsePassiveTree, projectNodeForView, type PassiveNode, type PassiveTreeModel } from "../passive/tree";

type ChangeFilter = PassiveChangeStatus | "all";
type PassivePanelMode = "build" | "changes";

const BUILD_PASSIVE_LIMIT = 124;
const BUILD_ASCENDANCY_LIMIT = 8;

const changeFilterRows: { key: ChangeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "added", label: "New" },
  { key: "stats", label: "Stats" },
  { key: "renamed", label: "Rename" },
  { key: "moved", label: "Moved" },
  { key: "removed", label: "Removed" }
];

interface AggregatedStat {
  key: string;
  text: string;
  count: number;
}

function formatPassiveStatText(value: string): string {
  return String(value || "")
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, (_match, key: string, label: string) => label || key)
    .replace(/\[([^\]]*)\]/g, (_match, label: string) => label)
    .replace(/\s+/g, " ")
    .trim();
}

function signedNumber(value: number, forcePlus: boolean): string {
  const rounded = Number(value.toFixed(3));
  return forcePlus && rounded > 0 ? `+${rounded}` : String(rounded);
}

function aggregateNodeStats(nodes: PassiveNode[]): AggregatedStat[] {
  const rows = new Map<string, AggregatedStat & { sum?: number; suffix?: string; tail?: string; forcePlus?: boolean }>();
  for (const node of nodes) {
    for (const rawLine of node.stats) {
      const line = formatPassiveStatText(rawLine);
      if (!line) continue;
      const match = line.match(/^([+-]?\d+(?:\.\d+)?)(%)?\s+(.+)$/);
      const key = match ? `${match[2] || ""}|${match[3]}` : `text|${line}`;
      const current = rows.get(key);
      if (current) {
        current.count += 1;
        if (match && typeof current.sum === "number") {
          current.sum += Number(match[1]);
          current.text = `${signedNumber(current.sum, Boolean(current.forcePlus))}${current.suffix || ""} ${current.tail || ""}`;
        } else if (current.count > 1) {
          current.text = `${line} x${current.count}`;
        }
        continue;
      }
      rows.set(key, match ? {
        key,
        text: line,
        count: 1,
        sum: Number(match[1]),
        suffix: match[2] || "",
        tail: match[3],
        forcePlus: match[1].startsWith("+")
      } : {
        key,
        text: line,
        count: 1
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).map(({ key, text, count }) => ({ key, text, count }));
}

function buildCountsForIds(ids: Iterable<string>, selectedStartIds: Set<string>, nodeById: Map<string, PassiveNode>) {
  let passive = 0;
  let ascendancy = 0;
  for (const id of ids) {
    if (selectedStartIds.has(id)) continue;
    const node = nodeById.get(id);
    if (!node) continue;
    if (node.ascendancyName) ascendancy += 1;
    else passive += 1;
  }
  return { passive, ascendancy, total: passive + ascendancy };
}

const passiveCopy = {
  build: { vi: "Build", en: "Build" },
  class: { vi: "Class", en: "Class" },
  ascendancy: { vi: "Ascendancy", en: "Ascendancy" },
  all: { vi: "All", en: "All" },
  baseTree: { vi: "Base tree", en: "Base tree" },
  search: { vi: "Search node/stat...", en: "Search node/stat..." },
  treeChanges: { vi: "Tree changes", en: "Tree changes" },
  highlight: { vi: "Highlight 0.5 changes", en: "Highlight 0.5 changes" },
  officialUpdates: { vi: "node updates from official export", en: "node updates from official export" },
  buildSummary: { vi: "Build summary", en: "Build summary" },
  statSummary: { vi: "Stat summary", en: "Stat summary" },
  visibleNodes: { vi: "visible", en: "visible" },
  passives: { vi: "passives", en: "passives" },
  ascendancyPoints: { vi: "ascendancy", en: "ascendancy" },
  noSelectedNodes: { vi: "Chưa chọn node nào", en: "No selected nodes" },
  buildLimitReached: { vi: "Build đã chạm giới hạn điểm", en: "Build point limit reached" },
  selectedPassives: { vi: "selected passives", en: "selected passives" },
  allClasses: { vi: "All classes", en: "All classes" },
  noAscendancy: { vi: "No ascendancy filter", en: "No ascendancy filter" },
  clearBuild: { vi: "Clear build", en: "Clear build" }
};

export function PassiveTreePage({ locale }: { locale: Locale }) {
  const [tree, setTree] = useState<PassiveTreeModel | null>(null);
  const [changes, setChanges] = useState<PassiveTreeChanges | null>(null);
  const [error, setError] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [ascendancyFilter, setAscendancyFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeMode, setActiveMode] = useState<PassivePanelMode>("build");
  const [buildPanelCollapsed, setBuildPanelCollapsed] = useState(false);
  const [changesPanelCollapsed, setChangesPanelCollapsed] = useState(false);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
  const [allocatedIds, setAllocatedIds] = useState<Set<string>>(() => new Set());
  const [buildLimitWarning, setBuildLimitWarning] = useState("");
  const [hover, setHover] = useState<{ node: PassiveNode | null; x: number; y: number; held: boolean }>({ node: null, x: 0, y: 0, held: false });
  const [command, setCommand] = useState<CanvasCommand | null>(null);

  useEffect(() => {
    let alive = true;
    loadPassiveTreeData().then((raw) => {
      if (!alive) return;
      const parsed = parsePassiveTree(raw, locale);
      const initialClass = parsed.classes[0] || "";
      const initialAscendancy = initialClass ? parsed.classByName.get(initialClass)?.ascendancies[0]?.name || "" : "";
      setTree(parsed);
      setClassFilter((current) => current || initialClass);
      setAscendancyFilter((current) => current || initialAscendancy);
    }).catch((err: Error) => {
      if (alive) setError(err.message);
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  useEffect(() => {
    let alive = true;
    loadPassiveTreeChanges().then((raw) => {
      if (alive) setChanges(parsePassiveTreeChanges(raw));
    }).catch(() => {
      if (alive) setChanges(null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const effectiveChangesOn = Boolean(changes && activeMode === "changes");
  const allocationEnabled = activeMode === "build" && !effectiveChangesOn;

  const visibleSearchIds = useMemo(() => {
    if (!tree || !search.trim()) return new Set<string>();
    const rows = filteredTreeNodes(tree, classFilter, ascendancyFilter);
    return new Set(rows.filter((node) => matchesQuery(node, search, ["name", "stats", "type", "ascendancyName"])).map((node) => node.id));
  }, [tree, search, classFilter, ascendancyFilter]);

  const visibleNodeIds = useMemo(() => {
    if (!tree) return new Set<string>();
    const rows = filteredTreeNodes(tree, classFilter, ascendancyFilter);
    return new Set(rows.map((node) => node.id));
  }, [tree, classFilter, ascendancyFilter]);

  const targetNodeById = useMemo(() => {
    const rows = new Map<string, PassiveNode>();
    if (!tree) return rows;
    for (const node of filteredTreeNodes(tree, classFilter, ascendancyFilter)) {
      rows.set(node.id, node);
    }
    return rows;
  }, [tree, classFilter, ascendancyFilter]);

  const graphByNodeId = useMemo(() => {
    if (!tree) return new Map<string, string[]>();
    return buildPassiveGraph(tree);
  }, [tree]);
  const selectedStartIds = useMemo(() => tree ? selectedStartNodeIds(tree, classFilter, ascendancyFilter) : new Set<string>(), [tree, classFilter, ascendancyFilter]);
  const startIds = useMemo(() => tree ? allStartNodeIds(tree) : new Set<string>(), [tree]);
  const selectedBuildNodes = useMemo(() => {
    return [...allocatedIds]
      .filter((id) => !selectedStartIds.has(id))
      .map((id) => targetNodeById.get(id) || tree?.nodeById.get(id))
      .filter((node): node is PassiveNode => Boolean(node));
  }, [allocatedIds, selectedStartIds, targetNodeById, tree]);
  const buildCounts = useMemo(() => buildCountsForIds(allocatedIds, selectedStartIds, targetNodeById), [allocatedIds, selectedStartIds, targetNodeById]);
  const buildStatRows = useMemo(() => aggregateNodeStats(selectedBuildNodes), [selectedBuildNodes]);
  const buildLimitExceeded = buildCounts.passive > BUILD_PASSIVE_LIMIT || buildCounts.ascendancy > BUILD_ASCENDANCY_LIMIT;
  const visibleNodeCount = visibleNodeIds.size;
  const displayAllocatedIds = useMemo(() => effectiveChangesOn ? new Set<string>() : allocatedIds, [effectiveChangesOn, allocatedIds]);

  useEffect(() => {
    if (!tree) return;
    setAllocatedIds((current) => syncSelectedStartNodeIds(current, selectedStartIds, startIds));
  }, [tree, selectedStartIds, startIds]);

  const filteredChanges = useMemo(() => {
    if (!changes) return [];
    return changes.entries.filter((entry) => {
      if (changeFilter !== "all" && entry.status !== changeFilter) return false;
      if (classFilter && entry.className && entry.className !== classFilter) return false;
      if (ascendancyFilter && entry.ascendancyName && entry.ascendancyName !== ascendancyFilter) return false;
      return true;
    });
  }, [changes, changeFilter, classFilter, ascendancyFilter]);

  const changeRows = useMemo(() => filteredChanges.slice(0, 36), [filteredChanges]);

  const filteredAscendancies = useMemo(() => {
    if (!tree) return [];
    if (!classFilter) return tree.ascendancies;
    return tree.classByName.get(classFilter)?.ascendancies.map((asc) => asc.name) ?? [];
  }, [tree, classFilter]);

  const selectClass = (name: string) => {
    setBuildLimitWarning("");
    setClassFilter(name);
    const nextAscendancy = name ? tree?.classByName.get(name)?.ascendancies[0]?.name || "" : "";
    setAscendancyFilter(nextAscendancy);
    if (tree) {
      const nextStarts = selectedStartNodeIds(tree, name, nextAscendancy);
      setAllocatedIds(syncSelectedStartNodeIds(new Set(), nextStarts, allStartNodeIds(tree)));
    }
  };

  const selectAscendancy = (name: string) => {
    setBuildLimitWarning("");
    setAscendancyFilter(name);
    if (tree) {
      const nextStarts = selectedStartNodeIds(tree, classFilter, name);
      setAllocatedIds((current) => syncSelectedStartNodeIds(current, nextStarts, startIds));
    }
  };

  const toggleAllocated = (node: PassiveNode) => {
    if (!allocationEnabled) return;
    setAllocatedIds((current) => {
      const seeded = syncSelectedStartNodeIds(current, selectedStartIds, startIds);
      if (seeded.has(node.id) && !selectedStartIds.has(node.id)) {
        setBuildLimitWarning("");
        return refundAllocatedNodeIds({
          targetId: node.id,
          allocatedIds: seeded,
          startNodeIds: selectedStartIds,
          graphByNodeId,
          visibleNodeIds
        });
      }
      const next = allocatePathToNode({
        targetId: node.id,
        allocatedIds: seeded,
        startNodeIds: selectedStartIds,
        graphByNodeId,
        visibleNodeIds
      });
      const counts = buildCountsForIds(next, selectedStartIds, targetNodeById);
      if (counts.passive > BUILD_PASSIVE_LIMIT || counts.ascendancy > BUILD_ASCENDANCY_LIMIT) {
        setBuildLimitWarning(localizedText(passiveCopy.buildLimitReached, "", locale));
        return seeded;
      }
      setBuildLimitWarning("");
      return next;
    });
  };

  const runCommand = (type: CanvasCommand["type"], target?: Pick<CanvasCommand, "x" | "y" | "zoom">) => setCommand({ type, nonce: Date.now(), ...target });

  const focusChange = (change: PassiveTreeChangeMarker) => {
    if (!tree) return;
    const node = tree.nodeById.get(change.id);
    const target = node ? projectNodeForView(tree, node, classFilter, ascendancyFilter) : projectNodeForView(tree, changeToPassiveNode(change), classFilter, ascendancyFilter);
    runCommand("focus", {
      x: target.x,
      y: target.y,
      zoom: node?.type.includes("small") ? 0.34 : 0.24
    });
  };

  if (error) return <main className="passive-route"><div className="error-panel">{error}</div></main>;
  if (!tree) return <main className="passive-route"><div className="loading-panel">{uiText("loadingPassiveTree", locale)}</div></main>;

  const hoverChange = effectiveChangesOn && hover.node ? changes?.byId.get(hover.node.id) : undefined;
  const totalChanges = changes ? changes.counts.added + changes.counts.removed + changes.counts.stats + changes.counts.renamed + changes.counts.moved : 0;
  const allocatedBuildCount = buildCounts.total;
  const showChangesPanel = activeMode === "changes" && effectiveChangesOn && changes;

  return (
    <main className="passive-route">
      <div className="passive-toolbar">
        <div className="passive-mode-tabs" role="tablist" aria-label="Passive tree mode">
          <button className={`${activeMode === "build" ? "is-active" : ""} ${buildLimitWarning || buildLimitExceeded ? "is-danger" : ""}`} type="button" onClick={() => setActiveMode("build")} aria-pressed={activeMode === "build"}>
            <span className="material-symbols-rounded" aria-hidden="true">summarize</span>
            <span>{localizedText(passiveCopy.build, "", locale)}</span>
            <strong>{formatNumber(allocatedBuildCount, locale)}</strong>
          </button>
          <button className={activeMode === "changes" ? "is-active" : ""} type="button" onClick={() => setActiveMode("changes")} aria-pressed={activeMode === "changes"} disabled={!changes}>
            <span className="material-symbols-rounded" aria-hidden="true">change_circle</span>
            <span>Change 0.4</span>
          </button>
        </div>
        <label>
          <span>{localizedText(passiveCopy.class, "", locale)}</span>
          <select value={classFilter} onChange={(event) => selectClass(event.target.value)} aria-label="classFilter">
            <option value="">{localizedText(passiveCopy.all, "", locale)}</option>
            {tree.classes.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>{localizedText(passiveCopy.ascendancy, "", locale)}</span>
          <select value={ascendancyFilter} onChange={(event) => selectAscendancy(event.target.value)} aria-label="ascendancyFilter">
            <option value="">{localizedText(passiveCopy.baseTree, "", locale)}{classFilter ? `: ${classFilter}` : ""}</option>
            {filteredAscendancies.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="passive-search">
          <span className="material-symbols-rounded" aria-hidden="true">search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={localizedText(passiveCopy.search, "", locale)} aria-label="search" />
        </label>
        <button className="passive-action" type="button" onClick={() => runCommand("fit")} title="Fit map" aria-label="Fit map">
          <span className="material-symbols-rounded" aria-hidden="true">fit_screen</span>
          <span>Fit</span>
        </button>
        <button className="passive-action" type="button" onClick={() => runCommand("reset")} title="Reset view" aria-label="Reset view">
          <span className="material-symbols-rounded" aria-hidden="true">center_focus_strong</span>
          <span>Reset</span>
        </button>
      </div>
      <div className="passive-stage">
        <TreeCanvas
          tree={tree}
          searchIds={visibleSearchIds}
          allocatedIds={displayAllocatedIds}
          changeEntries={filteredChanges}
          changesOn={effectiveChangesOn}
          allocationEnabled={allocationEnabled}
          classFilter={classFilter}
          ascendancyFilter={ascendancyFilter}
          command={command}
          onHover={(node, x, y, held) => setHover({ node, x, y, held })}
          onToggle={toggleAllocated}
        />
        {showChangesPanel ? (
          <aside className={`passive-changes-panel passive-side-panel ${changesPanelCollapsed ? "is-collapsed" : ""}`}>
            {changesPanelCollapsed ? (
              <button className="passive-panel-rail" type="button" onClick={() => setChangesPanelCollapsed(false)} aria-label="Show changes panel" title="Show changes panel">
                <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                <strong>Changes</strong>
                <small>{formatNumber(totalChanges, locale)}</small>
              </button>
            ) : (
              <>
                <div className="passive-panel-title">
                  <span className="material-symbols-rounded" aria-hidden="true">published_with_changes</span>
                  <div>
                    <h2>{localizedText(passiveCopy.treeChanges, "", locale)}</h2>
                    <p>{changes.baseVersion} -&gt; {changes.targetVersion}</p>
                  </div>
                  <div className="passive-panel-actions">
                    <button className="passive-panel-collapse" type="button" onClick={() => setChangesPanelCollapsed(true)} aria-label="Hide changes panel" title="Hide panel">
                      <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                    </button>
                  </div>
                </div>
                <div className="passive-change-tabs" aria-label="Passive change filters">
                  {changeFilterRows.map((row) => {
                    const count = row.key === "all" ? totalChanges : changes.counts[row.key] ?? 0;
                    return (
                      <button key={row.key} className={changeFilter === row.key ? "is-active" : ""} type="button" onClick={() => setChangeFilter(row.key)}>
                        <span>{row.label}</span>
                        <strong>{formatNumber(count, locale)}</strong>
                      </button>
                    );
                  })}
                </div>
                <div className="passive-change-list">
                  {changeRows.map((change) => (
                    <button key={`${change.status}:${change.id}`} className="passive-change-row" type="button" onClick={() => focusChange(change)}>
                      <span className="passive-change-dot" style={{ color: CHANGE_COLORS[change.status] }} aria-hidden="true" />
                      <span>
                        <strong translate="no">{changeTitle(change)}</strong>
                        <small>{CHANGE_LABELS[change.status]} - {change.ascendancyName || change.className || "Passive tree"}</small>
                        <em>{changePreview(change)}</em>
                      </span>
                      <span className="material-symbols-rounded" aria-hidden="true">my_location</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>
        ) : null}
        {activeMode === "build" ? (
          <aside className={`passive-build-panel passive-side-panel ${buildLimitExceeded ? "is-danger" : ""} ${buildPanelCollapsed ? "is-collapsed" : ""}`}>
            {buildPanelCollapsed ? (
              <button className="passive-panel-rail" type="button" onClick={() => setBuildPanelCollapsed(false)} aria-label="Show build summary" title="Show build summary">
                <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                <strong>Build</strong>
                <small>{formatNumber(allocatedBuildCount, locale)}</small>
              </button>
            ) : (
              <>
                <div className="passive-panel-title">
                  <span className="material-symbols-rounded" aria-hidden="true">summarize</span>
                  <div>
                    <h2>{localizedText(passiveCopy.buildSummary, "", locale)}</h2>
                    <p>{formatNumber(visibleNodeCount, locale)} {localizedText(passiveCopy.visibleNodes, "", locale)}</p>
                  </div>
                  <div className="passive-panel-actions">
                    <button className="passive-build-clear" type="button" onClick={() => {
                      setBuildLimitWarning("");
                      setAllocatedIds(syncSelectedStartNodeIds(new Set(), selectedStartIds, startIds));
                    }} title={localizedText(passiveCopy.clearBuild, "", locale)} aria-label={localizedText(passiveCopy.clearBuild, "", locale)}>
                      <span className="material-symbols-rounded" aria-hidden="true">delete_sweep</span>
                      <span>Clear</span>
                    </button>
                    <button className="passive-panel-collapse" type="button" onClick={() => setBuildPanelCollapsed(true)} aria-label="Hide build summary" title="Hide panel">
                      <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                    </button>
                  </div>
                </div>
                <div className="passive-build-meters">
                  <span className={buildCounts.passive >= BUILD_PASSIVE_LIMIT ? "is-danger" : ""}><strong>{formatNumber(buildCounts.passive, locale)}</strong>/{BUILD_PASSIVE_LIMIT} {localizedText(passiveCopy.passives, "", locale)}</span>
                  <span className={buildCounts.ascendancy >= BUILD_ASCENDANCY_LIMIT ? "is-danger" : ""}><strong>{formatNumber(buildCounts.ascendancy, locale)}</strong>/{BUILD_ASCENDANCY_LIMIT} {localizedText(passiveCopy.ascendancyPoints, "", locale)}</span>
                </div>
                {buildLimitWarning ? <p className="passive-build-warning">{buildLimitWarning}</p> : null}
                <div className="passive-build-section">
                  <h3>{localizedText(passiveCopy.statSummary, "", locale)}</h3>
                  <div className="passive-stat-list">
                    {buildStatRows.length ? buildStatRows.slice(0, 24).map((row) => (
                      <div key={row.key} className="passive-stat-row">
                        <span>{row.text}</span>
                        {row.count > 1 ? <strong>x{formatNumber(row.count, locale)}</strong> : null}
                      </div>
                    )) : <p>{localizedText(passiveCopy.noSelectedNodes, "", locale)}</p>}
                  </div>
                </div>
              </>
            )}
          </aside>
        ) : null}
        {hover.node ? (
          <div className={`passive-tooltip ${hover.held ? "is-held" : ""}`} style={{ left: Math.min(hover.x + 18, window.innerWidth - 380), top: Math.min(hover.y + 18, window.innerHeight - 220) }}>
            <strong translate="no">{hover.node.name || `Node ${hover.node.id}`}</strong>
            <span>{hover.node.type}</span>
            {hover.node.stats.slice(0, 5).map((line) => <p key={line}>{formatPassiveStatText(line)}</p>)}
            {hoverChange ? (
              <div className="passive-tooltip__change">
                <b style={{ color: CHANGE_COLORS[hoverChange.status] }}>{CHANGE_LABELS[hoverChange.status]}</b>
                {hoverChange.oldStats.slice(0, 3).map((line) => <del key={`old:${line}`}>{formatPassiveStatText(line)}</del>)}
                {hoverChange.newStats.slice(0, 3).map((line) => <ins key={`new:${line}`}>{formatPassiveStatText(line)}</ins>)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
