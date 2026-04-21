/**
 * Global schema registry. Per-component schema modules call
 * `registerComponentSchemas()` at import time; consumers look schemas up
 * via `getComponentSchemas()` or enumerate with `listRegisteredComponents()`.
 */

import type { ComponentSchemas } from './types.js';
import { compareVersions } from './version.js';

const registry = new Map<string, ComponentSchemas>();

/**
 * Register the full set of versioned schemas for a component type.
 *
 * Validates:
 *   - At least one version.
 *   - `versions` are sorted ascending by `since`.
 *   - No two versions share the same `since`.
 *   - The component type has not already been registered.
 *
 * Called once per component at module-import time from
 * `src/component/{name}/schema.ts`.
 */
export function registerComponentSchemas(entry: ComponentSchemas): void {
  if (registry.has(entry.componentType)) {
    throw new Error(
      `schema registry: duplicate registration for component "${entry.componentType}"`,
    );
  }
  if (entry.versions.length === 0) {
    throw new Error(
      `schema registry: component "${entry.componentType}" registered with empty versions list`,
    );
  }
  for (let i = 1; i < entry.versions.length; i += 1) {
    const prevVersion = entry.versions[i - 1];
    const curVersion = entry.versions[i];
    if (!prevVersion || !curVersion) continue;
    const prev = prevVersion.since;
    const cur = curVersion.since;
    const cmp = compareVersions(prev, cur);
    if (cmp === 0) {
      throw new Error(
        `schema registry: component "${entry.componentType}" has duplicate version "${cur}"`,
      );
    }
    if (cmp > 0) {
      throw new Error(
        `schema registry: component "${entry.componentType}" versions must be sorted ascending by \`since\` (got "${prev}" before "${cur}")`,
      );
    }
  }
  registry.set(entry.componentType, entry);
}

/**
 * Look up all versioned schemas for a component type.
 * Returns null if the component has not been registered.
 */
export function getComponentSchemas(
  componentType: string,
): ComponentSchemas | null {
  return registry.get(componentType) ?? null;
}

/**
 * Enumerate every currently-registered component type.
 * Used by the drift test to iterate the registry.
 */
export function listRegisteredComponents(): string[] {
  return Array.from(registry.keys()).sort();
}
