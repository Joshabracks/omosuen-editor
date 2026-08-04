/**
 * Regression coverage for .design/tasks/00a — a flush that doesn't capture
 * every live cell-map must be reported as incomplete so callers (viewport
 * index.ts) know not to clear voxelDirty and silently lose the stroke.
 *
 * mountAuthoringViewport itself needs a DOM (ResizeObserver, canvas 2D
 * context, document) this repo's Node test runner doesn't provide, so this
 * pins the same decision logic at the layer that doesn't need one:
 * session.ts's handles-driven collectors + cell-map-flush.ts's
 * flushIsComplete, which is exactly what index.ts's flushFullyCaptured
 * wraps with the console.warn + voxelDirty side effect.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flushIsComplete } from '../views/viewport/cell-map-flush';
import type { AuthoringSceneHandles } from '../views/viewport/authoring-scene';
import {
  collectLiveCellMapPackedFromHandles,
  liveCellMapIdsFromHandles,
} from '../views/viewport/session';

function handlesWith(
  entries: ReadonlyArray<[number, Record<string, unknown>]>,
): AuthoringSceneHandles {
  return {
    root: { id: 0, type: 'nexus', components: [] },
    idToLive: new Map(entries),
    viewport: null,
    camera: null,
    transform: null,
    atlasManager: null,
    inputController: null,
    disposeInput: () => undefined,
  };
}

test('liveCellMapIdsFromHandles finds cell-map-shaped entries only', () => {
  const handles = handlesWith([
    [1, { type: 'cell-map', packedData: [0, 0] }],
    [2, { type: 'transform' }],
    [3, { type: 'nexus', setCellData: () => undefined }],
  ]);
  assert.deepEqual([...liveCellMapIdsFromHandles(handles)], [1, 3]);
  assert.deepEqual(liveCellMapIdsFromHandles(null), []);
});

test('collectLiveCellMapPackedFromHandles skips entries whose packedData is not introspectable', () => {
  const handles = handlesWith([
    [1, { type: 'cell-map', packedData: [1, 2, 3] }],
    [2, { type: 'cell-map', packedData: undefined }], // unreadable — the real failure mode
  ]);
  const patches = collectLiveCellMapPackedFromHandles(handles);
  assert.deepEqual(patches.get(1), [1, 2, 3]);
  assert.equal(patches.has(2), false);
  assert.equal(patches.size, 1);
});

test('flushIsComplete reports partial capture as incomplete (the 00a regression)', () => {
  const handles = handlesWith([
    [1, { type: 'cell-map', packedData: [1, 2, 3] }],
    [2, { type: 'cell-map', packedData: undefined }],
  ]);
  const expectedIds = liveCellMapIdsFromHandles(handles);
  const patches = collectLiveCellMapPackedFromHandles(handles);

  const result = flushIsComplete(expectedIds, patches);
  assert.equal(result.complete, false);
  assert.deepEqual([...result.missing], [2]);

  // Once the previously-unreadable map becomes readable (e.g. retried on a
  // later flush attempt), the same expected-id set is now fully captured.
  const handlesRecovered = handlesWith([
    [1, { type: 'cell-map', packedData: [1, 2, 3] }],
    [2, { type: 'cell-map', packedData: [4, 5, 6] }],
  ]);
  const retryPatches = collectLiveCellMapPackedFromHandles(handlesRecovered);
  const retryResult = flushIsComplete(expectedIds, retryPatches);
  assert.equal(retryResult.complete, true);
  assert.deepEqual([...retryResult.missing], []);
});

test('flushIsComplete treats an empty expected set as trivially complete', () => {
  const result = flushIsComplete([], new Map());
  assert.equal(result.complete, true);
  assert.deepEqual([...result.missing], []);
});
