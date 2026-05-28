import type { Camera } from "./camera";
import { CHANGE_COLORS, type PassiveTreeChangeMarker } from "./changes";
import type { PassiveNode, PassiveTreeModel } from "./tree";
import { filteredTreeNodes, nodeRadius } from "./tree";

export interface RenderOptions {
  searchIds: Set<string>;
  allocatedIds: Set<string>;
  hoverId: string;
  classFilter: string;
  ascendancyFilter: string;
  changesOn: boolean;
  changeEntries: PassiveTreeChangeMarker[];
}

interface IconRecord {
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
}

const iconCache = new Map<string, IconRecord>();

function passiveIconForPath(iconPath: string): HTMLImageElement | null {
  if (!iconPath) return null;
  const cached = iconCache.get(iconPath);
  if (cached) return cached.ready && !cached.failed ? cached.image : null;

  const record: IconRecord = { image: new Image(), ready: false, failed: false };
  record.image.decoding = "async";
  record.image.onload = () => {
    record.ready = true;
    window.dispatchEvent(new Event("poe-passive-icons-loaded"));
  };
  record.image.onerror = () => {
    record.failed = true;
  };
  record.image.src = iconPath;
  iconCache.set(iconPath, record);
  return null;
}

function passiveIconForNode(node: PassiveNode): HTMLImageElement | null {
  return passiveIconForPath(node.iconPath);
}

function drawClippedIcon(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null, x: number, y: number, radius: number, alpha: number): boolean {
  if (!image || radius < 3.5) return false;

  const iconRadius = Math.max(radius * 0.92, 4);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, iconRadius, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, x - iconRadius, y - iconRadius, iconRadius * 2, iconRadius * 2);
  ctx.restore();
  return true;
}

function drawNodeIcon(ctx: CanvasRenderingContext2D, node: PassiveNode, x: number, y: number, radius: number, alpha: number): boolean {
  return drawClippedIcon(ctx, passiveIconForNode(node), x, y, radius, alpha);
}

function colorWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function changeRadius(change: PassiveTreeChangeMarker): number {
  if (change.type.includes("keystone")) return 92;
  if (change.type.includes("notable")) return 72;
  if (change.type.includes("jewel")) return 62;
  if (change.type.includes("ascend")) return 54;
  return 38;
}

const MIN_MINOR_DOT_CSS_PX = 0.3;
const DOT_LOD_ZOOM = 0.1;
const NORMAL_FRAME_PAD = 4;
const IMPORTANT_FRAME_PAD = 7;
const NORMAL_FRAME_LINE = 3.5;
const IMPORTANT_FRAME_LINE = 5;
const CHANGE_RING_GAP = 14;
const DASH_WORLD = [18, 13];

interface NodeVisual {
  important: boolean;
  fullRadius: number;
  dotRadius: number;
  dotColor: string;
  minor: boolean;
}

function nodeVisual(node: PassiveNode): NodeVisual {
  const type = node.type.toLowerCase();
  const baseRadius = nodeRadius(node);
  if (type.includes("keystone")) return { important: true, fullRadius: baseRadius, dotRadius: 60, dotColor: "#e0913f", minor: false };
  if (type.includes("notable")) return { important: true, fullRadius: baseRadius, dotRadius: 44, dotColor: "#d9c184", minor: false };
  if (type.includes("jewel")) return { important: true, fullRadius: baseRadius, dotRadius: 38, dotColor: "#5fd6cd", minor: false };
  if (type.includes("ascend")) return { important: false, fullRadius: baseRadius, dotRadius: 26, dotColor: "#8b86a8", minor: true };
  return { important: false, fullRadius: baseRadius, dotRadius: 24, dotColor: "#8f8a76", minor: true };
}

function shouldUseDotLod(zoom: number): boolean {
  return zoom <= DOT_LOD_ZOOM;
}

function frameLineWidth(worldPx: number, cssPx: (px: number) => number, minCssPx = 0.7): number {
  return Math.max(worldPx, cssPx(minCssPx));
}

function isInsideCamera(camera: Camera, x: number, y: number, pad: number): boolean {
  const left = camera.x - camera.width / 2 / camera.zoom - pad;
  const right = camera.x + camera.width / 2 / camera.zoom + pad;
  const top = camera.y - camera.height / 2 / camera.zoom - pad;
  const bottom = camera.y + camera.height / 2 / camera.zoom + pad;
  return x >= left && x <= right && y >= top && y <= bottom;
}

export function visibleNodes(tree: PassiveTreeModel, camera: Camera, opts: RenderOptions): PassiveNode[] {
  const pad = 220 / camera.zoom;

  return filteredTreeNodes(tree, opts.classFilter, opts.ascendancyFilter).filter((node) => {
    return isInsideCamera(camera, node.x, node.y, pad);
  });
}

