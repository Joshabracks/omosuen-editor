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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FUTURE OPTIMIZATION — component-id index (deferred from Phase 3.5.7):
 *
 * Every `component:update` dispatch walks the full scene tree to locate
 * `(componentType, id)`. At realistic Phase-5-and-earlier scene sizes
 * that's cheap. At Phase 6 gizmo-drag time — say a 10k-component scene
 * with 60 fps updates — it works out to ~600k node visits/sec.
 *
 * The planned fix is an `id → node-path` index held alongside the store:
 *   - Built once when `scene:load` hydrates the document.
 *   - Invalidated / patched on structural mutations (`component:add` /
 *     `component:remove` / `nexus:reparent` — verbs planned in 3.5.8).
 *   - Consumed by `applyComponentUpdate` for O(depth) path-descent
 *     instead of the current O(N) tree-walk.
 *
 * Not implemented yet: property-update walks are not the bottleneck until
 * Phase 6, and shipping the index without the structural verbs that also
 * need it would require re-designing invalidation once those verbs land.
 * Full design note: `.design/05-implementation-plan.md` → "Deferred
 * optimizations → Component-id lookup index".
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  OmosceneFile,
  SerializedComponent,
  SerializedScene,
} from '../omoscene/index.js';
import { isRecord } from '../util/guards.js';

function isSerializedComponent(value: unknown): value is SerializedComponent {
  return isRecord(value) && typeof value['type'] === 'string';
}

// =====================================================================
// Nested-path helpers — let `applyComponentUpdate` and
// `buildDefaultComponent` work with dotted-path field names like
// `config.atlasSize`. The inspector renders such fields as independent
// rows but the on-disk shape stays nested ({ config: { atlasSize } }).
// =====================================================================

/**
 * Read a value from `obj` by dot-separated path. Returns `undefined`
 * if any intermediate segment is missing or non-object. Used by the
 * inspector's renderField + editVector reads.
 */
export function getNestedProperty(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const segments = path.split('.');
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Set a value at `path` in `obj` immutably — every layer along the
 * path is shallow-cloned, untouched siblings stay reference-shared.
 * Creates empty `{}` for missing or non-object intermediates so a
 * dotted write can land in a brand-new component.
 */
function setNestedImmutable(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.');
  if (segments.length === 1) {
    return { ...obj, [segments[0]!]: value };
  }
  const [head, ...rest] = segments;
  const headKey = head!;
  const existing = obj[headKey];
  const childObj: Record<string, unknown> =
    existing !== null &&
    typeof existing === 'object' &&
    !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return {
    ...obj,
    [headKey]: setNestedImmutable(childObj, rest.join('.'), value),
  };
}

/**
 * Mutating sibling of `setNestedImmutable` for callers that own a
 * fresh draft object (e.g. `buildDefaultComponent`). Walks `path`,
 * lazy-creating empty objects for missing intermediates, and assigns
 * the leaf. Caller must guarantee `obj` is not aliased elsewhere.
 */
export function setNestedMutating(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.');
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const next = cursor[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[key] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[segments[segments.length - 1]!] = value;
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
  node: SerializedComponent,
  id: number,
  componentType: string,
  property: string,
  value: unknown,
): SerializedComponent {
  const matches = node.type === componentType && node.id === id;

  // Recurse into children first so a match higher in the tree still gets
  // its children visited (a component can match and have children, e.g. a
  // nexus updating a metadata field while still holding nested components).
  //
  // Lazy rebuild: `rebuilt` stays null until the first divergence is
  // found, at which point we back-fill the preceding unchanged children
  // and start pushing subsequent ones. No-match walks therefore allocate
  // zero per-node arrays.
  let rebuilt: SerializedComponent[] | null = null;
  if (Array.isArray(node.components)) {
    // `Array.isArray` narrows to `any[]`; pin the type back to the
    // interface-declared shape so per-element inference stays clean.
    const children = node.components as readonly SerializedComponent[];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child === undefined) continue;
      const updated = isSerializedComponent(child)
        ? updateNode(child, id, componentType, property, value)
        : child;
      if (rebuilt !== null) {
        rebuilt.push(updated);
      } else if (updated !== child) {
        // First divergence: back-fill preceding unchanged children.
        rebuilt = children.slice(0, i);
        rebuilt.push(updated);
      }
    }
  }

  const childrenChanged = rebuilt !== null;
  const nextChildren: readonly SerializedComponent[] | undefined =
    rebuilt ?? node.components;

  if (!matches && !childrenChanged) {
    return node;
  }

  let nextNode: SerializedComponent = { ...node };
  if (matches) {
    // `property` may be a dotted path (e.g. `config.atlasSize`). The
    // immutable nested setter shallow-clones every layer along the path
    // and leaves untouched siblings reference-shared, matching the
    // wider lazy-rebuild discipline of this module.
    nextNode = setNestedImmutable(
      nextNode as unknown as Record<string, unknown>,
      property,
      value,
    ) as SerializedComponent;
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

/**
 * Append `newComponent` under the nexus with `parentId`. Immutable;
 * returns the same `OmosceneFile` reference if the parent is not
 * found or isn't a nexus.
 *
 * Post-8 gap-fill: used by the scene-tree "+" button / `omosuen
 * .addChildComponent` command path.
 */
export function insertChildComponent(
  file: OmosceneFile,
  parentId: number,
  newComponent: SerializedComponent,
): OmosceneFile {
  const { scene, changed } = insertUnderNexus(
    file.scene,
    parentId,
    newComponent,
  );
  if (!changed) return file;
  // Root is always a nexus (SerializedScene constrains type: 'nexus').
  // The tree walk preserves the root's type since the root itself is
  // never replaced — only its descendants.
  return { ...file, scene: scene as SerializedScene };
}

function insertUnderNexus(
  node: SerializedComponent,
  parentId: number,
  newComponent: SerializedComponent,
): { scene: SerializedComponent; changed: boolean } {
  if (node.type === 'nexus' && node.id === parentId) {
    const existing: readonly SerializedComponent[] = Array.isArray(
      node.components,
    )
      ? (node.components as readonly SerializedComponent[])
      : [];
    const nextChildren = [...existing, newComponent];
    const nextNode: SerializedComponent = { ...node };
    (nextNode as Record<string, unknown>)['components'] = nextChildren;
    return { scene: nextNode, changed: true };
  }

  if (!Array.isArray(node.components)) {
    return { scene: node, changed: false };
  }

  const children = node.components as readonly SerializedComponent[];
  let rebuilt: SerializedComponent[] | null = null;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isSerializedComponent(child)) {
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }
    const result = insertUnderNexus(child, parentId, newComponent);
    if (rebuilt !== null) {
      rebuilt.push(result.scene);
    } else if (result.changed) {
      rebuilt = children.slice(0, i);
      rebuilt.push(result.scene);
    }
  }
  if (rebuilt === null) return { scene: node, changed: false };
  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>)['components'] = rebuilt;
  return { scene: nextNode, changed: true };
}

