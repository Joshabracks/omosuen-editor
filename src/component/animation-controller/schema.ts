import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'animation-controller',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        { name: 'animations', type: 'map', label: 'Animations' },
        {
          name: 'state',
          type: 'enum',
          label: 'State',
          values: ['playing', 'paused', 'stopped'],
          default: 'stopped',
        },
        {
          name: 'currentAnimation',
          type: 'string',
          label: 'Current Animation',
        },
        {
          name: 'speed',
          type: 'number',
          label: 'Speed',
          default: 1,
          min: 0,
          step: 0.1,
        },
        { name: 'channels', type: 'array', label: 'Channels' },
      ],
      // currentFrameIndex / frameTime are playback-state scratch, rewritten
      // every update tick. Not meaningful as user-edited inspector fields.
      exclude: ['currentFrameIndex', 'frameTime'],
      actions: [
        {
          label: 'Open Animation Editor',
          command: 'omosuen.openAnimationEditor',
        },
      ],
    },
  ],
});
