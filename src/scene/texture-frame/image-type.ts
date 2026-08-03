/**
 * Shared parsing + frame-rect derivation for texture-map `imageType` (5a).
 *
 * Three on-disk shapes:
 *   - Single: `null` / `undefined` — entire image is one frame.
 *   - Grid:   `{ mode: 'grid', cellWidth, cellHeight, cols, rows, cellCount? }`
 *   - Frame:  `{ mode: 'framemap', frames: [{ x, y, w, h }, …] }`
 */

export type Mode = 'single' | 'grid' | 'framemap';

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface GridConfig {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cols: number;
  readonly rows: number;
  readonly cellCount?: number;
}

export interface ImageTypeState {
  readonly mode: Mode;
  readonly grid: GridConfig;
  readonly frames: readonly FrameRect[];
}

export interface ImageDims {
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_GRID: GridConfig = {
  cellWidth: 32,
  cellHeight: 32,
  cols: 4,
  rows: 4,
};

export function defaultImageTypeState(): ImageTypeState {
  return { mode: 'single', grid: DEFAULT_GRID, frames: [] };
}

export function parseImageType(raw: unknown): ImageTypeState {
  if (raw === null || raw === undefined) return defaultImageTypeState();
  if (typeof raw !== 'object') return defaultImageTypeState();
  const rec = raw as Record<string, unknown>;

  if (rec.mode === 'grid') {
    const grid: GridConfig = {
      cellWidth: numericOr(rec.cellWidth, DEFAULT_GRID.cellWidth),
      cellHeight: numericOr(rec.cellHeight, DEFAULT_GRID.cellHeight),
      cols: numericOr(rec.cols, DEFAULT_GRID.cols),
      rows: numericOr(rec.rows, DEFAULT_GRID.rows),
    };
    const cellCount = rec.cellCount;
    const finalGrid: GridConfig =
      typeof cellCount === 'number' && Number.isFinite(cellCount)
        ? { ...grid, cellCount }
        : grid;
    return { mode: 'grid', grid: finalGrid, frames: [] };
  }

  if (rec.mode === 'framemap') {
    const rawFrames = Array.isArray(rec.frames) ? rec.frames : [];
    const frames: FrameRect[] = [];
    for (const item of rawFrames) {
      if (typeof item !== 'object' || item === null) continue;
      const f = item as Record<string, unknown>;
      const x = numericOr(f.x, 0);
      const y = numericOr(f.y, 0);
      const w = numericOr(f.w, 0);
      const h = numericOr(f.h, 0);
      if (w < 1 || h < 1) continue;
      frames.push({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    }
    return { mode: 'framemap', grid: DEFAULT_GRID, frames };
  }

  return defaultImageTypeState();
}

export function deriveFrameRects(
  state: ImageTypeState,
  imageDims?: ImageDims,
): readonly FrameRect[] {
  if (state.mode === 'grid') {
    const list: FrameRect[] = [];
    const max =
      state.grid.cellCount && state.grid.cellCount > 0
        ? state.grid.cellCount
        : state.grid.cols * state.grid.rows;
    let idx = 0;
    for (let row = 0; row < state.grid.rows; row += 1) {
      for (let col = 0; col < state.grid.cols; col += 1) {
        if (idx >= max) return list;
        list.push({
          x: col * state.grid.cellWidth,
          y: row * state.grid.cellHeight,
          w: state.grid.cellWidth,
          h: state.grid.cellHeight,
        });
        idx += 1;
      }
    }
    return list;
  }
  if (state.mode === 'framemap') return state.frames;
  if (imageDims !== undefined && imageDims.width > 0 && imageDims.height > 0) {
    return [{ x: 0, y: 0, w: imageDims.width, h: imageDims.height }];
  }
  return [];
}

function numericOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
