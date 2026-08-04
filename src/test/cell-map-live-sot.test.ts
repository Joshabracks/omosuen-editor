/**
 * Cell-map engine SoT: live paint without packedData dump; flush on save.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDocumentController,
  type DocumentControllerDependencies,
} from '../app/document-controller';
import { createEmptyOmosceneFile, type OmosceneFile } from '../omoscene';
import { componentUpdate } from '../protocol';
import { findComponentById, insertChildComponent } from '../scene';
import { applyVoxelStroke } from '../scene/cell-voxel-paint';
import { ensurePackedBuffer } from '../scene/cell-voxel-paint/packed-map';
import type { AuthoringSceneHandles } from '../views/viewport/authoring-scene';
import { createAuthoringSyncBridge } from '../views/viewport/authoring-sync';
import {
  canPatchFlushedIntoCurrent,
  mergeCellMapPackedData,
} from '../views/viewport/cell-map-flush';
import { sceneRegionKey } from '../views/viewport/entities';
import type { OmosuenEngineApi } from '../views/viewport/engine-loader';

function cellMapFile(packedFill = 0): OmosceneFile {
  let file = createEmptyOmosceneFile({ name: 'Paint', engine: 'v0.24.1' });
  file = insertChildComponent(file, 0, {
    type: 'cell-map',
    name: 'Terrain',
    id: 3,
    unique: 0,
    mapSize: { _vectorType: 'Vector3D', x: 4, y: 2, z: 4 },
    cellSize: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
    materials: [{ albedoTextureKey: 'tiles', albedoFrame: 0 }],
    packedData: new Array(32).fill(packedFill),
  });
  return file;
}

test('live paint stroke marks dirty and does not commit packedData', () => {
  let dirty = false;
  let liveCalls = 0;
  let committed = 0;
  const result = applyVoxelStroke({
    componentId: 3,
    brushTarget: { x: 1, y: 0, z: 1 },
    mapSize: { x: 4, y: 2, z: 4 },
    kind: 'place',
    selectedMaterial: 2,
    packed: ensurePackedBuffer([], { x: 4, y: 2, z: 4 }),
    applyLiveCell: () => {
      liveCalls += 1;
      return true;
    },
    markVoxelDirty: () => {
      dirty = true;
    },
    commitPackedFallback: () => {
      committed += 1;
    },
  });
  assert.equal(result, 'live');
  assert.equal(liveCalls, 1);
  assert.equal(committed, 0);
  assert.equal(dirty, true);
});

test('fallback paint without live cell commits packedData', () => {
  let committed: number[] | null = null;
  const packed = ensurePackedBuffer([], { x: 4, y: 2, z: 4 });
  const result = applyVoxelStroke({
    componentId: 3,
    brushTarget: { x: 1, y: 0, z: 1 },
    mapSize: { x: 4, y: 2, z: 4 },
    kind: 'place',
    selectedMaterial: 2,
    packed,
    commitPackedFallback: (next) => {
      committed = next;
    },
  });
  assert.equal(result, 'fallback');
  assert.ok(committed);
  assert.notEqual(committed, packed);
});

test('mergeCellMapPackedData patches document packedData', () => {
  const file = cellMapFile();
  const patches = new Map<number, number[]>([[3, new Array(32).fill(7)]]);
  const next = mergeCellMapPackedData(file, patches);
  const cm = findComponentById(next.scene, 3);
  assert.ok(cm);
  assert.deepEqual(cm.packedData, new Array(32).fill(7));
});

test('mergeCellMapPackedData rejects empty and wrong-length packs', () => {
  const file = cellMapFile(3);
  const before = findComponentById(file.scene, 3)!.packedData;
  const empty = mergeCellMapPackedData(file, new Map([[3, []]]));
  assert.equal(empty, file);
  assert.deepEqual(findComponentById(empty.scene, 3)!.packedData, before);
  const short = mergeCellMapPackedData(
    file,
    new Map([[3, new Array(8).fill(9)]]),
  );
  assert.equal(short, file);
});

test('mergeCellMapPackedData skips equal packedData (no-op)', () => {
  const file = cellMapFile(4);
  const same = mergeCellMapPackedData(
    file,
    new Map([[3, new Array(32).fill(4)]]),
  );
  assert.equal(same, file);
});

test('sceneRegionKey ignores packedData differences', () => {
  const a = cellMapFile(0);
  const b = cellMapFile(99);
  assert.equal(sceneRegionKey(a), sceneRegionKey(b));
  const otherEngine = { ...a, engine: 'v0.25.0' };
  assert.notEqual(sceneRegionKey(a), sceneRegionKey(otherEngine));
});

test('sceneRegionKey ignores other large engine-derived cell-map fields (00c)', () => {
  // meshes/chunks/materialMap/etc. are hidden from the inspector (schema.ts
  // excludeFromInspector) but can be present on the document — see
  // authoring-load.test.ts's "does not delete existing materials" case,
  // which proves ensureCellMapDeserializeShape preserves materialMap.
  // None of these should force a cold boot when they change.
  let base = cellMapFile();
  base = insertChildComponent(base, 0, {
    type: 'cell-map',
    name: 'Terrain2',
    id: 4,
    unique: 0,
    mapSize: { _vectorType: 'Vector3D', x: 2, y: 2, z: 2 },
    cellSize: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
    materials: [{ albedoTextureKey: 'tiles', albedoFrame: 0 }],
    packedData: new Array(8).fill(0),
    meshes: [{ verts: [1, 2, 3] }],
    chunks: { '0,0,0': { dirty: true } },
    chunkGridSize: 16,
    materialMap: { keep: true },
    shapeMap: [1, 2, 3],
    emissionMap: [0, 0, 0],
    visibilityMap: [1, 1, 1],
    smoothingWeights: [0.5, 0.5],
    needsGPUUpdate: true,
  });

  let mutated = insertChildComponent(cellMapFile(), 0, {
    type: 'cell-map',
    name: 'Terrain2',
    id: 4,
    unique: 0,
    mapSize: { _vectorType: 'Vector3D', x: 2, y: 2, z: 2 },
    cellSize: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
    materials: [{ albedoTextureKey: 'tiles', albedoFrame: 0 }],
    packedData: new Array(8).fill(0),
    meshes: [{ verts: [9, 9, 9, 9, 9] }],
    chunks: { '1,1,1': { dirty: false } },
    chunkGridSize: 32,
    materialMap: { keep: false, extra: true },
    // Same *lengths* as `base`'s arrays, different content — the stub
    // ignores array content but (correctly) still reflects length changes,
    // so length must match here to isolate "content is ignored."
    shapeMap: [9, 9, 9],
    emissionMap: [9, 9, 9],
    visibilityMap: [0, 0, 0],
    smoothingWeights: [0.1, 0.1],
    needsGPUUpdate: false,
  });

  assert.equal(sceneRegionKey(base), sceneRegionKey(mutated));

  // A real structural difference (a material's texture key) must still
  // distinguish regions — the stub-out must not swallow everything.
  const materialsChanged = insertChildComponent(cellMapFile(), 0, {
    type: 'cell-map',
    name: 'Terrain2',
    id: 4,
    unique: 0,
    mapSize: { _vectorType: 'Vector3D', x: 2, y: 2, z: 2 },
    cellSize: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
    materials: [{ albedoTextureKey: 'other-tile', albedoFrame: 0 }],
    packedData: new Array(8).fill(0),
  });
  assert.notEqual(sceneRegionKey(base), sceneRegionKey(materialsChanged));
});

test('flush targets previous file not incoming with colliding ids', () => {
  const previous = cellMapFile(0);
  const incoming = cellMapFile(0);
  const patches = new Map<number, number[]>([[3, new Array(32).fill(5)]]);
  const flushedPrev = mergeCellMapPackedData(previous, patches);
  assert.deepEqual(
    findComponentById(flushedPrev.scene, 3)!.packedData,
    new Array(32).fill(5),
  );
  // Incoming must stay untouched when flush is applied only to previous.
  assert.deepEqual(
    findComponentById(incoming.scene, 3)!.packedData,
    new Array(32).fill(0),
  );
  assert.equal(
    canPatchFlushedIntoCurrent(incoming, flushedPrev, sceneRegionKey),
    true,
  );
  // Different structure → must not patch current with previous flush.
  const other = insertChildComponent(incoming, 0, {
    type: 'light',
    name: 'L',
    id: 9,
    unique: 0,
  });
  assert.equal(
    canPatchFlushedIntoCurrent(other, flushedPrev, sceneRegionKey),
    false,
  );
});

test('beforeSave flush merges live packedData before write', async () => {
  const file = cellMapFile();
  const writes: OmosceneFile[] = [];
  const deps: DocumentControllerDependencies = {
    readFile: async () => file,
    writeFile: async (_uri, next) => {
      writes.push(next);
    },
  };
  const controller = createDocumentController(deps);
  await controller.load('mem://paint.omoscene');
  controller.setBeforeSave(async (current) =>
    mergeCellMapPackedData(current, new Map([[3, new Array(32).fill(9)]])),
  );
  await controller.save();
  assert.equal(writes.length, 1);
  const cm = findComponentById(writes[0]!.scene, 3);
  assert.deepEqual(cm!.packedData, new Array(32).fill(9));
  controller.dispose();
});

test('authoring sync no-ops packedData updates for live cell-maps', async () => {
  const live: Record<string, unknown> = {
    id: 3,
    type: 'cell-map',
  };
  let assigned: unknown = undefined;
  Object.defineProperty(live, 'packedData', {
    get: () => ({ forEach() {} }),
    set(v) {
      assigned = v;
    },
    configurable: true,
  });

  const handles: AuthoringSceneHandles = {
    root: { id: 0, type: 'nexus', components: [live] },
    idToLive: new Map([[3, live]]),
    viewport: null,
    camera: null,
    transform: null,
    atlasManager: null,
    inputController: null,
    disposeInput: () => undefined,
  };

  const api = {
    init() {},
    start() {},
    registerScene() {},
    switchScene() {},
    deserializeComponentRecursive() {
      return null;
    },
    serializeComponentRecursive(c: unknown) {
      return c;
    },
  } as unknown as OmosuenEngineApi;

  const bridge = createAuthoringSyncBridge({
    api,
    getHandles: () => handles,
    getDocument: () => cellMapFile(),
  });

  await bridge.applyMessage(
    componentUpdate(3, 'cell-map', 'packedData', [1, 2, 3]),
  );
  assert.equal(assigned, undefined);
  bridge.dispose();
});
