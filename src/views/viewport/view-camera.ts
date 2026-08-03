/**
 * Pure helpers + live controller for the independent authoring view camera.
 */

import type { EditorCameraState } from '../../omoscene';
import { DEFAULT_EDITOR_CAMERA } from '../../omoscene';

export const VIEW_ZOOM_MIN = 0.1;
export const VIEW_ZOOM_MAX = 8;
export const VIEW_ANGLE_MIN = 0;
export const VIEW_ANGLE_MAX = 90;

export const PAN_SENSITIVITY = 1;
export const ORBIT_YAW_SENSITIVITY = 0.35;
export const ORBIT_ANGLE_SENSITIVITY = 0.25;
export const KEY_PAN_STEP = 16;
export const KEY_ZOOM_STEP = 0.08;
export const KEY_YAW_STEP = 5;
export const KEY_ANGLE_STEP = 3;

export function clampViewCamera(cam: EditorCameraState): EditorCameraState {
  return {
    panX: Number.isFinite(cam.panX) ? cam.panX : 0,
    panY: Number.isFinite(cam.panY) ? cam.panY : 0,
    zoom: Math.max(
      VIEW_ZOOM_MIN,
      Math.min(VIEW_ZOOM_MAX, Number.isFinite(cam.zoom) ? cam.zoom : 1),
    ),
    axonometricAngle: Math.max(
      VIEW_ANGLE_MIN,
      Math.min(
        VIEW_ANGLE_MAX,
        Number.isFinite(cam.axonometricAngle)
          ? cam.axonometricAngle
          : DEFAULT_EDITOR_CAMERA.axonometricAngle,
      ),
    ),
    yaw: Number.isFinite(cam.yaw) ? cam.yaw : 0,
  };
}

export function editorCameraFromUnknown(
  value: Partial<EditorCameraState> | null | undefined,
): EditorCameraState {
  return clampViewCamera({
    ...DEFAULT_EDITOR_CAMERA,
    ...value,
  });
}

export function camerasEqual(
  a: EditorCameraState,
  b: EditorCameraState,
  epsilon = 1e-6,
): boolean {
  return (
    Math.abs(a.panX - b.panX) < epsilon &&
    Math.abs(a.panY - b.panY) < epsilon &&
    Math.abs(a.zoom - b.zoom) < epsilon &&
    Math.abs(a.axonometricAngle - b.axonometricAngle) < epsilon &&
    Math.abs(a.yaw - b.yaw) < epsilon
  );
}

export function panViewCamera(
  cam: EditorCameraState,
  screenDx: number,
  screenDy: number,
): EditorCameraState {
  const zoom = Math.max(cam.zoom, 1e-6);
  // Match V1: pan in iso-space; screen Y is flipped vs iso Y.
  return clampViewCamera({
    ...cam,
    panX: cam.panX - (screenDx * PAN_SENSITIVITY) / zoom,
    panY: cam.panY + (screenDy * PAN_SENSITIVITY) / zoom,
  });
}

export function zoomViewCameraAt(
  cam: EditorCameraState,
  factor: number,
  /** Iso-space point under cursor before zoom (optional). */
  focusIso?: { x: number; y: number },
): EditorCameraState {
  const nextZoom = Math.max(
    VIEW_ZOOM_MIN,
    Math.min(VIEW_ZOOM_MAX, cam.zoom * factor),
  );
  if (!focusIso || Math.abs(nextZoom - cam.zoom) < 1e-9) {
    return clampViewCamera({ ...cam, zoom: nextZoom });
  }
  // Keep focusIso under the same screen point: pan' = focus - (focus - pan) * (zoom/next)
  const ratio = cam.zoom / nextZoom;
  return clampViewCamera({
    ...cam,
    zoom: nextZoom,
    panX: focusIso.x - (focusIso.x - cam.panX) * ratio,
    panY: focusIso.y - (focusIso.y - cam.panY) * ratio,
  });
}

export function orbitViewCamera(
  cam: EditorCameraState,
  screenDx: number,
  screenDy: number,
): EditorCameraState {
  return clampViewCamera({
    ...cam,
    yaw: cam.yaw + screenDx * ORBIT_YAW_SENSITIVITY,
    axonometricAngle: cam.axonometricAngle - screenDy * ORBIT_ANGLE_SENSITIVITY,
  });
}

export type ViewGesture = 'pan' | 'orbit' | null;

export interface ViewCameraControllerDeps {
  readonly getCamera: () => EditorCameraState;
  readonly setCamera: (cam: EditorCameraState) => void;
  readonly onCommit: (cam: EditorCameraState) => void;
}

