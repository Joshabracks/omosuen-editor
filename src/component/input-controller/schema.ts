import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 input-controller schema. */
registerEditorType({
  type: "input-controller",
  since: "v0.1.30",
  excludeFromInspector: [
    "activeInputs",
    "actionCallbacks",
    "_eventHandlers",
    "target"
  ],
  fields: [
    {
      "name": "bindings",
      "type": "array",
      "label": "Bindings"
    },
    {
      "name": "preventDefault",
      "type": "boolean",
      "label": "Prevent Default",
      "default": true
    }
  ],
});
