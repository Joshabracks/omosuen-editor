import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'texture-map',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'textureMapKey',
          type: 'string',
          label: 'Texture Map Key',
        },
        { name: 'filePath', type: 'string', label: 'File Path' },
        { name: 'imageType', type: 'object', label: 'Image Type' },
        {
          name: 'originalFrames',
          type: 'array',
          label: 'Original Frames',
        },
      ],
      // packedFrames/frameIndexMap are atlas-manager output populated after
      // packing; they're derived from originalFrames + atlas layout.
      exclude: ['packedFrames', 'frameIndexMap'],
    },
  ],
});
