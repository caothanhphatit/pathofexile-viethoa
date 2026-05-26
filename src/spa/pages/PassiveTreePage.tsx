import { useEffect, useMemo, useState } from "react";
import { loadPassiveTreeChanges, loadPassiveTreeData } from "../lib/data";
import { formatNumber, localizedText, type Locale, uiText } from "../lib/locale";
import { matchesQuery } from "../lib/text";
import { TreeCanvas, type CanvasCommand } from "../passive/TreeCanvas";
import {
  CHANGE_COLORS,
  CHANGE_LABELS,
  changePreview,
  changeTitle,
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

const changeFilterRows: { key: ChangeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "added", label: "New" },
  { key: "stats", label: "Stats" },
  { key: "renamed", label: "Rename" },
  { key: "removed", label: "Removed" }
];

const passiveCopy = {
  allocated: { vi: "allocated", en: "allocated" },
  class: { vi: "Class", en: "Class" },
  ascendancy: { vi: "Ascendancy", en: "Ascendancy" },
  all: { vi: "All", en: "All" },
  baseTree: { vi: "Base tree", en: "Base tree" },
  search: { vi: "Search node/stat...", en: "Search node/stat..." },
  treeChanges: { vi: "Tree changes", en: "Tree changes" },
  highlight: { vi: "Highlight 0.5 changes", en: "Highlight 0.5 changes" },
  officialUpdates: { vi: "node updates from official export", en: "node updates from official export" },
  buildSummary: { vi: "Build summary", en: "Build summary" },
  selectedPassives: { vi: "selected passives", en: "selected passives" },
  allClasses: { vi: "All classes", en: "All classes" },
  noAscendancy: { vi: "No ascendancy filter", en: "No ascendancy filter" },
  clearBuild: { vi: "Clear build", en: "Clear build" },
  passiveTree: { vi: "Passive Tree", en: "Passive Tree" }
};

