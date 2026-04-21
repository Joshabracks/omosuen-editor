import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'flag-manager',
  versions: [
    {
      since: 'v0.1.30',
      fields: [{ name: 'flags', type: 'array', label: 'Flags' }],
    },
  ],
});
