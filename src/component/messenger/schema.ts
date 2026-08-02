import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 messenger schema. */
registerEditorType({
  type: "messenger",
  since: "v0.1.30",
  fields: [
    {
      "name": "listeners",
      "type": "array",
      "label": "Listeners"
    }
  ],
});
