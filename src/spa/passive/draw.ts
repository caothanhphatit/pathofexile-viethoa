import type { Camera } from "./camera";
import { worldToScreen } from "./camera";
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

function passiveIconForChange(change: PassiveTreeChangeMarker): HTMLImageElement | null {
  return passiveIconForPath(change.iconPath);
}

function drawNodeIcon(ctx: CanvasRenderingContext2D, node: PassiveNode, x: number, y: number, radius: number, alpha: number): boolean {
  const image = passiveIconForNode(node);
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

function drawChangeGhost(ctx: CanvasRenderingContext2D, camera: Camera, change: PassiveTreeChangeMarker): void {
  const p = worldToScreen(camera, change.x, change.y);
  if (p.x < -120 || p.x > camera.width + 120 || p.y < -120 || p.y > camera.height + 120) return;

  const color = CHANGE_COLORS[change.status];
  const r = Math.max(changeRadius(change) * camera.zoom, change.type.includes("small") ? 3 : 7);
  ctx.save();
  ctx.globalAlpha = change.status === "removed" ? 0.52 : 0.62;
  ctx.fillStyle = colorWithAlpha(color, 0.1);
  ctx.strokeStyle = colorWithAlpha(color, 0.88);
  ctx.lineWidth = change.status === "removed" ? 1.4 : 2;
  if (change.status === "removed") ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawAddedChangeNode(ctx: CanvasRenderingContext2D, camera: Camera, change: PassiveTreeChangeMarker): void {
  const p = worldToScreen(camera, change.x, change.y);
  if (p.x < -120 || p.x > camera.width + 120 || p.y < -120 || p.y > camera.height + 120) return;

  const important = change.type.includes("notable") || change.type.includes("keystone") || change.type.includes("jewel");
  const r = Math.max(changeRadius(change) * camera.zoom * (important ? 1.12 : 1), change.type.includes("small") ? 3.2 : 7);
  const color = CHANGE_COLORS.added;

  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = "rgba(3, 18, 20, .96)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + (important ? 4 : 2.5), 0, Math.PI * 2);
  ctx.fill();

  const image = passiveIconForChange(change);
  if (image && r >= 4) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.92, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, p.x - r, p.y - r, r * 2, r * 2);
    ctx.restore();
  } else {
    const gradient = ctx.createRadialGradient(p.x - r * 0.28, p.y - r * 0.28, 0, p.x, p.y, r);
    gradient.addColorStop(0, "rgba(110, 231, 183, .96)");
    gradient.addColorStop(1, "rgba(21, 94, 71, .88)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r >= 9) {
      ctx.strokeStyle = "rgba(2, 8, 14, .72)";
      ctx.lineWidth = Math.max(1, r * 0.15);
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.38, p.y);
      ctx.lineTo(p.x + r * 0.38, p.y);
      ctx.moveTo(p.x, p.y - r * 0.38);
      ctx.lineTo(p.x, p.y + r * 0.38);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = colorWithAlpha(color, 0.95);
  ctx.lineWidth = important ? 2.4 : 1.8;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = colorWithAlpha(color, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function visibleNodes(tree: PassiveTreeModel, camera: Camera, opts: RenderOptions): PassiveNode[] {
  const pad = 160 / camera.zoom;
  const left = camera.x - camera.width / 2 / camera.zoom - pad;
  const right = camera.x + camera.width / 2 / camera.zoom + pad;
  const top = camera.y - camera.height / 2 / camera.zoom - pad;
  const bottom = camera.y + camera.height / 2 / camera.zoom + pad;

  return filteredTreeNodes(tree, opts.classFilter, opts.ascendancyFilter).filter((node) => {
    return node.x >= left && node.x <= right && node.y >= top && node.y <= bottom;
  });
}

export function renderPassiveTree(ctx: CanvasRenderingContext2D, camera: Camera, tree: PassiveTreeModel, opts: RenderOptions): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, camera.width, camera.height);
  ctx.fillStyle = document.documentElement.classList.contains("dark") ? "#020611" : "#eef2f7";
  ctx.fillRect(0, 0, camera.width, camera.height);

  const nodes = visibleNodes(tree, camera, opts);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visible = new Set(nodeById.keys());
  const changeById = opts.changesOn ? new Map(opts.changeEntries.map((entry) => [entry.id, entry])) : new Map<string, PassiveTreeChangeMarker>();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const edge of tree.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    if (from.ascendancyName !== to.ascendancyName) continue;
    const a = worldToScreen(camera, from.x, from.y);
    const b = worldToScreen(camera, to.x, to.y);
    if (Math.hypot(a.x - b.x, a.y - b.y) > Math.max(camera.width, camera.height) * 0.7) continue;
    const active = opts.allocatedIds.has(from.id) && opts.allocatedIds.has(to.id);
    ctx.strokeStyle = active ? "#f1d6a0" : "rgba(148, 122, 76, .42)";
    ctx.lineWidth = active ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  if (opts.changesOn) {
    for (const change of opts.changeEntries) {
      if (nodeById.has(change.id)) continue;
      if (change.status === "added") drawAddedChangeNode(ctx, camera, change);
      else drawChangeGhost(ctx, camera, change);
    }
  }

  for (const node of nodes) {
    const p = worldToScreen(camera, node.x, node.y);
    const baseRadius = Math.max(nodeRadius(node) * camera.zoom, node.type.includes("small") ? 2.2 : 4);
    const isAllocated = opts.allocatedIds.has(node.id);
    const isSearch = opts.searchIds.has(node.id);
    const isHover = opts.hoverId === node.id;
    const change = opts.changesOn ? changeById.get(node.id) : undefined;
    const important = node.type.includes("notable") || node.type.includes("keystone") || node.type.includes("jewel");
    const r = important ? baseRadius * 1.18 : baseRadius;

    ctx.fillStyle = isAllocated ? "#f1d6a0" : important ? "#c8a35a" : "#687284";
    ctx.globalAlpha = node.ascendancyName && opts.ascendancyFilter && node.ascendancyName !== opts.ascendancyFilter ? 0.18 : 1;

    ctx.fillStyle = important ? "rgba(4, 8, 18, .92)" : "rgba(15, 23, 42, .84)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + (important ? 2 : 1.4), 0, Math.PI * 2);
    ctx.fill();

    const iconDrawn = drawNodeIcon(ctx, node, p.x, p.y, r, isAllocated || important ? 1 : 0.76);
    if (!iconDrawn) {
      ctx.fillStyle = isAllocated ? "#f1d6a0" : important ? "#c8a35a" : "#687284";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = isHover ? "#ffffff" : isSearch ? "#5eead4" : isAllocated ? "#f8d76a" : important ? "rgba(241, 214, 160, .62)" : "rgba(148, 163, 184, .38)";
    ctx.lineWidth = isHover ? 2.6 : isSearch || isAllocated ? 2 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + (isSearch || isHover || isAllocated ? 5 : 1.5), 0, Math.PI * 2);
    ctx.stroke();

    if (change) {
      ctx.strokeStyle = CHANGE_COLORS[change.status];
      ctx.lineWidth = isHover ? 3 : 2.2;
      if (change.status === "removed") ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
}
