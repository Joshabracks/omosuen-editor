import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'input-controller',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'bindings', type: 'array', label: 'Bindings' },
        {
          name: 'preventDefault',
          type: 'boolean',
          label: 'Prevent Default',
          default: true,
        },
      ],
      // activeInputs/actionCallbacks are runtime state, _eventHandlers holds
      // DOM listeners, target is a live EventTarget (window or custom node).
      exclude: ['activeInputs', 'actionCallbacks', '_eventHandlers', 'target'],
    },
  ],
});
