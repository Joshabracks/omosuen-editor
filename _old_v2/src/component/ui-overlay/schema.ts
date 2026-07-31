import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'ui-overlay',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'bindings', type: 'array', label: 'Bindings' },
        { name: 'cssOverrides', type: 'object', label: 'CSS Overrides' },
        {
          name: 'previousOverlayId',
          type: 'number',
          label: 'Previous Overlay ID',
        },
        { name: 'showOverride', type: 'string', label: 'Show Override' },
        { name: 'hideOverride', type: 'string', label: 'Hide Override' },
        {
          name: 'htmlConstructorKey',
          type: 'string',
          label: 'HTML Constructor Key',
        },
      ],
      // element/container are DOM refs, _htmlConstructed is a first-time-init flag.
      exclude: ['element', 'container', '_htmlConstructed'],
    },
  ],
});
