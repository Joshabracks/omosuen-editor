import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 cell-map schema. */
registerEditorType({
  type: "cell-map",
  since: "v0.1.30",
  viewport: {
    gizmos: ["overlay.grid"],
    paintModes: ["paint.cell-map"],
  },
  excludeFromInspector: [
    "materialMap",
    "shapeMap",
    "meshes",
    "emissionMap",
    "visibilityMap",
    "packedData",
    "needsGPUUpdate",
    "chunks",
    "chunkGridSize",
    "smoothingWeights"
  ],
  fields: [
    {
      "name": "materials",
      "type": "array",
      "label": "Materials"
    },
    {
      "name": "cellSize",
      "type": "Vector3D",
      "label": "Cell Size"
    },
    {
      "name": "mapSize",
      "type": "Vector3D",
      "label": "Map Size"
    },
    {
      "name": "smoothing",
      "type": "number",
      "label": "Smoothing Iterations",
      "default": 0,
      "min": 0
    },
    {
      "name": "normalSmoothing",
      "type": "number",
      "label": "Normal Smoothing",
      "default": 0,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "revealExempt",
      "type": "boolean",
      "label": "Exempt from Reveal",
      "default": false
    }
  ],
});
