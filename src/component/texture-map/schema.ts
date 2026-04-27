import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'texture-map',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'textureMapKey', type: 'string', label: 'Texture Map Key' },
        {
          name: 'filePath',
          type: 'string',
          label: 'File Path',
          filePicker: {
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
          },
        },
      ],
      // The frame layout (single / grid / framemap) is owned by the
      // dedicated Frame Editor — leaving it as a JSON textarea here would
      // let two surfaces fight over the same field. originalFrames is
      // engine-derived from imageType; packedFrames / frameIndexMap are
      // atlas-packing output populated at runtime.
      exclude: ['imageType', 'originalFrames', 'packedFrames', 'frameIndexMap'],
      actions: [
        { label: 'Open Frame Editor', command: 'omosuen.openFrameEditor' },
      ],
    },
  ],
});
