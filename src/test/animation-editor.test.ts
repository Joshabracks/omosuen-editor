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
  moveFrame,
  parseAnimations,
  removeAnimation,
  removeFrameAt,
  renameAnimation,
  serializeAnimations,
  setFrameRate,
  setLoop,
  type AnimationEntry,
} from '../scene/animation-editor/reducer.js';
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
}
