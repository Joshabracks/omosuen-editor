/**
 * Tests for the Phase 8.2 animation-editor reducer.
 *
 * The reducer is DOM-free + vscode-free, so every mutation is unit-
 * testable under tsx. Invariants under test:
 *   - every mutation returns a NEW array (reference inequality).
 *   - out-of-range / no-op mutations return a structurally-equal copy.
 *   - parseAnimations tolerates malformed scenes.
 */

import {
  addAnimation,
  appendFrame,
  insertFrame,
  moveFrame,
  parseAnimations,
  removeAnimation,
  removeFrameAt,
  renameAnimation,
  serializeAnimations,
  setFrameRate,
  setLoop,
  setOnComplete,
  type AnimationEntry,
} from '../scene/animation-editor/reducer.js';
import { resolveTextureContext } from '../scene/animation-editor/texture-context.js';
import type { SerializedComponent } from '../omoscene/index.js';
import { assertDeepEqual, test } from './harness.js';

function fixture(): AnimationEntry[] {
  return [
    { name: 'idle', frames: [0, 1, 2], frameRate: 12, loop: true },
    { name: 'walk', frames: [3, 4, 5, 6], frameRate: 10, loop: true },
  ];
}

export function runAnimationEditorTests(): void {
  // --- parseAnimations ---------------------------------------------------

  test('parseAnimations: empty / malformed inputs produce empty array', () => {
    assertDeepEqual(parseAnimations(undefined), []);
    assertDeepEqual(parseAnimations(null), []);
    assertDeepEqual(parseAnimations({}), []);
    assertDeepEqual(parseAnimations('not-an-array'), []);
  });

  test('parseAnimations: drops entries without a string name', () => {
    const raw = [
      { frames: [0], frameRate: 10 },
      { name: 'ok', frames: [1], frameRate: 10, loop: false },
    ];
    const parsed = parseAnimations(raw);
    if (parsed.length !== 1 || parsed[0]!.name !== 'ok') {
      throw new Error(`got: ${JSON.stringify(parsed)}`);
    }
  });

  test('parseAnimations: coerces bad frames to a filtered number array', () => {
    const parsed = parseAnimations([
      {
        name: 'a',
        frames: [1, 'x', 2, -1, null, 3],
        frameRate: 15,
        loop: true,
      },
    ]);
    assertDeepEqual(parsed[0]!.frames, [1, 2, 3]);
  });

  test('parseAnimations: preserves onComplete when a non-empty string', () => {
    const parsed = parseAnimations([
      { name: 'a', frames: [], frameRate: 12, loop: false, onComplete: 'done' },
      { name: 'b', frames: [], frameRate: 12, loop: false, onComplete: '' },
    ]);
    if (parsed[0]!.onComplete !== 'done') throw new Error('onComplete lost');
    if (parsed[1]!.onComplete !== undefined) {
      throw new Error('empty onComplete should be dropped');
    }
  });

  // --- addAnimation ------------------------------------------------------

  test('addAnimation: appends with defaults', () => {
    const next = addAnimation(fixture(), 'run');
    if (next.length !== 3) throw new Error('expected 3 entries');
    const added = next[2]!;
    assertDeepEqual(added, {
      name: 'run',
      frames: [],
      frameRate: 12,
      loop: false,
    });
  });

  test('addAnimation: rejects empty or whitespace name', () => {
    const start = fixture();
    const next = addAnimation(start, '   ');
    if (next === start) throw new Error('must return new array even on no-op');
    if (next.length !== start.length) throw new Error('length changed');
  });

  test('addAnimation: rejects duplicate name', () => {
    const next = addAnimation(fixture(), 'idle');
    if (next.length !== 2) throw new Error('duplicate should not append');
  });

  // --- renameAnimation ---------------------------------------------------

  test('renameAnimation: updates matching entry', () => {
    const next = renameAnimation(fixture(), 'walk', 'stroll');
    if (next[1]!.name !== 'stroll') throw new Error('rename failed');
  });

  test('renameAnimation: no-ops on duplicate target', () => {
    const next = renameAnimation(fixture(), 'walk', 'idle');
    if (next[1]!.name !== 'walk') throw new Error('duplicate should no-op');
  });

  // --- removeAnimation ---------------------------------------------------

  test('removeAnimation: drops matching entry', () => {
    const next = removeAnimation(fixture(), 'idle');
    if (next.length !== 1 || next[0]!.name !== 'walk') {
      throw new Error('wrong entry removed');
    }
  });

  // --- setFrameRate / setLoop -------------------------------------------

  test('setFrameRate: updates on positive finite, otherwise no-ops', () => {
    const next = setFrameRate(fixture(), 'idle', 24);
    if (next[0]!.frameRate !== 24) throw new Error('frameRate not set');
    const bad = setFrameRate(fixture(), 'idle', 0);
    if (bad[0]!.frameRate !== 12) throw new Error('non-positive should no-op');
  });

  test('setLoop: flips only the matching entry', () => {
    const next = setLoop(fixture(), 'idle', false);
    if (next[0]!.loop !== false) throw new Error('loop not changed');
    if (next[1]!.loop !== true) throw new Error('other entry mutated');
  });

  // --- frame ops ---------------------------------------------------------

  test('appendFrame: pushes a frame index onto the named animation', () => {
    const next = appendFrame(fixture(), 'idle', 7);
    assertDeepEqual(next[0]!.frames, [0, 1, 2, 7]);
  });

  test('appendFrame: rejects non-finite or negative index', () => {
    const next = appendFrame(fixture(), 'idle', -1);
    assertDeepEqual(next[0]!.frames, [0, 1, 2]);
    const nan = appendFrame(fixture(), 'idle', Number.NaN);
    assertDeepEqual(nan[0]!.frames, [0, 1, 2]);
  });

  test('removeFrameAt: removes by position', () => {
    const next = removeFrameAt(fixture(), 'idle', 1);
    assertDeepEqual(next[0]!.frames, [0, 2]);
  });

  test('removeFrameAt: out-of-range no-ops', () => {
    const next = removeFrameAt(fixture(), 'idle', 10);
    assertDeepEqual(next[0]!.frames, [0, 1, 2]);
  });

  test('moveFrame: reorders within the named animation', () => {
    const next = moveFrame(fixture(), 'walk', 0, 2);
    assertDeepEqual(next[1]!.frames, [4, 5, 3, 6]);
  });

  test('moveFrame: no-ops on same index or out-of-range', () => {
    const same = moveFrame(fixture(), 'walk', 1, 1);
    assertDeepEqual(same[1]!.frames, [3, 4, 5, 6]);
    const oor = moveFrame(fixture(), 'walk', 5, 0);
    assertDeepEqual(oor[1]!.frames, [3, 4, 5, 6]);
  });

  // --- serializeAnimations -----------------------------------------------

  test('serializeAnimations: round-trips through parse', () => {
    const start = fixture();
    const reparsed = parseAnimations(serializeAnimations(start));
    assertDeepEqual(reparsed, start);
  });

  test('serializeAnimations: omits undefined onComplete', () => {
    const out = serializeAnimations(fixture());
    for (const entry of out) {
      if (Object.prototype.hasOwnProperty.call(entry, 'onComplete')) {
        throw new Error('undefined onComplete should not be serialized');
      }
    }
  });

  // --- insertFrame -------------------------------------------------------

  test('insertFrame: inserts at the given position', () => {
    const out = insertFrame(fixture(), 'walk', 1, 99);
    assertDeepEqual(out[1]!.frames, [3, 99, 4, 5, 6]);
  });

  test('insertFrame: position 0 inserts at the start', () => {
    const out = insertFrame(fixture(), 'walk', 0, 99);
    assertDeepEqual(out[1]!.frames, [99, 3, 4, 5, 6]);
  });

  test('insertFrame: past-end position appends', () => {
    const out = insertFrame(fixture(), 'walk', 99, 7);
    assertDeepEqual(out[1]!.frames, [3, 4, 5, 6, 7]);
  });

  test('insertFrame: negative frameIndex is rejected', () => {
    const start = fixture();
    const out = insertFrame(start, 'walk', 0, -1);
    assertDeepEqual(out[1]!.frames, [3, 4, 5, 6]);
  });

  test('insertFrame: empty animation supports insertion', () => {
    const empty: AnimationEntry[] = [
      { name: 'a', frames: [], frameRate: 12, loop: true },
    ];
    assertDeepEqual(insertFrame(empty, 'a', 0, 5)[0]!.frames, [5]);
  });

  // --- setOnComplete -----------------------------------------------------

  test('setOnComplete: sets the callback name', () => {
    const out = setOnComplete(fixture(), 'walk', 'onWalkDone');
    if (out[1]!.onComplete !== 'onWalkDone') {
      throw new Error(`got: ${String(out[1]!.onComplete)}`);
    }
  });

  test('setOnComplete: empty string strips the field', () => {
    const withCb: AnimationEntry[] = [
      {
        name: 'walk',
        frames: [0],
        frameRate: 12,
        loop: true,
        onComplete: 'foo',
      },
    ];
    const out = setOnComplete(withCb, 'walk', '');
    if ('onComplete' in out[0]!) {
      throw new Error('onComplete should be stripped on empty input');
    }
  });

  test('setOnComplete: trims whitespace', () => {
    const out = setOnComplete(fixture(), 'walk', '  onDone  ');
    if (out[1]!.onComplete !== 'onDone') {
      throw new Error(`got: ${String(out[1]!.onComplete)}`);
    }
  });

  // --- resolveTextureContext --------------------------------------------

  function makeScene(): SerializedComponent {
    return {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        {
          type: 'texture-map',
          name: 'tm-hero',
          id: 1,
          textureMapKey: 'hero',
          filePath: 'assets/hero.png',
          imageType: {
            mode: 'grid',
            cellWidth: 32,
            cellHeight: 32,
            cols: 4,
            rows: 4,
          },
        },
        {
          type: 'nexus',
          name: 'group',
          id: 2,
          components: [
            {
              type: 'animation-controller',
              name: 'ac',
              id: 3,
              animations: [],
            },
            {
              type: 'sprite',
              name: 'spr',
              id: 4,
              textureMapKeys: { albedo: 'hero' },
            },
          ],
        },
      ],
    } as unknown as SerializedComponent;
  }

  test('resolveTextureContext: finds sibling sprite + matching texture-map', () => {
    const ctx = resolveTextureContext(makeScene(), 3);
    if (ctx === null) throw new Error('expected non-null context');
    if (ctx.spriteName !== 'spr') {
      throw new Error(`spriteName: ${String(ctx.spriteName)}`);
    }
    if (ctx.textureMapKey !== 'hero') {
      throw new Error(`textureMapKey: ${ctx.textureMapKey}`);
    }
    if (ctx.filePath !== 'assets/hero.png') {
      throw new Error(`filePath: ${ctx.filePath}`);
    }
    if (ctx.frames.length !== 16) {
      throw new Error(
        `expected 16 frames (4x4 grid), got ${ctx.frames.length}`,
      );
    }
  });

  test('resolveTextureContext: returns null when no sibling sprite', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        {
          type: 'animation-controller',
          name: 'ac',
          id: 3,
          animations: [],
        },
      ],
    } as unknown as SerializedComponent;
    if (resolveTextureContext(scene, 3) !== null) {
      throw new Error('expected null for orphaned animation-controller');
    }
  });

  test('resolveTextureContext: returns null when sprite has no albedo key', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        {
          type: 'nexus',
          name: 'group',
          id: 2,
          components: [
            {
              type: 'animation-controller',
              name: 'ac',
              id: 3,
              animations: [],
            },
            {
              type: 'sprite',
              name: 'spr',
              id: 4,
              textureMapKeys: {},
            },
          ],
        },
      ],
    } as unknown as SerializedComponent;
    if (resolveTextureContext(scene, 3) !== null) {
      throw new Error('expected null when albedo key is empty');
    }
  });

  test('resolveTextureContext: returns null when no matching texture-map', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        {
          type: 'nexus',
          name: 'group',
          id: 2,
          components: [
            {
              type: 'animation-controller',
              name: 'ac',
              id: 3,
              animations: [],
            },
            {
              type: 'sprite',
              name: 'spr',
              id: 4,
              textureMapKeys: { albedo: 'ghost' },
            },
          ],
        },
      ],
    } as unknown as SerializedComponent;
    if (resolveTextureContext(scene, 3) !== null) {
      throw new Error('expected null when no texture-map matches the key');
    }
  });

  test('resolveTextureContext: framemap mode passes frame rects through', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        {
          type: 'texture-map',
          name: 'tm',
          id: 1,
          textureMapKey: 'hero',
          filePath: 'a.png',
          imageType: {
            mode: 'framemap',
            frames: [
              { x: 0, y: 0, w: 16, h: 16 },
              { x: 16, y: 0, w: 16, h: 16 },
            ],
          },
        },
        {
          type: 'animation-controller',
          name: 'ac',
          id: 2,
          animations: [],
        },
        {
          type: 'sprite',
          name: 'spr',
          id: 3,
          textureMapKeys: { albedo: 'hero' },
        },
      ],
    } as unknown as SerializedComponent;
    const ctx = resolveTextureContext(scene, 2);
    if (ctx === null) throw new Error('expected non-null context');
    assertDeepEqual(ctx.frames, [
      { x: 0, y: 0, w: 16, h: 16 },
      { x: 16, y: 0, w: 16, h: 16 },
    ]);
  });
}
