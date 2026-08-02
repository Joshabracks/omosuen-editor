import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 audio-track schema. */
registerEditorType({
  type: "audio-track",
  since: "v0.1.30",
  fields: [
    {
      "name": "filePath",
      "type": "string",
      "label": "File Path",
      "filePicker": {
        "extensions": [
          "mp3",
          "wav",
          "ogg",
          "flac",
          "aac",
          "webm"
        ]
      }
    }
  ],
});
