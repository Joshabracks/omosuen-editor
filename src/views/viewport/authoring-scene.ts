/**
 * Cold-boot authoring display scene — newComponent shells like cellmap-test,
 * deserialize allowlisted leaves with overrides nulled, EditorCam + input.
 */

import type { EditorCameraState, SerializedComponent, SerializedScene } from '../../omoscene';
import {
  deserializeAuthoringLeaf,
  ensureCellMapDeserializeShape,
  resolveTexturePathsForAuthoring,
  shallowCloneTree,
  walkSerialized,
} from './authoring-load';
import {
  isAuthoringDisplayType,
  LAPIS_SIN_RGBA,
  nexusHasDisplayChildren,
  prepareLeafForDeserialize,
} from './authoring-allowlist';
import type { OmosuenEngineApi } from './engine-loader';
import {
  EDITOR_CAMERA_NAME,
  EDITOR_CAM_NEXUS_NAME,
  EDITOR_CAM_TRANSFORM_NAME,
  EDITOR_VIEWPORT_NAME,
} from './prepare';
import { isoPanToWorld } from './view-camera-map';

export interface LiveComponentRef {
  readonly live: Record<string, unknown>;
  readonly docId: number;
  readonly type: string;
}

export interface AuthoringSceneHandles {
  readonly root: Record<string, unknown>;
  readonly idToLive: Map<number, Record<string, unknown>>;
  readonly viewport: Record<string, unknown> | null;
  readonly camera: Record<string, unknown> | null;
  readonly transform: Record<string, unknown> | null;
  readonly atlasManager: Record<string, unknown> | null;
  readonly inputController: Record<string, unknown> | null;
  /** Tear down input listeners / zoom loop. */
  readonly disposeInput: () => void;
}

export interface BuildAuthoringSceneOptions {
  readonly api: OmosuenEngineApi;
  readonly scene: SerializedScene;
  readonly hostWidth: number;
  readonly hostHeight: number;
  readonly viewCamera?: EditorCameraState;
  readonly readImageDataUrl?: (
    relativePath: string,
  ) => Promise<string | null>;
  /** Fired when EditorCam input moves the live camera (pan/zoom/orbit). */
  readonly onCameraMoved?: () => void;
}

