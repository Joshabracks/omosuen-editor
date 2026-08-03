import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fitImageToView,
  frameAt,
  handleAt,
  rectFromPoints,
  screenToImage,
  zoomToward,
} from '../scene/texture-frame/geom';
import {
  addFrame,
  defaultState,
  deleteFrame,
  parseImageType,
  resizeFrame,
  serializeImageType,
  setGridConfig,
  setMode,
} from '../scene/texture-frame/reducer';

test('parseImageType null → single; serialize round-trips grid/framemap', () => {
  assert.equal(parseImageType(null).mode, 'single');
  assert.equal(serializeImageType(defaultState()), null);

  const grid = setGridConfig(setMode(defaultState(), 'grid'), {
    cellWidth: 16,
    cellHeight: 16,
    cols: 2,
    rows: 2,
    cellCount: 3,
  });
  const raw = serializeImageType(grid);
  assert.deepEqual(parseImageType(raw).grid, grid.grid);
  assert.equal(parseImageType(raw).mode, 'grid');

  const withFrames = addFrame(setMode(defaultState(), 'framemap'), {
    x: 1,
    y: 2,
    w: 10,
    h: 10,
  });
  const framed = serializeImageType(withFrames);
  assert.equal(parseImageType(framed).frames.length, 1);
});

test('framemap mutators add/move/resize/delete', () => {
  let state = setMode(defaultState(), 'framemap');
  state = addFrame(state, { x: 0, y: 0, w: 8, h: 8 });
  state = resizeFrame(state, 0, 'se', 4, 4);
  assert.deepEqual(state.frames[0], { x: 0, y: 0, w: 12, h: 12 });
  state = deleteFrame(state, 0);
  assert.equal(state.frames.length, 0);
});

test('geom hit-test and zoom helpers', () => {
  const cam = { x: 0, y: 0, zoom: 1 };
  assert.deepEqual(screenToImage({ x: 10, y: 20 }, cam), { x: 10, y: 20 });
  assert.equal(frameAt({ x: 5, y: 5 }, [{ x: 0, y: 0, w: 10, h: 10 }]), 0);
  assert.equal(
    handleAt({ x: 0, y: 0 }, { x: 0, y: 0, w: 20, h: 20 }, cam),
    'nw',
  );
  const fitted = fitImageToView(
    { width: 100, height: 50 },
    { width: 200, height: 200 },
  );
  assert.ok(fitted.zoom > 0);
  const zoomed = zoomToward(cam, { x: 50, y: 50 }, -100);
  assert.ok(zoomed.zoom > cam.zoom);
  assert.deepEqual(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 0 }), {
    x: 0,
    y: 0,
    w: 10,
    h: 10,
  });
});
