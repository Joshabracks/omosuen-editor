import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 atlas-manager schema. */
registerEditorType({
  type: "atlas-manager",
  since: "v0.1.30",
  excludeFromInspector: [
    "textureMapIds",
    "atlases",
    "compiled",
    "imageCache",
    "imageLoading"
  ],
  fields: [
    {
      "name": "config.atlasSize",
      "type": "enum",
      "label": "Atlas Size",
      "values": [
        1024,
        2048,
        4096,
        8192
      ],
      "default": 4096
    },
    {
      "name": "config.maxAtlases",
      "type": "number",
      "label": "Max Atlases",
      "min": 1,
      "max": 16,
      "step": 1,
      "default": 8
    },
    {
      "name": "config.padding",
      "type": "number",
      "label": "Padding (px)",
      "min": 0,
      "max": 4,
      "step": 1,
      "default": 1
    }
  ],
});
