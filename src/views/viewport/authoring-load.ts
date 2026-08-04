/**
 * Authoring viewport load helpers — texture URI rewrite + additive cell-map
 * shape for engine deserialize (never strip required fields).
 */

import type { SerializedComponent, SerializedScene } from '../../omoscene';
import {
  ensurePackedBuffer,
  normalizeExtents,
} from '../../scene/cell-voxel-paint/packed-map';

export interface OmosuenAuthoringApi {
  readonly getInitQueueLength?: () => number;
  readonly getInitQueueSize?: () => number;
  readonly getActiveScene?: () => unknown;
  readonly switchScene?: (name: string) => unknown;
  readonly unregisterScene?: (name: string) => void;
  readonly markForDisposal?: (component: unknown) => void;
}

/** Rewrite texture-map filePath values to data URLs the engine can fetch. */
export async function resolveTexturePathsForAuthoring(
  scene: SerializedScene,
  readDataUrl: (relativePath: string) => Promise<string | null>,
): Promise<SerializedScene> {
  const clone = JSON.parse(JSON.stringify(scene)) as SerializedScene;
  const tasks: Promise<void>[] = [];
  walkSerialized(clone, (node) => {
    if (node.type !== 'texture-map') return;
    const filePath = node.filePath;
    if (typeof filePath !== 'string' || filePath.trim() === '') return;
    if (filePath.startsWith('data:') || /^https?:/i.test(filePath)) return;
    const rel = filePath.replace(/\\/g, '/');
    tasks.push(
      (async () => {
        try {
          const dataUrl = await readDataUrl(rel);
          if (dataUrl) {
            (node as Record<string, unknown>).filePath = dataUrl;
          }
        } catch {
          // Leave relative path; engine may fail that texture only.
        }
      })(),
    );
  });
  await Promise.all(tasks);
  return clone;
}

/**
 * Additive-only: ensure cell-maps satisfy engine deserialize requirements
 * (materials[], packedData[], positive extents). Never deletes fields.
 */
export function ensureCellMapDeserializeShape(scene: SerializedScene): void {
  walkSerialized(scene, (node) => {
    if (node.type !== 'cell-map') return;
    const row = node as Record<string, unknown>;

    const mapSize = normalizeExtents(node.mapSize, { x: 8, y: 4, z: 8 });
    const cellSize = normalizeExtents(node.cellSize, { x: 1, y: 1, z: 1 });
    if (mapSize.corrected) {
      row.mapSize = {
        _vectorType: 'Vector3D',
        x: mapSize.x,
        y: mapSize.y,
        z: mapSize.z,
      };
    }
    if (cellSize.corrected) {
      row.cellSize = {
        _vectorType: 'Vector3D',
        x: cellSize.x,
        y: cellSize.y,
        z: cellSize.z,
      };
    }

    const ms = { x: mapSize.x, y: mapSize.y, z: mapSize.z };
    if (!Array.isArray(row.materials)) {
      row.materials = [];
    }
    if (!Array.isArray(row.packedData)) {
      row.packedData = ensurePackedBuffer([], ms);
    } else {
      // Pad/truncate to current volume without dropping existing voxels.
      row.packedData = ensurePackedBuffer(row.packedData, ms);
    }
  });
}

/**
 * Flatten live cell-map packedData (engine getter with forEach) into a number[].
 * Falls back to serializeComponentRecursive when forEach is unavailable.
 */
