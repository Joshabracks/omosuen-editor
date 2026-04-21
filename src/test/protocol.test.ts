/**
 * Protocol codec tests.
 *
 * Every `EditorMessage` variant gets a round-trip test (requirement 5.3:
 * "Every message type has a test that encodes and decodes without loss.").
 * Decoder rejection behavior is tested alongside so malformed inputs can't
 * slip through.
 */

import {
  OMOSCENE_FORMAT_VERSION,
  defaultEditorMetadata,
} from '../omoscene/index.js';
import type { OmosceneFile } from '../omoscene/index.js';
import {
  ProtocolDecodeError,
  componentSelect,
  componentUpdate,
  decodeMessage,
  encodeMessage,
  sceneLoad,
  sceneSave,
} from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { assertDeepEqual, expectThrow, test } from './harness.js';

const sceneFixture: OmosceneFile = {
  omoscene: OMOSCENE_FORMAT_VERSION,
  engine: '0.0.0-test',
  name: 'Test Scene',
  editor: defaultEditorMetadata(),
  scene: {
    type: 'nexus',
    name: 'Root',
    id: 0,
    unique: 0,
    components: [{ type: 'transform', name: 't', id: 1 }],
  },
};

function roundTrip(msg: EditorMessage): EditorMessage {
  return decodeMessage(encodeMessage(msg));
}

export function runProtocolTests(): void {
  // --- Round-trips --------------------------------------------------------

  test('round-trip: component:select (numeric id)', () => {
    const msg = componentSelect(42);
    assertDeepEqual(roundTrip(msg), msg);
  });

  test('round-trip: component:select (null clears selection)', () => {
    const msg = componentSelect(null);
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

  test('decode rejects component:select with non-numeric non-null id', () => {
    expectThrow(
      () => decodeMessage('{"kind":"component:select","id":"one"}'),
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
}
