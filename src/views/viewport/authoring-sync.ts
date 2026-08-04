/**
 * Live authoring sync — DocumentController Bridge applies incremental
 * EditorMessages onto the engine graph (no full scene reload).
 */

import type { Bridge, BridgeListener } from '../../bridge/protocol-bridge';
import type { OmosceneFile, SerializedComponent } from '../../omoscene';
import type { EditorMessage } from '../../protocol';
import { findComponentById } from '../../scene';
import {
  flattenLivePackedData,
} from './authoring-load';
import { isAuthoringDisplayType } from './authoring-allowlist';
import {
  ensureAtlasCompiled,
  mirrorNode,
  registerTextureWithAtlas,
  type AuthoringSceneHandles,
} from './authoring-scene';
import type { OmosuenEngineApi } from './engine-loader';

export interface AuthoringSyncDeps {
  readonly api: OmosuenEngineApi;
  readonly getHandles: () => AuthoringSceneHandles | null;
  readonly getDocument: () => OmosceneFile | null;
  /** Cold-boot when scene:load carries a new scene region / engine. */
  readonly onSceneLoad: (file: OmosceneFile) => void | Promise<void>;
  /** True when scene:load should skip rebuild (editor-metadata only). */
  readonly isSameSceneRegion: (file: OmosceneFile) => boolean;
  readonly onSelect?: (ids: readonly number[]) => void;
  readonly onDesync?: (reason: string) => void;
}

export interface AuthoringSyncBridge extends Bridge {
  /** Apply one message (also used by Bridge.dispatch). */
  readonly applyMessage: (msg: EditorMessage) => Promise<void>;
}

