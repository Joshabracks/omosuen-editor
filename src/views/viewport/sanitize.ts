/**
 * Authoring viewport keeps visual types only — no game update scripts.
 */

import type { SerializedComponent, SerializedScene } from '../../omoscene';

/** Types safe to run in the static/scrubbing authoring viewport. */
export const AUTHORING_VISUAL_TYPES = new Set([
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

// Re-export strict display allowlist (same set — kept for import stability).
export { AUTHORING_DISPLAY_TYPES } from './authoring-allowlist';

/**
 * Deep-clone a scene region, dropping non-visual / logic components so the
 * authoring viewport does not run game update scripts by default.
 */
export function sanitizeSceneForAuthoring(
  scene: SerializedScene,
): SerializedScene {
  const clone = JSON.parse(JSON.stringify(scene)) as SerializedComponent;
  return filterNode(clone) as SerializedScene;
}

function filterNode(node: SerializedComponent): SerializedComponent | null {
  if (typeof node.type !== 'string' || !AUTHORING_VISUAL_TYPES.has(node.type)) {
    return null;
  }
  if (!Array.isArray(node.components) || node.components.length === 0) {
    return node;
  }
  const nextChildren: SerializedComponent[] = [];
  for (const child of node.components) {
    if (
      !child ||
      typeof child !== 'object' ||
      typeof (child as SerializedComponent).type !== 'string'
    ) {
      continue;
    }
    const kept = filterNode(child as SerializedComponent);
    if (kept) nextChildren.push(kept);
  }
  return { ...node, components: nextChildren };
}

/** Compare scene vs loaded/project engine tags (loose: ignore leading `v`). */
export function engineVersionMismatchWarning(
  sceneEngine: string,
  loadedEngine: string,
): string | null {
  const a = normalizeEngineTag(sceneEngine);
  const b = normalizeEngineTag(loadedEngine);
  if (!a || !b || a === b) return null;
  return `Scene engine ${sceneEngine} does not match loaded engine ${loadedEngine}`;
}

export function normalizeEngineTag(tag: string): string {
  return tag.trim().replace(/^v/i, '').toLowerCase();
}
