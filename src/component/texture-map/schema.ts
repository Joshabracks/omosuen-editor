import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 texture-map schema; frame data via texture-frame tool (5a). */
registerEditorType({
  type: 'texture-map',
  since: 'v0.1.30',
  excludeFromInspector: [
    'imageType',
    'originalFrames',
    'packedFrames',
    'frameIndexMap',
  ],
  actions: [
    {
      id: 'edit-frames',
      label: 'Edit Frames',
      tool: 'texture-frame',
    },
  ],
  fields: [
    {
      name: 'textureMapKey',
      type: 'string',
      label: 'Texture Map Key',
    },
    {
      name: 'filePath',
      type: 'string',
      label: 'File Path',
      filePicker: {
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
      },
    },
  ],
});
