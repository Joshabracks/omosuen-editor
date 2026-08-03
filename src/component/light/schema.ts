import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 light schema. */
registerEditorType({
  type: "light",
  since: "v0.1.30",
  viewport: {
    gizmos: ["gizmo.light-direction"],
  },
  fields: [
    {
      "name": "lightType",
      "type": "enum",
      "label": "Light Type",
      "values": [
        "ambient",
        "point",
        "spot",
        "directional"
      ],
      "default": "ambient"
    },
    {
      "name": "color",
      "type": "Vector3D",
      "label": "Color"
    },
    {
      "name": "brightness",
      "type": "number",
      "label": "Brightness",
      "default": 1,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "radius",
      "type": "number",
      "label": "Radius",
      "default": 100,
      "min": 0
    },
    {
      "name": "hardness",
      "type": "number",
      "label": "Hardness",
      "default": 0,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "direction",
      "type": "Vector3D",
      "label": "Direction"
    }
  ],
});
