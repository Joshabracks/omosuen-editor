import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 transform schema. */
registerEditorType({
  type: "transform",
  since: "v0.1.30",
  fields: [
    {
      "name": "position",
      "type": "Vector3D",
      "label": "Position"
    },
    {
      "name": "rotation",
      "type": "Vector3D",
      "label": "Rotation"
    },
    {
      "name": "scale",
      "type": "Vector3D",
      "label": "Scale"
    }
  ],
});
