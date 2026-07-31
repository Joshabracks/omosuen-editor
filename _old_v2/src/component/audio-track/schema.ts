import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'audio-track',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'filePath',
          type: 'string',
          label: 'File Path',
          filePicker: {
            extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'webm'],
          },
        },
      ],
    },
  ],
});
