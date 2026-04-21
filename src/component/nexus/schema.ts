import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'nexus',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'components', type: 'array', label: 'Components' },
        {
          name: 'paused',
          type: 'boolean',
          label: 'Paused',
          default: false,
        },
        { name: 'script', type: 'string', label: 'Script' },
      ],
    },
  ],
});
