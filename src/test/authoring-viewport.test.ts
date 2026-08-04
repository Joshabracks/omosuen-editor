import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyOmosceneFile } from '../omoscene';
import { insertChildComponent } from '../scene';
import {
  AUTHORING_DISPLAY_TYPES,
  isAuthoringDisplayType,
  LAPIS_SIN_HEX,
  LAPIS_SIN_RGBA,
  nexusHasDisplayChildren,
  nullOverrides,
  prepareLeafForDeserialize,
} from '../views/viewport/authoring-allowlist';
import { registerTextureWithAtlas } from '../views/viewport/authoring-scene';
import { createAuthoringSyncBridge } from '../views/viewport/authoring-sync';
import type { AuthoringSceneHandles } from '../views/viewport/authoring-scene';
import {
  componentAdd,
  componentRemove,
  componentUpdate,
  sceneLoad,
} from '../protocol';
import type { OmosuenEngineApi } from '../views/viewport/engine-loader';

test('registerTextureWithAtlas calls addTextureMap (not dead atlasManager assign)', () => {
  const registered: unknown[] = [];
  const atlas = {
    type: 'atlas-manager',
    addTextureMap(tm: unknown) {
      registered.push(tm);
      (this as { compiled?: boolean }).compiled = false;
    },
    compiled: true,
  };
  const tm = { type: 'texture-map', textureMapKey: 'tiles' };
  registerTextureWithAtlas(atlas, tm);
  assert.equal(registered.length, 1);
  assert.equal(registered[0], tm);
  assert.equal(atlas.compiled, false);
});

test('AUTHORING_DISPLAY_TYPES excludes cameras and gameplay types', () => {
  assert.equal(isAuthoringDisplayType('cell-map'), true);
  assert.equal(isAuthoringDisplayType('texture-map'), true);
  assert.equal(isAuthoringDisplayType('camera'), false);
  assert.equal(isAuthoringDisplayType('input-controller'), false);
  assert.equal(isAuthoringDisplayType('ui-overlay'), false);
  assert.equal(isAuthoringDisplayType('animation-controller'), false);
  assert.equal(isAuthoringDisplayType('collider'), false);
  assert.ok(AUTHORING_DISPLAY_TYPES.has('nexus'));
});

test('nullOverrides clears script and override keys without dropping packedData', () => {
  const node = nullOverrides({
    type: 'cell-map',
    id: 3,
    overrideKey: 'evil',
    initOverride: 'init',
    updateOverride: 'tick',
    script: './game.omo.ts',
    packedData: [1, 2, 3],
    materials: [{ name: 'dirt' }],
  });
  assert.equal(node.overrideKey, null);
  assert.equal(node.initOverride, null);
  assert.equal(node.updateOverride, null);
  assert.equal(node.script, null);
  assert.deepEqual(node.packedData, [1, 2, 3]);
  assert.equal(Array.isArray(node.materials), true);
});

test('prepareLeafForDeserialize strips children', () => {
  const leaf = prepareLeafForDeserialize({
    type: 'nexus',
    id: 1,
    components: [{ type: 'transform', id: 2 }],
    script: 'x',
  });
  assert.equal(leaf.script, null);
  assert.equal('components' in leaf, false);
});

test('nexusHasDisplayChildren skips hollow camera-only nexuses', () => {
  assert.equal(
    nexusHasDisplayChildren({
      type: 'nexus',
      id: 5,
      components: [
        { type: 'transform', id: 6 },
        { type: 'camera', id: 7 },
      ],
    }),
    false,
  );
  assert.equal(
    nexusHasDisplayChildren({
      type: 'nexus',
      id: 5,
      components: [{ type: 'camera', id: 7 }],
    }),
    false,
  );
  assert.equal(
    nexusHasDisplayChildren({
      type: 'nexus',
      id: 5,
      components: [
        { type: 'camera', id: 7 },
        { type: 'timer', id: 8 },
      ],
    }),
    false,
  );
  assert.equal(
    nexusHasDisplayChildren({
      type: 'nexus',
      id: 5,
      components: [{ type: 'light', id: 9, lightType: 'ambient' }],
    }),
    true,
  );
  assert.equal(
    nexusHasDisplayChildren({
      type: 'nexus',
      id: 5,
      components: [
        { type: 'transform', id: 6 },
        { type: 'sprite', id: 10 },
      ],
    }),
    true,
  );
});

test('lapis-sin background constants match #1E3A8A', () => {
  assert.equal(LAPIS_SIN_HEX, '#1E3A8A');
  assert.ok(Math.abs(LAPIS_SIN_RGBA.r - 30 / 255) < 1e-9);
  assert.ok(Math.abs(LAPIS_SIN_RGBA.g - 58 / 255) < 1e-9);
  assert.ok(Math.abs(LAPIS_SIN_RGBA.b - 138 / 255) < 1e-9);
  assert.equal(LAPIS_SIN_RGBA.a, 1);
});

test('authoring sync applies update/remove without calling onSceneLoad', async () => {
  let boots = 0;
  const live: Record<string, unknown> = {
    id: 1,
    type: 'transform',
    opacity: 1,
    parent: { components: [] as unknown[] },
  };
  (live.parent as { components: unknown[] }).components.push(live);

  const idToLive = new Map<number, Record<string, unknown>>([[1, live]]);
  const handles: AuthoringSceneHandles = {
    root: { id: 0, type: 'nexus', components: [live.parent] },
    idToLive,
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

  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(file, 0, {
    type: 'transform',
    name: 'T',
    id: 1,
    unique: 0,
    opacity: 1,
  });

  const bridge = createAuthoringSyncBridge({
    api,
    getHandles: () => handles,
    getDocument: () => file,
    onSceneLoad: () => {
      boots += 1;
    },
    isSameSceneRegion: () => false,
  });

  await bridge.applyMessage(
    componentUpdate(1, 'transform', 'opacity', 0.5),
  );
  assert.equal(live.opacity, 0.5);
  assert.equal(boots, 0);

  await bridge.applyMessage(componentRemove(1));
  assert.equal(idToLive.has(1), false);
  assert.equal(boots, 0);

  // scene:load with different region boots once
  await bridge.applyMessage(sceneLoad(file));
  assert.equal(boots, 1);

  bridge.dispose();
});

test('authoring sync ignores disallowed component:add', async () => {
  let mirrored = 0;
  const idToLive = new Map<number, Record<string, unknown>>([
    [0, { id: 0, type: 'nexus', components: [], addComponent() { mirrored += 1; } }],
  ]);
  const handles: AuthoringSceneHandles = {
    root: idToLive.get(0)!,
    idToLive,
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
    newComponent: async () => {
      mirrored += 1;
      return { id: 99 };
    },
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
    getDocument: () => createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' }),
    onSceneLoad: () => undefined,
    isSameSceneRegion: () => true,
  });

  await bridge.applyMessage(componentAdd(0, 'camera'));
  await bridge.applyMessage(componentAdd(0, 'timer'));
  assert.equal(mirrored, 0);
  bridge.dispose();
});
