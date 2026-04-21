/**
 * Pure scene-tree helpers. Kept separate from `dispatch.ts` so the mutation
 * logic is testable in isolation — the tree walk is the bit most prone to
 * subtle bugs (nested nexuses, deeply nested components) and deserves its
 * own unit tests.
 *
 * The tree structure exploited here is the engine's serialization format:
 * a root nexus whose `components` array contains child components, each of
 * which may itself be a nexus with its own `components` array.
 *
 * `id` is the engine's unique identifier across the tree. The scene region
 * is "opaque" to the extension host in the sense that per-component field
 * shapes are not introspected — but the *tree structure* (type, id,
 * components[]) is common across all component types and is fair game for
 * the editor to traverse.
 */

import type { OmosceneFile, SerializedScene } from '../omoscene/index.js';

interface ComponentNode {
  readonly type: string;
  readonly id?: number;
  readonly components?: readonly ComponentNode[];
  readonly [key: string]: unknown;
}

function isComponentNode(value: unknown): value is ComponentNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const typed = value as { type?: unknown };
  return typeof typed.type === 'string';
}

/**
 * Walk the scene tree and produce a new tree with the matching component's
 * `property` set to `value`. Immutable: structurally shares unmodified
 * subtrees, and returns the same root reference if nothing matched.
 *
 * Returns `{ scene, changed }` so callers can skip notifications when
 * nothing was updated (e.g. mutation target didn't exist).
 */
export function updateComponentProperty(
  root: SerializedScene,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): { scene: SerializedScene; changed: boolean } {
  const result = updateNode(root, id, componentType, property, value);
  if (result === root) {
    return { scene: root, changed: false };
  }
  return { scene: result as SerializedScene, changed: true };
}

function updateNode(
  node: ComponentNode,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): ComponentNode {
  const matches = node.type === componentType && node.id === id;

  // Recurse into children first so a match higher in the tree still gets
  // its children visited (a component can match and have children, e.g. a
  // nexus updating a metadata field while still holding nested components).
  let nextChildren: readonly ComponentNode[] | undefined = node.components;
  if (Array.isArray(node.components)) {
    let childChanged = false;
    const rebuilt: ComponentNode[] = [];
    for (const child of node.components) {
      if (!isComponentNode(child)) {
        rebuilt.push(child);
        continue;
      }
      const updated = updateNode(child, id, componentType, property, value);
      if (updated !== child) childChanged = true;
      rebuilt.push(updated);
    }
    if (childChanged) {
      nextChildren = rebuilt;
    }
  }

  const childrenChanged = nextChildren !== node.components;

  if (!matches && !childrenChanged) {
    return node;
  }

  const nextNode: ComponentNode = { ...node };
  if (matches) {
    (nextNode as Record<string, unknown>)[property] = value;
  }
  if (childrenChanged) {
    (nextNode as Record<string, unknown>)['components'] = nextChildren;
  }
  return nextNode;
}

/**
 * Return a new `OmosceneFile` with its scene region updated, or the input
 * unchanged if no matching component was found.
 */
export function applyComponentUpdate(
  file: OmosceneFile,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): OmosceneFile {
  const { scene, changed } = updateComponentProperty(
    file.scene,
    id,
    componentType,
    property,
    value,
  );
  if (!changed) return file;
  return { ...file, scene };
}
