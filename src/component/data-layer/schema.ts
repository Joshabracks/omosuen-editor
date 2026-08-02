import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 data-layer schema. */
registerEditorType({
  type: "data-layer",
  since: "v0.1.30",
  excludeFromInspector: [
    "$"
  ],
  fields: [
    {
      "name": "storage",
      "type": "map",
      "label": "Storage"
    },
    {
      "name": "typeMap",
      "type": "map",
      "label": "Type Map"
    }
  ],
});
