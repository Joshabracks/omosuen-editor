import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 audio-effect schema. */
registerEditorType({
  type: "audio-effect",
  since: "v0.1.30",
  excludeFromInspector: [
    "mix"
  ],
  actions: [
    {
      "id": "omosuen.openAudioEditor",
      "label": "Open Audio Editor",
      "command": "omosuen.openAudioEditor"
    }
  ],
  fields: [
    {
      "name": "pitchShift",
      "type": "number",
      "label": "Pitch Shift (semitones)",
      "default": 0,
      "min": -24,
      "max": 24,
      "step": 0.1
    },
    {
      "name": "speedShift",
      "type": "number",
      "label": "Speed",
      "default": 1,
      "min": 0.1,
      "max": 4,
      "step": 0.01
    },
    {
      "name": "reverb",
      "type": "number",
      "label": "Reverb",
      "default": 0,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "volume",
      "type": "number",
      "label": "Volume",
      "default": 1,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "pan",
      "type": "number",
      "label": "Pan",
      "default": 0,
      "min": -1,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "spatial",
      "type": "boolean",
      "label": "Spatial",
      "default": false
    },
    {
      "name": "spatialX",
      "type": "number",
      "label": "Spatial X",
      "default": 0,
      "min": -1,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "spatialY",
      "type": "number",
      "label": "Spatial Y",
      "default": 0,
      "min": -1,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "spatialZ",
      "type": "number",
      "label": "Spatial Z",
      "default": 0,
      "min": -1,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "transitionBuffer",
      "type": "number",
      "label": "Transition Buffer (ms)",
      "default": 150,
      "min": 0,
      "max": 5000,
      "step": 25
    }
  ],
});
