import { registerComponentSchemas } from '../../schema/registry.js';

const TEXTURE_MAP_REF = {
  componentType: 'texture-map',
  keyField: 'textureMapKey',
} as const;

registerComponentSchemas({
  componentType: 'sprite',
  versions: [
    {
      since: 'v0.1.30',
      // The on-disk shape stores `textureMapKeys` and `frame` as nested
      // objects each holding 4 channels (albedo / normal / material /
      // emission). The schema-drift test classifies them by their root
      // segment (`textureMapKeys` / `frame`); the inspector splits them
      // into 8 individual rows for direct editing — the host's
      // `applyComponentUpdate` walks the dotted path on write so the
      // serialized object keeps its nested shape.
      //
      // `textureMapKeys.*` use `componentRef` so each dropdown is
      // populated by scanning the scene tree for `texture-map`
      // components and listing their `textureMapKey` values — picking
      // a key wires the sprite to that specific texture-map.
      fields: [
        {
          name: 'textureMapKeys.albedo',
          type: 'enum',
          label: 'Albedo Texture',
          componentRef: TEXTURE_MAP_REF,
        },
        {
          name: 'textureMapKeys.normal',
          type: 'enum',
          label: 'Normal Texture',
          componentRef: TEXTURE_MAP_REF,
        },
        {
          name: 'textureMapKeys.material',
          type: 'enum',
          label: 'Material Texture',
          componentRef: TEXTURE_MAP_REF,
        },
        {
          name: 'textureMapKeys.emission',
          type: 'enum',
          label: 'Emission Texture',
          componentRef: TEXTURE_MAP_REF,
        },
        {
          name: 'frame.albedo',
          type: 'number',
          label: 'Albedo Frame',
          min: 0,
          step: 1,
          default: 0,
        },
        {
          name: 'frame.normal',
          type: 'number',
          label: 'Normal Frame',
          min: 0,
          step: 1,
          default: 0,
        },
        {
          name: 'frame.material',
          type: 'number',
          label: 'Material Frame',
          min: 0,
          step: 1,
          default: 0,
        },
        {
          name: 'frame.emission',
          type: 'number',
          label: 'Emission Frame',
          min: 0,
          step: 1,
          default: 0,
        },
        { name: 'anchor', type: 'Vector2D', label: 'Anchor' },
        { name: 'tint', type: 'Vector4D', label: 'Tint' },
        {
          name: 'opacity',
          type: 'number',
          label: 'Opacity',
          default: 1,
          min: 0,
          max: 1,
          step: 0.01,
        },
        {
          name: 'showSilhouette',
          type: 'boolean',
          label: 'Show Silhouette',
          default: false,
        },
        {
          name: 'silhouetteColor',
          type: 'Vector4D',
          label: 'Silhouette Color',
        },
      ],
    },
  ],
});
