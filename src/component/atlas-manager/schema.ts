import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'atlas-manager',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'textureMapIds',
          type: 'array',
          label: 'Texture Map IDs',
        },
        { name: 'config', type: 'object', label: 'Config' },
      ],
      // atlases/compiled are runtime packing output; imageCache/imageLoading
      // are in-flight HTMLImageElement handles.
      exclude: ['atlases', 'compiled', 'imageCache', 'imageLoading'],
    },
  ],
});
