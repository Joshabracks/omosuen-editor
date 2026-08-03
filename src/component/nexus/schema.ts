import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 nexus schema. */
registerEditorType({
  type: "nexus",
  since: "v0.1.30",
  viewport: {
    labelWhen: "has-sibling-transform",
  },
  fields: [
    {
      "name": "components",
      "type": "array",
      "label": "Components"
    },
    {
      "name": "paused",
      "type": "boolean",
      "label": "Paused",
      "default": false
    },
    {
      "name": "script",
      "type": "string",
      "label": "Script"
    }
  ],
});