export function PassiveTreePage({ locale }: { locale: Locale }) {
  const [tree, setTree] = useState<PassiveTreeModel | null>(null);
  const [changes, setChanges] = useState<PassiveTreeChanges | null>(null);
  const [error, setError] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [ascendancyFilter, setAscendancyFilter] = useState("");
  const [search, setSearch] = useState("");
  const [changesOn, setChangesOn] = useState(true);
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
  const [allocatedIds, setAllocatedIds] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<{ node: PassiveNode | null; x: number; y: number }>({ node: null, x: 0, y: 0 });
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

  const visibleSearchIds = useMemo(() => {
    if (!tree || !search.trim()) return new Set<string>();
    return new Set(tree.nodes.filter((node) => matchesQuery(node, search, ["name", "stats", "type", "ascendancyName"])).map((node) => node.id));
  }, [tree, search]);

  const visibleNodeIds = useMemo(() => {
    if (!tree) return new Set<string>();
    return new Set(filteredTreeNodes(tree, classFilter, ascendancyFilter).map((node) => node.id));
  }, [tree, classFilter, ascendancyFilter]);

  const graphByNodeId = useMemo(() => tree ? buildPassiveGraph(tree) : new Map<string, string[]>(), [tree]);
  const selectedStartIds = useMemo(() => tree ? selectedStartNodeIds(tree, classFilter, ascendancyFilter) : new Set<string>(), [tree, classFilter, ascendancyFilter]);
  const startIds = useMemo(() => tree ? allStartNodeIds(tree) : new Set<string>(), [tree]);

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
    setClassFilter(name);
    const nextAscendancy = name ? tree?.classByName.get(name)?.ascendancies[0]?.name || "" : "";
    setAscendancyFilter(nextAscendancy);
    if (tree) {
      const nextStarts = selectedStartNodeIds(tree, name, nextAscendancy);
      setAllocatedIds(syncSelectedStartNodeIds(new Set(), nextStarts, allStartNodeIds(tree)));
    }
  };

  const selectAscendancy = (name: string) => {
    setAscendancyFilter(name);
    if (tree) {
      const nextStarts = selectedStartNodeIds(tree, classFilter, name);
      setAllocatedIds((current) => syncSelectedStartNodeIds(current, nextStarts, startIds));
    }
  };

  const toggleAllocated = (node: PassiveNode) => {
    setAllocatedIds((current) => {
      const seeded = syncSelectedStartNodeIds(current, selectedStartIds, startIds);
      if (seeded.has(node.id) && !selectedStartIds.has(node.id)) {
        return refundAllocatedNodeIds({
          targetId: node.id,
          allocatedIds: seeded,
          startNodeIds: selectedStartIds,
          graphByNodeId,
          visibleNodeIds
        });
      }
      return allocatePathToNode({
        targetId: node.id,
        allocatedIds: seeded,
        startNodeIds: selectedStartIds,
        graphByNodeId,
        visibleNodeIds
      });
    });
  };

  const runCommand = (type: CanvasCommand["type"], target?: Pick<CanvasCommand, "x" | "y" | "zoom">) => setCommand({ type, nonce: Date.now(), ...target });

  const focusChange = (change: PassiveTreeChangeMarker) => {
    if (!tree) return;
    const node = tree.nodeById.get(change.id);
    const target = node ? projectNodeForView(tree, node, classFilter, ascendancyFilter) : change;
    runCommand("focus", {
      x: target.x,
      y: target.y,
      zoom: node?.type.includes("small") ? 0.34 : 0.24
    });
  };

  if (error) return <main className="passive-route"><div className="error-panel">{error}</div></main>;
  if (!tree) return <main className="passive-route"><div className="loading-panel">{uiText("loadingPassiveTree", locale)}</div></main>;

  const hoverChange = changesOn && hover.node ? changes?.byId.get(hover.node.id) : undefined;
  const totalChanges = changes ? changes.counts.added + changes.counts.removed + changes.counts.stats + changes.counts.renamed : 0;
  const allocatedBuildCount = [...allocatedIds].filter((id) => !selectedStartIds.has(id)).length;

  return (
    <main className="passive-route">
      <div className="passive-toolbar">
        <div className="passive-toolbar__brand">
          <span className="material-symbols-rounded" aria-hidden="true">account_tree</span>
          <div>
            <strong>{localizedText(passiveCopy.passiveTree, "", locale)}</strong>
            <small>{formatNumber(tree.nodes.length, locale)} nodes - {formatNumber(allocatedBuildCount, locale)} {localizedText(passiveCopy.allocated, "", locale)}</small>
          </div>
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
        <button className={`passive-action ${changesOn ? "is-active" : ""}`} type="button" onClick={() => setChangesOn((value) => !value)} title="Toggle passive changes" aria-label="Toggle passive changes" disabled={!changes}>
          <span className="material-symbols-rounded" aria-hidden="true">change_circle</span>
          <span>Changes</span>
        </button>
      </div>
      <div className="passive-stage">
        <TreeCanvas
          tree={tree}
          searchIds={visibleSearchIds}
          allocatedIds={allocatedIds}
          changeEntries={filteredChanges}
          changesOn={Boolean(changes && changesOn)}
          classFilter={classFilter}
          ascendancyFilter={ascendancyFilter}
          command={command}
          onHover={(node, x, y) => setHover({ node, x, y })}
          onToggle={toggleAllocated}
        />
        {changes ? (
          <aside className="passive-changes-panel">
            <div className="passive-panel-title">
              <span className="material-symbols-rounded" aria-hidden="true">published_with_changes</span>
              <div>
                <h2>{localizedText(passiveCopy.treeChanges, "", locale)}</h2>
                <p>{changes.baseVersion} -&gt; {changes.targetVersion}</p>
              </div>
            </div>
            <button className={`passive-change-switch ${changesOn ? "is-on" : ""}`} type="button" onClick={() => setChangesOn((value) => !value)} aria-pressed={changesOn}>
              <span>
                <strong>{localizedText(passiveCopy.highlight, "", locale)}</strong>
                <small>{formatNumber(totalChanges, locale)} {localizedText(passiveCopy.officialUpdates, "", locale)}</small>
              </span>
              <i aria-hidden="true" />
            </button>
            <div className="passive-change-tabs" aria-label="Passive change filters">
              {changeFilterRows.map((row) => {
                const count = row.key === "all" ? totalChanges : changes.counts[row.key];
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
          </aside>
        ) : null}
        <aside className="passive-summary-panel">
          <h2>{localizedText(passiveCopy.buildSummary, "", locale)}</h2>
          <p><strong>{formatNumber(allocatedBuildCount, locale)}</strong> {localizedText(passiveCopy.selectedPassives, "", locale)}</p>
          <div className="badges">
            <span>{classFilter || localizedText(passiveCopy.allClasses, "", locale)}</span>
            <span>{ascendancyFilter || localizedText(passiveCopy.noAscendancy, "", locale)}</span>
          </div>
          <button type="button" onClick={() => setAllocatedIds(syncSelectedStartNodeIds(new Set(), selectedStartIds, startIds))}>
            <span className="material-symbols-rounded" aria-hidden="true">delete_sweep</span>
            {localizedText(passiveCopy.clearBuild, "", locale)}
          </button>
        </aside>
        {hover.node ? (
          <div className="passive-tooltip" style={{ left: Math.min(hover.x + 18, window.innerWidth - 380), top: Math.min(hover.y + 18, window.innerHeight - 220) }}>
            <strong translate="no">{hover.node.name || `Node ${hover.node.id}`}</strong>
            <span>{hover.node.type}</span>
            {hover.node.stats.slice(0, 5).map((line) => <p key={line}>{line}</p>)}
            {hoverChange ? (
              <div className="passive-tooltip__change">
                <b style={{ color: CHANGE_COLORS[hoverChange.status] }}>{CHANGE_LABELS[hoverChange.status]}</b>
                {hoverChange.oldStats.slice(0, 3).map((line) => <del key={`old:${line}`}>{line}</del>)}
                {hoverChange.newStats.slice(0, 3).map((line) => <ins key={`new:${line}`}>{line}</ins>)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
