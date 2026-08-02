import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 audio-player schema. */
registerEditorType({
  type: "audio-player",
  since: "v0.1.30",
  uniqueness: "GLOBAL",
  excludeFromInspector: [
    "_audioContext",
    "_masterGain",
    "_activeSources",
    "_nextSourceId",
    "_bufferCache",
    "_bufferLoading",
    "_reverbConvolver",
    "_workletBlobUrl"
  ],
  fields: [
    {
      "name": "masterVolume",
      "type": "number",
      "label": "Master Volume",
      "default": 1,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "muted",
      "type": "boolean",
      "label": "Muted",
      "default": false
    }
  ],
});
