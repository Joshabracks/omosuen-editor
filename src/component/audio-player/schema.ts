import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'audio-player',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'masterVolume',
          type: 'number',
          label: 'Master Volume',
          default: 1,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'muted',
          type: 'boolean',
          label: 'Muted',
          default: false,
        },
      ],
      // Every underscore-prefixed field is runtime audio-graph state:
      // AudioContext, GainNodes, active source map, decoded buffer cache,
      // worklet blob URL, etc.
      exclude: [
        '_audioContext',
        '_masterGain',
        '_activeSources',
        '_nextSourceId',
        '_bufferCache',
        '_bufferLoading',
        '_reverbConvolver',
        '_workletBlobUrl',
      ],
    },
  ],
});