export async function buildAuthoringScene(
  options: BuildAuthoringSceneOptions,
): Promise<AuthoringSceneHandles> {
  const { api } = options;
  if (typeof api.newComponent !== 'function') {
    throw new Error('Engine newComponent is required for authoring viewport');
  }

  // One cheap per-node clone (not a deep JSON round-trip — see
  // shallowCloneTree) so this function owns the tree it mutates below
  // without ever touching options.scene's voxel/mesh payloads.
  let scene = shallowCloneTree(options.scene) as SerializedScene;
  ensureCellMapDeserializeShape(scene);
  if (options.readImageDataUrl) {
    scene = await resolveTexturePathsForAuthoring(
      scene,
      options.readImageDataUrl,
    );
  }

  const idToLive = new Map<number, Record<string, unknown>>();
  let atlasManager: Record<string, unknown> | null = null;

  const root = (await api.newComponent(
    'nexus',
    { name: 'AuthoringRoot' },
  )) as Record<string, unknown>;
  if (!root) throw new Error('Failed to create AuthoringRoot nexus');
  stampDocId(root, typeof scene.id === 'number' ? scene.id : 0);
  idToLive.set(typeof scene.id === 'number' ? scene.id : 0, root);

  // Pass 1: atlas-manager under root (so texture-maps can wire a live ref).
  if (Array.isArray(scene.components)) {
    for (const child of scene.components) {
      if (!child || typeof child !== 'object') continue;
      if ((child as SerializedComponent).type !== 'atlas-manager') continue;
      const live = await attachLeaf(api, child as SerializedComponent, root);
      if (live) {
        atlasManager = live;
        registerId(idToLive, child as SerializedComponent, live);
      }
    }
  }

  if (!atlasManager) {
    atlasManager = (await api.newComponent(
      'atlas-manager',
      {
        name: 'AtlasManager',
        config: { atlasSize: 4096, maxAtlases: 4, padding: 1 },
      },
      root,
    )) as Record<string, unknown>;
  }

  // Pass 2: remaining document children (skip cameras, viewports, hollow nexuses).
  if (Array.isArray(scene.components)) {
    for (const child of scene.components) {
      if (!child || typeof child !== 'object') continue;
      const node = child as SerializedComponent;
      if (node.type === 'atlas-manager') continue; // already attached
      await mirrorNode(api, node, root, idToLive, atlasManager);
    }
  }

  // Materials reference textureMapKeys; those keys only draw once the atlas
  // has packed frames. Explicitly register + compile (don't rely solely on
  // dead `textureMap.atlasManager = …` assignment).
  if (atlasManager) {
    walkLive(root, (node) => {
      if (node.type === 'texture-map') {
        registerTextureWithAtlas(atlasManager!, node);
      }
    });
  }

  const width = Math.max(1, Math.floor(options.hostWidth) || 800);
  const height = Math.max(1, Math.floor(options.hostHeight) || 600);
  const bg = makeVec4(api, LAPIS_SIN_RGBA.r, LAPIS_SIN_RGBA.g, LAPIS_SIN_RGBA.b, LAPIS_SIN_RGBA.a);

  const viewport = (await api.newComponent(
    'viewport',
    {
      name: EDITOR_VIEWPORT_NAME,
      width,
      height,
      offsetX: 0,
      offsetY: 0,
      backgroundColor: bg,
    },
    root,
  )) as Record<string, unknown>;
  styleViewportFill(viewport);

  const cam = options.viewCamera ?? {
    panX: 0,
    panY: 0,
    zoom: 1,
    axonometricAngle: 30,
    yaw: 0,
  };
  const world = isoPanToWorld({ ...cam, yaw: 0 });

  const cameraNexus = (await api.newComponent(
    'nexus',
    { name: EDITOR_CAM_NEXUS_NAME },
    root,
  )) as Record<string, unknown>;

  const transform = (await api.newComponent(
    'transform',
    {
      name: EDITOR_CAM_TRANSFORM_NAME,
      position: makeVec3(api, world.x, world.y, world.z),
      rotation: makeVec3(api, 0, 0, 0),
      scale: makeVec3(api, 1, 1, 1),
    },
    cameraNexus,
  )) as Record<string, unknown>;

  const camera = (await api.newComponent(
    'camera',
    {
      name: EDITOR_CAMERA_NAME,
      viewportRef: EDITOR_VIEWPORT_NAME,
      zoom: cam.zoom,
      axonometricAngle: cam.axonometricAngle,
      orbitYaw: cam.yaw,
      pixelScale: 2,
    },
    cameraNexus,
  )) as Record<string, unknown>;

  const inputController = (await api.newComponent(
    'input-controller',
    { name: 'EditorCamInput', preventDefault: false },
    root,
  )) as Record<string, unknown>;

  const disposeInput = wireEditorCamInput(
    inputController,
    camera,
    viewport,
    options.onCameraMoved,
  );

  return {
    root,
    idToLive,
    viewport,
    camera,
    transform,
    atlasManager,
    inputController,
    disposeInput,
  };
}

/** Recursively mirror one document node under a live nexus parent. */
export async function mirrorNode(
  api: OmosuenEngineApi,
  node: SerializedComponent,
  liveParent: Record<string, unknown>,
  idToLive: Map<number, Record<string, unknown>>,
  atlasManager: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  const type = node.type;
  if (typeof type !== 'string') return null;
  if (type === 'camera' || type === 'viewport') return null;
  if (!isAuthoringDisplayType(type)) return null;

  if (type === 'nexus') {
    if (!nexusHasDisplayChildren(node)) return null;
    const live = (await api.newComponent!(
      'nexus',
      { name: typeof node.name === 'string' ? node.name : 'Nexus' },
      liveParent,
    )) as Record<string, unknown> | null;
    if (!live) return null;
    registerId(idToLive, node, live);
    if (Array.isArray(node.components)) {
      for (const child of node.components) {
        if (child && typeof child === 'object') {
          await mirrorNode(
            api,
            child as SerializedComponent,
            live,
            idToLive,
            atlasManager,
          );
        }
      }
    }
    return live;
  }

  if (type === 'atlas-manager') {
    // Only create under parent if not already the root atlas.
    const live = await attachLeaf(api, node, liveParent);
    if (live) registerId(idToLive, node, live);
    return live;
  }

  const live = await attachLeaf(api, node, liveParent);
  if (!live) return null;
  registerId(idToLive, node, live);

  if (type === 'texture-map' && atlasManager) {
    registerTextureWithAtlas(atlasManager, live);
  }
  return live;
}

