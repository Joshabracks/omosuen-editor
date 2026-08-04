/**
 * Strict allowlist + override nulling for the authoring display scene.
 */

import type { SerializedComponent } from '../../omoscene';

/** Types mirrored into the live authoring engine graph. */
export const AUTHORING_DISPLAY_TYPES = new Set([
  'atlas-manager',
  'texture-map',
  'cell-map',
  'transform',
  'nexus',
  'sprite',
  'light',
  'animation-map',
  'viewport',
]);

/** Lapis-sin blue from Omosuen logo (`#1E3A8A`). */
export const LAPIS_SIN_HEX = '#1E3A8A';
export const LAPIS_SIN_RGBA = {
  r: 30 / 255,
  g: 58 / 255,
  b: 138 / 255,
  a: 1,
} as const;

const OVERRIDE_KEYS = [
  'overrideKey',
  'initOverride',
  'updateOverride',
  'script',
] as const;

export function isAuthoringDisplayType(type: string): boolean {
  return AUTHORING_DISPLAY_TYPES.has(type);
}

/**
 * Deep-clone a serialized node with override/script keys nulled.
 * Does not strip engine-required fields (packedData, materials, …).
 */
export function nullOverrides(
  node: SerializedComponent,
): SerializedComponent {
  const clone = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
  for (const key of OVERRIDE_KEYS) {
    if (key in clone) clone[key] = null;
  }
  if (Array.isArray(clone.components)) {
    clone.components = (clone.components as SerializedComponent[]).map(
      (child) => nullOverrides(child),
    );
  }
  return clone as SerializedComponent;
}

/** Clone a leaf for deserialize — children stripped, overrides nulled. */
export function prepareLeafForDeserialize(
  node: SerializedComponent,
): SerializedComponent {
  const clone = nullOverrides(node) as Record<string, unknown>;
  delete clone.components;
  return clone as SerializedComponent;
}

/**
 * True when a document nexus should be mirrored (has keepable children
 * after dropping cameras / disallowed types). Hollow camera nexuses that
 * only retain a transform (or nothing) are skipped.
 */
export function nexusHasDisplayChildren(node: SerializedComponent): boolean {
  if (!Array.isArray(node.components)) return false;
  let hasNonTransform = false;
  for (const child of node.components) {
    if (!child || typeof child !== 'object') continue;
    const type = (child as SerializedComponent).type;
    if (typeof type !== 'string') continue;
    if (type === 'camera') continue;
    if (type === 'viewport') continue; // authoring injects its own
    if (!isAuthoringDisplayType(type)) continue;
    if (type === 'nexus') {
      if (nexusHasDisplayChildren(child as SerializedComponent)) {
        return true;
      }
      continue;
    }
    if (type !== 'transform') {
      hasNonTransform = true;
    }
  }
  return hasNonTransform;
}