export function createAuthoringSyncBridge(
  deps: AuthoringSyncDeps,
): AuthoringSyncBridge {
  const listeners = new Set<BridgeListener>();
  let disposed = false;

  async function applyMessage(msg: EditorMessage): Promise<void> {
    if (disposed) return;

    switch (msg.kind) {
      case 'scene:load': {
        if (deps.isSameSceneRegion(msg.file)) {
          return;
        }
        await deps.onSceneLoad(msg.file);
        return;
      }
      case 'component:select': {
        deps.onSelect?.(msg.ids);
        return;
      }
      case 'component:add': {
        await applyAdd(deps, msg.parentId, msg.componentType);
        return;
      }
      case 'component:remove': {
        applyRemove(deps, msg.id);
        return;
      }
      case 'component:move': {
        applyMove(deps, msg.id, msg.parentId, msg.index);
        return;
      }
      case 'component:update': {
        applyUpdate(deps, msg.id, msg.property, msg.value);
        return;
      }
      case 'scene:save':
      case 'preview:ready':
      case 'preview:log':
      case 'preview:pause':
      case 'preview:resume':
      case 'preview:step':
        return;
      default:
        return;
    }
  }

  return {
    dispatch(msg) {
      void applyMessage(msg);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
    applyMessage,
  };
}

async function applyAdd(
  deps: AuthoringSyncDeps,
  parentId: number,
  componentType: string,
): Promise<void> {
  if (!isAuthoringDisplayType(componentType) && componentType !== 'nexus') {
    return;
  }
  // Document cameras / viewports are never mirrored.
  if (componentType === 'camera' || componentType === 'viewport') return;

  const handles = deps.getHandles();
  const file = deps.getDocument();
  if (!handles || !file) return;

  const parentLive = handles.idToLive.get(parentId);
  if (!parentLive) {
    deps.onDesync?.(`add: missing live parent ${parentId}`);
    return;
  }

  const parentDoc = findComponentById(file.scene, parentId);
  if (!parentDoc || !Array.isArray(parentDoc.components)) return;

  const unmapped = parentDoc.components.find(
    (c) =>
      c &&
      typeof c === 'object' &&
      (c as SerializedComponent).type === componentType &&
      typeof (c as SerializedComponent).id === 'number' &&
      !handles.idToLive.has((c as SerializedComponent).id as number),
  ) as SerializedComponent | undefined;

  if (!unmapped) {
    deps.onDesync?.(`add: could not find unmapped ${componentType} under ${parentId}`);
    return;
  }

  await mirrorNode(
    deps.api,
    unmapped,
    parentLive,
    handles.idToLive,
    handles.atlasManager,
  );

  if (componentType === 'texture-map' && handles.atlasManager) {
    const live = handles.idToLive.get(unmapped.id as number);
    if (live) {
      registerTextureWithAtlas(handles.atlasManager, live);
      void ensureAtlasCompiled(handles.atlasManager);
    }
  }
}

function applyRemove(deps: AuthoringSyncDeps, id: number): void {
  const handles = deps.getHandles();
  if (!handles) return;
  const live = handles.idToLive.get(id);
  if (!live) return;

  disposeLive(deps.api, live);
  dropMappedSubtree(handles, id, live);
}

function applyMove(
  deps: AuthoringSyncDeps,
  id: number,
  parentId: number,
  index?: number,
): void {
  const handles = deps.getHandles();
  if (!handles) return;
  const live = handles.idToLive.get(id);
  const newParent = handles.idToLive.get(parentId);
  if (!live || !newParent) {
    deps.onDesync?.(`move: missing live node ${id} or parent ${parentId}`);
    return;
  }

  // Detach from old parent.
  const oldParent = live.parent as Record<string, unknown> | null | undefined;
  if (oldParent && Array.isArray(oldParent.components)) {
    oldParent.components = (oldParent.components as unknown[]).filter(
      (c) => c !== live,
    );
  }

  const add = newParent.addComponent;
  if (typeof add === 'function') {
    (add as (c: unknown) => void).call(newParent, live);
  } else if (Array.isArray(newParent.components)) {
    newParent.components.push(live);
  }
  live.parent = newParent;

  if (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    Array.isArray(newParent.components)
  ) {
    const comps = newParent.components as unknown[];
    const at = comps.indexOf(live);
    if (at >= 0) {
      comps.splice(at, 1);
      comps.splice(Math.max(0, Math.min(index, comps.length)), 0, live);
    }
  }
}

function applyUpdate(
  deps: AuthoringSyncDeps,
  id: number,
  property: string,
  value: unknown,
): void {
  const handles = deps.getHandles();
  if (!handles) return;
  const live = handles.idToLive.get(id);
  if (!live) return;

  if (property === 'packedData' && Array.isArray(value)) {
    applyPackedData(deps.api, live, value as number[]);
    return;
  }

  try {
    live[property] = hydrateEngineValue(deps.api, value);
  } catch {
    // Some proxies reject assignment; ignore soft failures.
  }
}

function applyPackedData(
  api: OmosuenEngineApi,
  live: Record<string, unknown>,
  packed: number[],
): void {
  const current = live.packedData;
  if (
    current &&
    typeof current === 'object' &&
    !Array.isArray(current) &&
    typeof (current as { indexSet?: unknown }).indexSet === 'function'
  ) {
    const indexSet = (current as { indexSet: (i: number, v: number) => void })
      .indexSet;
    for (let i = 0; i < packed.length; i++) {
      indexSet(i, packed[i]! >>> 0);
    }
    return;
  }
  live.packedData = packed;
  void flattenLivePackedData(live, (c) => api.serializeComponentRecursive(c));
}

function hydrateEngineValue(api: OmosuenEngineApi, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const row = value as Record<string, unknown>;
  const tag = row._vectorType;
  if (tag === 'Vector3D' || ('x' in row && 'y' in row && 'z' in row && !('w' in row))) {
    const x = Number(row.x) || 0;
    const y = Number(row.y) || 0;
    const z = Number(row.z) || 0;
    if (typeof api.Vector3D === 'function') return new api.Vector3D(x, y, z);
    return { x, y, z };
  }
  if (tag === 'Vector4D' || ('w' in row && 'x' in row)) {
    const x = Number(row.x) || 0;
    const y = Number(row.y) || 0;
    const z = Number(row.z) || 0;
    const w = Number(row.w) || 0;
    const Ctor = (api as OmosuenEngineApi & {
      Vector4D?: new (x: number, y: number, z: number, w: number) => unknown;
    }).Vector4D;
    if (typeof Ctor === 'function') return new Ctor(x, y, z, w);
    return { x, y, z, w };
  }
  if (tag === 'Vector2D' || ('x' in row && 'y' in row && !('z' in row))) {
    const x = Number(row.x) || 0;
    const y = Number(row.y) || 0;
    const Ctor = (api as OmosuenEngineApi & {
      Vector2D?: new (x: number, y: number) => unknown;
    }).Vector2D;
    if (typeof Ctor === 'function') return new Ctor(x, y);
    return { x, y };
  }
  return value;
}

function disposeLive(api: OmosuenEngineApi, live: Record<string, unknown>): void {
  try {
    if (typeof live.dispose === 'function') {
      (live.dispose as () => void).call(live);
    } else {
      api.markForDisposal?.(live);
      live._disposed = true;
    }
  } catch {
    live._disposed = true;
  }

  const parent = live.parent as Record<string, unknown> | null | undefined;
  if (parent && Array.isArray(parent.components)) {
    parent.components = (parent.components as unknown[]).filter((c) => c !== live);
  }
}

function dropMappedSubtree(
  handles: AuthoringSceneHandles,
  rootId: number,
  live: Record<string, unknown>,
): void {
  const dropIds = new Set<number>([rootId]);
  const walk = (node: Record<string, unknown>): void => {
    if (typeof node.id === 'number') dropIds.add(node.id);
    if (Array.isArray(node.components)) {
      for (const child of node.components) {
        if (child && typeof child === 'object') {
          walk(child as Record<string, unknown>);
        }
      }
    }
  };
  walk(live);
  // Also drop any map entries pointing at this live object / descendants.
  for (const [id, ref] of [...handles.idToLive.entries()]) {
    if (dropIds.has(id) || ref === live) {
      handles.idToLive.delete(id);
    }
  }
}
