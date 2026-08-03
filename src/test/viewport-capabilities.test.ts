import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  registerEditorType,
  resetEditorApiForTests,
} from '../editor-api';
import { createEmptyOmosceneFile } from '../omoscene';
import { insertChildComponent } from '../scene';
import {
  buildViewportOverlayModel,
  listRegisteredPaintModes,
  resolveViewportCapsForType,
} from '../views/viewport/capabilities';

const ENGINE = 'v0.24.1';

function registerMockViewportTypes(options: {
  readonly colliderGizmo?: boolean;
  readonly lightGizmo?: boolean;
  readonly cellPaint?: boolean;
  readonly nexusLabels?: boolean;
  readonly translate?: boolean;
}): void {
  resetEditorApiForTests();
  registerEditorType({
    type: 'nexus',
    since: 'v0.1.0',
    viewport: options.nexusLabels
      ? { labelWhen: 'has-sibling-transform' }
      : { labelWhen: 'never' },
    fields: [],
  });
  registerEditorType({
    type: 'transform',
    since: 'v0.1.0',
    viewport: {
      gizmos: options.translate
        ? ['gizmo.translate', 'overlay.grid']
        : ['overlay.grid'],
    },
    fields: [],
  });
  registerEditorType({
    type: 'collider',
    since: 'v0.1.0',
    viewport: options.colliderGizmo
      ? { gizmos: ['gizmo.collider'] }
      : undefined,
    fields: [],
  });
  registerEditorType({
    type: 'light',
    since: 'v0.1.0',
    viewport: options.lightGizmo
      ? { gizmos: ['gizmo.light-direction'] }
      : undefined,
    fields: [],
  });
  registerEditorType({
    type: 'cell-map',
    since: 'v0.1.0',
    viewport: options.cellPaint
      ? { paintModes: ['paint.cell-map'], gizmos: ['overlay.grid'] }
      : undefined,
    fields: [],
  });
}

function sceneWithHelpers() {
  let file = createEmptyOmosceneFile({ name: 'T', engine: ENGINE });
  file = insertChildComponent(file, 0, {
    type: 'nexus',
    name: 'Player',
    id: 4,
    unique: 0,
    components: [],
  });
  file = insertChildComponent(file, 4, {
    type: 'transform',
    name: 'Transform',
    id: 5,
    unique: 0,
    position: { x: 1, y: 2, z: 3 },
  });
  file = insertChildComponent(file, 4, {
    type: 'collider',
    name: 'Hit',
    id: 6,
    unique: 0,
    shape: 'box',
    size: { x: 8, y: 8, z: 8 },
    offset: { x: 0, y: 0, z: 0 },
  });
  file = insertChildComponent(file, 0, {
    type: 'light',
    name: 'Sun',
    id: 7,
    unique: 0,
    lightType: 'directional',
    direction: { x: 0.5, y: -1, z: 0.2 },
    color: { x: 1, y: 1, z: 1 },
  });
  file = insertChildComponent(file, 0, {
    type: 'cell-map',
    name: 'Map',
    id: 8,
    unique: 0,
  });
  return file;
}

test('resolveViewportCapsForType reads contribution gizmos', () => {
  registerMockViewportTypes({ translate: true, colliderGizmo: true });
  const transform = resolveViewportCapsForType('transform', ENGINE);
  assert.equal(transform.gizmos.has('gizmo.translate'), true);
  const collider = resolveViewportCapsForType('collider', ENGINE);
  assert.equal(collider.gizmos.has('gizmo.collider'), true);
});

test('adding viewport caps enables collider/light helpers and labels', () => {
  registerMockViewportTypes({
    nexusLabels: true,
    translate: true,
    colliderGizmo: true,
    lightGizmo: true,
    cellPaint: true,
  });
  const model = buildViewportOverlayModel(sceneWithHelpers(), ENGINE);
  assert.equal(model.labels.length, 1);
  assert.equal(model.labels[0]!.label, 'Player');
  assert.equal(model.labels[0]!.translateEnabled, true);
  assert.equal(model.colliders.length, 1);
  assert.equal(model.colliders[0]!.componentId, 6);
  assert.equal(model.lights.length, 1);
  assert.equal(model.lights[0]!.lightType, 'directional');
  assert.deepEqual(model.paintModes, ['paint.cell-map']);
  assert.equal(model.showGrid, true);
});

test('removing viewport caps disables overlay helpers', () => {
  registerMockViewportTypes({
    nexusLabels: false,
    translate: false,
    colliderGizmo: false,
    lightGizmo: false,
    cellPaint: false,
  });
  const model = buildViewportOverlayModel(sceneWithHelpers(), ENGINE);
  assert.equal(model.labels.length, 0);
  assert.equal(model.colliders.length, 0);
  assert.equal(model.lights.length, 0);
  assert.deepEqual(model.paintModes, []);
});

test('listRegisteredPaintModes includes paint.cell-map hook', () => {
  registerMockViewportTypes({ cellPaint: true });
  assert.deepEqual(listRegisteredPaintModes(ENGINE), ['paint.cell-map']);
});
