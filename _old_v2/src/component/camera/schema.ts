import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'camera',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'zoom',
          type: 'number',
          label: 'Zoom',
          default: 1,
          min: 0.1,
          max: 10,
          step: 0.1,
        },
        {
          name: 'pixelScale',
          type: 'number',
          label: 'Pixel Scale',
          default: 2,
          min: 1,
          max: 8,
          step: 1,
        },
        {
          name: 'axonometricAngle',
          type: 'number',
          label: 'Axonometric Angle',
          default: 30,
          min: 0,
          max: 90,
          step: 1,
        },
        {
          name: 'viewportRef',
          type: 'string',
          label: 'Viewport Reference',
        },
        { name: 'zoomTarget', type: 'object', label: 'Zoom Target' },
        { name: 'revealTarget', type: 'object', label: 'Reveal Target' },
        {
          name: 'revealYOffset',
          type: 'number',
          label: 'Reveal Y Offset',
          default: 16,
        },
        {
          name: 'revealFadeHeight',
          type: 'number',
          label: 'Reveal Fade Height',
          default: 8,
        },
        {
          name: 'revealRadius',
          type: 'number',
          label: 'Reveal Radius',
          default: 256,
        },
        { name: 'revealVolume', type: 'object', label: 'Reveal Volume' },
      ],
      // glResources is a WebGL resource bundle rebuilt in init(); never a UI field.
      exclude: ['glResources'],
    },
  ],
});
