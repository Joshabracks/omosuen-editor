import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 viewport schema. */
registerEditorType({
  type: "viewport",
  since: "v0.1.30",
  excludeFromInspector: [
    "canvas",
    "gl",
    "container"
  ],
  fields: [
    {
      "name": "width",
      "type": "number",
      "label": "Width",
      "default": 800,
      "min": 1
    },
    {
      "name": "height",
      "type": "number",
      "label": "Height",
      "default": 600,
      "min": 1
    },
    {
      "name": "offsetX",
      "type": "number",
      "label": "Offset X",
      "default": 0
    },
    {
      "name": "offsetY",
      "type": "number",
      "label": "Offset Y",
      "default": 0
    },
    {
      "name": "backgroundColor",
      "type": "Vector4D",
      "label": "Background Color"
    }
  ],
});