export function flattenLivePackedData(
  live: Record<string, unknown>,
  serialize?: (component: unknown) => unknown,
): number[] | null {
  const packed = live.packedData as
    | { forEach?: (cb: (val: number) => void) => void }
    | number[]
    | undefined;
  if (Array.isArray(packed)) {
    return packed.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v >>> 0 : 0));
  }
  if (packed && typeof packed.forEach === 'function') {
    const out: number[] = [];
    packed.forEach((val) => {
      out.push(typeof val === 'number' && Number.isFinite(val) ? val >>> 0 : 0);
    });
    return out;
  }
  if (typeof serialize === 'function') {
    try {
      const ser = serialize(live) as Record<string, unknown>;
      if (Array.isArray(ser?.packedData)) {
        return (ser.packedData as unknown[]).map((v) =>
          typeof v === 'number' && Number.isFinite(v) ? v >>> 0 : 0,
        );
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Engine unload calls `activeScene.dispose()` which nexuses lack.
 * Attach a safe dispose before switchScene so reload doesn't throw.
 */
export function patchActiveSceneDispose(
  api: OmosuenAuthoringApi,
): void {
  const active = api.getActiveScene?.();
  if (!active || typeof active !== 'object') return;
  const scene = active as { dispose?: unknown; _disposed?: boolean };
  if (typeof scene.dispose === 'function') return;
  scene.dispose = () => {
    try {
      api.markForDisposal?.(active);
    } catch {
      // ignore
    }
    scene._disposed = true;
  };
}

/** Register + switch authoring scene, patching dispose and awaiting switch. */
export async function registerAndSwitchAuthoringScene(
  api: OmosuenAuthoringApi & {
    registerScene: (name: string, scene: unknown) => void;
    switchScene: (name: string) => unknown;
  },
  key: string,
  root: unknown,
): Promise<void> {
  patchActiveSceneDispose(api);
  try {
    api.unregisterScene?.(key);
  } catch {
    // ignore
  }
  api.registerScene(key, root);
  patchActiveSceneDispose(api);
  const switched = api.switchScene(key);
  if (switched && typeof (switched as Promise<unknown>).then === 'function') {
    await (switched as Promise<unknown>);
  }
}

/**
 * Engine `deserializeComponentRecursive` (ve) is async and returns
 * `{ component, errors }`. Prefer `deserializeScene` when present.
 */
export async function deserializeAuthoringRoot(
  api: {
    deserializeComponentRecursive: (data: unknown) => unknown | Promise<unknown>;
    deserializeScene?: (data: unknown) => unknown | Promise<unknown>;
  },
  scene: SerializedScene,
): Promise<unknown> {
  if (typeof api.deserializeScene === 'function') {
    const root = await Promise.resolve(api.deserializeScene(scene));
    if (!root) {
      throw new Error('Engine deserializeScene returned no nexus');
    }
    return root;
  }

  const raw = await Promise.resolve(api.deserializeComponentRecursive(scene));
  if (!raw || typeof raw !== 'object') {
    throw new Error('Engine failed to deserialize scene');
  }
  const row = raw as { component?: unknown; errors?: unknown };
  if ('component' in row) {
    const errors = row.errors;
    if (Array.isArray(errors)) {
      for (const err of errors) {
        if (err && typeof err === 'object') {
          const e = err as { code?: string; message?: string };
          console.warn(
            `[authoring deserialize] ${e.code ?? 'ERROR'}: ${e.message ?? ''}`,
          );
        }
      }
    }
    if (!row.component) {
      throw new Error('Engine deserialize returned null component');
    }
    return row.component;
  }
  return raw;
}

/**
 * Deserialize a single component leaf (not a full scene nexus).
 * Always uses deserializeComponentRecursive — never deserializeScene.
 */
export async function deserializeAuthoringLeaf(
  api: {
    deserializeComponentRecursive: (data: unknown) => unknown | Promise<unknown>;
  },
  leaf: SerializedComponent,
): Promise<unknown> {
  const raw = await Promise.resolve(api.deserializeComponentRecursive(leaf));
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Engine failed to deserialize ${leaf.type}`);
  }
  const row = raw as { component?: unknown; errors?: unknown };
  if ('component' in row) {
    const errors = row.errors;
    if (Array.isArray(errors)) {
      for (const err of errors) {
        if (err && typeof err === 'object') {
          const e = err as { code?: string; message?: string };
          console.warn(
            `[authoring deserialize leaf] ${e.code ?? 'ERROR'}: ${e.message ?? ''}`,
          );
        }
      }
    }
    if (!row.component) {
      throw new Error(`Engine deserialize returned null for ${leaf.type}`);
    }
    return row.component;
  }
  return raw;
}

/** Poll engine init queue until empty (V1 editor ready gate). */
export async function waitForEngineInit(
  api: OmosuenAuthoringApi,
  timeoutMs = 20000,
): Promise<void> {
  const getLen = api.getInitQueueLength;
  if (typeof getLen !== 'function') return;
  const started = Date.now();
  let sawPositive = false;
  while (Date.now() - started < timeoutMs) {
    let qLen: number;
    try {
      qLen = getLen.call(api);
    } catch {
      return;
    }
    if (typeof qLen !== 'number' || !Number.isFinite(qLen)) return;
    if (qLen === -1) return;
    if (qLen > 0) sawPositive = true;
    if (qLen === 0 && (sawPositive || Date.now() - started > 250)) return;
    await delay(50);
  }
}

export function walkSerialized(
  node: SerializedComponent,
  visit: (n: SerializedComponent) => void,
): void {
  visit(node);
  if (!Array.isArray(node.components)) return;
  for (const child of node.components) {
    if (child && typeof child === 'object') {
      walkSerialized(child as SerializedComponent, visit);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
