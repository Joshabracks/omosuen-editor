/**
 * Document-driven gizmo entities — contribution-backed (4b/4c).
 */

import type { OmosceneFile, SerializedComponent } from '../../omoscene';
import {
  buildViewportOverlayModel,
  resolveTranslateSelection,
  type ViewportLabelEntity,
} from './capabilities';

/** @deprecated Prefer ViewportLabelEntity — kept for existing call sites. */
export type GizmoEntity = ViewportLabelEntity;

/**
 * Walk the scene for labeled nexuses per `viewport.labelWhen` contributions.
 */
export function extractGizmoEntities(file: OmosceneFile | null): GizmoEntity[] {
  return [...buildViewportOverlayModel(file).labels];
}

/** Prefer transform id when selection is a nexus that has a transform sibling. */
export function resolveTransformSelection(
  entities: readonly GizmoEntity[],
  selectedIds: readonly number[],
): { readonly entity: GizmoEntity; readonly selectedId: number } | null {
  return resolveTranslateSelection(entities, selectedIds);
}

/** Fingerprint of tree structure (ids+types) — ignore property values. */
export function sceneStructureKey(file: OmosceneFile | null): string {
  if (!file) return '';
  const parts: string[] = [];
  function walkNode(node: SerializedComponent): void {
    parts.push(`${node.type}:${typeof node.id === 'number' ? node.id : -1}`);
    if (Array.isArray(node.components)) {
      for (const child of node.components) {
        if (
          child &&
          typeof child === 'object' &&
          typeof (child as SerializedComponent).type === 'string'
        ) {
          walkNode(child as SerializedComponent);
        }
      }
    }
  }
  walkNode(file.scene);
  return parts.join('|');
}

/**
 * cell-map fields that are large, engine-computed/derived, and must not
 * affect authoring-region identity — only their *presence* (via a cheap
 * stub) matters, never their content. Mirrors schema.ts's
 * `excludeFromInspector` list for cell-map, minus `materials` (texture-key
 * changes there legitimately need a re-register-with-atlas cold boot).
 */
const VOLATILE_CELL_MAP_FIELDS = new Set([
  'packedData',
  'meshes',
  'chunks',
  'chunkGridSize',
  'materialMap',
  'shapeMap',
  'emissionMap',
  'visibilityMap',
  'smoothingWeights',
  'needsGPUUpdate',
]);

/** Clone scene JSON with large derived cell-map fields replaced by cheap stubs. */
function sceneWithoutVoxelPayload(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sceneWithoutVoxelPayload);
  }
  if (!node || typeof node !== 'object') return node;
  const row = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (VOLATILE_CELL_MAP_FIELDS.has(key)) {
      out[key] = Array.isArray(value) ? { _len: value.length } : '<stubbed>';
      continue;
    }
    out[key] = sceneWithoutVoxelPayload(value);
  }
  return out;
}

/**
 * Authoring region identity: engine + scene without voxel/derived payloads.
 * packedData (and other large engine-computed cell-map fields) content
 * changes must not force cold boot; structure / materials / mapSize / ids
 * still distinguish documents.
 */
export function sceneRegionKey(file: OmosceneFile): string {
  return `${file.engine}::${JSON.stringify(sceneWithoutVoxelPayload(file.scene))}`;
}
