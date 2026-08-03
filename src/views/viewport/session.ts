/**
 * Live EngineSceneCodec backed by window.Omosuen (4a/4b).
 * Authoring display uses an injected EditorCamera — not scene cameras.
 */

import type { EditorCameraState } from '../../omoscene';
import type { EngineSceneCodec } from '../../omoscene';
import type { SerializedScene } from '../../omoscene';
import type { OmosuenEngineApi } from './engine-loader';
import {
  EDITOR_CAMERA_NAME,
  EDITOR_CAM_TRANSFORM_NAME,
  prepareSceneForAuthoring,
} from './prepare';
import { isoPanToWorld } from './view-camera-map';

export interface AuthoringEngineSession {
  readonly api: OmosuenEngineApi;
  readonly codec: EngineSceneCodec;
  readonly loadedVersion: string;
  loadScene(scene: SerializedScene, viewCamera?: EditorCameraState): void;
  applyViewCamera(cam: EditorCameraState): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

const AUTHORING_SCENE_KEY = 'authoring';

export function createAuthoringEngineSession(
  api: OmosuenEngineApi,
  loadedVersion: string,
  canvasHost: HTMLElement,
): AuthoringEngineSession {
  let started = false;
  let disposed = false;
  let liveCamera: Record<string, unknown> | null = null;
  let liveTransform: Record<string, unknown> | null = null;

  const codec: EngineSceneCodec = {
    serializeFromEngine() {
      const active = api.getActiveScene?.();
      if (!active) {
        throw new Error('No active engine scene to serialize');
      }
      return api.serializeComponentRecursive(active) as SerializedScene;
    },
    deserializeIntoEngine(scene) {
      loadScene(scene);
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
    for (const canvas of canvasHost.querySelectorAll('canvas')) {
      if (isGizmoOverlay(canvas)) continue;
      const el = canvas as HTMLCanvasElement;
      el.style.display = 'block';
      el.style.width = '100%';
      el.style.height = '100%';
    }
  }

  function resolveLiveRefs(): void {
    liveCamera = null;
    liveTransform = null;
    const active = api.getActiveScene?.();
    if (!active) return;
    liveCamera = findNamedComponent(active, EDITOR_CAMERA_NAME);
    liveTransform = findNamedComponent(active, EDITOR_CAM_TRANSFORM_NAME);
    if (!liveTransform && liveCamera) {
      const parent = (liveCamera as { parent?: unknown }).parent;
      if (parent) {
        liveTransform = findNamedComponent(parent, EDITOR_CAM_TRANSFORM_NAME);
        if (!liveTransform) {
          liveTransform = findTypedComponent(parent, 'transform');
        }
      }
    }
  }

  function loadScene(
    scene: SerializedScene,
    viewCamera?: EditorCameraState,
  ): void {
    if (disposed) return;
    const prepared = prepareSceneForAuthoring(scene, viewCamera);
    if (!started) {
      api.init();
      started = true;
    }
    const root = api.deserializeComponentRecursive(prepared.scene);
    if (!root) {
      throw new Error('Engine failed to deserialize scene');
    }
    api.registerScene(AUTHORING_SCENE_KEY, root);
    api.switchScene(AUTHORING_SCENE_KEY);
    api.start(30);
    resolveLiveRefs();
    if (viewCamera) applyViewCamera(viewCamera);
    requestAnimationFrame(() => {
      adoptCanvases();
      resolveLiveRefs();
      if (viewCamera) applyViewCamera(viewCamera);
    });
  }

  function applyViewCamera(cam: EditorCameraState): void {
    if (disposed) return;
    if (!liveCamera || !liveTransform) resolveLiveRefs();
    if (liveCamera) {
      liveCamera.zoom = cam.zoom;
      liveCamera.axonometricAngle = cam.axonometricAngle;
    }
    if (liveTransform) {
      // Classic iso inverse (yaw on rotation.y for the engine).
      const world = isoPanToWorld({ ...cam, yaw: 0 });
      setVec3Prop(liveTransform, 'position', world.x, world.y, world.z);
      setVec3Prop(liveTransform, 'rotation', 0, cam.yaw, 0);
    }
  }

  function resize(width: number, height: number): void {
    if (disposed || width <= 0 || height <= 0) return;
    for (const canvas of canvasHost.querySelectorAll('canvas')) {
      if (isGizmoOverlay(canvas)) continue;
      const el = canvas as HTMLCanvasElement;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.floor(width * dpr));
      el.height = Math.max(1, Math.floor(height * dpr));
    }
  }

  function dispose(): void {
    disposed = true;
    liveCamera = null;
    liveTransform = null;
    for (const child of [...canvasHost.children]) {
      if (!isGizmoOverlay(child)) child.remove();
    }
  }

  return {
    api,
    codec,
    loadedVersion,
    loadScene,
    applyViewCamera,
    resize,
    dispose,
  };
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

function findNamedComponent(
  root: unknown,
  name: string,
): Record<string, unknown> | null {
  return walkFind(root, (node) => node.name === name);
}

function findTypedComponent(
  root: unknown,
  type: string,
): Record<string, unknown> | null {
  return walkFind(root, (node) => node.type === type);
}

function walkFind(
  root: unknown,
  pred: (node: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (!root || typeof root !== 'object') return null;
  const node = root as Record<string, unknown>;
  if (pred(node)) return node;

  const byName = (
    node as { getComponentByName?: (n: string, deep?: boolean) => unknown }
  ).getComponentByName;
  if (typeof byName === 'function') {
    try {
      const hit = byName.call(node, String(node.name ?? ''), true);
      void hit;
    } catch {
      // ignore
    }
  }

  const children = node.components;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = walkFind(child, pred);
      if (found) return found;
    }
  }

  // Some engine graphs nest via child nexuses on the same array.
  return null;
}
