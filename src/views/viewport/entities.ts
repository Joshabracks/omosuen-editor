/**
 * Document-driven gizmo entities — nexus with a sibling transform (4b).
 */

import type { OmosceneFile, SerializedComponent } from '../../omoscene';
import { AUTHORING_VISUAL_TYPES } from './sanitize';
import { readVec3, type Vec3 } from './axonometry';

export interface GizmoEntity {
  /** Nexus id (label / click target identity). */
  readonly nexusId: number;
  /** Transform component id (write target for position). */
  readonly transformId: number;
  readonly label: string;
  readonly position: Vec3;
}

/**
 * Walk the scene for nexuses that have a sibling `transform`.
 * Non-visual logic types are ignored (visual-only filter).
 */
export function extractGizmoEntities(file: OmosceneFile | null): GizmoEntity[] {
  if (!file) return [];
  const out: GizmoEntity[] = [];
  walk(file.scene, out);
  return out;
}

function walk(node: SerializedComponent, out: GizmoEntity[]): void {
  if (typeof node.type !== 'string') return;
  if (!AUTHORING_VISUAL_TYPES.has(node.type)) return;

  if (node.type === 'nexus' && typeof node.id === 'number') {
    const children = Array.isArray(node.components) ? node.components : [];
    let transform: SerializedComponent | null = null;
    for (const child of children) {
      if (
        child &&
        typeof child === 'object' &&
        (child as SerializedComponent).type === 'transform' &&
        typeof (child as SerializedComponent).id === 'number'
      ) {
        transform = child as SerializedComponent;
        break;
      }
    }
    if (transform && typeof transform.id === 'number') {
      const label =
        typeof node.name === 'string' && node.name !== ''
          ? node.name
          : `nexus ${node.id}`;
      out.push({
        nexusId: node.id,
        transformId: transform.id,
        label,
        position: readVec3(transform.position),
      });
    }
    for (const child of children) {
      if (
        child &&
        typeof child === 'object' &&
        typeof (child as SerializedComponent).type === 'string'
      ) {
        walk(child as SerializedComponent, out);
      }
    }
    return;
  }

  if (Array.isArray(node.components)) {
    for (const child of node.components) {
      if (
        child &&
        typeof child === 'object' &&
        typeof (child as SerializedComponent).type === 'string'
      ) {
        walk(child as SerializedComponent, out);
      }
    }
  }
}

/** Prefer transform id when selection is a nexus that has a transform sibling. */
export function resolveTransformSelection(
  entities: readonly GizmoEntity[],
  selectedIds: readonly number[],
): { readonly entity: GizmoEntity; readonly selectedId: number } | null {
  if (selectedIds.length === 0) return null;
  const id = selectedIds[0]!;
  for (const entity of entities) {
    if (entity.transformId === id || entity.nexusId === id) {
      return { entity, selectedId: id };
    }
  }
  return null;
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
