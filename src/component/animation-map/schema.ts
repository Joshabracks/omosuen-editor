import { registerEditorType } from '../../editor-api';

/** Built-in contribution — animation clip map (tool-owned animations). */
registerEditorType({
  type: 'animation-map',
  since: 'v0.1.30',
  uniqueness: 'NAME',
  excludeFromInspector: ['animations'],
  actions: [
    {
      id: 'edit-animations',
      label: 'Edit Animations',
      tool: 'animation-timeline',
    },
  ],
  fields: [
    { name: 'animationMapKey', type: 'string', label: 'Animation Map Key' },
  ],
});
