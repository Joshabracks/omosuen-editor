/**
 * Preview-side scene sanitization (Phase 6.4 / requirement 2.1 / Q5).
 *
 * The scene-view preview is **static**: the engine renders the tree but
 * does not execute game logic. So before handing a scene to the preview
 * engine, strip components whose only purpose is runtime behavior —
 * scripts, timers, messengers, data stores, input controllers,
 * animation controllers, audio, atlas managers, flag managers. What
 * remains is the visual-only subset from requirement 2.1:
 *
 *   `nexus`, `transform`, `sprite`, `camera`, `light`, `cell-map`,
 *   `collider`, `event-collider`, `ui-overlay`
 *
 * Nexuses themselves are preserved unconditionally (they're the tree
 * scaffolding). Unknown component types are dropped by default — the
 * preview should fail closed; an engine that receives an unknown
 * component would either ignore it or blow up, and dropping is cheaper.
 *
 * Pure function, immutable: returns the same reference if nothing was
 * dropped, or a new tree that structurally shares untouched subtrees.
 * Mirrors the lazy-rebuild pattern from [scene-mutation.ts](./scene-mutation.ts).
 */

import type {
  SerializedComponent,
  SerializedScene,
} from '../omoscene/index.js';

/**
 * Component types kept in the sanitized tree. Everything else is
 * dropped. Drift from requirement 2.1 should be caught by code review;
 * the list is short enough that a constant is clearer than a schema
 * query here.
 */
const PREVIEW_VISIBLE_TYPES: ReadonlySet<string> = new Set([
  'nexus',
  'transform',
  'sprite',
  'camera',
  'light',
  'cell-map',
  'collider',
  'event-collider',
  'ui-overlay',
]);

export function sanitizeSceneForPreview(
  scene: SerializedScene,
): SerializedScene {
  const result = sanitizeNode(scene);
  if (result === scene) return scene;
  return result as SerializedScene;
}

function sanitizeNode(node: SerializedComponent): SerializedComponent {
  if (!PREVIEW_VISIBLE_TYPES.has(node.type)) {
    // Non-visual component. The caller filters these out of their
    // parent's `components` array, so `sanitizeNode` should only be
    // called on visual nodes. Fail loudly if not.
    throw new Error(
      `sanitizeNode called on non-visible type "${node.type}" (should have been filtered by parent)`,
    );
  }

  if (!Array.isArray(node.components)) {
    return node;
  }

  // Walk children: keep visible ones (recursively sanitized), drop the
  // rest. Lazy rebuild — stay on the original reference until the first
  // divergence, then back-fill.
  //
  // `Array.isArray` narrows to `any[]`; pin the type back to the
  // interface shape so per-element inference stays clean (same pattern
  // used in `scene-mutation.ts` for 3.5.6).
  const children = node.components as readonly SerializedComponent[];
  let rebuilt: SerializedComponent[] | null = null;

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (!isComponentNode(child)) {
      // Non-node entry (shouldn't happen in valid scenes). Preserve if
      // we're already rebuilding; otherwise skip detection logic.
      if (rebuilt !== null) rebuilt.push(child);
      continue;
    }

    const keep = PREVIEW_VISIBLE_TYPES.has(child.type);
    if (!keep) {
      // First drop triggers a rebuild starting from index 0.
      if (rebuilt === null) {
        rebuilt = children.slice(0, i);
      }
      continue;
    }

    const sanitizedChild = sanitizeNode(child);
    if (rebuilt !== null) {
      rebuilt.push(sanitizedChild);
    } else if (sanitizedChild !== child) {
      // Child was retained but its subtree changed — rebuild from here.
      rebuilt = children.slice(0, i);
      rebuilt.push(sanitizedChild);
    }
  }

  if (rebuilt === null) return node;

  const nextNode: SerializedComponent = { ...node };
  (nextNode as Record<string, unknown>)['components'] = rebuilt;
  return nextNode;
}

function isComponentNode(value: unknown): value is SerializedComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
