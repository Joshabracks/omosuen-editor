import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'viewport',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'width',
          type: 'number',
          label: 'Width',
          default: 800,
          min: 1,
        },
        {
          name: 'height',
          type: 'number',
          label: 'Height',
          default: 600,
          min: 1,
        },
        { name: 'offsetX', type: 'number', label: 'Offset X', default: 0 },
        { name: 'offsetY', type: 'number', label: 'Offset Y', default: 0 },
        {
          name: 'backgroundColor',
          type: 'Vector4D',
          label: 'Background Color',
        },
      ],
      // canvas / gl / container are DOM + WebGL handles recreated in init().
      exclude: ['canvas', 'gl', 'container'],
    },
  ],
});
