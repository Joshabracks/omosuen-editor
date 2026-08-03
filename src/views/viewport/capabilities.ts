/**
 * Viewport capability registry (4c / E16).
 *
 * Overlay behavior is driven by `registerEditorType({ viewport })` contributions
 * — not hard-coded `switch (type)` monoliths.
 */

import {
  listEditorTypes,
  resolveEditorType,
  type GizmoId,
  type ViewportContribution,
} from '../../editor-api';
import type { OmosceneFile, SerializedComponent } from '../../omoscene';
import { readVec3, type Vec3 } from './axonometry';

export type LabelWhen = NonNullable<ViewportContribution['labelWhen']>;

export interface ResolvedViewportCaps {
  readonly type: string;
  readonly labelWhen: LabelWhen;
  readonly gizmos: ReadonlySet<string>;
  readonly paintModes: ReadonlySet<string>;
}

export interface ViewportLabelEntity {
  readonly nexusId: number;
  readonly transformId: number;
  readonly label: string;
  readonly position: Vec3;
  /** True when resolved caps include gizmo.translate on the transform type. */
  readonly translateEnabled: boolean;
}

export interface ColliderHelper {
  readonly componentId: number;
  readonly parentNexusId: number | null;
  readonly kind: string;
  readonly shape: string;
  readonly position: Vec3;
  readonly offset: Vec3;
  readonly size: Vec3;
  readonly radius: number;
}

export interface LightHelper {
  readonly componentId: number;
  readonly parentNexusId: number | null;
  readonly lightType: string;
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly color: Vec3;
  readonly radius: number;
}

export interface ViewportOverlayModel {
  readonly labels: readonly ViewportLabelEntity[];
  readonly colliders: readonly ColliderHelper[];
  readonly lights: readonly LightHelper[];
  readonly paintModes: readonly string[];
  readonly showGrid: boolean;
}

const DEFAULT_LABEL_WHEN: LabelWhen = 'never';

/** Resolve viewport caps for every registered type at an engine version. */
export function resolveAllViewportCaps(
  engineVersion: string,
): Map<string, ResolvedViewportCaps> {
  const out = new Map<string, ResolvedViewportCaps>();
  for (const type of listEditorTypes()) {
    const resolved = resolveEditorType(type, engineVersion);
    if (!resolved) continue;
    out.set(type, normalizeCaps(type, resolved.viewport));
  }
  return out;
}

export function resolveViewportCapsForType(
  type: string,
  engineVersion: string,
): ResolvedViewportCaps {
  const resolved = resolveEditorType(type, engineVersion);
  return normalizeCaps(type, resolved?.viewport);
}

function normalizeCaps(
  type: string,
  viewport: ViewportContribution | undefined,
): ResolvedViewportCaps {
  return {
    type,
    labelWhen: viewport?.labelWhen ?? DEFAULT_LABEL_WHEN,
    gizmos: new Set(viewport?.gizmos ?? []),
    paintModes: new Set(viewport?.paintModes ?? []),
  };
}

export function typeHasGizmo(
  caps: ResolvedViewportCaps | undefined,
  gizmoId: GizmoId | string,
): boolean {
  return caps?.gizmos.has(gizmoId) ?? false;
}

/** Union of paint modes declared on any registered contribution. */
export function listRegisteredPaintModes(engineVersion: string): string[] {
  const modes = new Set<string>();
  for (const caps of resolveAllViewportCaps(engineVersion).values()) {
    for (const mode of caps.paintModes) modes.add(mode);
  }
  return [...modes].sort();
}

/**
 * Build overlay model from the document + contribution registry.
 * Labels / helpers appear only when the contributing type declares the cap.
 */
