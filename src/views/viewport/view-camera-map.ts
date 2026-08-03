/**
 * Map editor.camera iso pan ↔ world position for the injected EditorCamera.
 */

import type { EditorCameraState } from '../../omoscene';
import { applyYaw, getAngleValues, type Vec3 } from './axonometry';

/**
 * World-space look-at / camera transform position whose iso projection
 * equals (panX, panY) at y=0 (matches V1 overlay getCameraInfo inverse).
 */
export function isoPanToWorld(cam: EditorCameraState): Vec3 {
  const av = getAngleValues(cam.axonometricAngle);
  const cos = av.cos || 1e-6;
  const sin = av.sin < 0.01 ? 0.01 : av.sin;
  const spunX = (cam.panX / cos + cam.panY / sin) / 2;
  const spunZ = (cam.panY / sin - cam.panX / cos) / 2;
  // Inverse yaw so engine transform sits in pre-yaw world, then yaw via rotation.
  const rad = (-cam.yaw * Math.PI) / 180;
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
    panX: av.cos * spun.x - av.cos * spun.y,
    panY: av.sin * spun.x - av.hs * wy + av.sin * spun.y,
  };
}
