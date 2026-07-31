import { registerComponentSchemas } from '../../schema/registry.js';

registerComponentSchemas({
  componentType: 'atlas-manager',
  versions: [
    {
      since: 'v0.1.30',
      // The on-disk shape is `config: { atlasSize, maxAtlases, padding }`
      // — three independent inspector rows are surfaced as dotted-path
      // fields under the same root. The schema-drift test classifies
      // them under their root segment (`config`), and the host's
      // `applyComponentUpdate` walks the path on write so updates land
      // in the nested config object rather than as flat keys.
      fields: [
        {
          name: 'config.atlasSize',
          type: 'enum',
          label: 'Atlas Size',
          values: [1024, 2048, 4096, 8192],
          default: 4096,
        },
        {
          name: 'config.maxAtlases',
          type: 'number',
          label: 'Max Atlases',
          min: 1,
          max: 16,
          step: 1,
          default: 8,
        },
        {
          name: 'config.padding',
          type: 'number',
          label: 'Padding (px)',
          min: 0,
          max: 4,
          step: 1,
          default: 1,
        },
      ],
      // Runtime-only state populated by the engine — not user-editable.
      // `textureMapIds` joins the existing runtime siblings: it's the
      // engine's pending-process queue, auto-managed.
      exclude: [
        'textureMapIds',
        'atlases',
        'compiled',
        'imageCache',
        'imageLoading',
      ],
    },
  ],
});
