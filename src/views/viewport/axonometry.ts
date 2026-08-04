/**
 * Axonometric projection helpers for the authoring gizmo overlay.
 *
 * Matches the engine screen-pick math in
 * `omosuen/src/component/camera/screen-pick/projection-math.ts`:
 *   projScale = zoom²
 *   screen Y = (isoY - camIsoY) * projScale + H/2  (no extra DOM flip)
 *   yaw: rx = c*x + s*z, rz = -s*x + c*z
 *
 * The engine's WebGL clip already flips Y (`vec2(1,-1)`); overlay canvas is
 * Y-down like the engine's pixel pick space — do not invert again.
 */

export interface OverlayCamera {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly vpW: number;
  readonly vpH: number;
  /** Axonometric elevation degrees (0..90). */
  readonly angle: number;
  /** Yaw around world Y in degrees (engine orbitYaw). */
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

/** Engine `ISO_H` — constant horizontal spread (cos 30°). */
const ISO_H = 0.8660254;

export function getAngleValues(angleDeg: number): AngleValues {
  const angle = Math.max(0, Math.min(90, angleDeg));
  const rad = (angle * Math.PI) / 180;
  return {
    cos: ISO_H,
    sin: Math.sin(rad),
    hs: Math.cos(rad) * 1.1547005,
  };
}

/** Engine projScale — zoom is applied squared. */
export function projScale(zoom: number): number {
  const z = Number.isFinite(zoom) ? zoom : 1;
  return z * z;
}

/**
 * Rotate world XZ by yaw (degrees) around +Y — matches engine orbitYaw:
 *   rx = x*cos + z*sin
 *   rz = -x*sin + z*cos
 */
export function applyYaw(wx: number, wz: number, yawDeg: number): Vec2 {
  if (!yawDeg) return { x: wx, y: wz };
  const rad = (yawDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: wx * c + wz * s,
    y: -wx * s + wz * c,
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
  const isoX = av.cos * (spun.x - spun.y);
  const isoY = av.sin * (spun.x + spun.y) - av.hs * wy;
  // Screen delta matches worldToScreen (no Y flip).
  return { x: isoX, y: isoY };
}

export function worldToScreen(
  wx: number,
  wy: number,
  wz: number,
  cam: OverlayCamera,
): Vec2 {
  const av = getAngleValues(cam.angle);
  const spun = applyYaw(wx, wz, cam.yaw);
  const isoX = av.cos * (spun.x - spun.y);
  const isoY = av.sin * (spun.x + spun.y) - av.hs * wy;
  const scale = projScale(cam.zoom);
  return {
    x: (isoX - cam.panX) * scale + cam.vpW / 2,
    y: (isoY - cam.panY) * scale + cam.vpH / 2,
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
  const scale = Math.max(projScale(cam.zoom), 1e-6);
  const isoX = (sx - cam.vpW / 2) / scale + cam.panX;
  const isoY = (sy - cam.vpH / 2) / scale + cam.panY;
  // isoX = cos*(rx - rz)
  // isoY = sin*(rx + rz) - hs*groundY
  const cos = av.cos || 1e-6;
  const sin = av.sin < 0.01 ? 0.01 : av.sin;
  const spunX = (isoX / cos + (isoY + av.hs * groundY) / sin) / 2;
  const spunZ = ((isoY + av.hs * groundY) / sin - isoX / cos) / 2;
  // Inverse of applyYaw (transpose of [[c,s],[-s,c]]).
  const rad = (cam.yaw * Math.PI) / 180;
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
