/**
 * Tests for the Phase 8.4-A audio-editor pure helpers.
 *
 * Both modules (reducer + audio-tracks) are DOM-free + vscode-free,
 * so unit-testable under tsx. No protocol-layer assertions live
 * here — those are in protocol.test.ts.
 */

import {
  EQ_BAND_COUNT,
  defaultMix,
  parseAudioEffect,
  parseMix,
  setEqBand,
} from '../scene/audio-editor/reducer.js';
import { collectAudioTracks } from '../scene/audio-editor/audio-tracks.js';
import type { SerializedComponent } from '../omoscene/index.js';
import { assertDeepEqual, test } from './harness.js';

export function runAudioEditorTests(): void {
  // --- defaultMix --------------------------------------------------

  test('defaultMix: returns 10 zeros', () => {
    const out = defaultMix();
    if (out.length !== EQ_BAND_COUNT) {
      throw new Error(`expected ${EQ_BAND_COUNT} bands, got ${out.length}`);
    }
    if (out.some((v) => v !== 0)) {
      throw new Error(`expected all-zero, got ${JSON.stringify(out)}`);
    }
  });

  // --- parseMix ----------------------------------------------------

  test('parseMix: pads short arrays to EQ_BAND_COUNT with zeros', () => {
    const out = parseMix([0.5, -0.3]);
    assertDeepEqual(out, [0.5, -0.3, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('parseMix: truncates over-long arrays + clamps to [-1, 1]', () => {
    const out = parseMix([2, -2, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.9]);
    assertDeepEqual(out, [1, -1, 0.5, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('parseMix: non-array yields all-zero', () => {
    assertDeepEqual(parseMix(undefined), defaultMix());
    assertDeepEqual(parseMix('nope'), defaultMix());
  });

  // --- setEqBand ---------------------------------------------------

  test('setEqBand: writes the right index, returns a new array', () => {
    const start = defaultMix();
    const next = setEqBand(start, 3, 0.7);
    if (next === start) throw new Error('expected new array');
    assertDeepEqual(next[3], 0.7);
    if (next.filter((v, i) => i !== 3 && v !== 0).length > 0) {
      throw new Error('other bands mutated');
    }
  });

  test('setEqBand: out-of-range band is a no-op (returns copy)', () => {
    const start = defaultMix();
    const lo = setEqBand(start, -1, 0.5);
    const hi = setEqBand(start, EQ_BAND_COUNT, 0.5);
    assertDeepEqual(lo, start);
    assertDeepEqual(hi, start);
  });

  test('setEqBand: clamps value to [-1, 1]', () => {
    const out = setEqBand(defaultMix(), 0, 5);
    assertDeepEqual(out[0], 1);
    const out2 = setEqBand(defaultMix(), 0, -5);
    assertDeepEqual(out2[0], -1);
  });

  // --- parseAudioEffect --------------------------------------------

  test('parseAudioEffect: returns defaults for non-object input', () => {
    const s = parseAudioEffect(undefined);
    if (s.volume !== 1 || s.pitchShift !== 0 || s.spatial !== false) {
      throw new Error(`bad defaults: ${JSON.stringify(s)}`);
    }
  });

  test('parseAudioEffect: clamps spatial axes to [-1, 1]', () => {
    const s = parseAudioEffect({
      type: 'audio-effect',
      spatialX: 5,
      spatialY: -5,
      spatialZ: 'huh',
    });
    if (s.spatialX !== 1 || s.spatialY !== -1 || s.spatialZ !== 0) {
      throw new Error(`bad spatial clamp: ${JSON.stringify(s)}`);
    }
  });

  test('parseAudioEffect: pulls a populated mix array', () => {
    const s = parseAudioEffect({
      type: 'audio-effect',
      mix: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.5],
    });
    assertDeepEqual(s.mix, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.5]);
  });

  test('parseAudioEffect: clamps pitch / speed to engine ranges', () => {
    const s = parseAudioEffect({
      type: 'audio-effect',
      pitchShift: 99,
      speedShift: 100,
      transitionBuffer: 999999,
    });
    if (s.pitchShift !== 24) throw new Error(`pitch: ${s.pitchShift}`);
    if (s.speedShift !== 4) throw new Error(`speed: ${s.speedShift}`);
    if (s.transitionBuffer !== 5000) {
      throw new Error(`buffer: ${s.transitionBuffer}`);
    }
  });

  // --- collectAudioTracks ------------------------------------------

  test('collectAudioTracks: walks tree, returns sorted by name', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        {
          type: 'audio-track',
          name: 'zebra',
          id: 1,
          filePath: 'audio/zebra.ogg',
        },
        {
          type: 'nexus',
          name: 'group',
          id: 2,
          components: [
            {
              type: 'audio-track',
              name: 'alpha',
              id: 3,
              filePath: 'audio/alpha.ogg',
            },
          ],
        },
      ],
    } as unknown as SerializedComponent;
    const out = collectAudioTracks(scene);
    if (out.length !== 2) throw new Error(`expected 2, got ${out.length}`);
    if (out[0]!.name !== 'alpha' || out[1]!.name !== 'zebra') {
      throw new Error(`bad sort: ${JSON.stringify(out)}`);
    }
    if (out[0]!.id !== 3 || out[1]!.id !== 1) {
      throw new Error(`ids lost: ${JSON.stringify(out)}`);
    }
  });

  test('collectAudioTracks: keeps tracks with empty filePath (UI shows placeholder)', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [
        { type: 'audio-track', name: 'a', id: 1, filePath: '' },
        { type: 'audio-track', name: 'b', id: 2, filePath: 'audio/b.wav' },
      ],
    } as unknown as SerializedComponent;
    const out = collectAudioTracks(scene);
    if (out.length !== 2)
      throw new Error(`expected 2 entries, got ${out.length}`);
    if (out[0]!.filePath !== '' || out[1]!.filePath !== 'audio/b.wav') {
      throw new Error(`filePath data wrong: ${JSON.stringify(out)}`);
    }
  });

  test('collectAudioTracks: empty scene yields empty array', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [],
    } as unknown as SerializedComponent;
    assertDeepEqual(collectAudioTracks(scene), []);
  });

  test('collectAudioTracks: synthesizes name when missing', () => {
    const scene: SerializedComponent = {
      type: 'nexus',
      name: 'Root',
      id: 0,
      components: [{ type: 'audio-track', id: 7, filePath: 'a.wav' }],
    } as unknown as SerializedComponent;
    const out = collectAudioTracks(scene);
    if (out[0]!.name !== '(track #7)') {
      throw new Error(`bad fallback name: ${out[0]!.name}`);
    }
  });
}
