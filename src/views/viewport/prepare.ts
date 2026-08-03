/**
 * Prepare a document scene for the authoring engine display:
 * sanitize visuals, strip scene cameras, inject EditorCamera.
 */

import type {
  EditorCameraState,
  SerializedComponent,
  SerializedScene,
} from '../../omoscene';
import { sanitizeSceneForAuthoring } from './sanitize';
import { isoPanToWorld } from './view-camera-map';

export const EDITOR_CAM_NEXUS_NAME = 'EditorCam';
export const EDITOR_CAM_TRANSFORM_NAME = 'EditorCamTransform';
export const EDITOR_CAMERA_NAME = 'EditorCamera';
export const EDITOR_VIEWPORT_NAME = 'EditorViewport';

const EDITOR_NEXUS_ID = 900001;
const EDITOR_TRANSFORM_ID = 900002;
const EDITOR_CAMERA_ID = 900003;
const EDITOR_VIEWPORT_ID = 900004;

export interface PreparedAuthoringScene {
  readonly scene: SerializedScene;
  readonly viewportName: string;
}

/**
 * Clone + sanitize, drop scene cameras, ensure a viewport, inject editor camera.
 * Document is never mutated — only the display clone.
 */
export function prepareSceneForAuthoring(
  scene: SerializedScene,
  viewCamera?: EditorCameraState,
): PreparedAuthoringScene {
  const sanitized = sanitizeSceneForAuthoring(scene);
  const stripped = stripCameras(sanitized) as SerializedScene;
  const foundVp = findFirstViewport(stripped);
  let root = stripped;
  let viewportName =
    foundVp && typeof foundVp.name === 'string' && foundVp.name !== ''
      ? foundVp.name
      : EDITOR_VIEWPORT_NAME;

  if (!foundVp) {
    root = appendChild(root, {
      type: 'viewport',
      name: EDITOR_VIEWPORT_NAME,
      id: EDITOR_VIEWPORT_ID,
      unique: 0,
      width: 800,
      height: 600,
      offsetX: 0,
      offsetY: 0,
      backgroundColor: { x: 0.08, y: 0.09, z: 0.12, w: 1 },
    });
    viewportName = EDITOR_VIEWPORT_NAME;
  }

  const cam = viewCamera ?? {
    panX: 0,
    panY: 0,
    zoom: 1,
    axonometricAngle: 30,
    yaw: 0,
  };

  const world = isoPanToWorld({ ...cam, yaw: 0 });

  root = appendChild(root, {
    type: 'nexus',
    name: EDITOR_CAM_NEXUS_NAME,
    id: EDITOR_NEXUS_ID,
    unique: 0,
    components: [
      {
        type: 'transform',
        name: EDITOR_CAM_TRANSFORM_NAME,
        id: EDITOR_TRANSFORM_ID,
        unique: 0,
        position: {
          _vectorType: 'Vector3D',
          x: world.x,
          y: world.y,
          z: world.z,
        },
        rotation: {
          _vectorType: 'Vector3D',
          x: 0,
          y: cam.yaw,
          z: 0,
        },
        scale: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
      },
      {
        type: 'camera',
        name: EDITOR_CAMERA_NAME,
        id: EDITOR_CAMERA_ID,
        unique: 0,
        zoom: cam.zoom,
        pixelScale: 2,
        axonometricAngle: cam.axonometricAngle,
        viewportRef: viewportName,
      },
    ],
  });

  return { scene: root, viewportName };
}

/** Drop `camera` nodes from a prepared/sanitized tree (keep other visuals). */
export function stripCameras(node: SerializedComponent): SerializedComponent {
  if (!Array.isArray(node.components) || node.components.length === 0) {
    return node;
  }
  const next: SerializedComponent[] = [];
  for (const child of node.components) {
    if (!child || typeof child !== 'object') continue;
    if ((child as SerializedComponent).type === 'camera') continue;
    next.push(stripCameras(child as SerializedComponent));
  }
  return { ...node, components: next };
}

function findFirstViewport(
  node: SerializedComponent,
): SerializedComponent | null {
  if (node.type === 'viewport') return node;
  if (Array.isArray(node.components)) {
    for (const child of node.components) {
      if (child && typeof child === 'object') {
        const found = findFirstViewport(child as SerializedComponent);
        if (found) return found;
      }
    }
  }
  return null;
}

function appendChild(
  root: SerializedScene,
  child: SerializedComponent,
): SerializedScene {
  const components = Array.isArray(root.components)
    ? [...root.components, child]
    : [child];
  return { ...root, components };
}
