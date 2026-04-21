import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'messenger',
  versions: [
    {
      since: 'v0.1.30',
      fields: [{ name: 'listeners', type: 'array', label: 'Listeners' }],
    },
  ],
});
