import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 collider schema. */
registerEditorType({
  type: "collider",
  since: "v0.1.30",
  fields: [
    {
      "name": "shape",
      "type": "enum",
      "label": "Shape",
      "values": [
        "box",
        "sphere"
      ],
      "default": "box"
    },
    {
      "name": "size",
      "type": "Vector3D",
      "label": "Size"
    },
    {
      "name": "radius",
      "type": "number",
      "label": "Radius",
      "default": 0.5,
      "min": 0
    },
    {
      "name": "offset",
      "type": "Vector3D",
      "label": "Offset"
    }
  ],
});
