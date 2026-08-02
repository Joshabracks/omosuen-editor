import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ProtocolDecodeError,
  ProtocolEncodeError,
  componentAdd,
  componentMove,
  componentRemove,
  componentSelect,
  componentUpdate,
  decodeMessage,
  encodeMessage,
  previewLog,
  previewPause,
  previewReady,
  previewResume,
  previewStep,
  sceneLoad,
  sceneSave,
  type EditorMessage,
  type EditorMessageKind,
} from '../protocol';
import { createEmptyOmosceneFile } from '../omoscene';

/** Every v1 core kind — keep in sync with `KNOWN_KINDS` / `EditorMessage`. */
const CORE_KINDS: readonly EditorMessageKind[] = [
  'component:update',
  'component:select',
  'component:add',
  'component:remove',
  'component:move',
  'scene:load',
  'scene:save',
  'preview:ready',
  'preview:log',
  'preview:pause',
  'preview:resume',
  'preview:step',
];

function roundTrip(msg: EditorMessage): EditorMessage {
  return decodeMessage(encodeMessage(msg));
}

const samples: Record<EditorMessageKind, EditorMessage> = {
  'component:update': componentUpdate(3, 'transform', 'opacity', 0.75),
  'component:select': componentSelect([1, 2, 3]),
  'component:add': componentAdd(0, 'sprite', {
    name: 'hero',
    props: { opacity: 1 },
  }),
  'component:remove': componentRemove(9),
  'component:move': componentMove(4, 0, 2),
  'scene:load': sceneLoad(
    createEmptyOmosceneFile({ name: 'Root', engine: '0.1.0' }),
  ),
  'scene:save': sceneSave(),
  'preview:ready': previewReady('v0.1.30'),
  'preview:log': previewLog('warn', 'missing texture'),
  'preview:pause': previewPause(),
  'preview:resume': previewResume(),
  'preview:step': previewStep(),
};

test('every core verb has a sample for round-trip coverage', () => {
  assert.deepEqual(Object.keys(samples).sort(), [...CORE_KINDS].sort());
});

for (const kind of CORE_KINDS) {
  test(`round-trip: ${kind}`, () => {
    const msg = samples[kind];
    assert.deepEqual(roundTrip(msg), msg);
  });
}

test('round-trip: component:select empty clears selection', () => {
  const msg = componentSelect([]);
  assert.deepEqual(roundTrip(msg), msg);
});

test('round-trip: component:add without optional fields', () => {
  const msg = componentAdd(1, 'transform');
  assert.deepEqual(roundTrip(msg), msg);
});

test('round-trip: component:move without index', () => {
  const msg = componentMove(5, 2);
  assert.deepEqual(roundTrip(msg), msg);
});

test('round-trip: component:update nested value', () => {
  const msg = componentUpdate(1, 'transform', 'position', [1, 2, 3]);
  assert.deepEqual(roundTrip(msg), msg);
});

test('round-trip: preview:log info and error', () => {
  assert.deepEqual(roundTrip(previewLog('info', 'ok')), previewLog('info', 'ok'));
  assert.deepEqual(
    roundTrip(previewLog('error', 'boom')),
    previewLog('error', 'boom'),
  );
});

test('decode rejects unknown kind (fail closed)', () => {
  assert.throws(
    () => decodeMessage('{"kind":"component:teleport"}'),
    (err: unknown) =>
      err instanceof ProtocolDecodeError &&
      /unknown message kind/.test(err.message),
  );
});

test('decode rejects non-JSON and non-object payloads', () => {
  assert.throws(() => decodeMessage('not json'), ProtocolDecodeError);
  assert.throws(() => decodeMessage('[1,2,3]'), ProtocolDecodeError);
  assert.throws(() => decodeMessage('"hi"'), ProtocolDecodeError);
  assert.throws(() => decodeMessage('null'), ProtocolDecodeError);
});

test('decode rejects missing kind', () => {
  assert.throws(() => decodeMessage('{"id":1}'), ProtocolDecodeError);
});

test('decode rejects malformed component:update', () => {
  assert.throws(
    () =>
      decodeMessage(
        '{"kind":"component:update","id":1,"componentType":"transform","property":"x"}',
      ),
    ProtocolDecodeError,
  );
  assert.throws(
    () =>
      decodeMessage(
        '{"kind":"component:update","id":null,"componentType":"t","property":"x","value":0}',
      ),
    ProtocolDecodeError,
  );
});

test('decode rejects malformed component:select', () => {
  assert.throws(
    () => decodeMessage('{"kind":"component:select"}'),
    ProtocolDecodeError,
  );
  assert.throws(
    () => decodeMessage('{"kind":"component:select","ids":[1,"two"]}'),
    ProtocolDecodeError,
  );
});

test('decode rejects malformed structural verbs', () => {
  assert.throws(
    () => decodeMessage('{"kind":"component:add","parentId":0}'),
    ProtocolDecodeError,
  );
  assert.throws(
    () => decodeMessage('{"kind":"component:remove"}'),
    ProtocolDecodeError,
  );
  assert.throws(
    () => decodeMessage('{"kind":"component:move","id":1}'),
    ProtocolDecodeError,
  );
});

test('decode rejects scene:load without file', () => {
  assert.throws(
    () => decodeMessage('{"kind":"scene:load"}'),
    ProtocolDecodeError,
  );
});

test('decode rejects scene:load whose file fails omoscene validation', () => {
  assert.throws(
    () =>
      decodeMessage(
        JSON.stringify({
          kind: 'scene:load',
          file: { omoscene: 1, engine: '0' },
        }),
      ),
    /valid \.omoscene/,
  );
});

test('decode rejects malformed preview messages', () => {
  assert.throws(
    () => decodeMessage('{"kind":"preview:ready"}'),
    ProtocolDecodeError,
  );
  assert.throws(
    () =>
      decodeMessage('{"kind":"preview:log","level":"debug","message":"x"}'),
    ProtocolDecodeError,
  );
});

test('encode rejects non-finite numbers in component:update.value', () => {
  assert.throws(
    () => encodeMessage(componentUpdate(1, 'transform', 'x', NaN)),
    ProtocolEncodeError,
  );
  assert.throws(
    () => encodeMessage(componentUpdate(1, 'transform', 'x', Infinity)),
    ProtocolEncodeError,
  );
  assert.throws(
    () =>
      encodeMessage(componentUpdate(1, 'transform', 'position', [0, NaN, 0])),
    ProtocolEncodeError,
  );
});
