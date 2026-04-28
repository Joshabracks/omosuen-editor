import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'audio-effect',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          // Range matches the engine's pitch-shift worklet, which
          // accepts ±2 octaves (24 semitones) before clipping. Step
          // 0.1 lets the user dial in cents-level adjustments.
          name: 'pitchShift',
          type: 'number',
          label: 'Pitch Shift (semitones)',
          default: 0,
          min: -24,
          max: 24,
          step: 0.1,
        },
        {
          // Engine clamps below 0.1× (worklet would underflow) and
          // above 4× (CPU cost climbs sharply). Step 0.01 matches
          // `_old` so the UI feels familiar.
          name: 'speedShift',
          type: 'number',
          label: 'Speed',
          default: 1,
          min: 0.1,
          max: 4,
          step: 0.01,
        },
        {
          name: 'reverb',
          type: 'number',
          label: 'Reverb',
          default: 0,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'volume',
          type: 'number',
          label: 'Volume',
          default: 1,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'pan',
          type: 'number',
          label: 'Pan',
          default: 0,
          min: -1,
          max: 1,
          step: 0.01,
        },
        {
          name: 'spatial',
          type: 'boolean',
          label: 'Spatial',
          default: false,
        },
        {
          // Engine's PannerNode HRTF expects normalized [-1, 1]
          // coordinates; out-of-range values silently clamp inside
          // the engine, so the inspector enforces the same range.
          name: 'spatialX',
          type: 'number',
          label: 'Spatial X',
          default: 0,
          min: -1,
          max: 1,
          step: 0.01,
        },
        {
          name: 'spatialY',
          type: 'number',
          label: 'Spatial Y',
          default: 0,
          min: -1,
          max: 1,
          step: 0.01,
        },
        {
          name: 'spatialZ',
          type: 'number',
          label: 'Spatial Z',
          default: 0,
          min: -1,
          max: 1,
          step: 0.01,
        },
        {
          name: 'transitionBuffer',
          type: 'number',
          label: 'Transition Buffer (ms)',
          default: 150,
          min: 0,
          max: 5000,
          step: 25,
        },
      ],
      // `mix` (10-band EQ array) is owned by the dedicated audio
      // editor — surfacing it as a JSON textarea in the inspector
      // would let two surfaces fight over the same field.
      exclude: ['mix'],
      actions: [
        {
          label: 'Open Audio Editor',
          command: 'omosuen.openAudioEditor',
        },
      ],
    },
  ],
});