export interface ViewCameraController {
  readonly gesture: () => ViewGesture;
  readonly attach: (target: HTMLElement) => () => void;
  readonly handleKeyDown: (event: KeyboardEvent) => boolean;
}

export function createViewCameraController(
  deps: ViewCameraControllerDeps,
): ViewCameraController {
  let gesture: ViewGesture = null;
  let lastX = 0;
  let lastY = 0;
  let spaceDown = false;

  const emit = (next: EditorCameraState, commit: boolean): void => {
    const clamped = clampViewCamera(next);
    deps.setCamera(clamped);
    if (commit) deps.onCommit(clamped);
  };

  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceDown = true;
  };
  const onKeyUpCapture = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceDown = false;
  };

  return {
    gesture: () => gesture,
    attach(target) {
      window.addEventListener('keydown', onKeyDownCapture, true);
      window.addEventListener('keyup', onKeyUpCapture, true);

      const onPointerDown = (event: PointerEvent): void => {
        const wantPan =
          event.button === 1 || (event.button === 0 && spaceDown);
        const wantOrbit = event.button === 0 && event.altKey;
        if (!wantPan && !wantOrbit) return;
        gesture = wantOrbit ? 'orbit' : 'pan';
        lastX = event.clientX;
        lastY = event.clientY;
        target.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (!gesture) return;
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        const cam = deps.getCamera();
        if (gesture === 'pan') {
          emit(panViewCamera(cam, dx, dy), false);
        } else {
          emit(orbitViewCamera(cam, dx, dy), false);
        }
        event.preventDefault();
      };

      const endGesture = (event: PointerEvent): void => {
        if (!gesture) return;
        gesture = null;
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
        deps.onCommit(deps.getCamera());
      };

      const onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        const cam = deps.getCamera();
        const rect = target.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const focusIso = {
          x: (sx - rect.width / 2) / Math.max(cam.zoom, 1e-6) + cam.panX,
          y: cam.panY - (sy - rect.height / 2) / Math.max(cam.zoom, 1e-6),
        };
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        emit(zoomViewCameraAt(cam, factor, focusIso), true);
      };

      const onContextMenu = (event: Event): void => {
        event.preventDefault();
      };

      target.addEventListener('pointerdown', onPointerDown, true);
      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', endGesture);
      target.addEventListener('pointercancel', endGesture);
      target.addEventListener('wheel', onWheel, { passive: false });
      target.addEventListener('contextmenu', onContextMenu);

      return () => {
        window.removeEventListener('keydown', onKeyDownCapture, true);
        window.removeEventListener('keyup', onKeyUpCapture, true);
        target.removeEventListener('pointerdown', onPointerDown, true);
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', endGesture);
        target.removeEventListener('pointercancel', endGesture);
        target.removeEventListener('wheel', onWheel);
        target.removeEventListener('contextmenu', onContextMenu);
      };
    },
    handleKeyDown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return false;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return false;
      }
      const cam = deps.getCamera();
      switch (event.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          emit(panViewCamera(cam, KEY_PAN_STEP, 0), true);
          return true;
        case 'ArrowRight':
        case 'd':
        case 'D':
          emit(panViewCamera(cam, -KEY_PAN_STEP, 0), true);
          return true;
        case 'ArrowUp':
        case 'w':
        case 'W':
          emit(panViewCamera(cam, 0, KEY_PAN_STEP), true);
          return true;
        case 'ArrowDown':
        case 's':
        case 'S':
          emit(panViewCamera(cam, 0, -KEY_PAN_STEP), true);
          return true;
        case '+':
        case '=':
          emit(zoomViewCameraAt(cam, 1 + KEY_ZOOM_STEP), true);
          return true;
        case '-':
        case '_':
          emit(zoomViewCameraAt(cam, 1 / (1 + KEY_ZOOM_STEP)), true);
          return true;
        case 'q':
        case 'Q':
          emit(clampViewCamera({ ...cam, yaw: cam.yaw - KEY_YAW_STEP }), true);
          return true;
        case 'e':
        case 'E':
          emit(clampViewCamera({ ...cam, yaw: cam.yaw + KEY_YAW_STEP }), true);
          return true;
        case 'r':
        case 'R':
          emit(
            clampViewCamera({
              ...cam,
              axonometricAngle: cam.axonometricAngle + KEY_ANGLE_STEP,
            }),
            true,
          );
          return true;
        case 'f':
        case 'F':
          emit(
            clampViewCamera({
              ...cam,
              axonometricAngle: cam.axonometricAngle - KEY_ANGLE_STEP,
            }),
            true,
          );
          return true;
        default:
          return false;
      }
    },
  };
}
