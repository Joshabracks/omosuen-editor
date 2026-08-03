import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../component';
import { createEmptyOmosceneFile } from '../omoscene';
import { insertChildComponent } from '../scene';
import {
  EDITOR_CAMERA_NAME,
  prepareSceneForAuthoring,
  stripCameras,
} from '../views/viewport/prepare';
import {
  clampViewCamera,
  orbitViewCamera,
  panViewCamera,
  zoomViewCameraAt,
} from '../views/viewport/view-camera';
import { isoPanToWorld, worldToIsoPan } from '../views/viewport/view-camera-map';

test('clampViewCamera clamps zoom and angle', () => {
  const cam = clampViewCamera({
    panX: 0,
    panY: 0,
    zoom: 100,
    axonometricAngle: 120,
    yaw: 45,
  });
  assert.equal(cam.zoom, 8);
  assert.equal(cam.axonometricAngle, 90);
  assert.equal(cam.yaw, 45);
});

test('pan and orbit helpers mutate expected axes', () => {
  const base = {
    panX: 0,
    panY: 0,
    zoom: 1,
    axonometricAngle: 30,
    yaw: 0,
  };
  const panned = panViewCamera(base, 10, 0);
  assert.ok(panned.panX < 0);
  const orbited = orbitViewCamera(base, 10, -20);
  assert.ok(orbited.yaw > 0);
  assert.ok(orbited.axonometricAngle > 30);
});

test('zoomViewCameraAt scales zoom', () => {
  const next = zoomViewCameraAt(
    { panX: 0, panY: 0, zoom: 1, axonometricAngle: 30, yaw: 0 },
    2,
  );
  assert.equal(next.zoom, 2);
});

test('prepareSceneForAuthoring strips scene cameras and injects EditorCamera', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(file, 0, {
    type: 'viewport',
    name: 'MainViewport',
    id: 1,
    unique: 0,
  });
  file = insertChildComponent(file, 0, {
    type: 'camera',
    name: 'MainCamera',
    id: 2,
    unique: 0,
    axonometricAngle: 45,
    viewportRef: 'MainViewport',
  });
  file = insertChildComponent(file, 0, {
    type: 'light',
    name: 'Ambient',
    id: 3,
    unique: 0,
    lightType: 'ambient',
  });

  const prepared = prepareSceneForAuthoring(file.scene, {
    panX: 0,
    panY: 0,
    zoom: 1,
    axonometricAngle: 30,
    yaw: 15,
  });
  const types = (prepared.scene.components ?? []).map((c) => c.type);
  assert.ok(!types.includes('camera'));
  assert.equal(prepared.viewportName, 'MainViewport');
  const editorCam = (prepared.scene.components ?? []).find(
    (c) => c.type === 'nexus' && c.name === 'EditorCam',
  );
  assert.ok(editorCam);
  const nested = (editorCam!.components ?? []).map((c) => c.type);
  assert.deepEqual(nested.sort(), ['camera', 'transform']);
  const cam = (editorCam!.components ?? []).find((c) => c.type === 'camera');
  assert.equal(cam!.name, EDITOR_CAMERA_NAME);
  assert.equal(cam!.viewportRef, 'MainViewport');
  assert.equal(cam!.axonometricAngle, 30);
});

test('stripCameras removes only camera nodes', () => {
  const root = {
    type: 'nexus' as const,
    name: 'Root',
    id: 0,
    components: [
      { type: 'camera', name: 'C', id: 1 },
      { type: 'light', name: 'L', id: 2 },
    ],
  };
  const stripped = stripCameras(root);
  assert.deepEqual(
    (stripped.components ?? []).map((c) => c.type),
    ['light'],
  );
});

test('isoPanToWorld roughly inverts worldToIsoPan at yaw 0', () => {
  const angle = 30;
  const world = { x: 10, y: 0, z: -4 };
  const pan = worldToIsoPan(world.x, world.y, world.z, angle, 0);
  const back = isoPanToWorld({
    panX: pan.panX,
    panY: pan.panY,
    zoom: 1,
    axonometricAngle: angle,
    yaw: 0,
  });
  assert.ok(Math.abs(back.x - world.x) < 1e-6);
  assert.ok(Math.abs(back.z - world.z) < 1e-6);
});
