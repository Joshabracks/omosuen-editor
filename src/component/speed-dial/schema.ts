import { registerEditorType } from '../../editor-api';

/**
 * Built-in contribution — speed-dial (quick action / radial menu style).
 * Field list is a v1 floor; refine when engine allowlist is available in CI.
 */
registerEditorType({
  type: 'speed-dial',
  since: 'v0.1.30',
  fields: [
    { name: 'dialKey', type: 'string', label: 'Dial Key' },
    {
      name: 'items',
      type: 'list',
      label: 'Items',
      list: { itemType: 'string' },
    },
    {
      name: 'radius',
      type: 'number',
      label: 'Radius',
      default: 80,
      min: 0,
    },
  ],
});
