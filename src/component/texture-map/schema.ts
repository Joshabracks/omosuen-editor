import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 texture-map schema. */
registerEditorType({
  type: "texture-map",
  since: "v0.1.30",
  excludeFromInspector: [
    "imageType",
    "originalFrames",
    "packedFrames",
    "frameIndexMap"
  ],
  actions: [
    {
      "id": "omosuen.openFrameEditor",
      "label": "Open Frame Editor",
      "command": "omosuen.openFrameEditor"
    }
  ],
  fields: [
    {
      "name": "textureMapKey",
      "type": "string",
      "label": "Texture Map Key"
    },
    {
      "name": "filePath",
      "type": "string",
      "label": "File Path",
      "filePicker": {
        "extensions": [
          "png",
          "jpg",
          "jpeg",
          "gif",
          "webp",
          "bmp"
        ]
      }
    }
  ],
});
