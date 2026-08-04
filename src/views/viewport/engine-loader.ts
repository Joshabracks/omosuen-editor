/**
 * Load the pinned Omosuen UMD into the renderer.
 *
 * Uses global eval — CSP already allows 'unsafe-eval', while blob: script
 * tags were blocked (script-src lacked blob:) and triggered onerror.
 */

export interface OmosuenEngineApi {
  init: () => void;
  start: (fps: number) => void;
  registerScene: (name: string, scene: unknown) => void;
  switchScene: (name: string) => unknown;
  unregisterScene?: (name: string) => void;
  deserializeComponentRecursive: (
    data: unknown,
  ) => unknown | Promise<unknown>;
  /** Prefer this when available — returns the nexus (awaits async deserialize). */
  deserializeScene?: (data: unknown) => unknown | Promise<unknown>;
  serializeComponentRecursive: (component: unknown) => unknown;
  getActiveScene?: () => unknown;
  version?: string;
  /** Optional constructors / helpers present on the UMD global. */
  Vector3D?: new (x: number, y: number, z: number) => unknown;
  Array3D?: new (
    size: unknown,
    fill?: unknown,
  ) => { indexSet?: (i: number, v: number) => void };
  packCell?: (cell: {
    materialIndex: number;
    shapeIndex: number;
    emissionIntensity: number;
    visible: boolean;
  }) => number;
  unpackCell?: (packed: number) => {
    materialIndex: number;
    shapeIndex: number;
    emissionIntensity: number;
    visible: boolean;
  };
  getInitQueueLength?: () => number;
  getInitQueueSize?: () => number;
  markForDisposal?: (component: unknown) => void;
  newComponent?: (
    type: string,
    options?: unknown,
    parent?: unknown,
  ) => Promise<unknown> | unknown;
}

declare global {
  interface Window {
    Omosuen?: OmosuenEngineApi;
  }
}

const loadedVersions = new Map<string, Promise<OmosuenEngineApi>>();

export async function loadEngineUmd(
  version: string,
  readUmdSource: (version: string) => Promise<string>,
): Promise<OmosuenEngineApi> {
  const key = version.trim();
  const existing = loadedVersions.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const source = await readUmdSource(key);
    if (!source || source.trim() === '') {
      throw new Error(`Engine ${key} UMD source is empty`);
    }
    evaluateUmd(source);
    const api = window.Omosuen;
    if (!api || typeof api.init !== 'function') {
      throw new Error(
        `Engine ${key} evaluated but window.Omosuen.init is missing`,
      );
    }
    return api;
  })();

  loadedVersions.set(key, pending);
  try {
    return await pending;
  } catch (err) {
    loadedVersions.delete(key);
    throw err;
  }
}

/**
 * Run classic UMD in global scope so it can attach `window.Omosuen`.
 * Indirect eval keeps the caller's local scope out of the engine bundle.
 */
export function evaluateUmd(source: string): void {
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(source);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to evaluate engine UMD: ${detail}`);
  }
}

/** Test helper — clear load cache between tests. */
export function resetEngineLoadCacheForTests(): void {
  loadedVersions.clear();
}
