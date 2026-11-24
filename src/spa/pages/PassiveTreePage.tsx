import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadPassiveTreeData } from "../lib/data";
import { formatNumber, localizedText, type Locale, uiText } from "../lib/locale";
import { boundsOfPoints } from "../passive/fit";
import { canRedo, canUndo, createHistory, historyKeyAction, recordEdit, redoEdit, sameTreeEditState, treeEditState, undoEdit, type EditHistory, type TreeEditState } from "../passive/history";
import { searchTreeNodes, stepMatchIndex } from "../passive/search";
import { createTreeSnapshot, deleteTreeSnapshot, passiveCount, readCurrentTreeSnapshot, readSavedTreeSnapshots, saveTreeSnapshot, WEAPON_SET_POINTS, weaponSetPointCounts, writeCurrentTreeSnapshot, type AttributeChoice, type BuildTreeSnapshot } from "../lib/buildPlanner";
import { TreeCanvas, type CanvasCommand } from "../passive/TreeCanvas";
import {
  allStartNodeIds,
  allocatePathInMode,
  buildPassiveGraph,
  refundInMode,
  selectedStartNodeIds,
  syncSelectedStartNodeIds,
  type AllocMode
} from "../passive/planner";
import { WEAPON_SET_COLORS } from "../passive/draw";
import "../styles/planner-tree-edit.css";
import { TREE_VERSION, isChoiceOptionNode } from "../../shared/equipment-rules.mjs";
import { filteredTreeNodes, parsePassiveTree, projectNodeForView, type PassiveNode, type PassiveTreeModel } from "../passive/tree";
import { parsePobBuild, type PobBuild } from "../passive/pob";

type PassivePanelMode = "build" | "items";

const BUILD_PASSIVE_LIMIT = 124;
const BUILD_ASCENDANCY_LIMIT = 8;

// Curated build stats shown as chips (POB exposes dozens — these are the headline ones).
const POB_KEY_STATS: { key: string; label: string; round?: boolean }[] = [
  { key: "CombinedDPS", label: "DPS", round: true },
  { key: "TotalDPS", label: "Hit DPS", round: true },
  { key: "Life", label: "Life", round: true },
  { key: "EnergyShield", label: "ES", round: true },
  { key: "Mana", label: "Mana", round: true },
  { key: "Ward", label: "Ward", round: true },
  { key: "MeleeEvadeChance", label: "Evade%" },
  { key: "PhysicalDamageReduction", label: "PhysRed%" },
  { key: "EffectiveMovementSpeedMod", label: "MoveSpd" },
  { key: "FireResist", label: "Fire" },
  { key: "ColdResist", label: "Cold" },
  { key: "LightningResist", label: "Light" },
  { key: "ChaosResist", label: "Chaos" }
];
const POB_ITEM_CATEGORIES = ["Weapon", "Armour", "Jewellery", "Belt", "Flask", "Jewel", "Other"] as const;

interface AggregatedStat {
  key: string;
  text: string;
  count: number;
}

export interface PassiveTreeWorkspaceProps {
  locale: Locale;
  embedded?: boolean;
  readOnly?: boolean;
  /** When set (e.g. inside Build Planner), the tree's class is permanently locked to this class. */
  lockedClass?: string;
  initialSnapshot?: BuildTreeSnapshot | null;
  onSnapshotChange?: (snapshot: BuildTreeSnapshot) => void;
  onSaveSnapshot?: (snapshot: BuildTreeSnapshot) => void;
  /** Jewel sockets, when the tree sits in the Build Planner (it holds the jewels). */
  jewels?: TreeJewelHooks;
  /** Extra tooltip content for a hovered node (the planner's "what this node changes"). */
  /** blocked: a click would not take the node (out of points), so the preview is a "would". */
  renderNodeExtra?: (node: PassiveNode, allocated: boolean, blocked?: boolean) => ReactNode;
  /** The node under the mouse (null when none). */
  onNodeHover?: (node: PassiveNode | null, allocated: boolean) => void;
  /** The parsed tree, once loaded. */
  onTreeReady?: (tree: PassiveTreeModel) => void;
}

/** What the Build Planner gives the tree so its sockets can hold jewels. */
export interface TreeJewelHooks {
  /** Socketed jewels: node id -> name and rarity. */
  socketed: Map<string, { name: string; rarity: string }>;
  /** A jewel picked in the inventory or being dragged: sockets that take it light up. */
  carried?: { name: string; accepts: (node: PassiveNode) => boolean; dragging: boolean } | null;
  onCancelCarried?: () => void;
  /** The carried jewel goes into this socket (a click or a drop). */
  onSocketCarried: (node: PassiveNode) => void;
  /** Data type of an inventory drag (see BuildInventoryPanel). */
  dragType?: string;
  /** A socket under the mouse (or under a dragged jewel); null when it leaves. */
  onSocketHover?: (node: PassiveNode | null) => void;
  /** Extra tooltip lines for a socket. */
  renderSocketTooltip?: (node: PassiveNode, allocated: boolean) => ReactNode;
  /** Body of the socket menu (jewels to put in, take out). */
  renderSocketMenu: (node: PassiveNode, allocated: boolean, close: () => void) => ReactNode;
}

const ATTRIBUTE_LABELS: Record<AttributeChoice, { vi: string; en: string; short: string }> = {
  str: { vi: "Sức mạnh (Str)", en: "Strength", short: "Str" },
  dex: { vi: "Khéo léo (Dex)", en: "Dexterity", short: "Dex" },
  int: { vi: "Trí tuệ (Int)", en: "Intelligence", short: "Int" }
};
/** PoB keeps keystones, jewel sockets and ascendancy nodes on the main tree. */
const isMainTreeOnlyNode = (node: PassiveNode | undefined) => Boolean(node && (node.ascendancyName || /keystone|jewel/i.test(node.type)));

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
    // PoB (PassiveSpec:CountAllocNodes): the option picked under a multiple-choice ascendancy
    // node is not a point of its own, so 8 real points no longer read "9/8".
    if (node.ascendancyName) ascendancy += isChoiceOptionNode(id) ? 0 : 1;
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
  clearBuild: { vi: "Clear build", en: "Clear build" },
  saveTree: { vi: "Save tree", en: "Save tree" },
  savedTrees: { vi: "Tree đã lưu", en: "Saved trees" },
  noSavedTrees: { vi: "Chưa có tree đã lưu.", en: "No saved trees yet." },
  openSavedTree: { vi: "Mở để sửa/xem", en: "Open to edit/view" },
  deleteTree: { vi: "Xóa tree", en: "Delete tree" },
  treeName: { vi: "Tên tree", en: "Tree name" },
  treeSaved: { vi: "Đã lưu tree cho tab Build", en: "Tree saved for the Build tab" },
  treeDeleted: { vi: "Đã xóa tree.", en: "Deleted tree." }
};

function treeSnapshotSignature(snapshot: BuildTreeSnapshot | null | undefined): string {
  if (!snapshot) return "";
  return JSON.stringify({
    name: snapshot.name || "",
    className: snapshot.className || "",
    ascendancyName: snapshot.ascendancyName || "",
    allocatedIds: [...new Set(snapshot.allocatedIds)].sort(),
    startIds: [...new Set(snapshot.startIds)].sort(),
    treeVersion: snapshot.treeVersion || "",
    weaponSets: snapshot.weaponSets ?? {},
    attributeChoices: snapshot.attributeChoices ?? {}
  });
}

