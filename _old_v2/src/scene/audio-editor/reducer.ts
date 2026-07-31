/**
 * Pure reducer + parser for the audio-effect editor (Phase 8.4 A).
 *
 * Operates on the `mix` 10-band EQ array and a parsed
 * `AudioEffectState` view of every numeric / boolean field. DOM-free,
 * vscode-free — everything here is unit-testable under tsx.
 *
 * Mutators return new arrays / objects; callers dispatch the result
 * via `component:update` and the broker fans the change out to every
 * other panel automatically.
 */

export const EQ_BAND_COUNT = 10;

export interface AudioEffectState {
  readonly pitchShift: number;
  readonly speedShift: number;
  readonly reverb: number;
  readonly volume: number;
  readonly pan: number;
  readonly spatial: boolean;
  readonly spatialX: number;
  readonly spatialY: number;
  readonly spatialZ: number;
  readonly transitionBuffer: number;
  readonly mix: readonly number[];
}

const DEFAULTS: AudioEffectState = {
  pitchShift: 0,
  speedShift: 1,
  reverb: 0,
  volume: 1,
  pan: 0,
  spatial: false,
  spatialX: 0,
  spatialY: 0,
  spatialZ: 0,
  transitionBuffer: 150,
  mix: defaultMix(),
};

/**
 * Build the default 10-band EQ mix — every band at neutral 0 (no
 * boost, no cut). The engine treats absent / missing bands the same
 * as zero, so this is the safe initial value.
 */
export function defaultMix(): number[] {
  return new Array<number>(EQ_BAND_COUNT).fill(0);
}

/**
 * Tolerant parse of a serialized audio-effect component into the
 * editor's working state. Hand-edited scenes can have missing fields,
 * out-of-range values, or non-array `mix`; we coerce to safe values
 * rather than throw.
 */
export function parseAudioEffect(raw: unknown): AudioEffectState {
  if (typeof raw !== 'object' || raw === null) return DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    pitchShift: clampNumber(r['pitchShift'], DEFAULTS.pitchShift, -24, 24),
    speedShift: clampNumber(r['speedShift'], DEFAULTS.speedShift, 0.1, 4),
    reverb: clampNumber(r['reverb'], DEFAULTS.reverb, 0, 1),
    volume: clampNumber(r['volume'], DEFAULTS.volume, 0, 1),
    pan: clampNumber(r['pan'], DEFAULTS.pan, -1, 1),
    spatial: r['spatial'] === true,
    spatialX: clampNumber(r['spatialX'], 0, -1, 1),
    spatialY: clampNumber(r['spatialY'], 0, -1, 1),
    spatialZ: clampNumber(r['spatialZ'], 0, -1, 1),
    transitionBuffer: clampNumber(
      r['transitionBuffer'],
      DEFAULTS.transitionBuffer,
      0,
      5000,
    ),
    mix: parseMix(r['mix']),
  };
}

/**
 * Normalize the EQ mix array. Always returns exactly `EQ_BAND_COUNT`
 * entries — extra bands are dropped, missing bands fill with 0,
 * non-finite values reset to 0.
 */
export function parseMix(raw: unknown): number[] {
  const out = new Array<number>(EQ_BAND_COUNT).fill(0);
  if (!Array.isArray(raw)) return out;
  const arr = raw as readonly unknown[];
  for (let i = 0; i < EQ_BAND_COUNT && i < arr.length; i += 1) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[i] = clamp(v, -1, 1);
    }
  }
  return out;
}

/**
 * Set one band's level. Out-of-range band index → no-op (returns a
 * copy of the input so callers always get a fresh array). Value is
 * clamped to [-1, 1] to match the engine's BiquadFilter mix range.
 */
export function setEqBand(
  mix: readonly number[],
  band: number,
  value: number,
): number[] {
  const next = parseMix(mix);
  if (!Number.isInteger(band) || band < 0 || band >= EQ_BAND_COUNT) {
    return next;
  }
  if (!Number.isFinite(value)) return next;
  next[band] = clamp(value, -1, 1);
  return next;
}

function clampNumber(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return clamp(v, min, max);
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
