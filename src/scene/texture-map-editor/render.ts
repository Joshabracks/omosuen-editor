/**
 * Canvas draw routines for the texture-map editor.
 *
 * Pure imperative drawing into a 2D canvas context. No State Street,
 * no DOM lookups beyond the passed-in canvas — the webview's rAF loop
 * calls `drawFrame` with the latest snapshot of `RenderState`.
 *
 * Smoothing is disabled for crisp pixel rendering — texture-map source
 * images are usually pixel-art atlases where bilinear filtering looks
 * wrong. Matches `_old` line 373.
 */

import {
  HANDLE_HIT_RADIUS,
  handlePositions,
  imageToScreen,
  type Camera,
} from './geom.js';
import type { EditorState, FrameRect, GridConfig } from './reducer.js';

export interface RenderState {
  readonly mode: EditorState['mode'];
  readonly camera: Camera;
  readonly image: HTMLImageElement | null;
  readonly grid: GridConfig;
  readonly frames: readonly FrameRect[];
  readonly selectedFrame: number | null;
  /** Frame currently being drawn via drag-create (FrameMap mode). */
  readonly drawingRect: FrameRect | null;
}

const COLOR_GRID_LINE = 'rgba(74,157,187,0.6)';
const COLOR_GRID_LABEL = '#d4a843';
const COLOR_FRAME_LINE = 'rgba(212,168,67,0.5)';
const COLOR_FRAME_FILL = 'rgba(212,168,67,0.05)';
const COLOR_FRAME_LINE_SELECTED = '#d4a843';
const COLOR_FRAME_FILL_SELECTED = 'rgba(212,168,67,0.1)';
const COLOR_HANDLE = '#8ebc3a';
const COLOR_DRAW_RECT = '#8ebc3a';
const COLOR_IMAGE_BORDER = 'rgba(200,191,176,0.3)';
const COLOR_CHECKER_DARK = '#1f2123';
const COLOR_CHECKER_LIGHT = '#2a2c2e';

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
): void {
  const { width, height } = ctx.canvas;
  drawCheckerBackground(ctx, width, height);

  const { image, camera } = state;
  if (!image || image.width === 0 || image.height === 0) return;

  ctx.imageSmoothingEnabled = false;

  const dx = camera.x;
  const dy = camera.y;
  const dw = image.width * camera.zoom;
  const dh = image.height * camera.zoom;
  ctx.drawImage(image, dx, dy, dw, dh);

  ctx.strokeStyle = COLOR_IMAGE_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(dx, dy, dw, dh);

  if (state.mode === 'grid') {
    drawGridOverlay(ctx, state);
  } else if (state.mode === 'framemap') {
    drawFrameMapOverlay(ctx, state);
  }

  if (state.drawingRect) {
    drawDashedRect(ctx, state.drawingRect, camera);
  }
}

function drawCheckerBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.fillStyle = COLOR_CHECKER_DARK;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COLOR_CHECKER_LIGHT;
  const size = 16;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      if ((x / size + y / size) % 2 === 0) continue;
      ctx.fillRect(x, y, size, size);
    }
  }
}

function drawGridOverlay(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
): void {
  const { grid, camera } = state;
  ctx.strokeStyle = COLOR_GRID_LINE;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLOR_GRID_LABEL;

  const cw = grid.cellWidth * camera.zoom;
  const ch = grid.cellHeight * camera.zoom;
  const maxCount =
    grid.cellCount && grid.cellCount > 0
      ? grid.cellCount
      : grid.cols * grid.rows;

  ctx.font = `${Math.max(8, Math.min(12, cw * 0.3))}px 'IBM Plex Mono', monospace`;

  let idx = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (idx >= maxCount) return;
      const sx = camera.x + col * cw;
      const sy = camera.y + row * ch;
      ctx.strokeRect(sx, sy, cw, ch);
      ctx.fillStyle = COLOR_GRID_LABEL;
      ctx.fillText(String(idx), sx + 3, sy + Math.min(14, ch * 0.4));
      idx += 1;
    }
  }
}

function drawFrameMapOverlay(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
): void {
  const { frames, selectedFrame, camera } = state;
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i]!;
    const r = rectToScreen(f, camera);
    const isSelected = i === selectedFrame;

    ctx.strokeStyle = isSelected ? COLOR_FRAME_LINE_SELECTED : COLOR_FRAME_LINE;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = isSelected ? COLOR_FRAME_FILL_SELECTED : COLOR_FRAME_FILL;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = isSelected ? COLOR_FRAME_LINE_SELECTED : COLOR_FRAME_LINE;
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText(String(i), r.x + 3, r.y + 13);
  }

  if (
    selectedFrame !== null &&
    selectedFrame >= 0 &&
    selectedFrame < frames.length
  ) {
    drawHandles(ctx, frames[selectedFrame]!, camera);
  }
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  rect: FrameRect,
  cam: Camera,
): void {
  const positions = handlePositions(rect, cam);
  ctx.fillStyle = COLOR_HANDLE;
  const size = HANDLE_HIT_RADIUS;
  for (const id of Object.keys(positions) as (keyof typeof positions)[]) {
    const p = positions[id];
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  }
}

function drawDashedRect(
  ctx: CanvasRenderingContext2D,
  rect: FrameRect,
  cam: Camera,
): void {
  const r = rectToScreen(rect, cam);
  ctx.strokeStyle = COLOR_DRAW_RECT;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([]);
}

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectToScreen(rect: FrameRect, cam: Camera): ScreenRect {
  const tl = imageToScreen({ x: rect.x, y: rect.y }, cam);
  return {
    x: tl.x,
    y: tl.y,
    w: rect.w * cam.zoom,
    h: rect.h * cam.zoom,
  };
}
