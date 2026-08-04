/**
 * Engine-compatible cell pack/unpack (omosuen v0.24.x bit layout).
 *
 * Bits: material 0..11 | shape 12..23 | emission 24..28 | visible 29
 */

export interface CellData {
  readonly materialIndex: number;
  readonly shapeIndex: number;
  readonly emissionIntensity: number;
  readonly visible: boolean;
}

export function createDefaultCellData(): CellData {
  return {
    materialIndex: 0,
    shapeIndex: 1,
    emissionIntensity: 0,
    visible: true,
  };
}

export function packCell(cell: CellData): number {
  return (
    (4095 & Math.max(0, Math.floor(cell.materialIndex))) |
    ((4095 & Math.max(0, Math.floor(cell.shapeIndex))) << 12) |
    ((31 & Math.max(0, Math.floor(cell.emissionIntensity))) << 24) |
    ((cell.visible ? 1 : 0) << 29)
  );
}

export function unpackCell(packed: number): CellData {
  const n = packed >>> 0;
  return {
    materialIndex: n & 4095,
    shapeIndex: (n >> 12) & 4095,
    emissionIntensity: (n >> 24) & 31,
    visible: ((n >> 29) & 1) === 1,
  };
}

/** Empty / erased voxel (matches V1 removeCell). */
export function erasedCellData(): CellData {
  return {
    materialIndex: 0,
    shapeIndex: 0,
    emissionIntensity: 0,
    visible: true,
  };
}

/** Placed voxel with the given material index. */
export function placedCellData(materialIndex: number): CellData {
  return {
    materialIndex: Math.max(0, Math.floor(materialIndex)),
    shapeIndex: 1,
    emissionIntensity: 0,
    visible: true,
  };
}
