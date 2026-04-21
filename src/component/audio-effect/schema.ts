import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'audio-effect',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'pitchShift',
          type: 'number',
          label: 'Pitch Shift (semitones)',
          default: 0,
          step: 1,
        },
        {
          name: 'speedShift',
          type: 'number',
          label: 'Speed',
          default: 1,
          min: 0,
          step: 0.1,
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
        { name: 'mix', type: 'array', label: 'EQ Mix' },
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
          name: 'spatialX',
          type: 'number',
          label: 'Spatial X',
          default: 0,
        },
        {
          name: 'spatialY',
          type: 'number',
          label: 'Spatial Y',
          default: 0,
        },
        {
          name: 'spatialZ',
          type: 'number',
          label: 'Spatial Z',
          default: 0,
        },
        {
          name: 'transitionBuffer',
          type: 'number',
          label: 'Transition Buffer (ms)',
          default: 150,
          min: 0,
        },
      ],
    },
  ],
});
