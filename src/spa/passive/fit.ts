// Where the tree camera looks when it opens or the "Fit" button is pressed: around the
// build's allocated nodes, so a planner tree opens on nodes big enough to click.
// Pure (no imports) so tests can load it on its own.

export interface FitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FitView {
  x: number;
  y: number;
  zoom: number;
}

export interface FitOptions {
  /** Screen pixels kept free around the box on each side. */
  padding?: number;
  /** Smallest box side in world units, so one or two nodes are not blown up to the max zoom. */
  minSpan?: number;
  minZoom?: number;
  maxZoom?: number;
}

/** Zoom limits the canvas itself allows (camera.ts zoomCameraAt). */
export const FIT_MIN_ZOOM = 0.012;
export const FIT_MAX_ZOOM = 0.45;
export const FIT_MIN_SPAN = 2400;

/** The box around the points; null when there is none (no finite point). */
export function boundsOfPoints(points: Iterable<{ x: number; y: number } | null | undefined>): FitBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Centre and zoom that show the whole box inside a width x height viewport with
 * `padding` pixels around it. A box smaller than minSpan is grown around its centre
 * and the zoom stays within [minZoom, maxZoom].
 */
export function fitViewToBounds(bounds: FitBounds, width: number, height: number, options: FitOptions = {}): FitView {
  const padding = Math.max(options.padding ?? 48, 0);
  const minSpan = Math.max(options.minSpan ?? FIT_MIN_SPAN, 1);
  const minZoom = options.minZoom ?? FIT_MIN_ZOOM;
  const maxZoom = Math.max(options.maxZoom ?? FIT_MAX_ZOOM, minZoom);
  const spanX = Math.max(bounds.maxX - bounds.minX, minSpan);
  const spanY = Math.max(bounds.maxY - bounds.minY, minSpan);
  // A viewport smaller than twice the padding still gets a quarter of itself for the box.
  const usableW = Math.max(width - padding * 2, Math.max(width, 1) / 4, 1);
  const usableH = Math.max(height - padding * 2, Math.max(height, 1) / 4, 1);
  const zoom = Math.min(Math.max(Math.min(usableW / spanX, usableH / spanY), minZoom), maxZoom);
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom };
}
