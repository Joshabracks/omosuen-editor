/**
 * Pure transforms + hit-testing for the texture-map editor canvas.
 *
 * The canvas works in two coordinate spaces:
 *   - Screen pixels: where the mouse lives (relative to the canvas).
 *   - Image pixels: where frames + grid cells are anchored.
 *
 * The `Camera` is the single transform between them: image-space
 * point `(ix, iy)` lives at screen `(ix * zoom + x, iy * zoom + y)`.
 *
 * Everything in this module is pure, DOM-free, vscode-free, and
 * unit-testable under tsx. No Image/ImageData/HTMLCanvasElement refs.
 */

import type { FrameRect, HandleId } from './reducer.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Camera {
  /** Screen-space x of image origin (top-left of image at zoom=1). */
  readonly x: number;
  readonly y: number;
  /** Image → screen scale (1 = native pixels). */
  readonly zoom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 20;

/** 12-pixel hit area around each handle, regardless of zoom. */
export const HANDLE_HIT_RADIUS = 6;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  if (z < ZOOM_MIN) return ZOOM_MIN;
  if (z > ZOOM_MAX) return ZOOM_MAX;
  return z;
}

export function screenToImage(p: Point, cam: Camera): Point {
  return {
    x: (p.x - cam.x) / cam.zoom,
    y: (p.y - cam.y) / cam.zoom,
  };
}

export function imageToScreen(p: Point, cam: Camera): Point {
  return {
    x: p.x * cam.zoom + cam.x,
    y: p.y * cam.zoom + cam.y,
  };
}

/**
 * Mouse-wheel zoom that keeps the image point under the cursor anchored
 * — the user's focus doesn't drift during zoom. Returns the new
 * `Camera`. `scrollDelta` follows the browser's `wheel.deltaY` sign:
 * positive = wheel-down = zoom out (matches `_old` line 721).
 */
export function zoomToward(
  cam: Camera,
  cursor: Point,
  scrollDelta: number,
): Camera {
  const direction = scrollDelta > 0 ? -0.1 : 0.1;
  const nextZoom = clampZoom(cam.zoom + direction * cam.zoom);
  if (nextZoom === cam.zoom) return cam;
  // Anchor: image point under cursor stays under cursor.
  const ratio = nextZoom / cam.zoom;
  return {
    x: cursor.x - (cursor.x - cam.x) * ratio,
    y: cursor.y - (cursor.y - cam.y) * ratio,
    zoom: nextZoom,
  };
}

/**
 * Initial camera that fits an image inside a viewport with 5%
 * padding, clamped to ZOOM_MAX so very small assets still render
 * pixel-crisp. Centers the image in the viewport.
 */
export function fitImageToView(image: Size, viewport: Size): Camera {
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const scaleX = (viewport.width * 0.9) / image.width;
  const scaleY = (viewport.height * 0.9) / image.height;
  const zoom = clampZoom(Math.min(scaleX, scaleY));
  return {
    x: (viewport.width - image.width * zoom) / 2,
    y: (viewport.height - image.height * zoom) / 2,
    zoom,
  };
}

/**
 * Find the topmost frame containing a given image-space point.
 * Iterates in reverse so the most-recently-added frame (drawn on top)
 * wins ties — matches `_old`'s loop direction (line 610). Returns the
 * frame's index, or `null` if no frame contains the point.
 */
export function frameAt(
  point: Point,
  frames: readonly FrameRect[],
): number | null {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i]!;
    if (
      point.x >= f.x &&
      point.x <= f.x + f.w &&
      point.y >= f.y &&
      point.y <= f.y + f.h
    ) {
      return i;
    }
  }
  return null;
}

const HANDLE_ORDER: readonly HandleId[] = [
  'nw',
  'ne',
  'se',
  'sw',
  'n',
  'e',
  's',
  'w',
];

export function handlePositions(
  rect: FrameRect,
  cam: Camera,
): Record<HandleId, Point> {
  const tl = imageToScreen({ x: rect.x, y: rect.y }, cam);
  const br = imageToScreen({ x: rect.x + rect.w, y: rect.y + rect.h }, cam);
  return {
    nw: { x: tl.x, y: tl.y },
    ne: { x: br.x, y: tl.y },
    se: { x: br.x, y: br.y },
    sw: { x: tl.x, y: br.y },
    n: { x: (tl.x + br.x) / 2, y: tl.y },
    e: { x: br.x, y: (tl.y + br.y) / 2 },
    s: { x: (tl.x + br.x) / 2, y: br.y },
    w: { x: tl.x, y: (tl.y + br.y) / 2 },
  };
}

/**
 * Hit-test a screen-space mouse point against the 8 resize handles of
 * a frame. Returns the matching `HandleId`, or `null` if no handle is
 * within `HANDLE_HIT_RADIUS` of the point. Corners win over edges
 * (iteration order ensures it).
 */
export function handleAt(
  screenPoint: Point,
  rect: FrameRect,
  cam: Camera,
): HandleId | null {
  const positions = handlePositions(rect, cam);
  for (const id of HANDLE_ORDER) {
    const p = positions[id];
    if (
      Math.abs(screenPoint.x - p.x) <= HANDLE_HIT_RADIUS &&
      Math.abs(screenPoint.y - p.y) <= HANDLE_HIT_RADIUS
    ) {
      return id;
    }
  }
  return null;
}

/**
 * CSS cursor name to show when hovering a particular handle. Keys
 * mirror `HandleId`. Returned strings are valid `cursor` values for
 * direct assignment to `canvas.style.cursor`.
 */
export const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/**
 * Build a normalized rect from two image-space points (drag start +
 * current). Always returns w/h ≥ 0; `x`/`y` always end up at the
 * top-left so the rect makes sense regardless of drag direction.
 */
export function rectFromPoints(a: Point, b: Point): FrameRect {
  const x = Math.round(Math.min(a.x, b.x));
  const y = Math.round(Math.min(a.y, b.y));
  const w = Math.round(Math.abs(b.x - a.x));
  const h = Math.round(Math.abs(b.y - a.y));
  return { x, y, w, h };
}