export function buildViewportOverlayModel(
  file: OmosceneFile | null,
  engineVersion?: string,
): ViewportOverlayModel {
  if (!file) {
    return {
      labels: [],
      colliders: [],
      lights: [],
      paintModes: [],
      showGrid: false,
    };
  }
  const version = engineVersion ?? file.engine;
  const capsByType = resolveAllViewportCaps(version);
  const labels: ViewportLabelEntity[] = [];
  const colliders: ColliderHelper[] = [];
  const lights: LightHelper[] = [];
  const paintModes = new Set<string>();
  let showGrid = false;

  const transformCaps = capsByType.get('transform');
  const translateEnabled = typeHasGizmo(transformCaps, 'gizmo.translate');

  walkScene(file.scene, null, (node, parentNexusId, nexusTransform) => {
    const caps = capsByType.get(String(node.type));
    if (!caps) return;

    if (typeHasGizmo(caps, 'overlay.grid')) {
      showGrid = true;
    }
    for (const mode of caps.paintModes) {
      paintModes.add(mode);
    }

    if (
      node.type === 'nexus' &&
      typeof node.id === 'number' &&
      shouldShowLabel(caps.labelWhen, nexusTransform !== null)
    ) {
      if (nexusTransform && typeof nexusTransform.id === 'number') {
        labels.push({
          nexusId: node.id,
          transformId: nexusTransform.id,
          label:
            typeof node.name === 'string' && node.name !== ''
              ? node.name
              : `nexus ${node.id}`,
          position: readVec3(nexusTransform.position),
          translateEnabled,
        });
      } else if (caps.labelWhen === 'always') {
        labels.push({
          nexusId: node.id,
          transformId: node.id,
          label:
            typeof node.name === 'string' && node.name !== ''
              ? node.name
              : `nexus ${node.id}`,
          position: { x: 0, y: 0, z: 0 },
          translateEnabled: false,
        });
      }
    }

    if (typeHasGizmo(caps, 'gizmo.collider') && typeof node.id === 'number') {
      const offset = readVec3(node.offset);
      const size = readVec3(node.size);
      const radius =
        typeof node.radius === 'number' && Number.isFinite(node.radius)
          ? node.radius
          : 0.5;
      const base = nexusTransform
        ? readVec3(nexusTransform.position)
        : { x: 0, y: 0, z: 0 };
      colliders.push({
        componentId: node.id,
        parentNexusId,
        kind: String(node.type),
        shape: typeof node.shape === 'string' ? node.shape : 'box',
        position: base,
        offset,
        size: {
          x: size.x || 16,
          y: size.y || 16,
          z: size.z || 16,
        },
        radius,
      });
    }

    if (
      typeHasGizmo(caps, 'gizmo.light-direction') &&
      typeof node.id === 'number'
    ) {
      const lightType =
        typeof node.lightType === 'string' ? node.lightType : 'ambient';
      if (lightType === 'ambient') return;
      lights.push({
        componentId: node.id,
        parentNexusId,
        lightType,
        position: nexusTransform
          ? readVec3(nexusTransform.position)
          : { x: 0, y: 0, z: 0 },
        direction: readVec3(node.direction ?? { x: 0, y: -1, z: 0 }),
        color: readVec3(node.color ?? { x: 1, y: 1, z: 1 }),
        radius:
          typeof node.radius === 'number' && Number.isFinite(node.radius)
            ? node.radius
            : 0,
      });
    }
  });

  return {
    labels,
    colliders,
    lights,
    paintModes: [...paintModes].sort(),
    showGrid,
  };
}

function shouldShowLabel(
  labelWhen: LabelWhen,
  hasSiblingTransform: boolean,
): boolean {
  if (labelWhen === 'always') return true;
  if (labelWhen === 'never') return false;
  return hasSiblingTransform;
}

type WalkVisitor = (
  node: SerializedComponent,
  parentNexusId: number | null,
  /** Transform under the enclosing nexus (if any). */
  nexusTransform: SerializedComponent | null,
) => void;

function walkScene(
  node: SerializedComponent,
  parentNexusId: number | null,
  visit: WalkVisitor,
): void {
  if (typeof node.type !== 'string') return;

  let nexusTransform: SerializedComponent | null = null;
  if (node.type === 'nexus' && Array.isArray(node.components)) {
    for (const child of node.components) {
      if (
        child &&
        typeof child === 'object' &&
        (child as SerializedComponent).type === 'transform'
      ) {
        nexusTransform = child as SerializedComponent;
        break;
      }
    }
  }

  // Children of a nexus see that nexus's transform; nested walks inherit via parent.
  visit(node, parentNexusId, nexusTransform);

  if (!Array.isArray(node.components)) return;

  const nextParent =
    node.type === 'nexus' && typeof node.id === 'number'
      ? node.id
      : parentNexusId;

  for (const child of node.components) {
    if (
      !child ||
      typeof child !== 'object' ||
      typeof (child as SerializedComponent).type !== 'string'
    ) {
      continue;
    }
    if (node.type === 'nexus') {
      // Pass this nexus's transform into child visits by wrapping visit.
      walkSceneWithTransform(
        child as SerializedComponent,
        nextParent,
        nexusTransform,
        visit,
      );
    } else {
      walkScene(child as SerializedComponent, nextParent, visit);
    }
  }
}

function walkSceneWithTransform(
  node: SerializedComponent,
  parentNexusId: number | null,
  inheritedTransform: SerializedComponent | null,
  visit: WalkVisitor,
): void {
  if (typeof node.type !== 'string') return;

  if (node.type === 'nexus') {
    // Nested nexus: resolve its own transform for its subtree.
    walkScene(node, parentNexusId, visit);
    return;
  }

  visit(node, parentNexusId, inheritedTransform);

  if (!Array.isArray(node.components)) return;
  for (const child of node.components) {
    if (
      child &&
      typeof child === 'object' &&
      typeof (child as SerializedComponent).type === 'string'
    ) {
      walkSceneWithTransform(
        child as SerializedComponent,
        parentNexusId,
        inheritedTransform,
        visit,
      );
    }
  }
}

/** Prefer transform id when selection is a labeled nexus / its transform. */
export function resolveTranslateSelection(
  labels: readonly ViewportLabelEntity[],
  selectedIds: readonly number[],
): {
  readonly entity: ViewportLabelEntity;
  readonly selectedId: number;
} | null {
  if (selectedIds.length === 0) return null;
  const id = selectedIds[0]!;
  for (const entity of labels) {
    if (!entity.translateEnabled) continue;
    if (entity.transformId === id || entity.nexusId === id) {
      return { entity, selectedId: id };
    }
  }
  return null;
}
