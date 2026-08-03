/**
 * Axonometric projection helpers for the authoring gizmo overlay.
 * Convention matches the V1 preview overlay (pan/zoom + flipped screen Y).
 * Yaw rotates world XZ before iso projection (independent of scene cameras).
 */

export interface OverlayCamera {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly vpW: number;
  readonly vpH: number;
  /** Axonometric elevation degrees (0..90). */
  readonly angle: number;
  /** Yaw around world Y in degrees. */
  readonly yaw: number;
}

export interface AngleValues {
  readonly cos: number;
  readonly sin: number;
  readonly hs: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function getAngleValues(angleDeg: number): AngleValues {
  const angle = Math.max(0, Math.min(90, angleDeg));
  const rad = (angle * Math.PI) / 180;
  return {
    cos: 0.8660254,
    sin: Math.sin(rad),
    hs: Math.cos(rad) * 1.1547005,
  };
}

/** Rotate world XZ by yaw (degrees) around +Y. */
export function applyYaw(wx: number, wz: number, yawDeg: number): Vec2 {
  if (!yawDeg) return { x: wx, y: wz };
  const rad = (yawDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: wx * c - wz * s,
    y: wx * s + wz * c,
  };
}

export function getAxisDirs(
  av: AngleValues,
  yawDeg = 0,
): Record<'x' | 'y' | 'z', Vec2> {
  const x = projectDirection(1, 0, 0, av, yawDeg);
  const y = projectDirection(0, 1, 0, av, yawDeg);
  const z = projectDirection(0, 0, 1, av, yawDeg);
  return { x, y, z };
}

function projectDirection(
  wx: number,
  wy: number,
  wz: number,
  av: AngleValues,
  yawDeg: number,
): Vec2 {
  const spun = applyYaw(wx, wz, yawDeg);
  const isoX = av.cos * spun.x - av.cos * spun.y;
  const isoY = av.sin * spun.x - av.hs * wy + av.sin * spun.y;
  // Screen delta matches worldToScreen derivative (y flipped).
  return { x: isoX, y: -isoY };
}

export function worldToScreen(
  wx: number,
  wy: number,
  wz: number,
  cam: OverlayCamera,
): Vec2 {
  const av = getAngleValues(cam.angle);
  const spun = applyYaw(wx, wz, cam.yaw);
  const isoX = av.cos * spun.x - av.cos * spun.y;
  const isoY = av.sin * spun.x - av.hs * wy + av.sin * spun.y;
  return {
    x: (isoX - cam.panX) * cam.zoom + cam.vpW / 2,
    y: cam.vpH / 2 - (isoY - cam.panY) * cam.zoom,
  };
}

/** Inverse of worldToScreen for points on the ground plane (y = groundY). */
export function screenToWorldOnPlane(
  sx: number,
  sy: number,
  cam: OverlayCamera,
  groundY = 0,
): Vec3 {
  const av = getAngleValues(cam.angle);
  const isoX = (sx - cam.vpW / 2) / Math.max(cam.zoom, 1e-6) + cam.panX;
  const isoY = cam.panY - (sy - cam.vpH / 2) / Math.max(cam.zoom, 1e-6);
  // Solve for spun x/z with wy = groundY:
  // isoX = cos*(sx) - cos*(sz)
  // isoY = sin*(sx) - hs*groundY + sin*(sz)
  const cos = av.cos || 1e-6;
  const spunX = (isoX / cos + (isoY + av.hs * groundY) / (av.sin || 1e-6)) / 2;
  const spunZ = ((isoY + av.hs * groundY) / (av.sin || 1e-6) - isoX / cos) / 2;
  // Inverse yaw
  const rad = (-cam.yaw * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: spunX * c - spunZ * s,
    y: groundY,
    z: spunX * s + spunZ * c,
  };
}

export function readVec3(value: unknown): Vec3 {
  if (!value || typeof value !== 'object') return { x: 0, y: 0, z: 0 };
  const row = value as Record<string, unknown>;
  return {
    x: typeof row.x === 'number' && Number.isFinite(row.x) ? row.x : 0,
    y: typeof row.y === 'number' && Number.isFinite(row.y) ? row.y : 0,
    z: typeof row.z === 'number' && Number.isFinite(row.z) ? row.z : 0,
  };
}
