/**
 * Protocol codec tests.
 *
 * Every `EditorMessage` variant gets a round-trip test (requirement 5.3:
 * "Every message type has a test that encodes and decodes without loss.").
 * Decoder rejection behavior is tested alongside so malformed inputs can't
 * slip through.
 */

import {
  ProtocolDecodeError,
  ProtocolEncodeError,
  audioTracks,
  commandInvoke,
  componentSelect,
  componentUpdate,
  decodeMessage,
  encodeMessage,
  imageLoaded,
  messengerSend,
  previewLog,
  previewReady,
  sceneLoad,
  sceneSave,
} from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { makeScene } from './fixtures.js';
import { assertDeepEqual, expectThrow, test } from './harness.js';

// Minimal scene with one transform — just enough to exercise `scene:load`
// round-trip through the protocol decoder (which delegates to omoscene's
// validator). The specific component set doesn't matter for codec tests.
const sceneFixture = makeScene({
  scene: {
    type: 'nexus',
    name: 'Root',
    id: 0,
    unique: 0,
    components: [{ type: 'transform', name: 't', id: 1 }],
  },
});

function roundTrip(msg: EditorMessage): EditorMessage {
  return decodeMessage(encodeMessage(msg));
}

export function runProtocolTests(): void {
  // --- Round-trips --------------------------------------------------------

  test('round-trip: component:select (single id)', () => {
    const msg = componentSelect([42]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:select (multi-select)', () => {
    const msg = componentSelect([1, 2, 3]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:select (empty clears selection)', () => {
    const msg = componentSelect([]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:update (number value)', () => {
    const msg = componentUpdate(3, 'transform', 'opacity', 0.75);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:update (Vector3D value)', () => {
    const msg = componentUpdate(1, 'transform', 'position', [1, 2, 3]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:update (string value)', () => {
    const msg = componentUpdate(5, 'sprite', 'textureMapKeys', 'atlas/key');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:update (null value)', () => {
    const msg = componentUpdate(9, 'audio-player', 'masterVolume', null);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: scene:load (full OmosceneFile)', () => {
    const msg = sceneLoad(sceneFixture);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: scene:save', () => {
    const msg = sceneSave();
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: preview:ready', () => {
    const msg = previewReady('v0.1.30');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: preview:log (info)', () => {
    const msg = previewLog('info', 'frame rendered');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: preview:log (warn)', () => {
    const msg = previewLog('warn', 'missing texture');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: preview:log (error)', () => {
    const msg = previewLog('error', 'boom');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: command:invoke (no args)', () => {
    const msg = commandInvoke('omosuen.newProject');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: command:invoke (single component-id arg)', () => {
    const msg = commandInvoke('omosuen.openAnimationEditor', [42]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: command:invoke (heterogeneous args)', () => {
    const msg = commandInvoke('omosuen.someFuture', [
      42,
      'scene.omoscene',
      true,
      null,
    ]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: image:loaded (data URI)', () => {
    const msg = imageLoaded(
      'data:image/png;base64,iVBORw0KGgo=',
      'assets/hero.png',
    );
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: image:loaded (null dataUri = load failed)', () => {
    const msg = imageLoaded(null, 'assets/missing.png');
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: audio:tracks (populated)', () => {
    const msg = audioTracks([
      {
        id: 1,
        name: 'bgm',
        filePath: 'audio/bgm.ogg',
        uri: 'https://w.example/audio/bgm.ogg',
      },
      { id: 2, name: 'sfx-jump', filePath: 'audio/jump.wav', uri: null },
    ]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: audio:tracks (empty)', () => {
    const msg = audioTracks([]);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: messenger:send (object payload)', () => {
    const msg = messengerSend('audio-effect:set', {
      field: 'volume',
      value: 0.75,
    });
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: messenger:send (null payload)', () => {
    const msg = messengerSend('transport:tick', null);
    assertDeepEqual(roundTrip(msg), msg);
  });

  // --- Decoder rejections -------------------------------------------------

  test('decode rejects non-JSON text', () => {
    expectThrow(() => decodeMessage('not json'), 'ProtocolDecodeError');
  });

  test('decode rejects JSON that is not an object', () => {
    expectThrow(() => decodeMessage('[1,2,3]'), 'ProtocolDecodeError');
    expectThrow(() => decodeMessage('"hi"'), 'ProtocolDecodeError');
    expectThrow(() => decodeMessage('null'), 'ProtocolDecodeError');
  });

  test('decode rejects missing kind field', () => {
    expectThrow(() => decodeMessage('{"id":1}'), 'ProtocolDecodeError');
  });

  test('decode rejects unknown kind', () => {
    expectThrow(
      () => decodeMessage('{"kind":"component:teleport"}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects component:select without ids array', () => {
    expectThrow(
      () => decodeMessage('{"kind":"component:select"}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"component:select","ids":null}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"component:select","ids":42}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects component:select ids containing non-number', () => {
    expectThrow(
      () => decodeMessage('{"kind":"component:select","ids":[1,"two",3]}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"component:select","ids":[null]}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects component:update missing value field', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"component:update","id":1,"componentType":"transform","property":"x"}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects component:update with non-finite id', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"component:update","id":null,"componentType":"transform","property":"x","value":0}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects component:update with empty componentType', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"component:update","id":1,"componentType":"","property":"x","value":0}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects component:update with empty property name', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"component:update","id":1,"componentType":"transform","property":"","value":0}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects scene:load without file field', () => {
    expectThrow(
      () => decodeMessage('{"kind":"scene:load"}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects scene:load whose file fails omoscene validation', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"scene:load","file":{"omoscene":1,"engine":"0"}}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects preview:ready without string engineVersion', () => {
    expectThrow(
      () => decodeMessage('{"kind":"preview:ready"}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"preview:ready","engineVersion":null}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects preview:log with unknown level', () => {
    expectThrow(
      () =>
        decodeMessage('{"kind":"preview:log","level":"debug","message":"x"}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects preview:log without string message', () => {
    expectThrow(
      () => decodeMessage('{"kind":"preview:log","level":"info"}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects command:invoke with empty command', () => {
    expectThrow(
      () => decodeMessage('{"kind":"command:invoke","command":"","args":[]}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects command:invoke without args array', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"command:invoke","command":"omosuen.openAnimationEditor"}',
        ),
      'ProtocolDecodeError',
    );
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"command:invoke","command":"omosuen.openAnimationEditor","args":42}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('encode rejects command:invoke with non-finite arg', () => {
    expectThrow(
      () => encodeMessage(commandInvoke('omosuen.x', [NaN])),
      'ProtocolEncodeError',
    );
  });

  test('decode rejects image:loaded with wrong dataUri type', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"image:loaded","dataUri":42,"sourceFilePath":"a.png"}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects image:loaded missing sourceFilePath', () => {
    expectThrow(
      () => decodeMessage('{"kind":"image:loaded","dataUri":null}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects audio:tracks without tracks array', () => {
    expectThrow(
      () => decodeMessage('{"kind":"audio:tracks"}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"audio:tracks","tracks":null}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects messenger:send missing pattern', () => {
    expectThrow(
      () => decodeMessage('{"kind":"messenger:send","data":null}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"messenger:send","pattern":"","data":null}'),
      'ProtocolDecodeError',
    );
    expectThrow(
      () => decodeMessage('{"kind":"messenger:send","pattern":42,"data":null}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects messenger:send missing data field', () => {
    expectThrow(
      () => decodeMessage('{"kind":"messenger:send","pattern":"x"}'),
      'ProtocolDecodeError',
    );
  });

  test('decode rejects audio:tracks track entry missing fields', () => {
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"audio:tracks","tracks":[{"id":1,"name":"x","filePath":"a"}]}',
        ),
      'ProtocolDecodeError',
    );
    expectThrow(
      () =>
        decodeMessage(
          '{"kind":"audio:tracks","tracks":[{"id":"not-a-number","name":"x","filePath":"a","uri":null}]}',
        ),
      'ProtocolDecodeError',
    );
  });

  test('ProtocolDecodeError is the error name', () => {
    try {
      decodeMessage('nope');
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof ProtocolDecodeError)) {
        throw new Error(`expected ProtocolDecodeError, got ${String(err)}`);
      }
    }
  });

  // --- Encoder rejections (3.5.12) ---------------------------------------

  test('encode rejects NaN in component:update.value', () => {
    expectThrow(
      () => encodeMessage(componentUpdate(1, 'transform', 'x', NaN)),
      'ProtocolEncodeError',
    );
  });

  test('encode rejects Infinity in component:update.value', () => {
    expectThrow(
      () => encodeMessage(componentUpdate(1, 'transform', 'x', Infinity)),
      'ProtocolEncodeError',
    );
    expectThrow(
      () => encodeMessage(componentUpdate(1, 'transform', 'x', -Infinity)),
      'ProtocolEncodeError',
    );
  });

  test('encode rejects nested non-finite number in component:update.value', () => {
    expectThrow(
      () =>
        encodeMessage(componentUpdate(1, 'transform', 'position', [0, NaN, 0])),
      'ProtocolEncodeError',
    );
    expectThrow(
      () =>
        encodeMessage(
          componentUpdate(1, 'sprite', 'tint', { r: 1, g: Infinity, b: 0 }),
        ),
      'ProtocolEncodeError',
    );
  });

  test('ProtocolEncodeError is the error name', () => {
    try {
      encodeMessage(componentUpdate(1, 'transform', 'x', NaN));
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof ProtocolEncodeError)) {
        throw new Error(`expected ProtocolEncodeError, got ${String(err)}`);
      }
    }
  });
}
