import { registerEditorType } from '../../editor-api';

/** Ported from _old_v2 sprite schema. */
registerEditorType({
  type: "sprite",
  since: "v0.1.30",
  fields: [
    {
      "name": "textureMapKeys.albedo",
      "type": "enum",
      "label": "Albedo Texture",
      "componentRef": {
        "componentType": "texture-map",
        "keyField": "textureMapKey"
      }
    },
    {
      "name": "textureMapKeys.normal",
      "type": "enum",
      "label": "Normal Texture",
      "componentRef": {
        "componentType": "texture-map",
        "keyField": "textureMapKey"
      }
    },
    {
      "name": "textureMapKeys.material",
      "type": "enum",
      "label": "Material Texture",
      "componentRef": {
        "componentType": "texture-map",
        "keyField": "textureMapKey"
      }
    },
    {
      "name": "textureMapKeys.emission",
      "type": "enum",
      "label": "Emission Texture",
      "componentRef": {
        "componentType": "texture-map",
        "keyField": "textureMapKey"
      }
    },
    {
      "name": "frame.albedo",
      "type": "number",
      "label": "Albedo Frame",
      "min": 0,
      "step": 1,
      "default": 0
    },
    {
      "name": "frame.normal",
      "type": "number",
      "label": "Normal Frame",
      "min": 0,
      "step": 1,
      "default": 0
    },
    {
      "name": "frame.material",
      "type": "number",
      "label": "Material Frame",
      "min": 0,
      "step": 1,
      "default": 0
    },
    {
      "name": "frame.emission",
      "type": "number",
      "label": "Emission Frame",
      "min": 0,
      "step": 1,
      "default": 0
    },
    {
      "name": "anchor",
      "type": "Vector2D",
      "label": "Anchor"
    },
    {
      "name": "tint",
      "type": "Vector4D",
      "label": "Tint"
    },
    {
      "name": "opacity",
      "type": "number",
      "label": "Opacity",
      "default": 1,
      "min": 0,
      "max": 1,
      "step": 0.01
    },
    {
      "name": "showSilhouette",
      "type": "boolean",
      "label": "Show Silhouette",
      "default": false
    },
    {
      "name": "silhouetteColor",
      "type": "Vector4D",
      "label": "Silhouette Color"
    }
  ],
});