/**
 * Walk the tree and return `max(id) + 1`. Used to allocate ids for
 * newly-inserted components without carrying a counter alongside the
 * scene. Returns `1` for an empty or untyped root.
 */
export function nextComponentId(file: OmosceneFile): number {
  const max = findMaxId(file.scene, -1);
  return max < 0 ? 1 : max + 1;
}

function findMaxId(node: SerializedComponent, current: number): number {
  let m = current;
  if (typeof node.id === 'number' && Number.isFinite(node.id) && node.id > m) {
    m = node.id;
  }
  if (Array.isArray(node.components)) {
    const children = node.components as readonly SerializedComponent[];
    for (const child of children) {
      if (isSerializedComponent(child)) m = findMaxId(child, m);
    }
  }
  return m;
}

// =====================================================================
// Scene-tree UX polish (2026-04-22): move / remove / reparent helpers.
// All three are pure, immutable, return the input ref on no-op, mirror
// `insertChildComponent`'s structural-sharing style.
// =====================================================================

export type MoveDirection = 'up' | 'down';

/**
 * Swap `componentId` with its immediately-prior (`up`) or -following
 * (`down`) sibling. No-op (returns input ref) when the component is
 * not found, is the root, or is already at the boundary in the given
 * direction.
 */
export function moveComponent(
  file: OmosceneFile,
  componentId: number,
  direction: MoveDirection,
): OmosceneFile {
  const { scene, changed } = moveInTree(file.scene, componentId, direction);
  if (!changed) return file;
  return { ...file, scene: scene as SerializedScene };
}