function drawRemovedGhosts(ctx: CanvasRenderingContext2D, camera: Camera, changes: PassiveTreeChangeMarker[], cssPx: (px: number) => number): void {
  const fillPath = new Path2D();
  const strokePath = new Path2D();
  let hasRows = false;
  const pad = 260 / camera.zoom;
  for (const change of changes) {
    if (change.status !== "removed") continue;
    if (!isInsideCamera(camera, change.x, change.y, pad)) continue;
    const r = changeRadius(change);
    fillPath.moveTo(change.x + r, change.y);
    fillPath.arc(change.x, change.y, r, 0, Math.PI * 2);
    strokePath.moveTo(change.x + r, change.y);
    strokePath.arc(change.x, change.y, r, 0, Math.PI * 2);
    strokePath.moveTo(change.x - r * 0.56, change.y - r * 0.56);
    strokePath.lineTo(change.x + r * 0.56, change.y + r * 0.56);
    hasRows = true;
  }
  if (!hasRows) return;
  ctx.save();
  ctx.fillStyle = colorWithAlpha(CHANGE_COLORS.removed, 0.1);
  ctx.fill(fillPath);
  ctx.strokeStyle = colorWithAlpha(CHANGE_COLORS.removed, 0.9);
  ctx.lineWidth = frameLineWidth(4.2, cssPx, 0.8);
  ctx.setLineDash(DASH_WORLD);
  ctx.stroke(strokePath);
  ctx.restore();
}

