/**
 * Tests for `sanitizeSceneForPreview` (Phase 6.4).
 *
 * Covers: the allowlist, drop-through of nested non-visual components,
 * unchanged-tree identity preservation, and structural sharing of
 * untouched subtrees.
 */

import { sanitizeSceneForPreview } from '../app/scene-sanitization.js';
import type {
  SerializedComponent,
  SerializedScene,
} from '../omoscene/index.js';
import { assertDeepEqual, test } from './harness.js';

function makeScene(components: SerializedComponent[]): SerializedScene {
  return {
    type: 'nexus',
    name: 'Root',
    id: 0,
    unique: 0,
    components,
  };
}

export function runSceneSanitizationTests(): void {
  test('sanitize: all-visible scene returns same reference', () => {
    const scene = makeScene([
      { type: 'transform', id: 1, position: [0, 0, 0] },
      { type: 'sprite', id: 2, opacity: 1 },
    ]);
    const out = sanitizeSceneForPreview(scene);
    if (out !== scene) {
      throw new Error('all-visible scenes should return the same reference');
    }
  });

  test('sanitize: drops top-level logic components', () => {
    const scene = makeScene([
      { type: 'transform', id: 1, position: [0, 0, 0] },
      { type: 'timer', id: 2, duration: 5 },
      { type: 'messenger', id: 3, listeners: [] },
      { type: 'flag-manager', id: 4, flags: [] },
      { type: 'data-layer', id: 5, storage: {} },
      { type: 'sprite', id: 6, opacity: 1 },
    ]);
    const out = sanitizeSceneForPreview(scene);
    const components = out.components as readonly {
      type: string;
      id: number;
    }[];
    if (components.length !== 2) {
      throw new Error(`expected 2 components, got ${components.length}`);
    }
    assertDeepEqual(
      components.map((c) => c.type),
      ['transform', 'sprite'],
    );
  });

  test('sanitize: drops animation/input/audio/atlas components', () => {
    const scene = makeScene([
      { type: 'animation-controller', id: 1 },
      { type: 'input-controller', id: 2 },
      { type: 'audio-player', id: 3 },
      { type: 'audio-track', id: 4 },
      { type: 'audio-effect', id: 5 },
      { type: 'atlas-manager', id: 6 },
      { type: 'transform', id: 7 },
    ]);
    const out = sanitizeSceneForPreview(scene);
    const remaining = (out.components as readonly { type: string }[]).map(
      (c) => c.type,
    );
    assertDeepEqual(remaining, ['transform']);
  });

  test('sanitize: keeps camera/light/cell-map/collider/event-collider/ui-overlay', () => {
    // Every entry of the visual allowlist (minus nexus) should survive.
    const visible: SerializedComponent[] = [
      { type: 'transform', id: 1 },
      { type: 'sprite', id: 2 },
      { type: 'camera', id: 3 },
      { type: 'light', id: 4 },
      { type: 'cell-map', id: 5 },
      { type: 'collider', id: 6 },
      { type: 'event-collider', id: 7 },
      { type: 'ui-overlay', id: 8 },
    ];
    const scene = makeScene(visible);
    const out = sanitizeSceneForPreview(scene);
    if (out !== scene) {
      throw new Error('all-allowlist scenes should be unchanged');
    }
  });

  test('sanitize: drops unknown component types (fail closed)', () => {
    const scene = makeScene([
      { type: 'transform', id: 1 },
      { type: 'unknown-future-thing', id: 2 },
    ]);
    const out = sanitizeSceneForPreview(scene);
    const types = (out.components as readonly { type: string }[]).map(
      (c) => c.type,
    );
    assertDeepEqual(types, ['transform']);
  });

  test('sanitize: recurses through nested nexuses', () => {
    const scene = makeScene([
      {
        type: 'nexus',
        name: 'Child',
        id: 1,
        unique: 1,
        components: [
          { type: 'transform', id: 2, position: [1, 1, 1] },
          { type: 'timer', id: 3, duration: 1 }, // dropped
          { type: 'flag-manager', id: 4 }, // dropped
          { type: 'camera', id: 5 }, // kept
        ],
      },
    ]);
    const out = sanitizeSceneForPreview(scene);
    const childComponents = (
      (out.components as readonly SerializedComponent[])[0]
        ?.components as readonly { type: string; id: number }[]
    ).map((c) => ({ type: c.type, id: c.id }));
    assertDeepEqual(childComponents, [
      { type: 'transform', id: 2 },
      { type: 'camera', id: 5 },
    ]);
  });

  test('sanitize: untouched subtree references are preserved (structural sharing)', () => {
    const untouchedBranch: SerializedComponent = {
      type: 'nexus',
      name: 'Clean',
      id: 1,
      unique: 1,
      components: [
        { type: 'transform', id: 2 },
        { type: 'sprite', id: 3 },
      ],
    };
    const dirtyBranch: SerializedComponent = {
      type: 'nexus',
      name: 'Dirty',
      id: 4,
      unique: 2,
      components: [
        { type: 'transform', id: 5 },
        { type: 'timer', id: 6 }, // will be dropped
      ],
    };
    const scene = makeScene([untouchedBranch, dirtyBranch]);
    const out = sanitizeSceneForPreview(scene);

    const outChildren = out.components as readonly SerializedComponent[];
    // The untouched branch should be the same reference. The dirty
    // branch should be a new reference because its children array
    // needed rebuilding.
    if (outChildren[0] !== untouchedBranch) {
      throw new Error(
        'untouched branch should be structurally shared (same reference)',
      );
    }
    if (outChildren[1] === dirtyBranch) {
      throw new Error('dirty branch should be a new reference');
    }
  });
}