/** Register a live texture-map with the atlas (required for packedFrames / cell draw). */
export function registerTextureWithAtlas(
  atlasManager: Record<string, unknown>,
  textureMap: Record<string, unknown>,
): void {
  const add = atlasManager.addTextureMap as
    | ((tm: unknown) => void)
    | undefined;
  if (typeof add === 'function') {
    add.call(atlasManager, textureMap);
    return;
  }
  console.warn(
    '[authoring-scene] atlasManager.addTextureMap missing — cell materials may not render',
  );
}

/** Force atlas compile after textures are registered (images should be ready). */
export async function ensureAtlasCompiled(
  atlasManager: Record<string, unknown> | null,
): Promise<void> {
  if (!atlasManager) return;
  if (atlasManager.compiled === true) return;
  const process = atlasManager.processTextureMaps as
    | (() => Promise<void>)
    | undefined;
  if (typeof process !== 'function') return;
  try {
    await process.call(atlasManager);
  } catch (err) {
    console.warn(
      '[authoring-scene] processTextureMaps failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

async function attachLeaf(
  api: OmosuenEngineApi,
  node: SerializedComponent,
  liveParent: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  // Shape (mapSize/cellSize/materials/packedData) was already normalized
  // once, scene-wide, by ensureCellMapDeserializeShape in buildAuthoringScene
  // — no need to redo it per leaf here.
  const leaf = prepareLeafForDeserialize(node);

  let live: Record<string, unknown> | null = null;
  try {
    const raw = await deserializeAuthoringLeaf(api, leaf);
    live = raw as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[authoring-scene] deserialize ${leaf.type} failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const add = liveParent.addComponent;
  if (typeof add === 'function') {
    (add as (c: unknown) => void).call(liveParent, live);
  } else {
    const comps = liveParent.components;
    if (Array.isArray(comps)) comps.push(live);
  }
  return live;
}

function registerId(
  idToLive: Map<number, Record<string, unknown>>,
  node: SerializedComponent,
  live: Record<string, unknown>,
): void {
  if (typeof node.id === 'number') {
    stampDocId(live, node.id);
    idToLive.set(node.id, live);
  }
}

function stampDocId(live: Record<string, unknown>, docId: number): void {
  try {
    live.id = docId;
  } catch {
    // proxy may reject; map still holds the ref
  }
}

function walkLive(
  root: Record<string, unknown>,
  visit: (node: Record<string, unknown>) => void,
): void {
  visit(root);
  if (!Array.isArray(root.components)) return;
  for (const child of root.components) {
    if (child && typeof child === 'object') {
      walkLive(child as Record<string, unknown>, visit);
    }
  }
}

function styleViewportFill(viewport: Record<string, unknown>): void {
  const container = viewport.container as HTMLElement | undefined;
  const canvas = viewport.canvas as HTMLCanvasElement | undefined;
  if (container && typeof container === 'object') {
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
  }
  if (canvas && typeof canvas === 'object') {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
}

function makeVec3(
  api: OmosuenEngineApi,
  x: number,
  y: number,
  z: number,
): unknown {
  if (typeof api.Vector3D === 'function') {
    return new api.Vector3D(x, y, z);
  }
  return { x, y, z };
}

function makeVec4(
  api: OmosuenEngineApi,
  x: number,
  y: number,
  z: number,
  w: number,
): unknown {
  const Ctor = (api as OmosuenEngineApi & {
    Vector4D?: new (x: number, y: number, z: number, w: number) => unknown;
  }).Vector4D;
  if (typeof Ctor === 'function') {
    return new Ctor(x, y, z, w);
  }
  return { x, y, z, w };
}

/**
 * Middle-drag pan + wheel zoom via input-controller (cellmap-test pattern).
 */
function wireEditorCamInput(
  inputController: Record<string, unknown>,
  camera: Record<string, unknown>,
  viewport: Record<string, unknown>,
  onCameraMoved?: () => void,
): () => void {
  const onAction = inputController.onAction as
    | ((action: string, cb: (...args: unknown[]) => void) => void)
    | undefined;
  const bindAction = inputController.bindAction as
    | ((binding: Record<string, unknown>) => void)
    | undefined;
  if (typeof onAction !== 'function' || typeof bindAction !== 'function') {
    return () => undefined;
  }

  let isPanning = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let zoomVelocity = 0;
  let raf = 0;
  let disposed = false;
  const PAN_SENSITIVITY = 1;
  const ZOOM_ACCELERATION = 0.002;
  const ZOOM_ENTROPY = 4;
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;

  onAction.call(inputController, 'middleMouseDown', (event: unknown) => {
    const e = event as { clientX: number; clientY: number };
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });
  onAction.call(inputController, 'middleMouseUp', () => {
    isPanning = false;
  });
  onAction.call(inputController, 'mouseMove', (event: unknown) => {
    if (!isPanning) return;
    const e = event as { clientX: number; clientY: number };
    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    const zoom =
      typeof camera.zoom === 'number' && Number.isFinite(camera.zoom)
        ? camera.zoom
        : 1;
    const pan = camera.pan as
      | ((dx: number, dy: number) => void)
      | undefined;
    if (typeof pan === 'function') {
      pan.call(camera, (deltaX * -PAN_SENSITIVITY) / zoom, (deltaY * -PAN_SENSITIVITY) / zoom);
      onCameraMoved?.();
    }
  });
  onAction.call(
    inputController,
    'mouseWheel',
    (event: unknown, deltaY: unknown) => {
      const dy = typeof deltaY === 'number' ? deltaY : 0;
      zoomVelocity += -dy * ZOOM_ACCELERATION;
      const setZoomTarget = camera.setZoomTarget as
        | ((x: number, y: number) => void)
        | undefined;
      if (typeof setZoomTarget === 'function') {
        const e = event as { clientX: number; clientY: number };
        const offsetX =
          typeof viewport.offsetX === 'number' ? viewport.offsetX : 0;
        const offsetY =
          typeof viewport.offsetY === 'number' ? viewport.offsetY : 0;
        setZoomTarget.call(camera, e.clientX - offsetX, e.clientY - offsetY);
      }
      onCameraMoved?.();
    },
  );

  for (const binding of [
    { eventType: 'mousedown', button: 1, action: 'middleMouseDown' },
    { eventType: 'mouseup', button: 1, action: 'middleMouseUp' },
    { eventType: 'mousemove', action: 'mouseMove' },
    { eventType: 'wheel', action: 'mouseWheel' },
  ]) {
    bindAction.call(inputController, binding);
  }

  let lastFrame = performance.now();
  const zoomLoop = (): void => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    if (zoomVelocity !== 0) {
      const z =
        typeof camera.zoom === 'number' && Number.isFinite(camera.zoom)
          ? camera.zoom
          : 1;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + zoomVelocity * dt));
      const setZoom = camera.setZoom as ((v: number) => void) | undefined;
      if (typeof setZoom === 'function') setZoom.call(camera, next);
      else camera.zoom = next;
      const decay = Math.exp(-ZOOM_ENTROPY * dt);
      zoomVelocity *= decay;
      if (Math.abs(zoomVelocity) < 1e-4) zoomVelocity = 0;
      onCameraMoved?.();
    }
    raf = requestAnimationFrame(zoomLoop);
  };
  raf = requestAnimationFrame(zoomLoop);

  const onKeyDown = (e: KeyboardEvent): void => {
    const orbitBy = camera.orbitBy as ((deg: number) => void) | undefined;
    if (e.key === 'ArrowLeft' && typeof orbitBy === 'function') {
      orbitBy.call(camera, -15);
      onCameraMoved?.();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && typeof orbitBy === 'function') {
      orbitBy.call(camera, 15);
      onCameraMoved?.();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const angle =
        typeof camera.axonometricAngle === 'number'
          ? camera.axonometricAngle
          : 30;
      camera.axonometricAngle = Math.min(90, angle + 5);
      onCameraMoved?.();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      const angle =
        typeof camera.axonometricAngle === 'number'
          ? camera.axonometricAngle
          : 30;
      camera.axonometricAngle = Math.max(0, angle - 5);
      onCameraMoved?.();
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
  };
}

/** Collect document ids currently mapped (test helper). */
export function mappedDocIds(handles: AuthoringSceneHandles): number[] {
  return [...handles.idToLive.keys()].sort((a, b) => a - b);
}

/** Debug: walk a serialized scene for allowlisted types only. */
export function collectAllowlistedTypes(
  scene: SerializedScene,
): string[] {
  const types: string[] = [];
  walkSerialized(scene, (n) => {
    if (typeof n.type === 'string' && isAuthoringDisplayType(n.type)) {
      types.push(n.type);
    }
  });
  return types;
}
