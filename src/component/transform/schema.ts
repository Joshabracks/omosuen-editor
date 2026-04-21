import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'transform',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'position', type: 'Vector3D', label: 'Position' },
        { name: 'rotation', type: 'Vector3D', label: 'Rotation' },
        { name: 'scale', type: 'Vector3D', label: 'Scale' },
      ],
    },
  ],
});