function moveInTree(
  node: SerializedComponent,
  componentId: number,
  direction: MoveDirection,
): { scene: SerializedComponent; changed: boolean } {
  if (!Array.isArray(node.components)) {
    return { scene: node, changed: false };
  }
  const children = node.components as readonly SerializedComponent[];

  // Is the target a direct child here? If so, swap within this parent.
  const index = children.findIndex(
    (c) => isSerializedComponent(c) && c.id === componentId,
  );
  if (index !== -1) {
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= children.length) {
      return { scene: node, changed: false };
    }
    const nextChildren = [...children];
    const a = nextChildren[index]!;
    const b = nextChildren[swapWith]!;
    nextChildren[index] = b;
    nextChildren[swapWith] = a;
    const nextNode: SerializedComponent = { ...node };
    (nextNode as Record<string, unknown>)['components'] = nextChildren;
    return { scene: nextNode, changed: true };
  }

  // Otherwise descend.
  let rebuilt: SerializedComponent[] | null = null;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isSerializedComponent(child)) {
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }
    const result = moveInTree(child, componentId, direction);
    if (rebuilt !== null) {
      rebuilt.push(result.scene);
    } else if (result.changed) {
      rebuilt = children.slice(0, i);
      rebuilt.push(result.scene);
    }
  }
  if (rebuilt === null) return { scene: node, changed: false };
  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>)['components'] = rebuilt;
  return { scene: nextNode, changed: true };
}

/**
 * Delete `componentId` from its parent's `components` array. The
 * removed node and its entire subtree are dropped. No-op when the
 * component is the root, not found, or its parent's `components` array
 * is missing.
 */
export function removeComponent(
  file: OmosceneFile,
  componentId: number,
): OmosceneFile {
  if (file.scene.id === componentId) return file; // can't remove root
  const { scene, changed } = removeInTree(file.scene, componentId);
  if (!changed) return file;
  return { ...file, scene: scene as SerializedScene };
}

function removeInTree(
  node: SerializedComponent,
  componentId: number,
): { scene: SerializedComponent; changed: boolean } {
  if (!Array.isArray(node.components)) {
    return { scene: node, changed: false };
  }
  const children = node.components as readonly SerializedComponent[];

  const index = children.findIndex(
    (c) => isSerializedComponent(c) && c.id === componentId,
  );
  if (index !== -1) {
    const nextChildren = [
      ...children.slice(0, index),
      ...children.slice(index + 1),
    ];
    const nextNode: SerializedComponent = { ...node };
    (nextNode as Record<string, unknown>)['components'] = nextChildren;
    return { scene: nextNode, changed: true };
  }

  let rebuilt: SerializedComponent[] | null = null;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isSerializedComponent(child)) {
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }
    const result = removeInTree(child, componentId);
    if (rebuilt !== null) {
      rebuilt.push(result.scene);
    } else if (result.changed) {
      rebuilt = children.slice(0, i);
      rebuilt.push(result.scene);
    }
  }
  if (rebuilt === null) return { scene: node, changed: false };
  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>)['components'] = rebuilt;
  return { scene: nextNode, changed: true };
}

/**
 * Move `componentId` (with its entire subtree) to become a new child
 * of `newParentId`. No-op (returns input ref) when:
 *   - `componentId` is the root.
 *   - either id is not found.
 *   - `newParentId` is not a nexus.
 *   - `newParentId` is already the component's current parent.
 *   - `newParentId` equals `componentId` or is one of its descendants
 *     (would create a cycle).
 */
export function reparentComponent(
  file: OmosceneFile,
  componentId: number,
  newParentId: number,
): OmosceneFile {
  if (componentId === newParentId) return file;
  if (file.scene.id === componentId) return file;

  const source = findNode(file.scene, componentId);
  if (source === null) return file;

  const target = findNode(file.scene, newParentId);
  if (target === null) return file;
  if (target.type !== 'nexus') return file;

  // Cycle check: newParentId must not be anywhere in source's subtree.
  if (findNode(source, newParentId) !== null) return file;

  // Already a direct child → no-op.
  const targetChildren = Array.isArray(target.components)
    ? (target.components as readonly SerializedComponent[])
    : [];
  if (
    targetChildren.some((c) => isSerializedComponent(c) && c.id === componentId)
  ) {
    return file;
  }

  // Remove then insert.
  const withoutSource = removeInTree(file.scene, componentId);
  if (!withoutSource.changed) return file;
  const withInsert = insertUnderNexus(withoutSource.scene, newParentId, source);
  if (!withInsert.changed) return file;
  return { ...file, scene: withInsert.scene as SerializedScene };
}

function findNode(
  node: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (node.id === id) return node;
  if (!Array.isArray(node.components)) return null;
  const children = node.components as readonly SerializedComponent[];
  for (const child of children) {
    if (!isSerializedComponent(child)) continue;
    const hit = findNode(child, id);
    if (hit !== null) return hit;
  }
  return null;
}
