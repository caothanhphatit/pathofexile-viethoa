(function attachPassiveTreePlanner(root) {
  "use strict";

  const VERSION = 1;
  const CLASS_DISC_RADIUS_SCALE = 0.91;
  const CLASS_DISC_STROKE_RATIO = 0.82;

  const cleanText = (value) => String(value || "").trim();
  const cleanNodeId = (value) => String(value ?? "").trim();
  const uniqueSortedIds = (values = []) => {
    const ids = [...new Set([...values].map(cleanNodeId).filter(Boolean))];
    return ids.sort((left, right) => {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
      return left.localeCompare(right);
    });
  };

  const setFrom = (values = []) => new Set([...values].map(cleanNodeId).filter(Boolean));

  const finiteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

  const roundMapCoord = (value) => Number(Number(value || 0).toFixed(4));

  const rectFrom = ({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    padding = 0
  } = {}) => {
    const left = Math.min(finiteNumber(x), finiteNumber(x) + finiteNumber(width)) - finiteNumber(padding);
    const right = Math.max(finiteNumber(x), finiteNumber(x) + finiteNumber(width)) + finiteNumber(padding);
    const top = Math.min(finiteNumber(y), finiteNumber(y) + finiteNumber(height)) - finiteNumber(padding);
    const bottom = Math.max(finiteNumber(y), finiteNumber(y) + finiteNumber(height)) + finiteNumber(padding);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };

  const rectsIntersect = (left, right) =>
    left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top;

  const spatialCellIndex = (value, cellSize) =>
    Math.floor(finiteNumber(value) / Math.max(finiteNumber(cellSize, 1), 1));

  const spatialCellKey = (cellX, cellY) => `${cellX}:${cellY}`;

  const buildPassiveSpatialIndex = (nodes = [], { cellSize = 720 } = {}) => {
    const size = Math.max(finiteNumber(cellSize, 720), 1);
    const cells = new Map();
    let order = 0;

    for (const node of nodes) {
      const x = Number(node?.x);
      const y = Number(node?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const entry = { node, x, y, order };
      order += 1;
      const key = spatialCellKey(spatialCellIndex(x, size), spatialCellIndex(y, size));
      const bucket = cells.get(key) || [];
      bucket.push(entry);
      cells.set(key, bucket);
    }

    return { cellSize: size, cells };
  };

  const queryPassiveSpatialIndex = (index = null, {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    padding = 0
  } = {}) => {
    if (!index?.cells?.size) return [];

    const size = Math.max(finiteNumber(index.cellSize, 720), 1);
    const left = Math.min(finiteNumber(x), finiteNumber(x) + finiteNumber(width)) - finiteNumber(padding);
    const right = Math.max(finiteNumber(x), finiteNumber(x) + finiteNumber(width)) + finiteNumber(padding);
    const top = Math.min(finiteNumber(y), finiteNumber(y) + finiteNumber(height)) - finiteNumber(padding);
    const bottom = Math.max(finiteNumber(y), finiteNumber(y) + finiteNumber(height)) + finiteNumber(padding);
    const matches = [];

    for (let cellX = spatialCellIndex(left, size); cellX <= spatialCellIndex(right, size); cellX += 1) {
      for (let cellY = spatialCellIndex(top, size); cellY <= spatialCellIndex(bottom, size); cellY += 1) {
        const bucket = index.cells.get(spatialCellKey(cellX, cellY));
        if (!bucket) continue;
        for (const entry of bucket) {
          if (entry.x >= left && entry.x <= right && entry.y >= top && entry.y <= bottom) {
            matches.push(entry);
          }
        }
      }
    }

    matches.sort((leftEntry, rightEntry) => leftEntry.order - rightEntry.order);
    return matches.map((entry) => entry.node);
  };

  const buildPassiveRectSpatialIndex = (items = [], { cellSize = 960, getBounds = (item) => item } = {}) => {
    const size = Math.max(finiteNumber(cellSize, 960), 1);
    const cells = new Map();
    let order = 0;

    for (const item of items) {
      const bounds = rectFrom(getBounds(item) || {});
      const entry = { item, ...bounds, order };
      order += 1;

      for (let cellX = spatialCellIndex(bounds.left, size); cellX <= spatialCellIndex(bounds.right, size); cellX += 1) {
        for (let cellY = spatialCellIndex(bounds.top, size); cellY <= spatialCellIndex(bounds.bottom, size); cellY += 1) {
          const key = spatialCellKey(cellX, cellY);
          const bucket = cells.get(key) || [];
          bucket.push(entry);
          cells.set(key, bucket);
        }
      }
    }

    return { cellSize: size, cells };
  };

  const queryPassiveRectSpatialIndex = (index = null, bounds = {}) => {
    if (!index?.cells?.size) return [];

    const size = Math.max(finiteNumber(index.cellSize, 960), 1);
    const rect = rectFrom(bounds);
    const matches = [];
    const seenOrders = new Set();

    for (let cellX = spatialCellIndex(rect.left, size); cellX <= spatialCellIndex(rect.right, size); cellX += 1) {
      for (let cellY = spatialCellIndex(rect.top, size); cellY <= spatialCellIndex(rect.bottom, size); cellY += 1) {
        const bucket = index.cells.get(spatialCellKey(cellX, cellY));
        if (!bucket) continue;
        for (const entry of bucket) {
          if (seenOrders.has(entry.order) || !rectsIntersect(entry, rect)) continue;
          seenOrders.add(entry.order);
          matches.push(entry);
        }
      }
    }

    matches.sort((leftEntry, rightEntry) => leftEntry.order - rightEntry.order);
    return matches.map((entry) => entry.item);
  };

  const clampPassiveMapView = (view = {}, bounds = {}, {
    overscrollRatio = 0.22,
    minWidth = 1,
    maxWidth = Infinity
  } = {}) => {
    const sourceWidth = Math.max(finiteNumber(view.width, bounds.width || 1), 1);
    const sourceHeight = Math.max(finiteNumber(view.height, bounds.height || sourceWidth), 1);
    const aspect = sourceHeight / sourceWidth;
    const width = clampNumber(sourceWidth, Math.max(finiteNumber(minWidth, 1), 1), Math.max(finiteNumber(maxWidth, Infinity), 1));
    const height = width === sourceWidth ? sourceHeight : width * aspect;
    const ratio = clampNumber(finiteNumber(overscrollRatio, 0.22), 0, 1);
    const box = rectFrom(bounds);

    const clampAxis = (value, viewSize, start, size) => {
      const overscroll = viewSize * ratio;
      const hardMin = start;
      const hardMax = start + size - viewSize;
      if (hardMin <= hardMax) return clampNumber(finiteNumber(value), hardMin - overscroll, hardMax + overscroll);

      const center = start + (size - viewSize) / 2;
      return clampNumber(finiteNumber(value), center - overscroll, center + overscroll);
    };

    return {
      x: roundMapCoord(clampAxis(view.x, width, box.left, box.width)),
      y: roundMapCoord(clampAxis(view.y, height, box.top, box.height)),
      width: roundMapCoord(width),
      height: roundMapCoord(height)
    };
  };

  const ascendancyLayerName = (node = {}) => cleanText(node?.ascendancy_name || node?.ascendancyName);
  const classStartNames = (node = {}) => [
    ...(Array.isArray(node.classes_start) ? node.classes_start : []),
    ...(Array.isArray(node.classesStart) ? node.classesStart : [])
  ].map(cleanText).filter(Boolean);

  const isClassStartNode = (node = {}) => Boolean(node?.is_class_start || node?.classesStart || node?.classes_start?.length);

  const shouldDrawTreeConnection = (fromNode = null, toNode = null, { maxDistance = Infinity } = {}) => {
    if (!fromNode || !toNode) return false;
    if (ascendancyLayerName(fromNode) !== ascendancyLayerName(toNode)) return false;
    if (isClassStartNode(fromNode) && isClassStartNode(toNode)) return false;

    const distanceLimit = Number(maxDistance);
    if (!Number.isFinite(distanceLimit)) return true;

    const fromX = Number(fromNode.x);
    const fromY = Number(fromNode.y);
    const toX = Number(toNode.x);
    const toY = Number(toNode.y);
    if (![fromX, fromY, toX, toY].every(Number.isFinite)) return false;
    return Math.hypot(fromX - toX, fromY - toY) <= distanceLimit;
  };

  const shouldShowPassiveTreeNode = (node = {}, {
    className = "",
    ascendancyName = "",
    type = "all"
  } = {}) => {
    const nodeLayer = ascendancyLayerName(node);
    const selectedClass = cleanText(className);
    const selectedAscendancy = cleanText(ascendancyName);
    const selectedType = cleanText(type);
    const startClasses = classStartNames(node);
    const typeOk = !selectedType || selectedType === "all" || node.type === selectedType;
    const layerOk = selectedAscendancy ? !nodeLayer || nodeLayer === selectedAscendancy : !nodeLayer;
    const classOk = !selectedClass ||
      !isClassStartNode(node) ||
      !startClasses.length ||
      startClasses.includes(selectedClass);
    return typeOk && layerOk && classOk;
  };

  const passiveTreeConnectionArcCenter = ({
    fromNode = null,
    toNode = null,
    orbit = 0,
    orbitRadii = []
  } = {}) => {
    const edgeOrbit = Number(orbit || 0);
    if (!fromNode || !toNode || edgeOrbit === 0) return null;
    const radius = Number(orbitRadii[Math.abs(edgeOrbit)] || 0);
    if (!Number.isFinite(radius) || radius <= 0) return null;

    const fromX = Number(fromNode.x);
    const fromY = Number(fromNode.y);
    const toX = Number(toNode.x);
    const toY = Number(toNode.y);
    if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null;

    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance) || distance <= 0 || distance >= radius * 2) return null;

    const perpendicular = Math.sqrt(Math.max(radius * radius - (distance * distance) / 4, 0)) * (edgeOrbit > 0 ? 1 : -1);
    return {
      x: roundMapCoord(fromX + deltaX / 2 + perpendicular * (deltaY / distance)),
      y: roundMapCoord(fromY + deltaY / 2 - perpendicular * (deltaX / distance)),
      radius: roundMapCoord(radius)
    };
  };

  const passiveTreeConnectorGeometry = ({
    edge = null,
    groupCenter = null,
    orbitRadii = []
  } = {}) => {
    const fromNode = edge?.fromNode || edge?.from || null;
    const toNode = edge?.toNode || edge?.to || null;
    if (!fromNode || !toNode) return { kind: "line" };

    const edgeOrbit = Number(edge?.orbit || 0);
    if (edgeOrbit !== 0) {
      const arcCenter = passiveTreeConnectionArcCenter({
        fromNode,
        toNode,
        orbit: edgeOrbit,
        orbitRadii
      });
      if (arcCenter) {
        return {
          kind: "arc",
          center: { x: arcCenter.x, y: arcCenter.y },
          radius: arcCenter.radius
        };
      }
      return { kind: "line" };
    }

    const sameGroup = cleanNodeId(fromNode.group) &&
      cleanNodeId(fromNode.group) === cleanNodeId(toNode.group);
    const sameOrbit = Number(fromNode.orbit || 0) === Number(toNode.orbit || 0);
    if (sameGroup && sameOrbit && groupCenter) {
      const radius = Number(orbitRadii[Number(fromNode.orbit || 0)] || 0);
      const centerX = Number(groupCenter.x);
      const centerY = Number(groupCenter.y);
      if (Number.isFinite(radius) && radius > 0 && Number.isFinite(centerX) && Number.isFinite(centerY)) {
        return {
          kind: "arc",
          center: {
            x: roundMapCoord(centerX),
            y: roundMapCoord(centerY)
          },
          radius: roundMapCoord(radius)
        };
      }
    }

    return { kind: "line" };
  };

  const passiveTreeBackgroundRadius = (background = {}) => {
    const candidates = [
      background.width,
      background.height,
      background.active?.width,
      background.active?.height,
      background.bg?.width,
      background.bg?.height
    ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
    return Math.max(...candidates, 1200);
  };

  const passiveTreeClassDiscStrokeRadius = (background = {}) =>
    roundMapCoord(passiveTreeBackgroundRadius(background) * CLASS_DISC_RADIUS_SCALE * CLASS_DISC_STROKE_RATIO);

  const projectClassStartNodeToClassDisc = ({ node = null, classBackground = null } = {}) => {
    if (!node || !classBackground || !isClassStartNode(node)) return node;
    const centerX = finiteNumber(classBackground.x, 0);
    const centerY = finiteNumber(classBackground.y, 0);
    const nodeX = Number(node.x);
    const nodeY = Number(node.y);
    if (![nodeX, nodeY].every(Number.isFinite)) return node;

    const deltaX = nodeX - centerX;
    const deltaY = nodeY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(distance) || distance <= 0) return node;

    const radius = passiveTreeClassDiscStrokeRadius(classBackground);
    return {
      ...node,
      x: roundMapCoord(centerX + (deltaX / distance) * radius),
      y: roundMapCoord(centerY + (deltaY / distance) * radius)
    };
  };

  const projectClassStartNodesToClassDisc = ({ nodes = [], classBackground = null } = {}) =>
    nodes.map((node) => projectClassStartNodeToClassDisc({ node, classBackground }));

  const bytesToBinary = (bytes) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return binary;
  };

  const binaryToBytes = (binary) => {
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };

  const toBase64 = (value) => {
    if (typeof root.btoa === "function" && typeof root.TextEncoder === "function") {
      return root.btoa(bytesToBinary(new root.TextEncoder().encode(value)));
    }
    if (typeof btoa === "function" && typeof TextEncoder === "function") {
      return btoa(bytesToBinary(new TextEncoder().encode(value)));
    }
    return "";
  };

  const fromBase64 = (value) => {
    const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
    if (typeof root.atob === "function" && typeof root.TextDecoder === "function") {
      return new root.TextDecoder().decode(binaryToBytes(root.atob(padded)));
    }
    if (typeof atob === "function" && typeof TextDecoder === "function") {
      return new TextDecoder().decode(binaryToBytes(atob(padded)));
    }
    return "";
  };

  const encodeBase64Url = (value) => toBase64(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const decodeBase64Url = (value) => fromBase64(String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/"));

  const allocatedBuildNodeIds = (allocatedNodeIds = [], freeStartNodeIds = []) => {
    const freeStarts = setFrom(freeStartNodeIds);
    return uniqueSortedIds(allocatedNodeIds).filter((id) => !freeStarts.has(id));
  };

  const encodePassiveBuildState = ({
    className = "",
    ascendancyName = "",
    nodeIds = [],
    freeStartNodeIds = [],
    selectedNodeId = "",
    version = ""
  } = {}) => {
    const payload = {
      v: VERSION,
      c: cleanText(className),
      a: cleanText(ascendancyName),
      n: allocatedBuildNodeIds(nodeIds, freeStartNodeIds),
      s: cleanNodeId(selectedNodeId),
      t: cleanText(version)
    };

    if (!payload.c && !payload.a && !payload.n.length && !payload.s) return "";
    return encodeBase64Url(JSON.stringify(payload));
  };

  const decodePassiveBuildState = (code = "") => {
    const clean = cleanText(code);
    if (!clean) return null;
    try {
      const payload = JSON.parse(decodeBase64Url(clean));
      if (!payload || Number(payload.v || 0) !== VERSION) return null;
      return {
        className: cleanText(payload.c),
        ascendancyName: cleanText(payload.a),
        nodeIds: uniqueSortedIds(payload.n || []),
        selectedNodeId: cleanNodeId(payload.s),
        version: cleanText(payload.t)
      };
    } catch {
      return null;
    }
  };

  const nodeWeight = (node = {}) => ({
    keystone: 0,
    ascendancy_notable: 1,
    notable: 2,
    jewel: 3,
    mastery: 4,
    ascendancy: 5,
    small: 6
  }[node.type] ?? 7);

  const passiveStatGroupOrder = [
    "Attributes",
    "Damage",
    "Defences",
    "Life",
    "Mana",
    "Skill Speed",
    "Minions",
    "Totems",
    "Charges",
    "Misc"
  ];

  const passiveStatGroupLabel = (line = "") => {
    const text = cleanText(line).toLowerCase();
    if (!text) return "Misc";
    if (/\battribute|strength|dexterity|intelligence|\+\d+(?:\.\d+)?\s+to\b/.test(text)) return "Attributes";
    if (/damage|attack|spell|critical|projectile|melee|elemental|fire|cold|lightning|chaos|physical|ignite|shock|freeze|poison|bleed/.test(text)) return "Damage";
    if (/armou?r|evasion|energy shield|block|resistance|defence|stun threshold|suppression/.test(text)) return "Defences";
    if (/\blife\b|regenerate|recoup|leech/.test(text)) return "Life";
    if (/\bmana\b|spirit/.test(text)) return "Mana";
    if (/speed|cooldown|recovery|duration/.test(text)) return "Skill Speed";
    if (/minion|allies|companion/.test(text)) return "Minions";
    if (/totem/.test(text)) return "Totems";
    if (/charge|frenzy|power|endurance/.test(text)) return "Charges";
    return "Misc";
  };

  const groupedPassiveStats = (rows = []) => {
    const buckets = new Map();
    for (const node of rows) {
      for (const stat of node.stats || []) {
        const line = cleanText(stat);
        if (!line) continue;
        const label = passiveStatGroupLabel(line);
        const bucket = buckets.get(label) || new Set();
        bucket.add(line);
        buckets.set(label, bucket);
      }
    }
    return passiveStatGroupOrder
      .filter((label) => buckets.has(label))
      .map((label) => ({ label, lines: [...buckets.get(label)] }));
  };

  const summarizeAllocatedNodes = ({
    nodeIds = [],
    nodesById = new Map(),
    freeStartNodeIds = [],
    maxImportant = 8
  } = {}) => {
    const freeStarts = setFrom(freeStartNodeIds);
    const rows = uniqueSortedIds(nodeIds)
      .filter((id) => !freeStarts.has(id))
      .map((id) => nodesById.get(id))
      .filter(Boolean);
    const typeCounts = {};
    let passivePoints = 0;
    let ascendancyPoints = 0;

    for (const node of rows) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
      if (node.ascendancy_name) ascendancyPoints += 1;
      else passivePoints += 1;
    }

    const importantNodes = rows
      .filter((node) => node.type !== "small" && node.type !== "ascendancy")
      .sort((left, right) => nodeWeight(left) - nodeWeight(right) || cleanText(left.name).localeCompare(cleanText(right.name)))
      .slice(0, Math.max(Number(maxImportant) || 0, 0));

    return {
      passivePoints,
      ascendancyPoints,
      typeCounts,
      importantNodes,
      statGroups: groupedPassiveStats(rows)
    };
  };

  const refundAllocatedNodeIds = ({
    targetId = "",
    allocatedNodeIds = [],
    startNodeIds = [],
    graphByNodeId = new Map(),
    visibleNodeIds = []
  } = {}) => {
    const target = cleanNodeId(targetId);
    const allocated = setFrom(allocatedNodeIds);
    const starts = setFrom(startNodeIds);
    if (!target || starts.has(target) || !allocated.has(target)) return new Set(allocated);
    const visible = visibleNodeIds && [...visibleNodeIds].length ? setFrom(visibleNodeIds) : new Set(allocated);
    const keep = new Set([...starts].filter((id) => allocated.has(id) && visible.has(id)));
    const queue = [...keep];
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      for (const rawNextId of graphByNodeId.get(current) || []) {
        const nextId = cleanNodeId(rawNextId);
        if (nextId === target || keep.has(nextId) || !allocated.has(nextId) || !visible.has(nextId)) continue;
        keep.add(nextId);
        queue.push(nextId);
      }
    }
    return keep;
  };

  const buildPassiveShareUrl = ({ location, state = {} } = {}) => {
    const source = typeof location === "string" ? location : String(location?.href || "");
    const url = new URL(source);
    const next = new URLSearchParams();
    const className = cleanText(state.className);
    const ascendancyName = cleanText(state.ascendancyName);
    const selectedNodeId = cleanNodeId(state.selectedNodeId);
    const code = encodePassiveBuildState(state);

    if (className) next.set("class", className);
    if (ascendancyName) next.set("ascendancy", ascendancyName);
    if (selectedNodeId) next.set("node", selectedNodeId);
    if (code) next.set("build", code);
    url.search = next.toString();
    url.hash = "";
    return url.toString();
  };

  const ascendancyCenterProjection = ({ ascendancyName = "", ascendancyMeta = null } = {}) => {
    const cleanName = cleanText(ascendancyName);
    const source = ascendancyMeta?.ascendancy?.background;
    if (!cleanName || !source) return null;
    const sourceX = Number(source.x);
    const sourceY = Number(source.y);
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null;
    const target = ascendancyMeta?.classRow?.background || {};
    const targetX = finiteNumber(target.x, 0);
    const targetY = finiteNumber(target.y, 0);
    return {
      ascendancyName: cleanName,
      dx: roundMapCoord(targetX - sourceX),
      dy: roundMapCoord(targetY - sourceY),
      x: roundMapCoord(targetX),
      y: roundMapCoord(targetY)
    };
  };

  const projectAscendancyBackgroundToClassDisc = ({ background = null, ascendancyName = "", ascendancyMeta = null } = {}) => {
    return projectAscendancyMapPointToClassDisc({
      point: background,
      ascendancyName,
      pointAscendancyName: ascendancyName,
      ascendancyMeta
    });
  };

  const projectAscendancyMapPointToClassDisc = ({
    point = null,
    ascendancyName = "",
    pointAscendancyName = "",
    ascendancyMeta = null
  } = {}) => {
    const projection = ascendancyCenterProjection({ ascendancyName, ascendancyMeta });
    if (!point || !projection || cleanText(pointAscendancyName) !== projection.ascendancyName) return point;
    return {
      ...point,
      x: roundMapCoord(finiteNumber(point.x) + projection.dx),
      y: roundMapCoord(finiteNumber(point.y) + projection.dy)
    };
  };

  const projectAscendancyNodesToClassDisc = ({ nodes = [], ascendancyName = "", ascendancyMeta = null } = {}) => {
    return nodes.map((node) => projectAscendancyMapPointToClassDisc({
      point: node,
      ascendancyName,
      pointAscendancyName: node?.ascendancy_name,
      ascendancyMeta
    }));
  };

  root.PoePassiveTreePlanner = {
    allocatedBuildNodeIds,
    ascendancyCenterProjection,
    buildPassiveSpatialIndex,
    buildPassiveRectSpatialIndex,
    buildPassiveShareUrl,
    clampPassiveMapView,
    decodePassiveBuildState,
    encodePassiveBuildState,
    passiveTreeBackgroundRadius,
    passiveTreeClassDiscStrokeRadius,
    passiveTreeConnectorGeometry,
    passiveTreeConnectionArcCenter,
    projectAscendancyBackgroundToClassDisc,
    projectAscendancyMapPointToClassDisc,
    projectAscendancyNodesToClassDisc,
    projectClassStartNodeToClassDisc,
    projectClassStartNodesToClassDisc,
    queryPassiveSpatialIndex,
    queryPassiveRectSpatialIndex,
    refundAllocatedNodeIds,
    shouldDrawTreeConnection,
    shouldShowPassiveTreeNode,
    summarizeAllocatedNodes
  };
})(window);
