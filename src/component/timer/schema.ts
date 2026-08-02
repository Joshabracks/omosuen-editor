import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 timer schema. */
registerEditorType({
  type: "timer",
  since: "v0.1.30",
  fields: [
    {
      "name": "time",
      "type": "number",
      "label": "Time",
      "default": 0
    },
    {
      "name": "speed",
      "type": "number",
      "label": "Speed",
      "default": 1,
      "step": 0.1
    },
    {
      "name": "duration",
      "type": "number",
      "label": "Duration",
      "min": 0
    },
    {
      "name": "repeat",
      "type": "object",
      "label": "Repeat"
    },
    {
      "name": "destroy",
      "type": "boolean",
      "label": "Destroy on Complete",
      "default": false
    },
    {
      "name": "running",
      "type": "boolean",
      "label": "Running",
      "default": false
    },
    {
      "name": "events",
      "type": "array",
      "label": "Events"
    }
  ],
});
