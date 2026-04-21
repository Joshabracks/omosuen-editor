import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'data-layer',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'storage', type: 'map', label: 'Storage' },
        { name: 'typeMap', type: 'map', label: 'Type Map' },
      ],
      // `$` is the Proxy accessor wrapping `storage`; it's an API surface,
      // not a serialized field.
      exclude: ['$'],
    },
  ],
});
