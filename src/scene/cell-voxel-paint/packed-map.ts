/**
 * Pure packedData buffer ops for cell-map (6b).
 *
 * Flat index order matches engine Array3D: x fastest, then y, then z.
 */

import {
  erasedCellData,
  packCell,
  placedCellData,
  unpackCell,
  type CellData,
} from './cell-data';

export interface MapSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CellSize {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CellCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function volumeOf(mapSize: MapSize): number {
  return Math.max(0, mapSize.x) * Math.max(0, mapSize.y) * Math.max(0, mapSize.z);
}

/** x + y*sx + z*sx*sy */
export function cellIndex(mapSize: MapSize, coord: CellCoord): number {
  return coord.x + coord.y * mapSize.x + coord.z * mapSize.x * mapSize.y;
}

export function inBounds(mapSize: MapSize, coord: CellCoord): boolean {
  return (
    coord.x >= 0 &&
    coord.y >= 0 &&
    coord.z >= 0 &&
    coord.x < mapSize.x &&
    coord.y < mapSize.y &&
    coord.z < mapSize.z
  );
}

/** Ensure a buffer of length volume; pad with empty (shape 0) cells. */
export function ensurePackedBuffer(
  raw: unknown,
  mapSize: MapSize,
): number[] {
  const len = volumeOf(mapSize);
  const empty = packCell(erasedCellData());
  const out = new Array<number>(len);
  const src = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < len; i += 1) {
    const v = src[i];
    out[i] =
      typeof v === 'number' && Number.isFinite(v) ? v >>> 0 : empty;
  }
  return out;
}

export function getCell(
  packed: readonly number[],
  mapSize: MapSize,
  coord: CellCoord,
): CellData | null {
  if (!inBounds(mapSize, coord)) return null;
  const idx = cellIndex(mapSize, coord);
  const v = packed[idx];
  if (typeof v !== 'number') return unpackCell(packCell(erasedCellData()));
  return unpackCell(v);
}

export function setCell(
  packed: readonly number[],
  mapSize: MapSize,
  coord: CellCoord,
  cell: CellData,
): number[] | null {
  if (!inBounds(mapSize, coord)) return null;
  const next = [...packed];
  const needed = volumeOf(mapSize);
  while (next.length < needed) next.push(packCell(erasedCellData()));
  next[cellIndex(mapSize, coord)] = packCell(cell) >>> 0;
  return next;
}

export function placeCellAt(
  packed: readonly number[],
  mapSize: MapSize,
  coord: CellCoord,
  materialIndex: number,
): number[] | null {
  return setCell(packed, mapSize, coord, placedCellData(materialIndex));
}

export function eraseCellAt(
  packed: readonly number[],
  mapSize: MapSize,
  coord: CellCoord,
): number[] | null {
  return setCell(packed, mapSize, coord, erasedCellData());
}

export function readVec3(
  raw: unknown,
  fallback: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  if (typeof raw !== 'object' || raw === null) return { ...fallback };
  const rec = raw as Record<string, unknown>;
  return {
    x: numOr(rec.x, fallback.x),
    y: numOr(rec.y, fallback.y),
    z: numOr(rec.z, fallback.z),
  };
}

/** Positive map/cell extents; zero/negative axes fall back (new cell-maps seed 0,0,0). */
export function normalizeExtents(
  raw: unknown,
  fallback: { x: number; y: number; z: number },
): { x: number; y: number; z: number; corrected: boolean } {
  const v = readVec3(raw, fallback);
  const x = v.x > 0 ? v.x : fallback.x;
  const y = v.y > 0 ? v.y : fallback.y;
  const z = v.z > 0 ? v.z : fallback.z;
  const corrected = x !== v.x || y !== v.y || z !== v.z;
  return { x, y, z, corrected };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * World point on brush plane → integer cell coord, or null if OOB.
 * Cell occupies [coord * cellSize, (coord+1) * cellSize).
 */
export function worldToCellCoord(
  world: { x: number; y: number; z: number },
  cellSize: CellSize,
  mapSize: MapSize,
  brushHeight: number,
): CellCoord | null {
  const csx = cellSize.x > 0 ? cellSize.x : 1;
  const csz = cellSize.z > 0 ? cellSize.z : 1;
  const coord: CellCoord = {
    x: Math.floor(world.x / csx),
    y: brushHeight,
    z: Math.floor(world.z / csz),
  };
  return inBounds(mapSize, coord) ? coord : null;
}
