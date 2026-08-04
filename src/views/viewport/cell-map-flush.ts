/**
 * Merge live cell-map packedData snapshots into an OmosceneFile.
 */

import type { OmosceneFile } from '../../omoscene';
import { applyComponentUpdate, findComponentById } from '../../scene';
import {
  normalizeExtents,
  volumeOf,
} from '../../scene/cell-voxel-paint/packed-map';

function packedEqual(a: unknown, b: readonly number[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if ((a[i] >>> 0) !== (b[i]! >>> 0)) return false;
  }
  return true;
}

/**
 * Patch cell-map packedData from live flush snapshots.
 * Skips empty / wrong-length packs and no-op when contents already match.
 */
export function mergeCellMapPackedData(
  file: OmosceneFile,
  patches: ReadonlyMap<number, number[]>,
): OmosceneFile {
  let next = file;
  for (const [id, packed] of patches) {
    if (packed.length === 0) {
      console.warn(`[voxel-flush] merge #${id}: skipped — empty pack`);
      continue;
    }
    const comp = findComponentById(next.scene, id);
    if (!comp || comp.type !== 'cell-map') {
      console.warn(
        `[voxel-flush] merge #${id}: skipped — component missing or not a cell-map ` +
          `in the target document`,
      );
      continue;
    }
    const mapSize = normalizeExtents(comp.mapSize, { x: 8, y: 4, z: 8 });
    const expected = volumeOf({ x: mapSize.x, y: mapSize.y, z: mapSize.z });
    if (packed.length !== expected) {
      console.warn(
        `[voxel-flush] merge #${id}: skipped — length ${packed.length} != expected ${expected}`,
      );
      continue;
    }
    if (packedEqual(comp.packedData, packed)) continue; // real no-op, not a loss — quiet
    next = applyComponentUpdate(next, id, 'cell-map', 'packedData', packed);
  }
  return next;
}

/**
 * Whether a flush captured every live cell-map the session knew about.
 * A flush covering only some `expectedIds` is a *partial* flush — the
 * caller must not treat it as complete (e.g. must not clear a dirty flag),
 * or the un-captured voxels are lost with no retry.
 */
export function flushIsComplete(
  expectedIds: readonly number[],
  patches: ReadonlyMap<number, number[]>,
): { readonly complete: boolean; readonly missing: readonly number[] } {
  const missing = expectedIds.filter((id) => !patches.has(id));
  return { complete: missing.length === 0, missing };
}

/**
 * Whether a flushed previous-scene file may be written back into the
 * current editor document (same region). Never true across a doc swap.
 */
export function canPatchFlushedIntoCurrent(
  current: OmosceneFile | null,
  flushed: OmosceneFile,
  regionKey: (file: OmosceneFile) => string,
): boolean {
  return current !== null && regionKey(current) === regionKey(flushed);
}
