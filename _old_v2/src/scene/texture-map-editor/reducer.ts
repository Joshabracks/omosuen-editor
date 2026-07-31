/**
 * Pure reducer for the texture-map frame editor (Phase 8.3).
 *
 * Operates on the `imageType` field serialized on a `texture-map`
 * component. The on-disk shape parsing (single / grid / framemap)
 * and frame-rect derivation live in `state/image-type.ts` and are
 * shared with the animation editor. This module owns the editor-
 * specific mutators (mode switching, frame add/move/resize/delete,
 * grid input edits) and serialization back to JsonValue.
 *
 * Every mutator returns a new state object (no in-place mutation).
 * Coordinates are integer-pixel snapped on every write; minimum
 * frame size is 1×1.
 *
 * DOM-free, vscode-free. Unit tests run under tsx with no runtime deps.
 */

import {
  defaultImageTypeState,
  deriveFrameRects,
  parseImageType,
  type FrameRect,
  type GridConfig,
  type ImageTypeState,
  type Mode,
} from '../../state/image-type.js';

// Re-export the shared types so existing callers can keep importing
// `FrameRect`/`Mode`/`ImageDims` from the texture-map editor's
// reducer without churning every callsite when the parsing helpers
// moved to `state/image-type.ts`.
export type {
  FrameRect,
  GridConfig,
  ImageDims,
  Mode,
} from '../../state/image-type.js';

/** Texture-map editor's working state — same shape as `ImageTypeState`. */
export type EditorState = ImageTypeState;

export { deriveFrameRects, parseImageType };

export function defaultState(): EditorState {
  return defaultImageTypeState();
}

/**
 * Switch modes. Preserves the other side's data so the user can flip
 * back without losing work. Single mode wipes nothing — the on-disk
 * value just becomes `null`.
 */
export function setMode(state: EditorState, mode: Mode): EditorState {
  if (state.mode === mode) return state;
  return { ...state, mode };
}

export function setGridConfig(
  state: EditorState,
  patch: Partial<GridConfig>,
): EditorState {
  const next: { -readonly [K in keyof GridConfig]: GridConfig[K] } = {
    ...state.grid,
  };
  if (patch.cellWidth !== undefined && Number.isFinite(patch.cellWidth)) {
    next.cellWidth = Math.max(1, Math.round(patch.cellWidth));
  }
  if (patch.cellHeight !== undefined && Number.isFinite(patch.cellHeight)) {
    next.cellHeight = Math.max(1, Math.round(patch.cellHeight));
  }
  if (patch.cols !== undefined && Number.isFinite(patch.cols)) {
    next.cols = Math.max(1, Math.round(patch.cols));
  }
  if (patch.rows !== undefined && Number.isFinite(patch.rows)) {
    next.rows = Math.max(1, Math.round(patch.rows));
  }
  if ('cellCount' in patch) {
    if (patch.cellCount === undefined) {
      delete next.cellCount;
    } else if (Number.isFinite(patch.cellCount)) {
      next.cellCount = Math.max(0, Math.round(patch.cellCount));
    }
  }
  return { ...state, grid: next };
}

export function addFrame(state: EditorState, rect: FrameRect): EditorState {
  return { ...state, frames: [...state.frames, snapRect(rect)] };
}

export function moveFrame(
  state: EditorState,
  index: number,
  dx: number,
  dy: number,
): EditorState {
  if (index < 0 || index >= state.frames.length) return state;
  const f = state.frames[index]!;
  const moved: FrameRect = {
    x: Math.max(0, Math.round(f.x + dx)),
    y: Math.max(0, Math.round(f.y + dy)),
    w: f.w,
    h: f.h,
  };
  if (moved.x === f.x && moved.y === f.y) return state;
  return {
    ...state,
    frames: state.frames.map((entry, i) => (i === index ? moved : entry)),
  };
}

