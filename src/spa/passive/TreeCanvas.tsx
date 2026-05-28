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
  allocationEnabled: boolean;
  classFilter: string;
  ascendancyFilter: string;
  command: CanvasCommand | null;
  onHover: (node: PassiveNode | null, x: number, y: number, held: boolean) => void;
  onToggle: (node: PassiveNode) => void;
}

function TreeCanvasImpl({ tree, searchIds, allocatedIds, changeEntries, changesOn, allocationEnabled, classFilter, ascendancyFilter, command, onHover, onToggle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>(createCamera());
  const dragging = useRef(false);
  const moved = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const down = useRef({ x: 0, y: 0 });
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef(0);
  const tapInspectId = useRef("");
  const hoverId = useRef("");
  const heldHover = useRef<{ node: PassiveNode; x: number; y: number } | null>(null);
  const altDown = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
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
    let viewKey = "";
    const fullDpr = () => Math.min(window.devicePixelRatio || 1, 2);
    const targetDpr = () => camera.zoom < 0.095 ? Math.min(fullDpr(), 1) : fullDpr();

    const applyCanvasSize = () => {
      const dpr = camera.dpr || 1;
      canvas.width = Math.floor(camera.width * dpr);
      canvas.height = Math.floor(camera.height * dpr);
      canvas.style.width = `${camera.width}px`;
      canvas.style.height = `${camera.height}px`;
    };

    const fitCurrentView = (padding = 72) => {
      const opts = renderOptsRef.current;
      const rows = filteredTreeNodes(tree, opts.classFilter, opts.ascendancyFilter);
      fitCameraToBounds(camera, boundsForNodes(rows, tree.bounds), padding);
    };

    const renderFrame = () => {
      raf = 0;
      const opts = renderOptsRef.current;
      const nextViewKey = `${opts.classFilter}|${opts.ascendancyFilter}|${opts.changesOn ? "base" : "target"}`;
      if (nextViewKey !== viewKey) {
        viewKey = nextViewKey;
        fitCurrentView(88);
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
      }
      const nextDpr = targetDpr();
      if (Math.abs(nextDpr - camera.dpr) > 0.01) {
        camera.dpr = nextDpr;
        applyCanvasSize();
      }
      renderPassiveTree(ctx, camera, tree, { ...opts, hoverId: hoverId.current });
    };

    const scheduleDraw = () => {
      if (!raf) raf = requestAnimationFrame(renderFrame);
    };

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      camera.width = Math.max(Math.floor(rect?.width ?? window.innerWidth), 1);
      camera.height = Math.max(Math.floor(rect?.height ?? window.innerHeight), 1);
      camera.dpr = targetDpr();
      applyCanvasSize();
      fitCurrentView();
      scheduleDraw();
    };

    resize();
    window.addEventListener("resize", resize);
    scheduleDraw();

    const markDirty = () => {
      scheduleDraw();
    };
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.pow(1.0015, -event.deltaY * (event.ctrlKey ? 2.2 : 1));
      zoomCameraAt(camera, factor, event.clientX - rect.left, event.clientY - rect.top);
      scheduleDraw();
    };
    const onKeyZoom = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const cx = camera.width / 2;
      const cy = camera.height / 2;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomCameraAt(camera, 1.3, cx, cy);
        scheduleDraw();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomCameraAt(camera, 1 / 1.3, cx, cy);
        scheduleDraw();
      } else if (event.key === "0") {
        event.preventDefault();
        fitCurrentView(88);
        scheduleDraw();
      }
    };
    canvas.addEventListener("poe-passive-dirty", markDirty);
    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    window.addEventListener("poe-passive-icons-loaded", markDirty);
    window.addEventListener("keydown", onKeyZoom, { passive: false });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("poe-passive-dirty", markDirty);
      canvas.removeEventListener("wheel", onWheelNative);
      window.removeEventListener("poe-passive-icons-loaded", markDirty);
      window.removeEventListener("keydown", onKeyZoom);
    };
  }, [tree]);

  const dirty = () => canvasRef.current?.dispatchEvent(new Event("poe-passive-dirty"));

  const pointerNode = (clientX: number, clientY: number, pointerType = "mouse") => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const camera = cameraRef.current;
    const p = screenToWorld(camera, clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0));
    const opts = renderOptsRef.current;
    const rows = filteredTreeNodes(tree, opts.classFilter, opts.ascendancyFilter);
    const hitPaddingCss = pointerType === "touch" ? 14 : 5;
    return hitTestNode(rows, p.x, p.y, hitPaddingCss / camera.zoom);
  };

  const showHover = (node: PassiveNode | null, clientX: number, clientY: number, held = false) => {
    const id = node?.id ?? "";
    if (id !== hoverId.current) hoverId.current = id;
    onHover(node, clientX, clientY, held && Boolean(node));
    dirty();
  };

  const inspectAtPointer = (clientX: number, clientY: number, held = false) => {
    const node = pointerNode(clientX, clientY);
    showHover(node, clientX, clientY, held);
    return node;
  };

  const holdAtPointer = (clientX: number, clientY: number) => {
    const node = pointerNode(clientX, clientY);
    heldHover.current = node ? { node, x: clientX, y: clientY } : null;
    showHover(node, clientX, clientY, Boolean(node));
    return node;
  };

  const releaseHeldHover = () => {
    heldHover.current = null;
    const pointer = lastPointer.current;
    if (pointer) {
      inspectAtPointer(pointer.x, pointer.y);
    } else {
      showHover(null, 0, 0);
    }
  };

  useEffect(() => {
    const onAltKey = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      if (event.type === "keydown") {
        altDown.current = true;
        const pointer = lastPointer.current;
        if (pointer && !heldHover.current) holdAtPointer(pointer.x, pointer.y);
      } else if (event.type === "keyup") {
        altDown.current = false;
        releaseHeldHover();
      }
    };
    const onBlur = () => {
      altDown.current = false;
      heldHover.current = null;
      showHover(null, 0, 0);
    };
    window.addEventListener("keydown", onAltKey);
    window.addEventListener("keyup", onAltKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onAltKey);
      window.removeEventListener("keyup", onAltKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    lastPointer.current = { x: event.clientX, y: event.clientY };
    altDown.current = event.altKey;
    if (event.altKey && !heldHover.current) holdAtPointer(event.clientX, event.clientY);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser already cancelled the pointer.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      dragging.current = true;
      moved.current = false;
      last.current = { x: event.clientX, y: event.clientY };
      down.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    lastPointer.current = { x: event.clientX, y: event.clientY };
    altDown.current = event.altKey;
    const previous = pointers.current.get(event.pointerId);
    if (previous) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        const rect = event.currentTarget.getBoundingClientRect();
        zoomCameraAt(cameraRef.current, distance / pinchDist.current, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      pinchDist.current = distance;
      moved.current = true;
      dirty();
      return;
    }

    if (dragging.current) {
      if (!previous) return;
      if (!moved.current) {
        const distance = Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y);
        if (distance > (event.pointerType === "touch" ? 10 : 3)) moved.current = true;
      }
      if (!moved.current) return;
      panCamera(cameraRef.current, event.clientX - previous.x, event.clientY - previous.y);
      last.current = { x: event.clientX, y: event.clientY };
      if (!heldHover.current) {
        hoverId.current = "";
        tapInspectId.current = "";
        onHover(null, 0, 0, false);
      }
      dirty();
      return;
    }
    if (event.pointerType !== "mouse") return;
    if (altDown.current && heldHover.current) return;
    const node = pointerNode(event.clientX, event.clientY, event.pointerType);
    const id = node?.id ?? "";
    if (id !== hoverId.current) {
      hoverId.current = id;
      onHover(node, event.clientX, event.clientY, false);
      dirty();
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDist.current = 0;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released or cancelled.
    }
    if (pointers.current.size === 0 && dragging.current && !moved.current) {
      const node = pointerNode(event.clientX, event.clientY, event.pointerType);
      if (event.pointerType === "mouse") {
        if (node && allocationEnabled) onToggle(node);
      } else if (!node && !heldHover.current) {
        tapInspectId.current = "";
        hoverId.current = "";
        onHover(null, 0, 0, false);
      } else if (tapInspectId.current === node.id && allocationEnabled) {
        onToggle(node);
        tapInspectId.current = "";
      } else {
        tapInspectId.current = node.id;
        hoverId.current = node.id;
        onHover(node, event.clientX, event.clientY, false);
      }
    }
    if (pointers.current.size === 0) {
      dragging.current = false;
      moved.current = false;
    }
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
      role="img"
      aria-label="Passive tree canvas"
    />
  );
}

export const TreeCanvas = memo(TreeCanvasImpl);
