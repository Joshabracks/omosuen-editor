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