/**
 * Resize handles, named after their position on the frame:
 *   nw  n  ne
 *   w       e
 *   sw  s  se
 *
 * Each handle moves a specific edge or corner; opposite anchor stays
 * fixed. Coordinates clamp to ≥ 0 and (w, h) clamp to ≥ 1.
 */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Compute a resized rect from a `startRect` + total mouse delta in
 * image pixels. Pure: same args always produce the same output, which
 * matches how `_old`'s drag handler applied each mousemove against the
 * frame's snapshot at drag-start (avoids accumulated rounding error
 * across many mouse ticks).
 */
export function resizeRect(
  startRect: FrameRect,
  handle: HandleId,
  dx: number,
  dy: number,
): FrameRect {
  let { x, y, w, h } = startRect;

  if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    const nx = Math.round(startRect.x + dx);
    const right = startRect.x + startRect.w;
    x = Math.max(0, Math.min(nx, right - 1));
    w = right - x;
  }
  if (handle === 'e' || handle === 'ne' || handle === 'se') {
    w = Math.max(1, Math.round(startRect.w + dx));
  }
  if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    const ny = Math.round(startRect.y + dy);
    const bottom = startRect.y + startRect.h;
    y = Math.max(0, Math.min(ny, bottom - 1));
    h = bottom - y;
  }
  if (handle === 's' || handle === 'sw' || handle === 'se') {
    h = Math.max(1, Math.round(startRect.h + dy));
  }
  return { x, y, w, h };
}

export function resizeFrame(
  state: EditorState,
  index: number,
  handle: HandleId,
  dx: number,
  dy: number,
): EditorState {
  if (index < 0 || index >= state.frames.length) return state;
  const f = state.frames[index]!;
  const next = resizeRect(f, handle, dx, dy);
  if (next.x === f.x && next.y === f.y && next.w === f.w && next.h === f.h) {
    return state;
  }
  return {
    ...state,
    frames: state.frames.map((entry, i) => (i === index ? next : entry)),
  };
}

export function deleteFrame(state: EditorState, index: number): EditorState {
  if (index < 0 || index >= state.frames.length) return state;
  return {
    ...state,
    frames: state.frames.filter((_, i) => i !== index),
  };
}

export function setFrameRect(
  state: EditorState,
  index: number,
  patch: Partial<FrameRect>,
): EditorState {
  if (index < 0 || index >= state.frames.length) return state;
  const f = state.frames[index]!;
  const next: FrameRect = {
    x:
      patch.x !== undefined && Number.isFinite(patch.x)
        ? Math.max(0, Math.round(patch.x))
        : f.x,
    y:
      patch.y !== undefined && Number.isFinite(patch.y)
        ? Math.max(0, Math.round(patch.y))
        : f.y,
    w:
      patch.w !== undefined && Number.isFinite(patch.w)
        ? Math.max(1, Math.round(patch.w))
        : f.w,
    h:
      patch.h !== undefined && Number.isFinite(patch.h)
        ? Math.max(1, Math.round(patch.h))
        : f.h,
  };
  if (next.x === f.x && next.y === f.y && next.w === f.w && next.h === f.h) {
    return state;
  }
  return {
    ...state,
    frames: state.frames.map((entry, i) => (i === index ? next : entry)),
  };
}

function snapRect(r: FrameRect): FrameRect {
  return {
    x: Math.max(0, Math.round(r.x)),
    y: Math.max(0, Math.round(r.y)),
    w: Math.max(1, Math.round(r.w)),
    h: Math.max(1, Math.round(r.h)),
  };
}

/**
 * Serialize editor state back to the on-disk `imageType` JsonValue.
 * Returns `null` for Single mode (matches the engine's expected shape
 * for "no overlay"). Output round-trips through `parseImageType`.
 */
export function serializeImageType(
  state: EditorState,
): null | Record<string, unknown> {
  if (state.mode === 'single') return null;
  if (state.mode === 'grid') {
    const out: Record<string, unknown> = {
      mode: 'grid',
      cellWidth: state.grid.cellWidth,
      cellHeight: state.grid.cellHeight,
      cols: state.grid.cols,
      rows: state.grid.rows,
    };
    if (state.grid.cellCount !== undefined) {
      out['cellCount'] = state.grid.cellCount;
    }
    return out;
  }
  return {
    mode: 'framemap',
    frames: state.frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
  };
}
