import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../component';
import { createEmptyOmosceneFile } from '../omoscene';
import { buildDefaultComponent, insertChildComponent } from '../scene';
import {
  getAngleValues,
  getAxisDirs,
  worldToScreen,
} from '../views/viewport/axonometry';
import {
  extractGizmoEntities,
  resolveTransformSelection,
  sceneStructureKey,
} from '../views/viewport/entities';

test('worldToScreen centers origin at viewport mid', () => {
  const cam = {
    panX: 0,
    panY: 0,
    zoom: 1,
    vpW: 200,
    vpH: 100,
    angle: 30,
    yaw: 0,
  };
  const p = worldToScreen(0, 0, 0, cam);
  assert.equal(p.x, 100);
  assert.equal(p.y, 50);
});

test('yaw rotates projected points around Y', () => {
  const base = {
    panX: 0,
    panY: 0,
    zoom: 1,
    vpW: 200,
    vpH: 100,
    angle: 30,
    yaw: 0,
  };
  // (16,0,16) is asymmetric under 90° yaw — screen position must move.
  const a = worldToScreen(16, 0, 16, base);
  const b = worldToScreen(16, 0, 16, { ...base, yaw: 90 });
  assert.notEqual(a.x, b.x);
  assert.notEqual(a.y, b.y);
});

test('axis dirs point distinct screen directions', () => {
  const dirs = getAxisDirs(getAngleValues(30), 0);
  assert.ok(dirs.x.x > 0);
  // Engine convention: +Y raises isoY negative → smaller screen Y (toward top).
  assert.ok(dirs.y.y < 0);
  assert.ok(dirs.z.x < 0);
});

test('worldToScreen Y matches engine (no extra flip)', () => {
  const cam = {
    panX: 0,
    panY: 0,
    zoom: 1,
    vpW: 200,
    vpH: 100,
    angle: 30,
    yaw: 0,
  };
  // Raising world Y should move toward the top of the canvas (smaller sy).
  const ground = worldToScreen(0, 0, 0, cam);
  const up = worldToScreen(0, 16, 0, cam);
  assert.ok(up.y < ground.y);
});

test('extractGizmoEntities finds nexus with sibling transform only', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(file, 0, {
    type: 'nexus',
    name: 'Player',
    id: 4,
    unique: 0,
    components: [],
  });
  file = insertChildComponent(
    file,
    4,
    buildDefaultComponent({
      type: 'transform',
      id: 5,
      engineVersion: 'v0.24.1',
      name: 'Transform',
    }),
  );
  file = insertChildComponent(file, 0, {
    type: 'light',
    name: 'Ambient',
    id: 3,
    unique: 0,
    lightType: 'ambient',
  });
  const entities = extractGizmoEntities(file);
  assert.equal(entities.length, 1);
  assert.equal(entities[0]!.nexusId, 4);
  assert.equal(entities[0]!.transformId, 5);
  assert.equal(entities[0]!.label, 'Player');
});

test('extractGizmoEntities skips nexus without transform', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(file, 0, {
    type: 'nexus',
    name: 'Empty',
    id: 2,
    unique: 0,
    components: [],
  });
  assert.deepEqual(extractGizmoEntities(file), []);
});

test('resolveTransformSelection maps nexus or transform id', () => {
  const entities = [
    {
      nexusId: 4,
      transformId: 5,
      label: 'Player',
      position: { x: 1, y: 2, z: 3 },
      translateEnabled: true,
    },
  ];
  assert.equal(resolveTransformSelection(entities, [5])?.entity.transformId, 5);
  assert.equal(resolveTransformSelection(entities, [4])?.entity.nexusId, 4);
  assert.equal(resolveTransformSelection(entities, [99]), null);
  assert.equal(resolveTransformSelection(entities, []), null);
});

test('sceneStructureKey ignores property values', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(
    file,
    0,
    buildDefaultComponent({
      type: 'transform',
      id: 5,
      engineVersion: 'v0.24.1',
    }),
  );
  const a = sceneStructureKey(file);
  const moved = {
    ...file,
    scene: {
      ...file.scene,
      components: (file.scene.components ?? []).map((c) =>
        c.id === 5
          ? {
              ...c,
              position: { _vectorType: 'Vector3D', x: 9, y: 0, z: 0 },
            }
          : c,
      ),
    },
  };
  assert.equal(sceneStructureKey(moved), a);
  const added = insertChildComponent(file, 0, {
    type: 'light',
    name: 'L',
    id: 3,
    unique: 0,
  });
  assert.notEqual(sceneStructureKey(added), a);
});