export function renderPassiveTree(ctx: CanvasRenderingContext2D, camera: Camera, tree: PassiveTreeModel, opts: RenderOptions): void {
  const dpr = camera.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, camera.width, camera.height);
  ctx.fillStyle = document.documentElement.classList.contains("dark") ? "#020611" : "#eef2f7";
  ctx.fillRect(0, 0, camera.width, camera.height);
  const z = camera.zoom;
  const cssPx = (px: number) => px / z;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (camera.width / 2 - camera.x * z), dpr * (camera.height / 2 - camera.y * z));

  const nodes = visibleNodes(tree, camera, opts);
  const targetNodes = nodes;
  const targetNodeById = new Map(targetNodes.map((node) => [node.id, node]));
  const visible = new Set(targetNodeById.keys());
  const changeById = opts.changesOn ? new Map(opts.changeEntries.map((entry) => [entry.id, entry])) : new Map<string, PassiveTreeChangeMarker>();
  const addEdgeSegment = (path: Path2D, edge: (typeof tree.edges)[number], from: PassiveNode, to: PassiveNode) => {
    if (edge.arc) {
      const projection = from.viewProjection;
      const sourceFrom = tree.nodeById.get(edge.from);
      const dx = sourceFrom ? from.x - sourceFrom.x : 0;
      const dy = sourceFrom ? from.y - sourceFrom.y : 0;
      const cx = projection ? projection.targetX + (edge.arc.cx - projection.sourceX) * projection.scale : edge.arc.cx + dx;
      const cy = projection ? projection.targetY + (edge.arc.cy - projection.sourceY) * projection.scale : edge.arc.cy + dy;
      const r = projection ? edge.arc.r * projection.scale : edge.arc.r;
      path.moveTo(cx + r * Math.cos(edge.arc.a0), cy + r * Math.sin(edge.arc.a0));
      path.arc(cx, cy, r, edge.arc.a0, edge.arc.a1, edge.arc.ccw);
      return;
    }
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  };

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const inactiveEdges = new Path2D();
  const activeEdges = new Path2D();
  for (const edge of tree.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue;
    const from = targetNodeById.get(edge.from);
    const to = targetNodeById.get(edge.to);
    if (!from || !to) continue;
    if (from.ascendancyName !== to.ascendancyName) continue;
    const active = opts.allocatedIds.has(from.id) && opts.allocatedIds.has(to.id);
    const path = active ? activeEdges : inactiveEdges;
    addEdgeSegment(path, edge, from, to);
  }
  ctx.strokeStyle = "rgba(148, 122, 76, .42)";
  ctx.lineWidth = cssPx(1.15);
  ctx.stroke(inactiveEdges);
  ctx.strokeStyle = "#f1d6a0";
  ctx.lineWidth = cssPx(2.5);
  ctx.stroke(activeEdges);

  if (opts.changesOn) {
    drawRemovedGhosts(ctx, camera, opts.changeEntries, cssPx);
  }

  const dotBuckets = new Map<string, { color: string; alpha: number; path: Path2D }>();
  const ringBuckets = new Map<string, { color: string; path: Path2D; dashed: boolean }>();
  let hoverRing: { x: number; y: number; r: number } | null = null;
  const pushRing = (color: string, x: number, y: number, r: number, dashed = false) => {
    const key = `${color}:${dashed ? "dash" : "solid"}`;
    let bucket = ringBuckets.get(key);
    if (!bucket) {
      bucket = { color, dashed, path: new Path2D() };
      ringBuckets.set(key, bucket);
    }
    bucket.path.moveTo(x + r, y);
    bucket.path.arc(x, y, r, 0, Math.PI * 2);
  };
  const flushDots = () => {
    for (const bucket of dotBuckets.values()) {
      ctx.globalAlpha = bucket.alpha;
      ctx.fillStyle = bucket.color;
      ctx.fill(bucket.path);
    }
    ctx.globalAlpha = 1;
    dotBuckets.clear();
  };

  for (const node of targetNodes) {
    const isAllocated = opts.allocatedIds.has(node.id);
    const isSearch = opts.searchIds.has(node.id);
    const isHover = opts.hoverId === node.id;
    const change = opts.changesOn ? changeById.get(node.id) : undefined;
    const visual = nodeVisual(node);
    const r = visual.fullRadius;
    const framePad = visual.important ? IMPORTANT_FRAME_PAD : NORMAL_FRAME_PAD;
    const alpha = node.ascendancyName && opts.ascendancyFilter && node.ascendancyName !== opts.ascendancyFilter ? 0.18 : 1;
    const canUseDot = shouldUseDotLod(z) && !isAllocated && !isSearch && !isHover && !change;

    if (canUseDot) {
      const dotRadius = visual.dotRadius;
      if (visual.minor && dotRadius * z * 2 < MIN_MINOR_DOT_CSS_PX) continue;
      const color = visual.dotColor;
      const key = `${color}:${alpha}`;
      let bucket = dotBuckets.get(key);
      if (!bucket) {
        bucket = { color, alpha, path: new Path2D() };
        dotBuckets.set(key, bucket);
      }
      bucket.path.moveTo(node.x + dotRadius, node.y);
      bucket.path.arc(node.x, node.y, dotRadius, 0, Math.PI * 2);
      continue;
    }

    flushDots();

    ctx.fillStyle = isAllocated ? "#f1d6a0" : visual.important ? "#c8a35a" : "#687284";
    ctx.globalAlpha = alpha;

    ctx.fillStyle = visual.important ? "rgba(4, 8, 18, .92)" : "rgba(15, 23, 42, .84)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + framePad, 0, Math.PI * 2);
    ctx.fill();

    const iconDrawn = drawNodeIcon(ctx, node, node.x, node.y, r, isAllocated || visual.important ? 1 : 0.76);
    if (!iconDrawn) {
      ctx.fillStyle = isAllocated ? "#f1d6a0" : visual.important ? "#c8a35a" : "#687284";
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = visual.important ? "rgba(241, 214, 160, .62)" : "rgba(148, 163, 184, .38)";
    ctx.lineWidth = frameLineWidth(visual.important ? IMPORTANT_FRAME_LINE : NORMAL_FRAME_LINE, cssPx, 0.65);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + framePad, 0, Math.PI * 2);
    ctx.stroke();

    if (isSearch) pushRing("#5eead4", node.x, node.y, r + CHANGE_RING_GAP);
    if (isAllocated) pushRing("#f8d76a", node.x, node.y, r + CHANGE_RING_GAP);
    if (isHover) hoverRing = { x: node.x, y: node.y, r: r + CHANGE_RING_GAP };

    if (change && change.status !== "removed") {
      pushRing(CHANGE_COLORS[change.status], node.x, node.y, r + CHANGE_RING_GAP * (change.status === "moved" ? 1.25 : 1), change.status === "added");
    }
    ctx.globalAlpha = 1;
  }
  flushDots();

  for (const bucket of ringBuckets.values()) {
    ctx.save();
    ctx.strokeStyle = bucket.color;
    if (bucket.dashed) ctx.setLineDash(DASH_WORLD);
    ctx.lineWidth = frameLineWidth(12, cssPx, 1);
    ctx.globalAlpha = 0.16;
    ctx.stroke(bucket.path);
    ctx.lineWidth = frameLineWidth(4.6, cssPx, 0.8);
    ctx.globalAlpha = 0.95;
    ctx.stroke(bucket.path);
    ctx.restore();
  }
  if (hoverRing) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = frameLineWidth(6.5, cssPx, 1.1);
    ctx.beginPath();
    ctx.arc(hoverRing.x, hoverRing.y, hoverRing.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
