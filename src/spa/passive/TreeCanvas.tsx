import { memo, useEffect, useMemo, useRef } from "react";
import { createCamera, fitCameraToBounds, panCamera, screenToWorld, zoomCameraAt, type Camera } from "./camera";
import type { PassiveTreeChangeMarker } from "./changes";
import { renderPassiveTree } from "./draw";
import { boundsForNodes, filteredTreeNodes, hitTestNode, type PassiveNode, type PassiveTreeModel } from "./tree";

export interface CanvasCommand {
  type: "fit" | "reset" | "focus";
  nonce: number;
  x?: number;
  y?: number;
  zoom?: number;
}

interface Props {
  tree: PassiveTreeModel;
  searchIds: Set<string>;
  allocatedIds: Set<string>;
  changeEntries: PassiveTreeChangeMarker[];
  changesOn: boolean;
  classFilter: string;
  ascendancyFilter: string;
  command: CanvasCommand | null;
  onHover: (node: PassiveNode | null, x: number, y: number) => void;
  onToggle: (node: PassiveNode) => void;
}

function TreeCanvasImpl({ tree, searchIds, allocatedIds, changeEntries, changesOn, classFilter, ascendancyFilter, command, onHover, onToggle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>(createCamera());
  const dragging = useRef(false);
  const moved = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const hoverId = useRef("");
  const commandNonce = useRef(-1);
  const commandRef = useRef<CanvasCommand | null>(command);

  const renderOpts = useMemo(() => ({ searchIds, allocatedIds, changeEntries, changesOn, hoverId: hoverId.current, classFilter, ascendancyFilter }), [searchIds, allocatedIds, changeEntries, changesOn, classFilter, ascendancyFilter]);
  const renderOptsRef = useRef(renderOpts);

  useEffect(() => {
    renderOptsRef.current = renderOpts;
    canvasRef.current?.dispatchEvent(new Event("poe-passive-dirty"));
  }, [renderOpts]);

  useEffect(() => {
    commandRef.current = command;
    canvasRef.current?.dispatchEvent(new Event("poe-passive-dirty"));
  }, [command]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const camera = cameraRef.current;
    let raf = 0;
    let dirty = true;
    let viewKey = "";

    const fitCurrentView = (padding = 72) => {
      const opts = renderOptsRef.current;
      const rows = filteredTreeNodes(tree, opts.classFilter, opts.ascendancyFilter);
      fitCameraToBounds(camera, boundsForNodes(rows, tree.bounds), padding);
    };

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      camera.width = Math.max(Math.floor(rect?.width ?? window.innerWidth), 1);
      camera.height = Math.max(Math.floor(rect?.height ?? window.innerHeight), 1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(camera.width * dpr);
      canvas.height = Math.floor(camera.height * dpr);
      canvas.style.width = `${camera.width}px`;
      canvas.style.height = `${camera.height}px`;
      fitCurrentView();
      dirty = true;
    };

    const draw = () => {
      const opts = renderOptsRef.current;
      const nextViewKey = `${opts.classFilter}|${opts.ascendancyFilter}`;
      if (nextViewKey !== viewKey) {
        viewKey = nextViewKey;
        fitCurrentView(88);
        dirty = true;
      }
      const nextCommand = commandRef.current;
      if (nextCommand && nextCommand.nonce !== commandNonce.current) {
        commandNonce.current = nextCommand.nonce;
        if (nextCommand.type === "focus" && Number.isFinite(nextCommand.x) && Number.isFinite(nextCommand.y)) {
          camera.x = Number(nextCommand.x);
          camera.y = Number(nextCommand.y);
          camera.zoom = Math.min(Math.max(Number(nextCommand.zoom ?? 0.28), 0.012), 1.8);
        } else {
          fitCurrentView(nextCommand.type === "reset" ? 96 : 64);
        }
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        renderPassiveTree(ctx, camera, tree, { ...opts, hoverId: hoverId.current });
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    const markDirty = () => {
      dirty = true;
    };
    canvas.addEventListener("poe-passive-dirty", markDirty);
    window.addEventListener("poe-passive-icons-loaded", markDirty);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("poe-passive-dirty", markDirty);
      window.removeEventListener("poe-passive-icons-loaded", markDirty);
    };
  }, [tree]);

  const dirty = () => canvasRef.current?.dispatchEvent(new Event("poe-passive-dirty"));

  const pointerNode = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const camera = cameraRef.current;
    const p = screenToWorld(camera, clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0));
    const opts = renderOptsRef.current;
    return hitTestNode(filteredTreeNodes(tree, opts.classFilter, opts.ascendancyFilter), p.x, p.y, 85 / camera.zoom);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    moved.current = false;
    last.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging.current) {
      const dx = event.clientX - last.current.x;
      const dy = event.clientY - last.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
      panCamera(cameraRef.current, dx, dy);
      last.current = { x: event.clientX, y: event.clientY };
      dirty();
      return;
    }
    const node = pointerNode(event.clientX, event.clientY);
    const id = node?.id ?? "";
    if (id !== hoverId.current) {
      hoverId.current = id;
      onHover(node, event.clientX, event.clientY);
      dirty();
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!moved.current) {
      const node = pointerNode(event.clientX, event.clientY);
      if (node) onToggle(node);
    }
    moved.current = false;
    dirty();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomCameraAt(cameraRef.current, Math.pow(1.0015, -event.deltaY), event.clientX - rect.left, event.clientY - rect.top);
    dirty();
  };

  return (
    <canvas
      ref={canvasRef}
      className="passive-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      role="img"
      aria-label="Passive tree canvas"
    />
  );
}

export const TreeCanvas = memo(TreeCanvasImpl);
