import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SerializedScene } from '../omoscene';
import {
  ensureCellMapDeserializeShape,
  flattenLivePackedData,
  resolveTexturePathsForAuthoring,
} from '../views/viewport/authoring-load';
import { packCell, placedCellData } from '../scene/cell-voxel-paint/cell-data';

function sampleScene(): SerializedScene {
  return {
    type: 'nexus',
    name: 'Root',
    id: 0,
    components: [
      {
        type: 'texture-map',
        name: 'Hero',
        id: 1,
        textureMapKey: 'hero',
        filePath: 'assets/hero.png',
      },
      {
        type: 'cell-map',
        name: 'Map',
        id: 2,
        mapSize: { _vectorType: 'Vector3D', x: 0, y: 0, z: 0 },
        cellSize: { _vectorType: 'Vector3D', x: 0, y: 0, z: 0 },
        packedData: [packCell(placedCellData(3))],
      },
    ],
  };
}

test('resolveTexturePathsForAuthoring rewrites relative paths to data URLs', async () => {
  const scene = sampleScene();
  const out = await resolveTexturePathsForAuthoring(scene, async (rel) => {
    assert.equal(rel, 'assets/hero.png');
    return 'data:image/png;base64,abc';
  });
  const tm = (out.components ?? []).find((c) => c.type === 'texture-map');
  assert.equal(tm!.filePath, 'data:image/png;base64,abc');
  assert.equal(
    (scene.components ?? []).find((c) => c.type === 'texture-map')!.filePath,
    'assets/hero.png',
  );
});

test('ensureCellMapDeserializeShape is additive: keeps packedData, fixes extents', () => {
  const scene = sampleScene();
  const before = (scene.components ?? []).find((c) => c.type === 'cell-map')!;
  const packedBefore = [...(before.packedData as number[])];

  ensureCellMapDeserializeShape(scene);

  const cm = (scene.components ?? []).find((c) => c.type === 'cell-map')!;
  assert.ok(Array.isArray(cm.packedData));
  assert.equal((cm.packedData as number[])[0], packedBefore[0]);
  assert.equal((cm.packedData as number[]).length, 8 * 4 * 8);
  assert.deepEqual(cm.mapSize, {
    _vectorType: 'Vector3D',
    x: 8,
    y: 4,
    z: 8,
  });
  assert.deepEqual(cm.cellSize, {
    _vectorType: 'Vector3D',
    x: 1,
    y: 1,
    z: 1,
  });
  assert.ok(Array.isArray(cm.materials));
});

test('ensureCellMapDeserializeShape does not delete existing materials', () => {
  const scene: SerializedScene = {
    type: 'nexus',
    name: 'Root',
    id: 0,
    components: [
      {
        type: 'cell-map',
        name: 'Map',
        id: 1,
        mapSize: { x: 2, y: 1, z: 2 },
        cellSize: { x: 1, y: 1, z: 1 },
        materials: [{ albedoTextureKey: 'hero' }],
        packedData: [1, 2, 3, 4],
        materialMap: { keep: true },
      },
    ],
  };
  ensureCellMapDeserializeShape(scene);
  const cm = (scene.components ?? [])[0]!;
  const mats = cm.materials as Array<{ albedoTextureKey: string }>;
  assert.equal(mats[0]!.albedoTextureKey, 'hero');
  assert.deepEqual(cm.materialMap, { keep: true });
  assert.equal((cm.packedData as number[]).length, 4);
});

test('flattenLivePackedData reads forEach getter or array', () => {
  assert.deepEqual(
    flattenLivePackedData({ packedData: [1, 2, 3] }),
    [1, 2, 3],
  );
  const live = {
    packedData: {
      forEach(cb: (v: number) => void) {
        cb(10);
        cb(20);
      },
    },
  };
  assert.deepEqual(flattenLivePackedData(live), [10, 20]);
  assert.deepEqual(
    flattenLivePackedData(
      {},
      () => ({ packedData: [7, 8] }),
    ),
    [7, 8],
  );
});

test('flattenLivePackedData returns null for unreadable packedData shapes', () => {
  // Neither array nor forEach-capable, and no serialize fallback provided —
  // this is the real-world shape mismatch that produces an empty flush
  // (see .design/audit00.md §1.1 / tasks/00a).
  assert.equal(flattenLivePackedData({ packedData: undefined }), null);
  assert.equal(flattenLivePackedData({ packedData: 42 }), null);
  assert.equal(flattenLivePackedData({}), null);
  // Serialize fallback provided but doesn't yield a packedData array either.
  assert.equal(
    flattenLivePackedData({}, () => ({ packedData: 'nope' })),
    null,
  );
});

test('deserializeAuthoringRoot awaits {component,errors} shape', async () => {
  const { deserializeAuthoringRoot } = await import(
    '../views/viewport/authoring-load'
  );
  const scene = {
    type: 'nexus',
    name: 'Root',
    id: 0,
    components: [],
  };
  const nexus = { type: 'nexus', name: 'Root', id: 0, components: [] };
  const root = await deserializeAuthoringRoot(
    {
      deserializeComponentRecursive: async () => ({
        component: nexus,
        errors: [{ code: 'WARN', message: 'example' }],
      }),
    },
    scene as import('../omoscene').SerializedScene,
  );
  assert.equal(root, nexus);

  const viaScene = await deserializeAuthoringRoot(
    {
      deserializeComponentRecursive: () => {
        throw new Error('should not call');
      },
      deserializeScene: async () => nexus,
    },
    scene as import('../omoscene').SerializedScene,
  );
  assert.equal(viaScene, nexus);
});
