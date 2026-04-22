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

  const nextNode: SerializedComponent = { ...node };
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
