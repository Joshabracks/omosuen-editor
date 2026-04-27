/**
 * Pure helpers for `PropertySchema.componentRef` resolution.
 *
 * A `componentRef`-flagged enum field declares that its dropdown
 * options are sourced from other components in the scene tree, not
 * from a static `values` array. Example: a sprite's
 * `textureMapKeys.albedo` is `{ componentType: 'texture-map',
 * keyField: 'textureMapKey' }` — the inspector walks the scene,
 * collects every `texture-map`'s `textureMapKey` value, and uses
 * those strings as the enum's options.
 *
 * Kept DOM-free + vscode-free so the resolution can be unit-tested.
 * The inspector calls `resolveDynamicEnum(field, currentValue, file)`
 * once per field at render time.
 */

import type { PropertySchema } from '../schema/index.js';
import type { SerializedComponent } from '../omoscene/index.js';
import { getNestedProperty } from './scene-mutation.js';

/**
 * Given a `componentRef`-flagged field, scan the scene for matching
 * components and return a copy of the field with `values` populated.
 * Non-componentRef fields pass through unchanged.
 *
 * The currently-saved value is folded into the option list so a
 * stale reference (e.g. to a since-deleted texture-map) stays
 * visible until the user picks a replacement. An empty string is
 * always included so the user can clear the reference.
 */
export function resolveDynamicEnum(
  field: PropertySchema,
  currentValue: unknown,
  scene: SerializedComponent,
): PropertySchema {
  if (field.componentRef === undefined) return field;
  const collected = collectComponentRefValues(
    scene,
    field.componentRef.componentType,
    field.componentRef.keyField,
  );
  const currentStr = typeof currentValue === 'string' ? currentValue : '';
  if (currentStr !== '' && !collected.includes(currentStr)) {
    collected.push(currentStr);
    collected.sort();
  }
  const values: string[] = collected.includes('')
    ? collected
    : ['', ...collected];
  return { ...field, values };
}

/**
 * Walk a serialized scene tree, returning every string value of
 * `keyField` across components matching `componentType`. Deduped
 * and sorted; empty strings dropped (an empty key isn't a valid
 * reference target). Order is stable for deterministic rendering.
 */
export function collectComponentRefValues(
  root: SerializedComponent,
  componentType: string,
  keyField: string,
): string[] {
  const out = new Set<string>();
  walkComponents(root, (c) => {
    if (c.type !== componentType) return;
    const v = (c as Record<string, unknown>)[keyField];
    if (typeof v === 'string' && v !== '') out.add(v);
  });
  return [...out].sort();
}

function walkComponents(
  root: SerializedComponent,
  visit: (c: SerializedComponent) => void,
): void {
  visit(root);
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue;
    walkComponents(child as SerializedComponent, visit);
  }
}

/**
 * Sibling of `resolveDynamicEnum` that pulls the enum's options from
 * a field on the *same* component, rather than scanning the wider
 * scene. Used by animation-controller's `currentAnimation` to surface
 * the dropdown of names defined inside the same controller's
 * `animations` array.
 *
 * `valuesFromField.mapField` extracts a property from each array
 * item when the source is an array of objects (`{ name, ... }`).
 * Omit it when the source is already a `string[]`. Non-string and
 * empty values are skipped; the result is deduped + sorted, with an
 * empty `''` option prepended so the user can clear the selection.
 */
export function resolveSameComponentEnum(
  field: PropertySchema,
  component: SerializedComponent,
): PropertySchema {
  if (field.valuesFromField === undefined) return field;
  const raw = getNestedProperty(component, field.valuesFromField.fieldName);
  const collected = new Set<string>();
  if (Array.isArray(raw)) {
    const mapField = field.valuesFromField.mapField;
    for (const item of raw) {
      if (mapField === undefined) {
        if (typeof item === 'string' && item !== '') collected.add(item);
      } else if (typeof item === 'object' && item !== null) {
        const v = (item as Record<string, unknown>)[mapField];
        if (typeof v === 'string' && v !== '') collected.add(v);
      }
    }
  }
  return { ...field, values: ['', ...[...collected].sort()] };
}
