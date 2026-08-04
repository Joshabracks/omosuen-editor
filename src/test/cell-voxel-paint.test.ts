import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  erasedCellData,
  packCell,
  placedCellData,
  unpackCell,
} from '../scene/cell-voxel-paint/cell-data';
import {
  cellIndex,
  eraseCellAt,
  ensurePackedBuffer,
  normalizeExtents,
  placeCellAt,
  worldToCellCoord,
  type MapSize,
} from '../scene/cell-voxel-paint/packed-map';

const map: MapSize = { x: 4, y: 3, z: 2 };

test('pack/unpack round-trips material, shape, emission, visible', () => {
  const cell = {
    materialIndex: 7,
    shapeIndex: 1,
    emissionIntensity: 12,
    visible: true,
  };
  assert.deepEqual(unpackCell(packCell(cell)), cell);
  const erased = erasedCellData();
  assert.equal(unpackCell(packCell(erased)).shapeIndex, 0);
  assert.equal(unpackCell(packCell(placedCellData(3))).materialIndex, 3);
  assert.equal(unpackCell(packCell(placedCellData(3))).shapeIndex, 1);
});

test('cellIndex: x fastest, then y, then z', () => {
  assert.equal(cellIndex(map, { x: 0, y: 0, z: 0 }), 0);
  assert.equal(cellIndex(map, { x: 3, y: 0, z: 0 }), 3);
  assert.equal(cellIndex(map, { x: 0, y: 1, z: 0 }), 4);
  assert.equal(cellIndex(map, { x: 0, y: 0, z: 1 }), 12);
  assert.equal(cellIndex(map, { x: 1, y: 2, z: 1 }), 1 + 2 * 4 + 1 * 12);
});

test('ensurePackedBuffer pads to volume with empty cells', () => {
  const buf = ensurePackedBuffer([1, 2], map);
  assert.equal(buf.length, 24);
  assert.equal(buf[0], 1);
  assert.equal(buf[1], 2);
  assert.equal(unpackCell(buf[2]!).shapeIndex, 0);
});

test('placeCellAt / eraseCellAt mutate packedData at index', () => {
  let packed = ensurePackedBuffer([], map);
  const coord = { x: 2, y: 1, z: 0 };
  const next = placeCellAt(packed, map, coord, 5);
  assert.ok(next);
  packed = next!;
  const idx = cellIndex(map, coord);
  assert.deepEqual(unpackCell(packed[idx]!), placedCellData(5));

  const erased = eraseCellAt(packed, map, coord);
  assert.ok(erased);
  assert.deepEqual(unpackCell(erased![idx]!), erasedCellData());
});

test('place/erase out of bounds → null', () => {
  const packed = ensurePackedBuffer([], map);
  assert.equal(placeCellAt(packed, map, { x: -1, y: 0, z: 0 }, 0), null);
  assert.equal(eraseCellAt(packed, map, { x: 0, y: 0, z: 9 }), null);
});

test('worldToCellCoord snaps to brush height layer', () => {
  const cellSize = { x: 1, y: 1, z: 1 };
  assert.deepEqual(
    worldToCellCoord({ x: 2.2, y: 99, z: 1.7 }, cellSize, map, 1),
    { x: 2, y: 1, z: 1 },
  );
  assert.equal(
    worldToCellCoord({ x: -0.1, y: 0, z: 0 }, cellSize, map, 0),
    null,
  );
});

test('normalizeExtents replaces zero/negative axes', () => {
  const out = normalizeExtents(
    { x: 0, y: 0, z: 0 },
    { x: 8, y: 4, z: 8 },
  );
  assert.deepEqual(
    { x: out.x, y: out.y, z: out.z, corrected: out.corrected },
    { x: 8, y: 4, z: 8, corrected: true },
  );
  const ok = normalizeExtents(
    { x: 2, y: 3, z: 4 },
    { x: 8, y: 4, z: 8 },
  );
  assert.equal(ok.corrected, false);
  assert.equal(ok.x, 2);
});
