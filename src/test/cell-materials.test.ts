import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SerializedComponent } from '../omoscene';
import {
  addMaterial,
  emptyMaterial,
  parseMaterials,
  removeMaterialAt,
  serializeMaterials,
  setChannelFrame,
  setChannelTextureKey,
} from '../scene/cell-materials/reducer';
import { collectSceneTextureMaps } from '../scene/cell-materials/texture-maps';

test('parseMaterials: empty / malformed → []', () => {
  assert.deepEqual(parseMaterials(undefined), []);
  assert.deepEqual(parseMaterials(null), []);
  assert.deepEqual(parseMaterials({}), []);
});

test('parseMaterials: defaults missing frames and keys', () => {
  const parsed = parseMaterials([
    { albedoTextureKey: 'hero' },
    { albedoFrame: 2.7, normalFrame: -1 },
  ]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]!.albedoTextureKey, 'hero');
  assert.equal(parsed[0]!.albedoFrame, 0);
  assert.equal(parsed[1]!.albedoFrame, 2);
  assert.equal(parsed[1]!.normalFrame, 0);
});

test('add / remove / set channel key+frame / serialize round-trip', () => {
  let mats = addMaterial([]);
  assert.equal(mats.length, 1);
  mats = setChannelTextureKey(mats, 0, 'albedo', 'hero');
  assert.equal(mats[0]!.albedoTextureKey, 'hero');
  assert.equal(mats[0]!.albedoFrame, 0);
  mats = setChannelFrame(mats, 0, 'albedo', 3);
  assert.equal(mats[0]!.albedoFrame, 3);
  mats = setChannelTextureKey(mats, 0, 'albedo', 'other');
  assert.equal(mats[0]!.albedoFrame, 0);
  mats = addMaterial(mats);
  assert.equal(mats.length, 2);
  mats = removeMaterialAt(mats, 0);
  assert.equal(mats.length, 1);
  assert.deepEqual(parseMaterials(serializeMaterials(mats)), mats);
});

test('emptyMaterial has blank keys and zero frames', () => {
  assert.deepEqual(emptyMaterial(), {
    albedoTextureKey: '',
    normalTextureKey: '',
    emissionTextureKey: '',
    materialTextureKey: '',
    albedoFrame: 0,
    normalFrame: 0,
    emissionFrame: 0,
    materialFrame: 0,
  });
});

test('collectSceneTextureMaps finds unique keys with frame rects', () => {
  const scene: SerializedComponent = {
    type: 'nexus',
    name: 'Root',
    id: 0,
    components: [
      {
        type: 'texture-map',
        name: 'a',
        id: 1,
        textureMapKey: 'hero',
        filePath: 'a.png',
        imageType: {
          mode: 'grid',
          cellWidth: 16,
          cellHeight: 16,
          cols: 2,
          rows: 2,
        },
      },
      {
        type: 'texture-map',
        name: 'dup',
        id: 2,
        textureMapKey: 'hero',
        filePath: 'b.png',
      },
      {
        type: 'texture-map',
        name: 'b',
        id: 3,
        textureMapKey: 'ground',
        filePath: 'g.png',
        imageType: {
          mode: 'framemap',
          frames: [{ x: 0, y: 0, w: 8, h: 8 }],
        },
      },
    ],
  };
  const maps = collectSceneTextureMaps(scene);
  assert.deepEqual(
    maps.map((m) => m.key),
    ['ground', 'hero'],
  );
  assert.equal(maps.find((m) => m.key === 'hero')!.frames.length, 4);
  assert.deepEqual(maps.find((m) => m.key === 'ground')!.frames, [
    { x: 0, y: 0, w: 8, h: 8 },
  ]);
});
