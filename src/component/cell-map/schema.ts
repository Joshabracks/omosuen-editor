import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'cell-map',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'materials', type: 'array', label: 'Materials' },
        { name: 'cellSize', type: 'Vector3D', label: 'Cell Size' },
        { name: 'mapSize', type: 'Vector3D', label: 'Map Size' },
        {
          name: 'smoothing',
          type: 'number',
          label: 'Smoothing Iterations',
          default: 0,
          min: 0,
        },
        {
          name: 'normalSmoothing',
          type: 'number',
          label: 'Normal Smoothing',
          default: 0,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'revealExempt',
          type: 'boolean',
          label: 'Exempt from Reveal',
          default: false,
        },
      ],
      // The remaining allowlist entries are runtime mesh/chunk caches,
      // compressed storage, and bit-packed smoothing weights — all derived
      // from materials + mapSize at build time or mutated by GPU sync.
      exclude: [
        'materialMap',
        'shapeMap',
        'meshes',
        'emissionMap',
        'visibilityMap',
        'packedData',
        'needsGPUUpdate',
        'chunks',
        'chunkGridSize',
        'smoothingWeights',
      ],
    },
  ],
});