export function PassiveTreeWorkspace({ locale, embedded = false, readOnly = false, lockedClass, initialSnapshot = null, onSnapshotChange, onSaveSnapshot, jewels, renderNodeExtra, onNodeHover, onTreeReady }: PassiveTreeWorkspaceProps) {
  const [tree, setTree] = useState<PassiveTreeModel | null>(null);
  const [error, setError] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [ascendancyFilter, setAscendancyFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeMode, setActiveMode] = useState<PassivePanelMode>("build");
  const [buildPanelCollapsed, setBuildPanelCollapsed] = useState(false);
  const [allocatedIds, setAllocatedIds] = useState<Set<string>>(() => new Set());
  // PoB's weapon-set allocation mode and the attribute new "+5 to any Attribute" nodes get.
  const [allocMode, setAllocMode] = useState<AllocMode>(0);
  const [weaponSets, setWeaponSets] = useState<Record<string, 1 | 2>>({});
  const [attributeChoices, setAttributeChoices] = useState<Record<string, AttributeChoice>>({});
  const [defaultAttribute, setDefaultAttribute] = useState<AttributeChoice>("str");
  const [nodeMenu, setNodeMenu] = useState<{ node: PassiveNode; x: number; y: number } | null>(null);
  const [dragHover, setDragHover] = useState<{ node: PassiveNode; x: number; y: number } | null>(null);
  const [buildLimitWarning, setBuildLimitWarning] = useState("");
  const [hover, setHover] = useState<{ node: PassiveNode | null; x: number; y: number; held: boolean }>({ node: null, x: 0, y: 0, held: false });
  const [command, setCommand] = useState<CanvasCommand | null>(null);
  const [zoom, setZoom] = useState(0.035);
  const [pob, setPob] = useState<PobBuild | null>(null);
  // Undo / redo of tree edits; starts empty for every tree that is opened or switched to.
  const [history, setHistory] = useState<EditHistory<TreeEditState>>(() => createHistory());
  // "build": fitting shows the allocated nodes; "tree": the whole tree.
  const [fitMode, setFitMode] = useState<"build" | "tree">("build");
  const [searchIndex, setSearchIndex] = useState(-1);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // The tooltip's height depends on the node's lines and the planner's preview (which
  // arrives later), so it is measured after each render: when it would run past the
  // bottom it goes above the cursor, or as low as still fits.
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const room = (el.offsetParent as HTMLElement | null)?.clientHeight ?? window.innerHeight;
    const top = Number(el.dataset.top);
    const cursorY = Number(el.dataset.cursorY);
    const tall = el.offsetHeight;
    let next = top;
    if (top + tall > room - 4) {
      const above = cursorY - tall - 12;
      next = above >= 4 ? above : Math.max(4, room - tall - 4);
    }
    el.style.top = `${next}px`;
  });
  const onTreeReadyRef = useRef(onTreeReady);
  onTreeReadyRef.current = onTreeReady;
  useEffect(() => {
    if (tree) onTreeReadyRef.current?.(tree);
  }, [tree]);

  const handleZoomChange = (newZoom: number) => {
    if (Math.abs(zoom - newZoom) > 0.0001) {
      setZoom(newZoom);
    }
  };

  const handleSliderChange = (newZoom: number) => {
    setZoom(newZoom);
    runCommand("zoom", { zoom: newZoom });
  };

  const handleZoomStep = (factor: number) => {
    const minZoom = embedded ? 0.016 : 0.012;
    const targetZoom = Math.min(Math.max(zoom * factor, minZoom), 1.5);
    handleSliderChange(targetZoom);
  };
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErr, setImportErr] = useState("");
  const [importing, setImporting] = useState(false);
  const [treeBuildName, setTreeBuildName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [savedTrees, setSavedTrees] = useState<BuildTreeSnapshot[]>(() => readSavedTreeSnapshots());
  const [treeLibraryOpen, setTreeLibraryOpen] = useState(false);
  const [activeSavedTreeId, setActiveSavedTreeId] = useState("");
  const [savedTreeBaseline, setSavedTreeBaseline] = useState("");
  const treeLibraryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadPassiveTreeData().then((raw) => {
      if (!alive) return;
      const parsed = parsePassiveTree(raw, locale);
      const stored = initialSnapshot ?? readCurrentTreeSnapshot();
      const storedSavedTrees = readSavedTreeSnapshots();
      const storedSavedTree = stored ? storedSavedTrees.find((row) => row.id === stored.id) ?? null : null;
      const storedClass = stored?.className && parsed.classByName.has(stored.className) ? stored.className : "";
      const initialClass = parsed.classes[0] || "";
      const className = storedClass || initialClass;
      const classAscendancies = className ? parsed.classByName.get(className)?.ascendancies ?? [] : [];
      const storedAscendancy = stored?.ascendancyName && classAscendancies.some((row) => row.name === stored.ascendancyName) ? stored.ascendancyName : "";
      const initialAscendancy = initialClass ? parsed.classByName.get(initialClass)?.ascendancies[0]?.name || "" : "";
      setTree(parsed);
      setClassFilter(className);
      setAscendancyFilter(stored ? storedAscendancy : initialAscendancy);
      setTreeBuildName(stored?.name || "");
      setAllocatedIds(stored ? new Set(stored.allocatedIds) : new Set());
      setWeaponSets({ ...(stored?.weaponSets ?? {}) });
      setAttributeChoices({ ...(stored?.attributeChoices ?? {}) });
      setHistory(createHistory());
      setSavedTrees(storedSavedTrees);
      setActiveSavedTreeId(storedSavedTree?.id || "");
      setSavedTreeBaseline(storedSavedTree ? treeSnapshotSignature(storedSavedTree) : "");
    }).catch((err: Error) => {
      if (alive) setError(err.message);
    });
    return () => {
      alive = false;
    };
  }, [locale, initialSnapshot?.id]);

  useEffect(() => {
    const refreshSavedTrees = () => setSavedTrees(readSavedTreeSnapshots());
    window.addEventListener("storage", refreshSavedTrees);
    window.addEventListener("poe-build-tree-saved", refreshSavedTrees);
    return () => {
      window.removeEventListener("storage", refreshSavedTrees);
      window.removeEventListener("poe-build-tree-saved", refreshSavedTrees);
    };
  }, []);

  useEffect(() => {
    if (!treeLibraryOpen) return;
    const closeTreeLibrary = (event: MouseEvent) => {
      if (treeLibraryRef.current?.contains(event.target as Node)) return;
      setTreeLibraryOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTreeLibraryOpen(false);
    };
    window.addEventListener("mousedown", closeTreeLibrary);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeTreeLibrary);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [treeLibraryOpen]);

  const allocationEnabled = !readOnly && activeMode === "build";

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

  // Nodes matching the search (name or stat, Vietnamese or English, accents optional),
  // in the order "next" walks them.
  const searchMatches = useMemo(() => search.trim() ? searchTreeNodes(targetNodeById.values(), search) : [], [targetNodeById, search]);
  const visibleSearchIds = useMemo(() => new Set(searchMatches.map((node) => node.id)), [searchMatches]);
  const focusedMatch = searchIndex >= 0 ? searchMatches[searchIndex] : undefined;
  useEffect(() => setSearchIndex(-1), [searchMatches]);

  const graphByNodeId = useMemo(() => {
    if (!tree) return new Map<string, string[]>();
    return buildPassiveGraph(tree);
  }, [tree]);
  const selectedStartIds = useMemo(() => tree ? selectedStartNodeIds(tree, classFilter, ascendancyFilter) : new Set<string>(), [tree, classFilter, ascendancyFilter]);
  const startIds = useMemo(() => tree ? allStartNodeIds(tree) : new Set<string>(), [tree]);
  // What "Fit" frames in build mode: the allocated nodes where they are drawn (not the start).
  const fitBounds = useMemo(() => {
    if (fitMode !== "build") return null;
    return boundsOfPoints([...allocatedIds].filter((id) => !selectedStartIds.has(id)).map((id) => targetNodeById.get(id)));
  }, [fitMode, allocatedIds, selectedStartIds, targetNodeById]);
  const selectedBuildNodes = useMemo(() => {
    return [...allocatedIds]
      .filter((id) => !selectedStartIds.has(id))
      .map((id) => targetNodeById.get(id) || tree?.nodeById.get(id))
      .filter((node): node is PassiveNode => Boolean(node));
  }, [allocatedIds, selectedStartIds, targetNodeById, tree]);
  const setCounts = useMemo(() => weaponSetPointCounts(weaponSets, allocatedIds), [weaponSets, allocatedIds]);
  const buildCounts = useMemo(() => {
    const counts = buildCountsForIds(allocatedIds, selectedStartIds, targetNodeById);
    // PoB: a point spent in both weapon sets is paid once from the main pool.
    return { ...counts, passive: counts.passive - setCounts.shared, total: counts.total - setCounts.shared };
  }, [allocatedIds, selectedStartIds, targetNodeById, setCounts]);
  const buildStatRows = useMemo(() => aggregateNodeStats(selectedBuildNodes), [selectedBuildNodes]);
  const buildLimitExceeded = buildCounts.passive > BUILD_PASSIVE_LIMIT || buildCounts.ascendancy > BUILD_ASCENDANCY_LIMIT;
  const visibleNodeCount = visibleNodeIds.size;

  useEffect(() => {
    if (!tree) return;
    setAllocatedIds((current) => syncSelectedStartNodeIds(current, selectedStartIds, startIds));
  }, [tree, selectedStartIds, startIds]);

  const filteredAscendancies = useMemo(() => {
    if (!tree) return [];
    if (!classFilter) return tree.ascendancies;
    return tree.classByName.get(classFilter)?.ascendancies.map((asc) => asc.name) ?? [];
  }, [tree, classFilter]);

  const resetTreeEdits = () => {
    setWeaponSets({});
    setAttributeChoices({});
    setNodeMenu(null);
  };

  /** Edits that can be undone: allocate, refund, attribute picks, weapon-set nodes, clear. */
  const applyEdit = (next: { allocatedIds?: Set<string>; weaponSets?: Record<string, 1 | 2>; attributeChoices?: Record<string, AttributeChoice> }) => {
    const before = treeEditState(allocatedIds, weaponSets, attributeChoices);
    const after = treeEditState(next.allocatedIds ?? allocatedIds, next.weaponSets ?? weaponSets, next.attributeChoices ?? attributeChoices);
    setHistory((current) => recordEdit(current, before, after, sameTreeEditState));
    if (next.allocatedIds) setAllocatedIds(next.allocatedIds);
    if (next.weaponSets) setWeaponSets(next.weaponSets);
    if (next.attributeChoices) setAttributeChoices(next.attributeChoices);
  };

  /** Puts back a whole edit state; the planner sees the change like any click. */
  const restoreEditState = (state: TreeEditState) => {
    setAllocatedIds(new Set(state.allocatedIds));
    setWeaponSets({ ...state.weaponSets });
    setAttributeChoices({ ...state.attributeChoices } as Record<string, AttributeChoice>);
    setNodeMenu(null);
    setBuildLimitWarning("");
  };

  // The undo / redo button just pressed can turn disabled and drop the focus: the tree
  // takes it back so Ctrl+Z / Ctrl+Y keep working.
  const keepTreeFocus = () => {
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) stageRef.current?.focus({ preventScroll: true });
    });
  };

  const undoTreeEdit = () => {
    const step = undoEdit(history, treeEditState(allocatedIds, weaponSets, attributeChoices));
    if (!step) return;
    setHistory(step.history);
    restoreEditState(step.state);
    keepTreeFocus();
  };

  const redoTreeEdit = () => {
    const step = redoEdit(history, treeEditState(allocatedIds, weaponSets, attributeChoices));
    if (!step) return;
    setHistory(step.history);
    restoreEditState(step.state);
    keepTreeFocus();
  };

  const selectClass = (name: string) => {
    if (lockedClass && name.toLowerCase() !== lockedClass.toLowerCase()) return;
    setBuildLimitWarning("");
    setHistory(createHistory());
    resetTreeEdits();
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
    setHistory(createHistory());
    setAscendancyFilter(name);
    if (tree) {
      const nextStarts = selectedStartNodeIds(tree, classFilter, name);
      setAllocatedIds((current) => syncSelectedStartNodeIds(current, nextStarts, startIds));
    }
  };

  const vi = locale === "vi";

  /** Takes the point back (and every node that only hung on it), as PoB does. */
  const refundNode = (node: PassiveNode) => {
    const seeded = syncSelectedStartNodeIds(allocatedIds, selectedStartIds, startIds);
    const result = refundInMode({ targetId: node.id, allocatedIds: seeded, startNodeIds: selectedStartIds, graphByNodeId, visibleNodeIds, weaponSets });
    setBuildLimitWarning("");
    applyEdit({
      allocatedIds: result.allocated,
      weaponSets: result.weaponSets,
      // PoB forgets the attribute of a node once it is refunded.
      attributeChoices: Object.fromEntries(Object.entries(attributeChoices).filter(([id]) => result.allocated.has(id)))
    });
    setNodeMenu(null);
  };

  /**
   * What a click on an unallocated node would allocate, and why it is refused when it is
   * (out of points, or a main-tree-only node while a weapon set is selected). The node
   * tooltip uses the same answer, so it never promises a node the click will not take.
   */
  const planAllocation = (node: PassiveNode, seeded = syncSelectedStartNodeIds(allocatedIds, selectedStartIds, startIds)) => {
    const result = allocatePathInMode({
      targetId: node.id,
      allocatedIds: seeded,
      startNodeIds: selectedStartIds,
      graphByNodeId,
      visibleNodeIds,
      weaponSets,
      mode: allocMode,
      isMainTreeOnly: (id) => isMainTreeOnlyNode(tree?.nodeById.get(id))
    });
    if (result.blocked) {
      return { result, refusal: vi ? "Điểm quan trọng (keystone), ô ngọc và điểm thăng hoa chỉ chọn được ở Cây chính." : "Keystones, jewel sockets and ascendancy nodes belong to the main tree." };
    }
    const sets = weaponSetPointCounts(result.weaponSets, result.allocated);
    const counts = buildCountsForIds(result.allocated, selectedStartIds, targetNodeById);
    const before = buildCountsForIds(seeded, selectedStartIds, targetNodeById);
    const passiveNow = counts.passive - sets.shared;
    const passiveBefore = before.passive - weaponSetPointCounts(weaponSets, seeded).shared;
    // Only a pool that this click makes grow past its limit refuses the node: an imported
    // build already over one (PoB leaves free ascendancy nodes out of the count) still edits.
    if (passiveNow > BUILD_PASSIVE_LIMIT && passiveNow > passiveBefore) {
      const need = passiveNow - passiveBefore;
      const left = Math.max(BUILD_PASSIVE_LIMIT - passiveBefore, 0);
      return {
        result,
        refusal: vi
          ? `Hết điểm thụ động (${passiveBefore}/${BUILD_PASSIVE_LIMIT}): node này cần ${need} điểm, còn ${left}. Hoàn lại điểm khác trước.`
          : `Out of passive points (${passiveBefore}/${BUILD_PASSIVE_LIMIT}): this node takes ${need}, ${left} left. Refund other nodes first.`
      };
    }
    if (counts.ascendancy > BUILD_ASCENDANCY_LIMIT && counts.ascendancy > before.ascendancy) {
      const need = counts.ascendancy - before.ascendancy;
      const left = Math.max(BUILD_ASCENDANCY_LIMIT - before.ascendancy, 0);
      return {
        result,
        refusal: vi
          ? `Hết điểm thăng hoa (${before.ascendancy}/${BUILD_ASCENDANCY_LIMIT}): node này cần ${need} điểm, còn ${left}. Hoàn lại điểm khác trước.`
          : `Out of ascendancy points (${before.ascendancy}/${BUILD_ASCENDANCY_LIMIT}): this node takes ${need}, ${left} left. Refund other nodes first.`
      };
    }
    return { result, refusal: "" };
  };

  // The out-of-points message goes away by itself; the next successful click clears it too.
  useEffect(() => {
    if (!buildLimitWarning) return;
    const timer = window.setTimeout(() => setBuildLimitWarning(""), 6000);
    return () => window.clearTimeout(timer);
  }, [buildLimitWarning]);

  const toggleAllocated = (node: PassiveNode) => {
    if (!allocationEnabled) return;
    const carried = jewels?.carried;
    if (carried && node.jewelSocket) {
      if (carried.accepts(node)) jewels!.onSocketCarried(node);
      return;
    }
    const seeded = syncSelectedStartNodeIds(allocatedIds, selectedStartIds, startIds);
    const isAllocated = seeded.has(node.id) && !selectedStartIds.has(node.id);
    // An allocated attribute node or jewel socket opens its menu (pick the attribute,
    // put a jewel in); the menu also has the button that takes the point back.
    if (isAllocated && (node.isAttribute || (node.jewelSocket && jewels))) {
      setNodeMenu({ node, x: hover.node?.id === node.id ? hover.x : window.innerWidth / 2, y: hover.node?.id === node.id ? hover.y : window.innerHeight / 3 });
      return;
    }
    if (isAllocated) {
      refundNode(node);
      return;
    }
    const { result, refusal } = planAllocation(node, seeded);
    if (refusal) {
      // Said where the player is looking (over the tree), not only in the side panel.
      setBuildLimitWarning(refusal);
      return;
    }
    setBuildLimitWarning("");
    // New attribute nodes take the attribute picked last (PoB: Strength until one is picked).
    const added = [...result.allocated].filter((id) => !seeded.has(id) && tree?.nodeById.get(id)?.isAttribute);
    applyEdit({
      allocatedIds: result.allocated,
      weaponSets: result.weaponSets,
      attributeChoices: added.length ? { ...attributeChoices, ...Object.fromEntries(added.map((id) => [id, defaultAttribute])) } : undefined
    });
  };

  const chooseAttribute = (nodeId: string, choice: AttributeChoice) => {
    applyEdit({ attributeChoices: { ...attributeChoices, [nodeId]: choice } });
    setDefaultAttribute(choice);
  };

  const clearBuild = () => {
    setBuildLimitWarning("");
    setNodeMenu(null);
    applyEdit({ allocatedIds: syncSelectedStartNodeIds(new Set(), selectedStartIds, startIds), weaponSets: {}, attributeChoices: {} });
  };

  /** Centres the view on a search match (step 1: next, -1: previous). */
  const jumpToMatch = (step: 1 | -1) => {
    const index = stepMatchIndex(searchIndex, searchMatches.length, step);
    if (index < 0) return;
    const node = searchMatches[index];
    setSearchIndex(index);
    runCommand("focus", { x: node.x, y: node.y, zoom: Math.max(zoom, 0.22) });
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && search) {
      event.preventDefault();
      event.stopPropagation();
      setSearch("");
    }
  };

  /** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y while the tree (or one of its buttons) has focus. */
  const onStageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const action = historyKeyAction(event);
    if (!action || readOnly) return;
    event.preventDefault();
    if (action === "undo") undoTreeEdit();
    else redoTreeEdit();
  };

  const fitTo = (mode: "build" | "tree") => {
    setFitMode(mode);
    if (mode === "tree") runCommand("reset");
    else runCommand("fit");
  };

  // Escape closes the node menu.
  useEffect(() => {
    if (!nodeMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNodeMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodeMenu]);

  const onTreeHover = (node: PassiveNode | null, x: number, y: number, held: boolean) => {
    setHover({ node, x, y, held });
    onNodeHover?.(node, Boolean(node && allocatedIds.has(node.id)));
    if (jewels?.onSocketHover) jewels.onSocketHover(node?.jewelSocket ? node : null);
  };

  const onNodeDrop = (phase: "over" | "leave" | "drop", node: PassiveNode | null, x: number, y: number) => {
    const carried = jewels?.carried;
    if (!jewels || !carried) return false;
    if (phase === "leave") {
      setDragHover(null);
      jewels.onSocketHover?.(null);
      return false;
    }
    const target = node?.jewelSocket && carried.accepts(node) ? node : null;
    if (phase === "drop") {
      setDragHover(null);
      if (target) jewels.onSocketCarried(target);
      return Boolean(target);
    }
    if ((target?.id ?? "") !== (dragHover?.node.id ?? "")) jewels.onSocketHover?.(target);
    setDragHover(target ? { node: target, x, y } : null);
    return Boolean(target);
  };

  const treeMarks = useMemo(() => {
    const carried = jewels?.carried;
    const dropSocketIds = carried && tree
      ? new Set(tree.nodes.filter((node) => node.jewelSocket && carried.accepts(node)).map((node) => node.id))
      : undefined;
    return {
      weaponSets,
      attributeChoices,
      socketedJewels: jewels ? new Map([...jewels.socketed].map(([id, jewel]) => [id, jewel.rarity])) : undefined,
      dropSocketIds,
      dropTargetId: dragHover?.node.id,
      focusId: focusedMatch?.id
    };
  }, [weaponSets, attributeChoices, jewels, tree, dragHover, focusedMatch]);

  const applyPob = (build: PobBuild) => {
    if (!tree) return;
    const className = tree.classByName.has(build.className) ? build.className : "";
    const ascendancy = className && tree.classByName.get(className)?.ascendancies.some((a) => a.name === build.ascendClassName)
      ? build.ascendClassName : "";
    setClassFilter(className);
    setAscendancyFilter(ascendancy);
    const starts = selectedStartNodeIds(tree, className, ascendancy);
    const ids = new Set<string>(build.nodeIds.filter((id) => tree.nodeById.has(id)));
    setAllocatedIds(syncSelectedStartNodeIds(ids, starts, allStartNodeIds(tree)));
    resetTreeEdits();
    // The code's own weapon-set nodes and attribute picks (they used to be dropped, so
    // every import read "Bộ 1 0/24, Bộ 2 0/24" and its "+5" nodes gave nothing).
    setWeaponSets(Object.fromEntries(Object.entries(build.weaponSets ?? {}).filter(([id]) => ids.has(id))));
    setAttributeChoices(Object.fromEntries(Object.entries(build.attributeChoices ?? {}).filter(([id]) => ids.has(id))));
    setHistory(createHistory());
    setBuildLimitWarning("");
    setPob(build);
  };

  const doImport = async () => {
    if (!importText.trim() || importing) return;
    setImporting(true);
    setImportErr("");
    try {
      const build = await parsePobBuild(importText);
      if (!build.nodeIds.length && !build.items.length && !build.skills.length) {
        throw new Error("Build rỗng — không có cây/item/gem nào");
      }
      if (lockedClass && build.className && build.className.toLowerCase() !== lockedClass.toLowerCase()) {
        throw new Error(
          locale === "vi"
            ? `Code PoB này thuộc class ${build.className}, không khớp với class ${lockedClass} của build.`
            : `This PoB code is for ${build.className}, which does not match this build's locked class (${lockedClass}).`
        );
      }
      applyPob(build);
      setImportOpen(false);
      setImportText("");
      setActiveMode(build.items.length || build.skills.length ? "items" : "build");
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : "Không đọc được build");
    } finally {
      setImporting(false);
    }
  };

  const runCommand = (type: CanvasCommand["type"], target?: Pick<CanvasCommand, "x" | "y" | "zoom">) => setCommand({ type, nonce: Date.now(), ...target });

  const currentBuildSnapshot = useMemo(() => {
    if (!tree) return null;
    return createTreeSnapshot({
      id: embedded && initialSnapshot?.id ? initialSnapshot.id : "current-tree",
      name: treeBuildName,
      className: classFilter,
      ascendancyName: ascendancyFilter,
      allocatedIds,
      startIds: selectedStartIds,
      treeVersion: tree.version || TREE_VERSION,
      weaponSets,
      attributeChoices
    });
  }, [tree, treeBuildName, classFilter, ascendancyFilter, allocatedIds, selectedStartIds, embedded, initialSnapshot?.id, weaponSets, attributeChoices]);
  const currentTreeSignature = useMemo(() => treeSnapshotSignature(currentBuildSnapshot), [currentBuildSnapshot]);
  const hasUnsavedTreeChanges = Boolean(currentBuildSnapshot && (
    savedTreeBaseline
      ? currentTreeSignature !== savedTreeBaseline
      : passiveCount(currentBuildSnapshot) > 0
  ));

  useEffect(() => {
    if (!currentBuildSnapshot) return;
    if (embedded) {
      onSnapshotChange?.(currentBuildSnapshot);
      return;
    }
    writeCurrentTreeSnapshot(currentBuildSnapshot);
    window.dispatchEvent(new CustomEvent("poe-build-tree-saved", { detail: { source: "current" } }));
  }, [currentBuildSnapshot, embedded, onSnapshotChange]);

  const loadSavedTreeSnapshot = (snapshot: BuildTreeSnapshot) => {
    setBuildLimitWarning("");
    setSearch("");
    setActiveMode("build");
    setClassFilter(snapshot.className);
    setAscendancyFilter(snapshot.ascendancyName);
    setTreeBuildName(snapshot.name);
    setAllocatedIds(new Set(snapshot.allocatedIds));
    setWeaponSets({ ...(snapshot.weaponSets ?? {}) });
    setAttributeChoices({ ...(snapshot.attributeChoices ?? {}) });
    setHistory(createHistory());
    setNodeMenu(null);
    setActiveSavedTreeId(snapshot.id);
    setSavedTreeBaseline(treeSnapshotSignature(snapshot));
    setTreeLibraryOpen(false);
    setSaveMessage("");
  };

  const removeSavedTreeSnapshot = (snapshotId: string) => {
    const next = deleteTreeSnapshot(snapshotId);
    setSavedTrees(next);
    if (activeSavedTreeId === snapshotId) {
      setActiveSavedTreeId("");
      setSavedTreeBaseline("");
    }
    setSaveMessage(localizedText(passiveCopy.treeDeleted, "", locale));
    window.dispatchEvent(new CustomEvent("poe-build-tree-saved", { detail: { source: "deleted", id: snapshotId } }));
    window.setTimeout(() => setSaveMessage(""), 1800);
  };

  const saveCurrentTree = () => {
    if (!currentBuildSnapshot || passiveCount(currentBuildSnapshot) <= 0) return;
    const timestamp = new Date().toISOString();
    const existing = savedTrees.find((row) => row.id === activeSavedTreeId);
    const saved = {
      ...currentBuildSnapshot,
      id: !embedded && activeSavedTreeId ? activeSavedTreeId : `saved-tree-${Date.now().toString(36)}`,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };
    if (embedded && onSaveSnapshot) onSaveSnapshot(saved);
    else {
      const next = saveTreeSnapshot(saved);
      setSavedTrees(next);
      setActiveSavedTreeId(saved.id);
      setSavedTreeBaseline(treeSnapshotSignature(saved));
    }
    if (!treeBuildName) setTreeBuildName(saved.name);
    setSaveMessage(localizedText(passiveCopy.treeSaved, "", locale));
    window.dispatchEvent(new CustomEvent("poe-build-tree-saved", { detail: { source: "saved", id: saved.id } }));
    window.setTimeout(() => setSaveMessage(""), 2200);
  };

  /**
   * Next to the clicked node; on a phone a sheet along the bottom of what is on screen
   * (the visual viewport, so a page wider than the phone does not push it off screen).
   */
  const nodeMenuPosition = (x: number, y: number): React.CSSProperties => {
    const view = window.visualViewport;
    const width = view?.width ?? window.innerWidth;
    const height = view?.height ?? window.innerHeight;
    const left = view?.offsetLeft ?? 0;
    const top = view?.offsetTop ?? 0;
    if (width < 720) return { left: left + 8, width: width - 16, top: "auto", bottom: Math.max(8, window.innerHeight - (top + height) + 8) };
    return { left: Math.max(8, Math.min(x + 12, left + width - 340)), top: Math.max(8, Math.min(y + 12, top + height - 420)) };
  };

  /** Weapon set, attribute and socket lines of a node's tooltip. */
  const nodePickTooltip = (node: PassiveNode): ReactNode => {
    const allocated = allocatedIds.has(node.id);
    const set = allocated ? weaponSets[node.id] : undefined;
    const attribute = allocated && node.isAttribute ? attributeChoices[node.id] : undefined;
    const lines: ReactNode[] = [];
    if (set) lines.push(<p key="set" className="passive-tooltip-set" style={{ color: WEAPON_SET_COLORS[set] }}>{vi ? `Chỉ có tác dụng khi cầm bộ vũ khí ${set}` : `Weapon set ${set} only`}</p>);
    if (node.isAttribute) {
      lines.push(<p key="attr" className="passive-tooltip-hint">{attribute
        ? (vi ? `Đang cho: ${ATTRIBUTE_LABELS[attribute].vi}. Bấm để đổi.` : `Gives ${ATTRIBUTE_LABELS[attribute].en}. Click to change.`)
        : allocated
          ? (vi ? "Chưa chọn thuộc tính nên điểm này chưa cho gì. Bấm để chọn." : "No attribute picked yet. Click to pick one.")
          : (vi ? `Khi chọn sẽ cho ${ATTRIBUTE_LABELS[defaultAttribute].vi}.` : `Will give ${ATTRIBUTE_LABELS[defaultAttribute].en}.`)}</p>);
    }
    if (!allocated && allocMode > 0 && isMainTreeOnlyNode(node) && !node.ascendancyName) {
      lines.push(<p key="global" className="passive-tooltip-hint">{vi ? "Chỉ chọn được ở Cây chính." : "Main tree only."}</p>);
    }
    if (node.jewelSocket && jewels?.renderSocketTooltip) lines.push(<div key="socket">{jewels.renderSocketTooltip(node, allocated)}</div>);
    return lines.length ? <div className="passive-tooltip-edits">{lines}</div> : null;
  };

  const routeClassName = embedded ? "passive-route passive-route--embedded" : "passive-route";

  if (error) return <main className={routeClassName}><div className="error-panel">{error}</div></main>;
  if (!tree) return <main className={routeClassName}><div className="loading-panel">{uiText("loadingPassiveTree", locale)}</div></main>;

  const allocatedBuildCount = buildCounts.total;

  return (
    <main className={routeClassName}>
      <div className="passive-toolbar">
        <div className="passive-mode-tabs" role="tablist" aria-label="Passive tree mode">
          <button className={`${activeMode === "build" ? "is-active" : ""} ${buildLimitWarning || buildLimitExceeded ? "is-danger" : ""}`} type="button" onClick={() => setActiveMode("build")} aria-pressed={activeMode === "build"}>
            <span className="material-symbols-rounded" aria-hidden="true">summarize</span>
            <span>{localizedText(passiveCopy.build, "", locale)}</span>
            <strong>{formatNumber(allocatedBuildCount, locale)}</strong>
          </button>
          <button className={activeMode === "items" ? "is-active" : ""} type="button" onClick={() => setActiveMode("items")} aria-pressed={activeMode === "items"} disabled={!pob}>
            <span className="material-symbols-rounded" aria-hidden="true">backpack</span>
            <span>Items</span>
            {pob ? <strong>{formatNumber(pob.items.length, locale)}</strong> : null}
          </button>
        </div>
        {!embedded ? (
        <div className="passive-tree-library" ref={treeLibraryRef}>
          <button className="passive-tree-library-toggle" type="button" onClick={() => setTreeLibraryOpen((open) => !open)} aria-expanded={treeLibraryOpen} aria-label={localizedText(passiveCopy.savedTrees, "", locale)}>
            <span className="material-symbols-rounded" aria-hidden="true">account_tree</span>
            <strong>{savedTrees.find((row) => row.id === activeSavedTreeId)?.name || localizedText(passiveCopy.savedTrees, "", locale)}</strong>
            <small>{formatNumber(savedTrees.length, locale)}</small>
            <span className="material-symbols-rounded" aria-hidden="true">expand_more</span>
          </button>
          {treeLibraryOpen ? (
            <div className="passive-tree-menu" role="menu" aria-label={localizedText(passiveCopy.savedTrees, "", locale)}>
              {savedTrees.length ? savedTrees.map((snapshot) => (
                <article className={snapshot.id === activeSavedTreeId ? "is-active" : ""} key={snapshot.id}>
                  <button className="passive-tree-menu-main" type="button" onClick={() => loadSavedTreeSnapshot(snapshot)} role="menuitem">
                    <span>
                      <strong>{snapshot.name}</strong>
                      <small>{snapshot.className}{snapshot.ascendancyName ? ` / ${snapshot.ascendancyName}` : ""}</small>
                    </span>
                    <em>{formatNumber(passiveCount(snapshot), locale)}</em>
                    <b>{localizedText(passiveCopy.openSavedTree, "", locale)}</b>
                  </button>
                  <button className="passive-tree-menu-delete" type="button" onClick={() => removeSavedTreeSnapshot(snapshot.id)} aria-label={`${localizedText(passiveCopy.deleteTree, "", locale)}: ${snapshot.name}`}>
                    <span className="material-symbols-rounded" aria-hidden="true">close</span>
                  </button>
                </article>
              )) : (
                <p>{localizedText(passiveCopy.noSavedTrees, "", locale)}</p>
              )}
            </div>
          ) : null}
        </div>
        ) : null}
        <label title={lockedClass ? (vi ? "Class của build đã cố định, không thể đổi" : "Build class is locked and cannot be changed") : undefined}>
          <span>{localizedText(passiveCopy.class, "", locale)}</span>
          <select value={classFilter} disabled={Boolean(lockedClass)} onChange={(event) => selectClass(event.target.value)} aria-label="classFilter">
            {!lockedClass ? <option value="">{localizedText(passiveCopy.all, "", locale)}</option> : null}
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
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={onSearchKeyDown} placeholder={localizedText(passiveCopy.search, "", locale)} aria-label="search" />
        </label>
        <button className="passive-action passive-action--accent" type="button" onClick={() => { setImportErr(""); setImportOpen(true); }} title="Nhập build từ Path of Building" aria-label="Import POB">
          <span className="material-symbols-rounded" aria-hidden="true">content_paste</span>
          <span>Nhập POB</span>
        </button>
        <button className="passive-action" type="button" onClick={() => fitTo("build")} title="Fit map" aria-label="Fit map">
          <span className="material-symbols-rounded" aria-hidden="true">fit_screen</span>
          <span>Fit</span>
        </button>
        <button className="passive-action" type="button" onClick={() => fitTo("tree")} title="Reset view" aria-label="Reset view">
          <span className="material-symbols-rounded" aria-hidden="true">center_focus_strong</span>
          <span>Reset</span>
        </button>
      </div>
      <div className="passive-stage" ref={stageRef} tabIndex={-1} onKeyDown={onStageKeyDown}>
        <TreeCanvas
          fitBounds={fitBounds}
          tree={tree}
          searchIds={visibleSearchIds}
          allocatedIds={allocatedIds}
          allocationEnabled={allocationEnabled}
          classFilter={classFilter}
          ascendancyFilter={ascendancyFilter}
          command={command}
          onHover={onTreeHover}
          onToggle={toggleAllocated}
          onZoomChange={handleZoomChange}
          marks={treeMarks}
          dropType={jewels?.dragType}
          onNodeDrop={jewels ? onNodeDrop : undefined}
        />

        <div className={`passive-overlay-tl ${embedded ? "has-search" : ""}`}>
        <div className="passive-quickbar" role="toolbar" aria-label={vi ? "Tìm, hoàn tác, khung nhìn" : "Search, undo, view"}>
          {embedded ? (
            <div className={`passive-quick-search ${search.trim() && !searchMatches.length ? "is-empty" : ""}`}>
              <span className="material-symbols-rounded" aria-hidden="true">search</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={vi ? "Tìm điểm, chỉ số…" : "Find node, stat…"}
                aria-label={vi ? "Tìm điểm theo tên hoặc chỉ số" : "Find a node by name or stat"}
                enterKeyHint="search"
              />
              {search.trim() ? (
                <>
                  <small aria-live="polite">{searchMatches.length ? `${searchIndex >= 0 ? searchIndex + 1 : "–"}/${searchMatches.length}` : "0"}</small>
                  <button type="button" className="passive-quick-prev" onClick={() => jumpToMatch(-1)} disabled={!searchMatches.length} title={vi ? "Kết quả trước (Shift+Enter)" : "Previous match (Shift+Enter)"} aria-label={vi ? "Kết quả trước" : "Previous match"}>
                    <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
                  </button>
                  <button type="button" onClick={() => jumpToMatch(1)} disabled={!searchMatches.length} title={vi ? "Tới kết quả tiếp (Enter)" : "Next match (Enter)"} aria-label={vi ? "Kết quả tiếp" : "Next match"}>
                    <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {!readOnly ? (
            <div className="passive-quick-group">
              <button type="button" onClick={undoTreeEdit} disabled={!canUndo(history)} title={vi ? "Hoàn tác (Ctrl+Z)" : "Undo (Ctrl+Z)"} aria-label={vi ? "Hoàn tác" : "Undo"}>
                <span className="material-symbols-rounded" aria-hidden="true">undo</span>
              </button>
              <button type="button" onClick={redoTreeEdit} disabled={!canRedo(history)} title={vi ? "Làm lại (Ctrl+Y / Ctrl+Shift+Z)" : "Redo (Ctrl+Y / Ctrl+Shift+Z)"} aria-label={vi ? "Làm lại" : "Redo"}>
                <span className="material-symbols-rounded" aria-hidden="true">redo</span>
              </button>
            </div>
          ) : null}
          <div className="passive-quick-group passive-quick-fit" role="group" aria-label={vi ? "Khung nhìn" : "View"}>
            <button type="button" className={fitMode === "build" ? "is-active" : ""} onClick={() => fitTo("build")} aria-pressed={fitMode === "build"} title={vi ? "Thu phóng vừa các điểm đã chọn" : "Fit the allocated nodes"}>
              <span className="material-symbols-rounded" aria-hidden="true">fit_screen</span>
              <span className="passive-quick-label">{vi ? "Vừa build" : "Fit build"}</span>
            </button>
            <button type="button" className={fitMode === "tree" ? "is-active" : ""} onClick={() => fitTo("tree")} aria-pressed={fitMode === "tree"} title={vi ? "Xem toàn bộ cây" : "Show the whole tree"}>
              <span className="material-symbols-rounded" aria-hidden="true">zoom_out_map</span>
              <span className="passive-quick-label">{vi ? "Toàn cây" : "Whole tree"}</span>
            </button>
          </div>
        </div>

        {!readOnly && activeMode === "build" ? (
          <div className="passive-alloc-mode" role="group" aria-label={vi ? "Điểm cho cây chính hay bộ vũ khí" : "Allocate to"}>
            <div className="passive-alloc-mode-row">
              {([0, 1, 2] as AllocMode[]).map((mode) => {
                const used = mode === 1 ? setCounts.set1 : mode === 2 ? setCounts.set2 : 0;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`passive-alloc-mode-btn ${allocMode === mode ? "is-active" : ""} ${mode && used > WEAPON_SET_POINTS ? "is-danger" : ""}`}
                    style={mode ? { ["--set-color" as string]: WEAPON_SET_COLORS[mode as 1 | 2] } : undefined}
                    onClick={() => setAllocMode(mode)}
                    aria-pressed={allocMode === mode}
                    title={mode ? (vi ? `Điểm chọn lúc này chỉ có tác dụng khi cầm bộ vũ khí ${mode}. Còn ${Math.max(WEAPON_SET_POINTS - used, 0)} điểm.` : `Points for weapon set ${mode}`) : (vi ? "Điểm dùng cho mọi bộ vũ khí" : "Points for both weapon sets")}
                  >
                    {mode ? <i aria-hidden="true" /> : null}
                    <span>{vi ? (mode ? `Bộ ${mode}` : "Cây chính") : (mode ? `Set ${mode}` : "Main")}</span>
                    {mode ? <small>{used}/{WEAPON_SET_POINTS}</small> : null}
                  </button>
                );
              })}
            </div>
            <div className="passive-alloc-mode-row passive-alloc-attr" title={vi ? "Thuộc tính cho các điểm \"+5 bất kỳ thuộc tính\" chọn mới" : "Attribute for new attribute nodes"}>
              <span>{vi ? "Điểm +5:" : "+5 nodes:"}</span>
              {(["str", "dex", "int"] as AttributeChoice[]).map((choice) => (
                <button key={choice} type="button" className={`passive-attr-btn is-${choice} ${defaultAttribute === choice ? "is-active" : ""}`} onClick={() => setDefaultAttribute(choice)} aria-pressed={defaultAttribute === choice}>
                  {ATTRIBUTE_LABELS[choice].short}
                </button>
              ))}
            </div>
            {allocMode ? <p className="passive-alloc-mode-hint">{vi ? `Đang chọn điểm cho bộ vũ khí ${allocMode}` : `Allocating weapon set ${allocMode}`}</p> : null}
          </div>
        ) : null}
        </div>

        {jewels?.carried && !jewels.carried.dragging ? (
          <div className="passive-carry-banner" role="status">
            <span className="material-symbols-rounded" aria-hidden="true">diamond</span>
            <span>{vi ? <>Bấm vào một ô ngọc đang sáng để gắn <b>{jewels.carried.name}</b>.</> : <>Click a lit socket to put in <b>{jewels.carried.name}</b>.</>}</span>
            <button type="button" onClick={jewels.onCancelCarried}>{vi ? "Hủy" : "Cancel"}</button>
          </div>
        ) : null}

        {/* Zoom Slider Overlay */}
        <div className="passive-zoom-control" style={{
          position: "absolute",
          right: "16px",
          bottom: "16px",
          background: "rgba(10, 12, 16, 0.85)",
          border: "1px solid var(--line)",
          borderRadius: "8px",
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          zIndex: 100,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)"
        }}>
          <button
            type="button"
            onClick={() => handleZoomStep(1 / 1.2)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              padding: "4px"
            }}
            title={locale === "vi" ? "Thu nhỏ" : "Zoom Out"}
          >
            <span className="material-symbols-rounded" style={{ fontSize: "16px" }}>remove</span>
          </button>
          <input
            type="range"
            min={embedded ? "0.016" : "0.012"}
            max="1.5"
            step="0.005"
            value={zoom}
            onChange={(e) => handleSliderChange(parseFloat(e.target.value))}
            style={{
              width: embedded ? "80px" : "110px",
              accentColor: "var(--gold)",
              cursor: "pointer",
              background: "rgba(255,255,255,0.1)",
              height: "4px",
              borderRadius: "2px",
              outline: "none"
            }}
          />
          <button
            type="button"
            onClick={() => handleZoomStep(1.2)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              padding: "4px"
            }}
            title={locale === "vi" ? "Phóng to" : "Zoom In"}
          >
            <span className="material-symbols-rounded" style={{ fontSize: "16px" }}>add</span>
          </button>
          <span style={{ fontSize: "10px", color: "var(--gold)", minWidth: "32px", textAlign: "right", fontWeight: "bold" }}>
            {Math.round(zoom * 100)}%
          </span>
        </div>
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
                    {!readOnly ? (
                      <>
                        <button className={`passive-build-save ${hasUnsavedTreeChanges ? "has-changes" : ""}`} type="button" onClick={saveCurrentTree} disabled={!currentBuildSnapshot || passiveCount(currentBuildSnapshot) <= 0} title={localizedText(passiveCopy.saveTree, "", locale)} aria-label={localizedText(passiveCopy.saveTree, "", locale)}>
                          <span className="material-symbols-rounded" aria-hidden="true">save</span>
                          <span>Save</span>
                        </button>
                        <button className="passive-build-clear" type="button" onClick={clearBuild} title={localizedText(passiveCopy.clearBuild, "", locale)} aria-label={localizedText(passiveCopy.clearBuild, "", locale)}>
                          <span className="material-symbols-rounded" aria-hidden="true">delete_sweep</span>
                          <span>Clear</span>
                        </button>
                      </>
                    ) : null}
                    <button className="passive-panel-collapse" type="button" onClick={() => setBuildPanelCollapsed(true)} aria-label="Hide build summary" title="Hide panel">
                      <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
                    </button>
                  </div>
                </div>
                <div className="passive-build-meters">
                  <span className={buildCounts.passive >= BUILD_PASSIVE_LIMIT ? "is-danger" : ""}><strong>{formatNumber(buildCounts.passive, locale)}</strong>/{BUILD_PASSIVE_LIMIT} {localizedText(passiveCopy.passives, "", locale)}</span>
                  <span className={buildCounts.ascendancy >= BUILD_ASCENDANCY_LIMIT ? "is-danger" : ""}><strong>{formatNumber(buildCounts.ascendancy, locale)}</strong>/{BUILD_ASCENDANCY_LIMIT} {localizedText(passiveCopy.ascendancyPoints, "", locale)}</span>
                  {setCounts.set1 || setCounts.set2 ? (
                    <>
                      <span className={setCounts.set1 > WEAPON_SET_POINTS ? "is-danger" : ""}><strong>{formatNumber(setCounts.set1, locale)}</strong>/{WEAPON_SET_POINTS} {vi ? "bộ 1" : "set 1"}</span>
                      <span className={setCounts.set2 > WEAPON_SET_POINTS ? "is-danger" : ""}><strong>{formatNumber(setCounts.set2, locale)}</strong>/{WEAPON_SET_POINTS} {vi ? "bộ 2" : "set 2"}</span>
                    </>
                  ) : null}
                </div>
                <label className="passive-build-name">
                  <span>{localizedText(passiveCopy.treeName, "", locale)}</span>
                  <input value={treeBuildName} onChange={(event) => setTreeBuildName(event.target.value)} placeholder={`${classFilter || "Class"} ${ascendancyFilter || "tree"}`} />
                </label>
                {saveMessage ? <p className="passive-build-saved">{saveMessage}</p> : null}
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
        {activeMode === "items" && pob ? (
          <aside className="passive-build-panel passive-pob-panel passive-side-panel">
            <div className="passive-panel-title">
              <span className="material-symbols-rounded" aria-hidden="true">backpack</span>
              <div>
                <h2 translate="no">{pob.className || "Build"}{pob.ascendClassName ? ` · ${pob.ascendClassName}` : ""}</h2>
                <p>Lv {formatNumber(pob.level, locale)} · {formatNumber(pob.nodeIds.length, locale)} node · {formatNumber(pob.items.length, locale)} item · {formatNumber(pob.skills.length, locale)} skill</p>
              </div>
            </div>

            {pob.stats.length ? (
              <div className="passive-build-section">
                <h3>Chỉ số</h3>
                <div className="passive-pob-stats" translate="no">
                  {POB_KEY_STATS.map((def) => {
                    const row = pob.stats.find((s) => s.stat === def.key);
                    if (!row) return null;
                    const val = def.round ? Math.round(row.value).toLocaleString("en-US") : (Math.round(row.value * 100) / 100).toString();
                    return <span className="passive-pob-stat" key={def.key}><small>{def.label}</small><strong>{val}</strong></span>;
                  })}
                </div>
              </div>
            ) : null}

            {pob.skills.length ? (
              <div className="passive-build-section">
                <h3>Skills &amp; Gems</h3>
                <div className="passive-pob-skills" translate="no">
                  {pob.skills.map((group, gi) => (
                    <div className={`passive-pob-skill ${group.enabled ? "" : "is-off"}`} key={`${group.slot}-${gi}`}>
                      {group.slot ? <span className="passive-pob-slot">{group.slot}{group.source ? " · granted" : ""}</span> : null}
                      {group.gems.map((gem, idx) => (
                        <div className={`passive-pob-gem ${gem.enabled ? "" : "is-off"} ${gem.support ? "is-support" : ""}`} key={`${gem.name}-${idx}`}>
                          <span>{gem.support ? "↳ " : ""}{gem.name}</span>
                          {gem.level ? <small>L{gem.level}{gem.quality ? ` · Q${gem.quality}` : ""}</small> : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {pob.items.length ? POB_ITEM_CATEGORIES.map((cat) => {
              const list = pob.items.filter((it) => it.category === cat);
              if (!list.length) return null;
              return (
                <div className="passive-build-section" key={cat}>
                  <h3>{cat} <span className="passive-pob-count">{list.length}</span></h3>
                  <div className="passive-pob-items" translate="no">
                    {list.map((item) => (
                      <details className={`passive-pob-item rarity-${(item.rarity || "normal").toLowerCase()}`} key={item.id}>
                        <summary>
                          {item.slot ? <span className="passive-pob-slot">{item.slot}</span> : null}
                          <strong>{item.name || item.baseType || "Item"}</strong>
                          <small>{[item.baseType && item.baseType !== item.name ? item.baseType : "", item.itemLevel ? `iLvl ${item.itemLevel}` : "", item.corrupted ? "Corrupted" : ""].filter(Boolean).join(" · ")}</small>
                        </summary>
                        {item.implicits.length ? <div className="passive-pob-mods is-implicit">{item.implicits.map((m, i) => <p key={`i${i}`}>{m}</p>)}</div> : null}
                        {item.explicits.length ? <div className="passive-pob-mods">{item.explicits.map((m, i) => <p key={`e${i}`}>{m}</p>)}</div> : null}
                        {!item.implicits.length && !item.explicits.length ? <pre>{item.text}</pre> : null}
                      </details>
                    ))}
                  </div>
                </div>
              );
            }) : null}

            {pob.jewels.length || pob.masteries.length ? (
              <div className="passive-build-section">
                <h3>Tree</h3>
                <p className="passive-pob-meta" translate="no">
                  {formatNumber(pob.nodeIds.length, locale)} node · {formatNumber(pob.masteries.length, locale)} mastery
                  {pob.treeVersion ? ` · tree ${pob.treeVersion.replace(/_/g, ".")}` : ""}
                </p>
                {pob.jewels.length ? (
                  <div className="passive-pob-skills" translate="no">
                    {pob.jewels.map((j, i) => <div className="passive-pob-gem" key={`${j.nodeId}-${i}`}><span>💎 {j.name}</span></div>)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {pob.configs.length ? (
              <details className="passive-build-section passive-pob-config">
                <summary><h3 style={{ display: "inline" }}>Config <span className="passive-pob-count">{pob.configs.length}</span></h3></summary>
                <div className="passive-pob-mods" translate="no">
                  {pob.configs.map((c, i) => <p key={i}>{c.name}: <strong>{c.value}</strong></p>)}
                </div>
              </details>
            ) : null}
          </aside>
        ) : null}
        {(() => {
          // While a jewel is dragged the browser sends no hover, so the socket under it shows here.
          const shown = dragHover ? { ...dragHover, held: false } : hover.node ? hover : null;
          if (!shown?.node || nodeMenu) return null;
          const node = shown.node;
          const nodeAllocated = allocatedIds.has(node.id);
          // Would a click take this node? If not, the tooltip says why instead of promising it.
          const refusal = allocationEnabled && !nodeAllocated && !dragHover && !selectedStartIds.has(node.id) && !(jewels?.carried && node.jewelSocket)
            ? planAllocation(node).refusal
            : "";
          const extra = renderNodeExtra?.(node, nodeAllocated, Boolean(refusal));
          const picks = nodePickTooltip(node);
          // The tooltip is placed inside the stage; embedded trees do not start at the window's corner.
          const box = embedded ? stageRef.current?.getBoundingClientRect() : null;
          const width = box?.width ?? window.innerWidth;
          const x = shown.x - (box?.left ?? 0);
          const y = shown.y - (box?.top ?? 0);
          // On a phone the stage is narrower than the tooltip's usual 360px: keep it inside.
          const tipWidth = Math.min(360, width - 8);
          return (
            <div className={`passive-tooltip ${!dragHover && hover.held ? "is-held" : ""} ${extra ? "has-node-extra" : ""} ${picks ? "has-tree-pick" : ""}`} ref={tooltipRef} data-top={Math.max(4, y + 18)} data-cursor-y={y} style={{ left: Math.max(4, Math.min(x + 18, width - tipWidth - 20)), top: Math.max(4, y + 18), maxWidth: tipWidth }}>
              <strong translate="no">{node.name || `Node ${node.id}`}</strong>
              <span>{node.type}</span>
              {node.stats.slice(0, 5).map((line) => <p key={line}>{formatPassiveStatText(line)}</p>)}
              {picks}
              {refusal ? <p className="passive-tooltip-refusal">{refusal}</p> : null}
              {extra}
            </div>
          );
        })()}
        {buildLimitWarning ? (
          <div className="passive-stage-toast" role="alert">
            <span className="material-symbols-rounded" aria-hidden="true">block</span>
            <span>{buildLimitWarning}</span>
          </div>
        ) : null}
        {nodeMenu ? (
          <div className="passive-node-menu-backdrop" onClick={() => setNodeMenu(null)}>
            <div
              className="passive-node-menu"
              role="dialog"
              aria-label={nodeMenu.node.name}
              onClick={(event) => event.stopPropagation()}
              style={nodeMenuPosition(nodeMenu.x, nodeMenu.y)}
            >
              <div className="passive-node-menu-head">
                <strong translate="no">{nodeMenu.node.name || `Node ${nodeMenu.node.id}`}</strong>
                <button type="button" onClick={() => setNodeMenu(null)} aria-label={vi ? "Đóng" : "Close"}>
                  <span className="material-symbols-rounded" aria-hidden="true">close</span>
                </button>
              </div>
              {nodeMenu.node.isAttribute ? (
                <div className="passive-node-menu-attrs">
                  <p>{vi ? "Điểm này cho +5 vào thuộc tính:" : "This node gives +5 to:"}</p>
                  {(["str", "dex", "int"] as AttributeChoice[]).map((choice) => (
                    <button key={choice} type="button" className={`passive-attr-btn is-${choice} ${attributeChoices[nodeMenu.node.id] === choice ? "is-active" : ""}`} onClick={() => { chooseAttribute(nodeMenu.node.id, choice); setNodeMenu(null); }} aria-pressed={attributeChoices[nodeMenu.node.id] === choice}>
                      {vi ? ATTRIBUTE_LABELS[choice].vi : ATTRIBUTE_LABELS[choice].en}
                    </button>
                  ))}
                </div>
              ) : null}
              {nodeMenu.node.jewelSocket && jewels ? jewels.renderSocketMenu(nodeMenu.node, allocatedIds.has(nodeMenu.node.id), () => setNodeMenu(null)) : null}
              {allocatedIds.has(nodeMenu.node.id) ? (
                <button type="button" className="passive-node-menu-refund" onClick={() => refundNode(nodeMenu.node)}>
                  <span className="material-symbols-rounded" aria-hidden="true">undo</span>
                  {vi ? "Bỏ điểm này" : "Refund this node"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {importOpen ? (
        <div className="passive-import-overlay" onClick={() => !importing && setImportOpen(false)}>
          <div className="passive-import-modal" onClick={(event) => event.stopPropagation()}>
            <div className="passive-import-head">
              <h2>Nhập build từ Path of Building</h2>
              <button type="button" onClick={() => setImportOpen(false)} aria-label="Đóng" disabled={importing}>✕</button>
            </div>
            <p>Dán <strong>build code</strong> (Path of Building → Import/Export → Generate) hoặc link <strong>pobb.in</strong> / <strong>pastebin</strong>.</p>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="eNrtv… hoặc https://pobb.in/xxxxxxxx"
              rows={6}
              spellCheck={false}
              autoFocus
            />
            {importErr ? <p className="passive-import-error">{importErr}</p> : null}
            <div className="passive-import-actions">
              <button type="button" className="passive-action" onClick={() => setImportOpen(false)} disabled={importing}>Hủy</button>
              <button type="button" className="passive-action passive-action--accent" onClick={doImport} disabled={importing || !importText.trim()}>
                {importing ? "Đang đọc…" : "Load build"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export function PassiveTreePage({ locale }: { locale: Locale }) {
  return <PassiveTreeWorkspace locale={locale} />;
}
