import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'sprite',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'textureMapKeys',
          type: 'object',
          label: 'Texture Map Keys',
        },
        { name: 'frame', type: 'object', label: 'Frame' },
        { name: 'anchor', type: 'Vector2D', label: 'Anchor' },
        { name: 'tint', type: 'Vector4D', label: 'Tint' },
        {
          name: 'opacity',
          type: 'number',
          label: 'Opacity',
          default: 1,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'showSilhouette',
          type: 'boolean',
          label: 'Show Silhouette',
          default: false,
        },
        {
          name: 'silhouetteColor',
          type: 'Vector4D',
          label: 'Silhouette Color',
        },
      ],
    },
  ],
});
