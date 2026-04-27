import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'animation-controller',
  versions: [
    {
      since: 'v0.1.30',
      fields: [
        {
          name: 'state',
          type: 'enum',
          label: 'State',
          values: ['playing', 'paused', 'stopped'],
          default: 'stopped',
        },
        {
          // Dropdown of animation names defined inside this same
          // controller. `valuesFromField` reads `animations[*].name`
          // at render time so the dropdown stays in sync with the
          // specialized animation editor's edits via the broker
          // fan-out — no manual refresh required.
          name: 'currentAnimation',
          type: 'enum',
          label: 'Current Animation',
          valuesFromField: { fieldName: 'animations', mapField: 'name' },
        },
        {
          name: 'speed',
          type: 'number',
          label: 'Speed',
          default: 1,
          min: 0,
          step: 0.1,
        },
        {
          // Four channel toggles. `albedo` is locked-on (the engine's
          // sprite renderer treats it as the base color and demands
          // its presence); the other three are user-toggleable. On
          // each toggle the inspector dispatches the whole new array
          // — no dotted-path math; `applyComponentUpdate` handles
          // top-level array replacements atomically.
          name: 'channels',
          type: 'stringSet',
          label: 'Channels',
          options: ['albedo', 'normal', 'material', 'emission'],
          alwaysOn: ['albedo'],
          default: ['albedo'],
        },
      ],
      // `animations` is excluded — the specialized "Open Animation
      // Editor" panel is the source of truth. Surfacing it here as a
      // JSON map textarea would create a competing edit surface for
      // the same field. `currentFrameIndex` / `frameTime` are
      // playback scratch rewritten every update tick; not meaningful
      // as user-edited inspector fields.
      exclude: ['animations', 'currentFrameIndex', 'frameTime'],
      actions: [
        {
          label: 'Open Animation Editor',
          command: 'omosuen.openAnimationEditor',
        },
      ],
    },
  ],
});
