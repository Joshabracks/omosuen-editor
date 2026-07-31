import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'event-collider',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'shape',
          type: 'enum',
          label: 'Shape',
          values: ['box', 'sphere'],
          default: 'box',
        },
        { name: 'size', type: 'Vector3D', label: 'Size' },
        {
          name: 'radius',
          type: 'number',
          label: 'Radius',
          default: 0.5,
          min: 0,
        },
        { name: 'offset', type: 'Vector3D', label: 'Offset' },
      ],
      // triggers + onEnter/onExit/while are runtime overlap state and
      // callback slots populated during updates, never user-authored.
      exclude: ['triggers', 'onEnter', 'onExit', 'while'],
    },
  ],
});
