/**
 * Map editor.camera iso pan ↔ world position for the injected EditorCamera.
 *
 * EditorCam stores world position at yaw 0; orbitYaw on the camera rotates the
 * view. Inverse uses the same applyYaw convention as the engine.
 */

import type { EditorCameraState } from '../../omoscene';
import { applyYaw, getAngleValues, type Vec3 } from './axonometry';

/**
 * World-space camera transform position whose iso projection (at yaw 0)
 * equals (panX, panY) at y=0.
 */
export function isoPanToWorld(cam: EditorCameraState): Vec3 {
  const av = getAngleValues(cam.axonometricAngle);
  const cos = av.cos || 1e-6;
  const sin = av.sin < 0.01 ? 0.01 : av.sin;
  const spunX = (cam.panX / cos + cam.panY / sin) / 2;
  const spunZ = (cam.panY / sin - cam.panX / cos) / 2;
  // Position is authored at yaw 0; orbitYaw is applied on the camera.
  if (!cam.yaw) {
    return { x: spunX, y: 0, z: spunZ };
  }
  // If a yaw is passed, invert applyYaw so the projected pan still matches.
  const rad = (cam.yaw * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: spunX * c - spunZ * s,
    y: 0,
    z: spunX * s + spunZ * c,
  };
}

/** Forward check: world → iso pan (for tests). */
export function worldToIsoPan(
  wx: number,
  wy: number,
  wz: number,
  angle: number,
  yaw: number,
): { panX: number; panY: number } {
  const av = getAngleValues(angle);
  const spun = applyYaw(wx, wz, yaw);
  return {
    panX: av.cos * (spun.x - spun.y),
    panY: av.sin * (spun.x + spun.y) - av.hs * wy,
  };
}
