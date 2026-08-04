/**
 * Live authoring engine session — cold-boot via authoring-scene builder;
 * incremental edits via id→live map (no full reload on ordinary edits).
 */

import type {
  EditorCameraState,
  EngineSceneCodec,
  SerializedScene,
} from '../../omoscene';
import {
  flattenLivePackedData,
  registerAndSwitchAuthoringScene,
  waitForEngineInit,
} from './authoring-load';
import {
  buildAuthoringScene,
  ensureAtlasCompiled,
  type AuthoringSceneHandles,
} from './authoring-scene';
import type { OmosuenEngineApi } from './engine-loader';
import { clampViewCamera } from './view-camera';
import { isoPanToWorld, worldToIsoPan } from './view-camera-map';

export interface AuthoringEngineSession {
  readonly api: OmosuenEngineApi;
  readonly codec: EngineSceneCodec;
  readonly loadedVersion: string;
  /** Cold-boot (or rebuild) the authoring display scene. */
  loadScene(
    scene: SerializedScene,
    viewCamera?: EditorCameraState,
  ): Promise<void>;
  getHandles(): AuthoringSceneHandles | null;
  applyViewCamera(cam: EditorCameraState): void;
  /** Read EditorCameraState from the live EditorCam (for overlay sync). */
  readLiveViewCamera(): EditorCameraState | null;
  /**
   * Soft-paint a cell on the live cell-map (engine SoT).
   * Returns true when setCellData succeeded — does not dump packedData.
   */
  applyCellPaint(
    componentId: number,
    coord: { x: number; y: number; z: number },
    cell: {
      materialIndex: number;
      shapeIndex: number;
      emissionIntensity: number;
      visible: boolean;
    },
  ): boolean;
  /**
   * Serialize every live cell-map's packedData.
   * Used before save / unload — not on the paint hot path.
   * When `yieldFirst` is true (default), awaits one microtask first.
   */
  flushLiveCellMaps(options?: {
    readonly yieldFirst?: boolean;
  }): Promise<ReadonlyMap<number, number[]>>;
  /** Synchronous dump for dispose/teardown (no microtask yield). */
  flushLiveCellMapsSync(): ReadonlyMap<number, number[]>;
  /**
   * Document ids of every live cell-map the session currently tracks.
   * Used by callers to tell a full flush from a partial one — a flush that
   * doesn't cover every id here must not be treated as complete.
   */
  getLiveCellMapIds(): readonly number[];
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface AuthoringSessionOptions {
  readonly readImageDataUrl?: (
    relativePath: string,
  ) => Promise<string | null>;
  readonly onCameraMoved?: () => void;
}

const AUTHORING_SCENE_KEY = 'authoring';

export function createAuthoringEngineSession(
  api: OmosuenEngineApi,
  loadedVersion: string,
  canvasHost: HTMLElement,
  options: AuthoringSessionOptions = {},
): AuthoringEngineSession {
  let started = false;
  let disposed = false;
  let handles: AuthoringSceneHandles | null = null;
  let loadGeneration = 0;

  const codec: EngineSceneCodec = {
    serializeFromEngine() {
      const active = api.getActiveScene?.();
      if (!active) {
        throw new Error('No active engine scene to serialize');
      }
      return api.serializeComponentRecursive(active) as SerializedScene;
    },
    deserializeIntoEngine(scene) {
      void loadScene(scene);
    },
  };

  function isGizmoOverlay(el: Element): boolean {
    return el.classList.contains('viewport-gizmo-overlay');
  }

  function adoptCanvases(): void {
    const orphans = document.body.querySelectorAll(':scope > canvas');
    for (const canvas of orphans) {
      if (isGizmoOverlay(canvas)) continue;
      canvasHost.appendChild(canvas);
    }
    // Viewport may append its own container — move into host.
    const orphansDiv = document.body.querySelectorAll(
      ':scope > div.omosuen-viewport, :scope > div[class*="viewport"]',
    );
    for (const el of orphansDiv) {
      canvasHost.appendChild(el);
    }
    if (handles?.viewport) {
      const container = handles.viewport.container as HTMLElement | undefined;
      if (container && container.parentElement !== canvasHost) {
        canvasHost.appendChild(container);
      }
    }
    for (const canvas of canvasHost.querySelectorAll('canvas')) {
      if (isGizmoOverlay(canvas)) continue;
      const el = canvas as HTMLCanvasElement;
      el.style.display = 'block';
      el.style.width = '100%';
      el.style.height = '100%';
    }
  }

  async function loadScene(
    scene: SerializedScene,
    viewCamera?: EditorCameraState,
  ): Promise<void> {
    if (disposed) return;
    const gen = ++loadGeneration;

    handles?.disposeInput();
    handles = null;

    if (!started) {
      api.init();
      started = true;
    }

    const rect = canvasHost.getBoundingClientRect();
    const built = await buildAuthoringScene({
      api,
      scene,
      hostWidth: rect.width || 800,
      hostHeight: rect.height || 600,
      viewCamera,
      readImageDataUrl: options.readImageDataUrl,
      onCameraMoved: options.onCameraMoved,
    });
    if (disposed || gen !== loadGeneration) {
      built.disposeInput();
      return;
    }
    handles = built;

    await registerAndSwitchAuthoringScene(api, AUTHORING_SCENE_KEY, built.root);
    if (disposed || gen !== loadGeneration) return;
    api.start(30);
    await waitForEngineInit(api);
    if (disposed || gen !== loadGeneration) return;
    // Texture images finish loading during init — compile atlas so cell-map
    // materials resolve albedoTextureKey → packedFrames.
    await ensureAtlasCompiled(built.atlasManager);
    if (disposed || gen !== loadGeneration) return;
    if (viewCamera) applyViewCamera(viewCamera);
    requestAnimationFrame(() => {
      if (disposed || gen !== loadGeneration) return;
      adoptCanvases();
      if (viewCamera) applyViewCamera(viewCamera);
      const r = canvasHost.getBoundingClientRect();
      resize(r.width, r.height);
    });
  }

  function applyViewCamera(cam: EditorCameraState): void {
    if (disposed || !handles) return;
    const { camera, transform } = handles;
    if (camera) {
      camera.zoom = cam.zoom;
      camera.axonometricAngle = cam.axonometricAngle;
      const setOrbitYaw = camera.setOrbitYaw as
        | ((deg: number) => void)
        | undefined;
      if (typeof setOrbitYaw === 'function') {
        setOrbitYaw.call(camera, cam.yaw);
      } else {
        camera.orbitYaw = cam.yaw;
      }
    }
    if (transform) {
      // World position encodes iso pan at yaw 0; orbitYaw rotates the view.
      const world = isoPanToWorld({ ...cam, yaw: 0 });
      setVec3Prop(transform, 'position', world.x, world.y, world.z);
      setVec3Prop(transform, 'rotation', 0, 0, 0);
    }
  }

  function readLiveViewCamera(): EditorCameraState | null {
    if (disposed || !handles?.camera || !handles.transform) return null;
    const camera = handles.camera;
    const transform = handles.transform;
    const pos = transform.position as
      | { x?: number; y?: number; z?: number }
      | undefined;
    const wx = typeof pos?.x === 'number' ? pos.x : 0;
    const wy = typeof pos?.y === 'number' ? pos.y : 0;
    const wz = typeof pos?.z === 'number' ? pos.z : 0;
    const yaw =
      typeof camera.orbitYaw === 'number' && Number.isFinite(camera.orbitYaw)
        ? camera.orbitYaw
        : 0;
    const zoom =
      typeof camera.zoom === 'number' && Number.isFinite(camera.zoom)
        ? camera.zoom
        : 1;
    const angle =
      typeof camera.axonometricAngle === 'number' &&
      Number.isFinite(camera.axonometricAngle)
        ? camera.axonometricAngle
        : 30;
    // Position was written at yaw 0; orbitYaw is separate.
    const pan = worldToIsoPan(wx, wy, wz, angle, 0);
    return clampViewCamera({
      panX: pan.panX,
      panY: pan.panY,
      zoom,
      axonometricAngle: angle,
      yaw,
    });
  }

  function applyCellPaint(
    componentId: number,
    coord: { x: number; y: number; z: number },
    cell: {
      materialIndex: number;
      shapeIndex: number;
      emissionIntensity: number;
      visible: boolean;
    },
  ): boolean {
    if (disposed) return false;
    const live =
      handles?.idToLive.get(componentId) ??
      findComponentByIdDeep(api.getActiveScene?.(), componentId);
    if (
      !live ||
      typeof (live as { setCellData?: unknown }).setCellData !== 'function'
    ) {
      return false;
    }
    const Vector3D = api.Vector3D;
    const pos = Vector3D
      ? new Vector3D(coord.x, coord.y, coord.z)
      : { x: coord.x, y: coord.y, z: coord.z };
    try {
      (
        live as {
          setCellData: (p: unknown, c: unknown) => void;
        }
      ).setCellData(pos, cell);
      return true;
    } catch {
      return false;
    }
  }

  function getLiveCellMapIds(): readonly number[] {
    return disposed ? [] : liveCellMapIdsFromHandles(handles);
  }

  function collectLiveCellMapPacked(): Map<number, number[]> {
    return disposed ? new Map() : collectLiveCellMapPackedFromHandles(handles);
  }

  async function flushLiveCellMaps(options?: {
    readonly yieldFirst?: boolean;
  }): Promise<ReadonlyMap<number, number[]>> {
    if (options?.yieldFirst !== false) {
      await Promise.resolve();
    }
    return collectLiveCellMapPacked();
  }

  function flushLiveCellMapsSync(): ReadonlyMap<number, number[]> {
    return collectLiveCellMapPacked();
  }

  function resize(width: number, height: number): void {
    if (disposed || width <= 0 || height <= 0) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const vp = handles?.viewport;
    if (vp && typeof vp.resize === 'function') {
      (vp.resize as (width: number, height: number) => void).call(vp, w, h);
    }
    const cam = handles?.camera;
    if (cam && typeof cam.resize === 'function') {
      (cam.resize as () => void).call(cam);
    }
    // Do NOT stomp WebGL canvas.width/height with DPR — viewport.resize owns
    // the buffer size. DPR scaling here desyncs the FBO and blanks cell-maps.
  }

  function dispose(): void {
    disposed = true;
    loadGeneration += 1;
    handles?.disposeInput();
    handles = null;
    for (const child of [...canvasHost.children]) {
      if (!isGizmoOverlay(child)) child.remove();
    }
  }

  return {
    api,
    codec,
    loadedVersion,
    loadScene,
    getHandles: () => handles,
    applyViewCamera,
    readLiveViewCamera,
    applyCellPaint,
    flushLiveCellMaps,
    flushLiveCellMapsSync,
    getLiveCellMapIds,
    resize,
    dispose,
  };
}

/** True when a live authoring node is (or acts as) a cell-map. */
export function isLiveCellMapEntry(live: Record<string, unknown>): boolean {
  return (
    live.type === 'cell-map' ||
    typeof (live as { setCellData?: unknown }).setCellData === 'function'
  );
}

/** Document ids of every live cell-map reachable from `handles`. */
export function liveCellMapIdsFromHandles(
  handles: AuthoringSceneHandles | null,
): readonly number[] {
  const out: number[] = [];
  if (!handles) return out;
  for (const [id, live] of handles.idToLive) {
    if (isLiveCellMapEntry(live)) out.push(id);
  }
  return out;
}

/**
 * Flatten every live cell-map's packedData reachable from `handles`.
 * An id present in `liveCellMapIdsFromHandles` but missing from this map's
 * result means its packedData wasn't introspectable this attempt (logged).
 */
export function collectLiveCellMapPackedFromHandles(
  handles: AuthoringSceneHandles | null,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!handles) return out;
  for (const [id, live] of handles.idToLive) {
    if (!isLiveCellMapEntry(live)) continue;
    // Prefer forEach flatten only — serializeComponentRecursive also dumps meshes.
    const packed = flattenLivePackedData(live);
    if (packed && packed.length > 0) {
      out.set(id, packed);
    } else {
      console.warn(
        `[voxel-flush] live cell-map #${id} packedData was not readable ` +
          '(neither array nor forEach-capable) — this stroke will not be flushed this attempt',
      );
    }
  }
  return out;
}

function setVec3Prop(
  obj: Record<string, unknown>,
  key: string,
  x: number,
  y: number,
  z: number,
): void {
  const current = obj[key];
  if (current && typeof current === 'object') {
    const row = current as Record<string, unknown>;
    row.x = x;
    row.y = y;
    row.z = z;
    return;
  }
  obj[key] = { x, y, z };
}

function findComponentByIdDeep(
  root: unknown,
  id: number,
): Record<string, unknown> | null {
  if (!root || typeof root !== 'object') return null;
  const node = root as Record<string, unknown>;
  if (node.id === id) return node;
  const children = node.components;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findComponentByIdDeep(child, id);
      if (found) return found;
    }
  }
  return null;
}
