/**
 * Tests for the Phase 8.3 texture-map editor reducer + geom helpers.
 *
 * Both modules are DOM-free + vscode-free, so unit-testable under tsx.
 * No protocol-layer tests live here — those are in protocol.test.ts.
 */

import {
  addFrame,
  defaultState,
  deleteFrame,
  parseImageType,
  resizeFrame,
  resizeRect,
  serializeImageType,
  setFrameRect,
  setGridConfig,
  setMode,
  type EditorState,
  type FrameRect,
} from '../scene/texture-map-editor/reducer.js';
import {
  HANDLE_HIT_RADIUS,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitImageToView,
  frameAt,
  handleAt,
  imageToScreen,
  rectFromPoints,
  screenToImage,
  zoomToward,
  type Camera,
} from '../scene/texture-map-editor/geom.js';
import { assertDeepEqual, test } from './harness.js';

const idCam: Camera = { x: 0, y: 0, zoom: 1 };

function withFrames(frames: FrameRect[]): EditorState {
  return { ...defaultState(), mode: 'framemap', frames };
}

export function runTextureMapEditorTests(): void {
  // --- parseImageType ---------------------------------------------------

  test('parseImageType: null/undefined → single mode default', () => {
    const a = parseImageType(null);
    const b = parseImageType(undefined);
    if (a.mode !== 'single' || b.mode !== 'single') {
      throw new Error(`expected single mode, got ${a.mode}/${b.mode}`);
    }
  });

  test('parseImageType: grid shape parsed with cellCount preserved', () => {
    const s = parseImageType({
      mode: 'grid',
      cellWidth: 16,
      cellHeight: 24,
      cols: 8,
      rows: 4,
      cellCount: 30,
    });
    if (s.mode !== 'grid') throw new Error(`mode: ${s.mode}`);
    assertDeepEqual(s.grid, {
      cellWidth: 16,
      cellHeight: 24,
      cols: 8,
      rows: 4,
      cellCount: 30,
    });
  });

  test('parseImageType: grid with bad fields falls back to defaults', () => {
    const s = parseImageType({
      mode: 'grid',
      cellWidth: 'huh',
      cols: 'no',
    });
    if (s.mode !== 'grid') throw new Error(`mode: ${s.mode}`);
    if (s.grid.cellWidth !== 32) throw new Error('cellWidth not defaulted');
    if (s.grid.cellHeight !== 32) throw new Error('cellHeight not defaulted');
    if (s.grid.cols !== 4) throw new Error('cols not defaulted');
    if (s.grid.rows !== 4) throw new Error('rows not defaulted');
  });

  test('parseImageType: framemap rounds + drops degenerate rects', () => {
    const s = parseImageType({
      mode: 'framemap',
      frames: [
        { x: 1.4, y: 2.6, w: 10, h: 10 },
        { x: 0, y: 0, w: 0, h: 5 }, // dropped — zero width
        'bogus',
        null,
        { x: 100, y: 100, w: 5.5, h: 4.4 },
      ],
    });
    if (s.mode !== 'framemap') throw new Error(`mode: ${s.mode}`);
    assertDeepEqual(s.frames, [
      { x: 1, y: 3, w: 10, h: 10 },
      { x: 100, y: 100, w: 6, h: 4 },
    ]);
  });

  test('parseImageType: unknown mode falls back to default', () => {
    const s = parseImageType({ mode: 'cosmic-rays' });
    if (s.mode !== 'single') throw new Error(`mode: ${s.mode}`);
  });

  // --- setMode ---------------------------------------------------------

  test('setMode: identity returns same reference', () => {
    const s = defaultState();
    if (setMode(s, 'single') !== s) {
      throw new Error('expected reference identity for no-op');
    }
  });

  test('setMode: switching preserves frames + grid', () => {
    const a = withFrames([{ x: 0, y: 0, w: 10, h: 10 }]);
    const b = setMode(a, 'grid');
    if (b.mode !== 'grid') throw new Error('mode not switched');
    assertDeepEqual(b.frames, a.frames);
  });

  // --- setGridConfig ---------------------------------------------------

  test('setGridConfig: integer-snaps + clamps minimums', () => {
    const s = setGridConfig(defaultState(), {
      cellWidth: 16.7,
      cellHeight: 0,
      cols: -3,
      rows: 8.2,
    });
    assertDeepEqual(s.grid, {
      cellWidth: 17,
      cellHeight: 1,
      cols: 1,
      rows: 8,
    });
  });

  test('setGridConfig: cellCount=0 means "use cols × rows"', () => {
    const s = setGridConfig(defaultState(), { cellCount: 0 });
    if (s.grid.cellCount !== 0) {
      throw new Error(`cellCount: ${String(s.grid.cellCount)}`);
    }
  });

  // --- addFrame --------------------------------------------------------

  test('addFrame: appends snapped rect', () => {
    const s = addFrame(withFrames([]), { x: 0.4, y: 0.6, w: 5.5, h: 7.2 });
    assertDeepEqual(s.frames, [{ x: 0, y: 1, w: 6, h: 7 }]);
  });

  test('addFrame: snaps zero-width input up to minimum w=1, h=1', () => {
    // Filtering tiny drags is the webview's job (mouseup checks w<2,h<2);
    // by the time addFrame runs, callers expect snap-to-minimum.
    const s = addFrame(withFrames([]), { x: 4, y: 4, w: 0, h: 0 });
    assertDeepEqual(s.frames, [{ x: 4, y: 4, w: 1, h: 1 }]);
  });

  // --- moveFrame (via setFrameRect on a delta basis) ----------------

  test('setFrameRect: moves and clamps to ≥0', () => {
    const s = setFrameRect(withFrames([{ x: 5, y: 5, w: 10, h: 10 }]), 0, {
      x: -5,
      y: -3,
    });
    assertDeepEqual(s.frames[0], { x: 0, y: 0, w: 10, h: 10 });
  });

  test('setFrameRect: w/h cannot drop below 1', () => {
    const s = setFrameRect(withFrames([{ x: 0, y: 0, w: 10, h: 10 }]), 0, {
      w: 0,
      h: -3,
    });
    assertDeepEqual(s.frames[0], { x: 0, y: 0, w: 1, h: 1 });
  });

  // --- resizeRect / resizeFrame (8 handles) -------------------------

  const start: FrameRect = { x: 10, y: 10, w: 20, h: 20 };

  test('resizeRect: SE handle expands w/h', () => {
    assertDeepEqual(resizeRect(start, 'se', 5, 7), {
      x: 10,
      y: 10,
      w: 25,
      h: 27,
    });
  });

  test('resizeRect: NW handle moves x/y, shrinks w/h', () => {
    assertDeepEqual(resizeRect(start, 'nw', 5, 4), {
      x: 15,
      y: 14,
      w: 15,
      h: 16,
    });
  });

  test('resizeRect: NE handle moves y, expands w, shrinks h', () => {
    assertDeepEqual(resizeRect(start, 'ne', 3, 4), {
      x: 10,
      y: 14,
      w: 23,
      h: 16,
    });
  });

  test('resizeRect: SW handle moves x, shrinks w, expands h', () => {
    assertDeepEqual(resizeRect(start, 'sw', 5, 7), {
      x: 15,
      y: 10,
      w: 15,
      h: 27,
    });
  });

  test('resizeRect: edge handles only touch one axis', () => {
    assertDeepEqual(resizeRect(start, 'n', 99, 4), {
      x: 10,
      y: 14,
      w: 20,
      h: 16,
    });
    assertDeepEqual(resizeRect(start, 'e', 4, 99), {
      x: 10,
      y: 10,
      w: 24,
      h: 20,
    });
    assertDeepEqual(resizeRect(start, 's', 99, 4), {
      x: 10,
      y: 10,
      w: 20,
      h: 24,
    });
    assertDeepEqual(resizeRect(start, 'w', 4, 99), {
      x: 14,
      y: 10,
      w: 16,
      h: 20,
    });
  });

  test('resizeRect: dragging W past right edge clamps to width=1', () => {
    assertDeepEqual(resizeRect(start, 'w', 50, 0), {
      x: 29,
      y: 10,
      w: 1,
      h: 20,
    });
  });

  test('resizeFrame returns same state for out-of-range index', () => {
    const a = withFrames([start]);
    if (resizeFrame(a, 5, 'se', 1, 1) !== a) {
      throw new Error('expected identity');
    }
  });

  // --- deleteFrame -----------------------------------------------------

  test('deleteFrame: removes only the indicated index', () => {
    const a = withFrames([
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 5, y: 5, w: 1, h: 1 },
      { x: 9, y: 9, w: 1, h: 1 },
    ]);
    const b = deleteFrame(a, 1);
    assertDeepEqual(b.frames, [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 9, y: 9, w: 1, h: 1 },
    ]);
  });

  test('deleteFrame: out-of-range returns same state', () => {
    const a = withFrames([{ x: 0, y: 0, w: 1, h: 1 }]);
    if (deleteFrame(a, 99) !== a) throw new Error('expected identity');
    if (deleteFrame(a, -1) !== a) throw new Error('expected identity');
  });

  // --- serializeImageType / round-trip ---------------------------

  test('serializeImageType: single → null', () => {
    if (serializeImageType(defaultState()) !== null) {
      throw new Error('expected null for single mode');
    }
  });

  test('serializeImageType: grid round-trips through parseImageType', () => {
    const s: EditorState = {
      ...defaultState(),
      mode: 'grid',
      grid: {
        cellWidth: 16,
        cellHeight: 16,
        cols: 8,
        rows: 8,
        cellCount: 60,
      },
    };
    const round = parseImageType(serializeImageType(s));
    if (round.mode !== 'grid') throw new Error('mode lost');
    assertDeepEqual(round.grid, s.grid);
  });

  test('serializeImageType: framemap round-trips', () => {
    const s = withFrames([
      { x: 0, y: 0, w: 32, h: 32 },
      { x: 32, y: 0, w: 32, h: 32 },
    ]);
    const round = parseImageType(serializeImageType(s));
    if (round.mode !== 'framemap') throw new Error('mode lost');
    assertDeepEqual(round.frames, s.frames);
  });

  // --- geom: clampZoom ------------------------------------------------

  test('clampZoom: clamps to [ZOOM_MIN, ZOOM_MAX]', () => {
    if (clampZoom(0.001) !== ZOOM_MIN) throw new Error('low not clamped');
    if (clampZoom(999) !== ZOOM_MAX) throw new Error('high not clamped');
    if (clampZoom(2) !== 2) throw new Error('inner range altered');
    if (clampZoom(NaN) !== 1) throw new Error('NaN not coerced to 1');
  });

  // --- geom: screenToImage / imageToScreen ----------------------------

  test('screenToImage / imageToScreen are inverses at zoom=2', () => {
    const cam: Camera = { x: 100, y: 50, zoom: 2 };
    const p = { x: 7, y: 11 };
    const round = screenToImage(imageToScreen(p, cam), cam);
    assertDeepEqual(round, p);
  });

  // --- geom: fitImageToView -------------------------------------------

  test('fitImageToView: centers + scales to 90% of viewport', () => {
    const cam = fitImageToView(
      { width: 100, height: 100 },
      { width: 1000, height: 500 },
    );
    // Limiting axis: height. 90% of 500 = 450 / 100 = 4.5× zoom.
    if (Math.abs(cam.zoom - 4.5) > 1e-9) {
      throw new Error(`zoom: ${cam.zoom}`);
    }
    // Scaled size = 100 * 4.5 = 450; centered horizontally = (1000-450)/2.
    if (Math.abs(cam.x - 275) > 1e-9) throw new Error(`x: ${cam.x}`);
    if (Math.abs(cam.y - 25) > 1e-9) throw new Error(`y: ${cam.y}`);
  });

  // --- geom: zoomToward keeps cursor anchored ------------------------

  test('zoomToward: image point under cursor stays put', () => {
    const cam: Camera = { x: 50, y: 50, zoom: 1 };
    const cursor = { x: 100, y: 100 };
    const before = screenToImage(cursor, cam);
    const after = zoomToward(cam, cursor, -120);
    if (after.zoom === cam.zoom) {
      throw new Error('expected zoom change for non-zero deltaY');
    }
    const beforeAfterZoom = screenToImage(cursor, after);
    // Should be (nearly) identical — float rounding may add tiny epsilon.
    if (Math.abs(beforeAfterZoom.x - before.x) > 1e-9) {
      throw new Error(`x drifted: ${beforeAfterZoom.x} vs ${before.x}`);
    }
    if (Math.abs(beforeAfterZoom.y - before.y) > 1e-9) {
      throw new Error(`y drifted: ${beforeAfterZoom.y} vs ${before.y}`);
    }
  });

  // --- geom: frameAt --------------------------------------------------

  test('frameAt: returns last-on-top index when frames overlap', () => {
    const frames: FrameRect[] = [
      { x: 0, y: 0, w: 50, h: 50 }, // 0
      { x: 10, y: 10, w: 30, h: 30 }, // 1 — drawn on top
    ];
    if (frameAt({ x: 25, y: 25 }, frames) !== 1) {
      throw new Error('expected topmost match');
    }
    if (frameAt({ x: 5, y: 5 }, frames) !== 0) {
      throw new Error('expected bottom match');
    }
    if (frameAt({ x: 100, y: 100 }, frames) !== null) {
      throw new Error('expected miss');
    }
  });

  // --- geom: handleAt --------------------------------------------------

  test('handleAt: hit on each of 8 handle positions', () => {
    const rect: FrameRect = { x: 0, y: 0, w: 100, h: 100 };
    const expected: Record<string, { x: number; y: number }> = {
      nw: { x: 0, y: 0 },
      ne: { x: 100, y: 0 },
      se: { x: 100, y: 100 },
      sw: { x: 0, y: 100 },
      n: { x: 50, y: 0 },
      e: { x: 100, y: 50 },
      s: { x: 50, y: 100 },
      w: { x: 0, y: 50 },
    };
    for (const [id, pos] of Object.entries(expected)) {
      if (handleAt(pos, rect, idCam) !== id) {
        throw new Error(`expected handle ${id} at ${pos.x},${pos.y}`);
      }
    }
    // Far away → null.
    if (handleAt({ x: 50, y: 50 }, rect, idCam) !== null) {
      throw new Error('center should not hit any handle');
    }
  });

  test('handleAt: corner wins over adjacent edge midpoint', () => {
    const rect: FrameRect = {
      x: 0,
      y: 0,
      w: HANDLE_HIT_RADIUS * 2,
      h: HANDLE_HIT_RADIUS * 2,
    };
    // At (0,0) both nw corner and any edge that contains (0,0) coincide;
    // implementation orders corners first.
    if (handleAt({ x: 0, y: 0 }, rect, idCam) !== 'nw') {
      throw new Error('expected nw to win at corner');
    }
  });

  // --- geom: rectFromPoints ---------------------------------------------

  test('rectFromPoints: works regardless of drag direction', () => {
    const a = rectFromPoints({ x: 10, y: 20 }, { x: 30, y: 50 });
    const b = rectFromPoints({ x: 30, y: 50 }, { x: 10, y: 20 });
    assertDeepEqual(a, { x: 10, y: 20, w: 20, h: 30 });
    assertDeepEqual(b, a);
  });
}
