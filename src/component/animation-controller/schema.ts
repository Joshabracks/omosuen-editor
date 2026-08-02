import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 animation-controller schema. */
registerEditorType({
  type: "animation-controller",
  since: "v0.1.30",
  excludeFromInspector: [
    "animations",
    "channels",
    "currentFrameIndex",
    "frameTime"
  ],
  actions: [
    {
      "id": "omosuen.openAnimationEditor",
      "label": "Open Animation Editor",
      "command": "omosuen.openAnimationEditor"
    }
  ],
  fields: [
    {
      "name": "state",
      "type": "enum",
      "label": "State",
      "values": [
        "playing",
        "paused",
        "stopped"
      ],
      "default": "stopped"
    },
    {
      "name": "currentAnimation",
      "type": "enum",
      "label": "Current Animation",
      "valuesFromField": {
        "fieldName": "animations",
        "mapField": "name"
      },
      "nullable": true
    },
    {
      "name": "speed",
      "type": "number",
      "label": "Speed",
      "default": 1,
      "min": 0,
      "step": 0.1
    }
  ],
});
