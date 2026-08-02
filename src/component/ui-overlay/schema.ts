import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 ui-overlay schema. */
registerEditorType({
  type: "ui-overlay",
  since: "v0.1.30",
  excludeFromInspector: [
    "element",
    "container",
    "_htmlConstructed"
  ],
  fields: [
    {
      "name": "bindings",
      "type": "array",
      "label": "Bindings"
    },
    {
      "name": "cssOverrides",
      "type": "object",
      "label": "CSS Overrides"
    },
    {
      "name": "previousOverlayId",
      "type": "number",
      "label": "Previous Overlay ID"
    },
    {
      "name": "showOverride",
      "type": "string",
      "label": "Show Override"
    },
    {
      "name": "hideOverride",
      "type": "string",
      "label": "Hide Override"
    },
    {
      "name": "htmlConstructorKey",
      "type": "string",
      "label": "HTML Constructor Key"
    }
  ],
});
