import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 cell-map schema; materials via cell-materials tool (6a). */
registerEditorType({
  type: 'cell-map',
  since: 'v0.1.30',
  viewport: {
    gizmos: ['overlay.grid'],
    paintModes: ['paint.cell-map'],
  },
  excludeFromInspector: [
    'materials',
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
  actions: [
    {
      id: 'edit-materials',
      label: 'Edit Materials',
      tool: 'cell-materials',
    },
    {
      id: 'paint-voxels',
      label: 'Paint Voxels',
      tool: 'cell-voxel-paint',
    },
  ],
  fields: [
    {
      name: 'cellSize',
      type: 'Vector3D',
      label: 'Cell Size',
      default: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
    },
    {
      name: 'mapSize',
      type: 'Vector3D',
      label: 'Map Size',
      default: { _vectorType: 'Vector3D', x: 8, y: 4, z: 8 },
    },
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
});
