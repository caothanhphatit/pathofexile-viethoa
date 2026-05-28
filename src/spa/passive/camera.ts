export interface Camera {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
  dpr: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const createCamera = (): Camera => ({ x: 0, y: 0, zoom: 0.035, width: 1, height: 1, dpr: 1 });

export function screenToWorld(camera: Camera, sx: number, sy: number) {
  return {
    x: camera.x + (sx - camera.width / 2) / camera.zoom,
    y: camera.y + (sy - camera.height / 2) / camera.zoom
  };
}

export function worldToScreen(camera: Camera, wx: number, wy: number) {
  return {
    x: (wx - camera.x) * camera.zoom + camera.width / 2,
    y: (wy - camera.y) * camera.zoom + camera.height / 2
  };
}

export function fitCameraToBounds(camera: Camera, bounds: Bounds, padding = 64): Camera {
  const bw = Math.max(bounds.maxX - bounds.minX, 1);
  const bh = Math.max(bounds.maxY - bounds.minY, 1);
  const zx = Math.max(camera.width - padding * 2, 1) / bw;
  const zy = Math.max(camera.height - padding * 2, 1) / bh;
  camera.x = bounds.minX + bw / 2;
  camera.y = bounds.minY + bh / 2;
  camera.zoom = Math.min(zx, zy);
  return camera;
}

export function zoomCameraAt(camera: Camera, factor: number, sx: number, sy: number): Camera {
  const before = screenToWorld(camera, sx, sy);
  camera.zoom = Math.min(Math.max(camera.zoom * factor, 0.006), 1.8);
  const after = screenToWorld(camera, sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  return camera;
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
  return camera;
}
