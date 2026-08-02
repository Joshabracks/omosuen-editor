import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 flag-manager schema. */
registerEditorType({
  type: "flag-manager",
  since: "v0.1.30",
  fields: [
    {
      "name": "flags",
      "type": "array",
      "label": "Flags"
    }
  ],
});
