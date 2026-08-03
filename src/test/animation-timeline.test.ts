import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SerializedComponent } from '../omoscene';
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
} from '../scene/animation-timeline/reducer';
import { resolveTextureContext } from '../scene/animation-timeline/texture-context';

function fixture(): AnimationEntry[] {
  return [
    { name: 'idle', frames: [0, 1, 2], frameRate: 12, loop: true },
    { name: 'walk', frames: [3, 4, 5, 6], frameRate: 10, loop: true },
  ];
}

test('parseAnimations: empty / malformed inputs produce empty array', () => {
  assert.deepEqual(parseAnimations(undefined), []);
  assert.deepEqual(parseAnimations(null), []);
  assert.deepEqual(parseAnimations({}), []);
  assert.deepEqual(parseAnimations('not-an-array'), []);
});

test('parseAnimations: drops entries without a string name', () => {
  const parsed = parseAnimations([
    { frames: [0], frameRate: 10 },
    { name: 'ok', frames: [1], frameRate: 10, loop: false },
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.name, 'ok');
});

test('parseAnimations: coerces bad frames and preserves onComplete', () => {
  const parsed = parseAnimations([
    {
      name: 'a',
      frames: [1, 'x', 2, -1, null, 3],
      frameRate: 15,
      loop: true,
      onComplete: 'done',
    },
    { name: 'b', frames: [], frameRate: 12, loop: false, onComplete: '' },
  ]);
  assert.deepEqual(parsed[0]!.frames, [1, 2, 3]);
  assert.equal(parsed[0]!.onComplete, 'done');
  assert.equal(parsed[1]!.onComplete, undefined);
});

test('addAnimation / rename / remove', () => {
  const added = addAnimation(fixture(), 'run');
  assert.equal(added.length, 3);
  assert.deepEqual(added[2], {
    name: 'run',
    frames: [],
    frameRate: 12,
    loop: false,
  });
  assert.equal(addAnimation(fixture(), 'idle').length, 2);
  assert.equal(renameAnimation(fixture(), 'walk', 'stroll')[1]!.name, 'stroll');
  assert.equal(removeAnimation(fixture(), 'idle').length, 1);
});

test('setFrameRate / setLoop / frame ops / serialize round-trip', () => {
  assert.equal(setFrameRate(fixture(), 'idle', 24)[0]!.frameRate, 24);
  assert.equal(setLoop(fixture(), 'idle', false)[0]!.loop, false);
  assert.deepEqual(appendFrame(fixture(), 'idle', 7)[0]!.frames, [0, 1, 2, 7]);
  assert.deepEqual(removeFrameAt(fixture(), 'idle', 1)[0]!.frames, [0, 2]);
  assert.deepEqual(moveFrame(fixture(), 'walk', 0, 2)[1]!.frames, [4, 5, 3, 6]);
  assert.deepEqual(insertFrame(fixture(), 'walk', 1, 99)[1]!.frames, [
    3, 99, 4, 5, 6,
  ]);
  const start = fixture();
  assert.deepEqual(parseAnimations(serializeAnimations(start)), start);
});

test('setOnComplete sets and strips', () => {
  assert.equal(
    setOnComplete(fixture(), 'walk', 'onWalkDone')[1]!.onComplete,
    'onWalkDone',
  );
  const withCb: AnimationEntry[] = [
    {
      name: 'walk',
      frames: [0],
      frameRate: 12,
      loop: true,
      onComplete: 'foo',
    },
  ];
  assert.equal('onComplete' in setOnComplete(withCb, 'walk', '')[0]!, false);
});

function makeControllerScene(): SerializedComponent {
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
  };
}

test('resolveTextureContext: controller finds sibling sprite + texture-map', () => {
  const ctx = resolveTextureContext(makeControllerScene(), 3);
  assert.ok(ctx);
  assert.equal(ctx!.spriteName, 'spr');
  assert.equal(ctx!.textureMapKey, 'hero');
  assert.equal(ctx!.filePath, 'assets/hero.png');
  assert.equal(ctx!.frames.length, 16);
});

test('resolveTextureContext: null without sibling sprite', () => {
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
  };
  assert.equal(resolveTextureContext(scene, 3), null);
});

test('resolveTextureContext: animation-map matches textureMapKey', () => {
  const scene: SerializedComponent = {
    type: 'nexus',
    name: 'Root',
    id: 0,
    components: [
      {
        type: 'texture-map',
        name: 'tm',
        id: 1,
        textureMapKey: 'clips',
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
        type: 'animation-map',
        name: 'am',
        id: 2,
        animationMapKey: 'clips',
        animations: [],
      },
    ],
  };
  const ctx = resolveTextureContext(scene, 2);
  assert.ok(ctx);
  assert.equal(ctx!.textureMapKey, 'clips');
  assert.deepEqual(ctx!.frames, [
    { x: 0, y: 0, w: 16, h: 16 },
    { x: 16, y: 0, w: 16, h: 16 },
  ]);
});
