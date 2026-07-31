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
          // fan-out — no manual refresh required. `nullable: true`
          // mirrors `_old`'s panels/inspector.ts:790-840 behaviour:
          // empty option labelled `(none)`, dispatch `null` (not
          // `''`) so the engine's `?? null` deserialize fallback
          // works, and stale references render as `<name> (missing)`
          // disabled selected options.
          name: 'currentAnimation',
          type: 'enum',
          label: 'Current Animation',
          valuesFromField: { fieldName: 'animations', mapField: 'name' },
          nullable: true,
        },
        {
          name: 'speed',
          type: 'number',
          label: 'Speed',
          default: 1,
          min: 0,
          step: 0.1,
        },
      ],
      // `animations` is excluded — the specialized "Open Animation
      // Editor" panel is the source of truth. Surfacing it here as a
      // JSON map textarea would create a competing edit surface for
      // the same field.
      //
      // `channels` is excluded to match `_old`'s
      // `schema/component-schemas.ts:526-554`, which deliberately
      // didn't expose it in the inspector. The field is engine-set
      // from sprite siblings and rarely needs hand-editing; the
      // earlier toggle-switch UI was experimental polish that turned
      // out to clutter the panel without much practical value.
      //
      // `currentFrameIndex` / `frameTime` are playback scratch
      // rewritten every update tick.
      exclude: ['animations', 'channels', 'currentFrameIndex', 'frameTime'],
      actions: [
        {
          label: 'Open Animation Editor',
          command: 'omosuen.openAnimationEditor',
        },
      ],
    },
  ],
});
