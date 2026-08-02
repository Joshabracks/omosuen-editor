/** Auto-synced from registered built-in schemas — update schemas, then re-run scripts/write-allowlist-fixture.mjs via tsx. */

import type { PropertyAllowlistFixture } from '../../editor-api';

export const BUILTIN_COMPONENT_COUNT = 23;

export const BUILTIN_COMPONENT_TYPES = [
  "animation-controller",
  "animation-map",
  "atlas-manager",
  "audio-effect",
  "audio-player",
  "audio-track",
  "camera",
  "cell-map",
  "collider",
  "data-layer",
  "event-collider",
  "flag-manager",
  "input-controller",
  "light",
  "messenger",
  "nexus",
  "speed-dial",
  "sprite",
  "texture-map",
  "timer",
  "transform",
  "ui-overlay",
  "viewport"
] as const;

export const PROPERTY_ALLOWLIST_FIXTURE: PropertyAllowlistFixture = {
  "animation-controller": [
    "animations",
    "channels",
    "currentAnimation",
    "currentFrameIndex",
    "frameTime",
    "speed",
    "state"
  ],
  "animation-map": [
    "animationMapKey",
    "animations"
  ],
  "atlas-manager": [
    "atlases",
    "compiled",
    "config",
    "imageCache",
    "imageLoading",
    "textureMapIds"
  ],
  "audio-effect": [
    "mix",
    "pan",
    "pitchShift",
    "reverb",
    "spatial",
    "spatialX",
    "spatialY",
    "spatialZ",
    "speedShift",
    "transitionBuffer",
    "volume"
  ],
  "audio-player": [
    "_activeSources",
    "_audioContext",
    "_bufferCache",
    "_bufferLoading",
    "_masterGain",
    "_nextSourceId",
    "_reverbConvolver",
    "_workletBlobUrl",
    "masterVolume",
    "muted"
  ],
  "audio-track": [
    "filePath"
  ],
  "camera": [
    "axonometricAngle",
    "glResources",
    "pixelScale",
    "revealFadeHeight",
    "revealRadius",
    "revealTarget",
    "revealVolume",
    "revealYOffset",
    "viewportRef",
    "zoom",
    "zoomTarget"
  ],
  "cell-map": [
    "cellSize",
    "chunkGridSize",
    "chunks",
    "emissionMap",
    "mapSize",
    "materialMap",
    "materials",
    "meshes",
    "needsGPUUpdate",
    "normalSmoothing",
    "packedData",
    "revealExempt",
    "shapeMap",
    "smoothing",
    "smoothingWeights",
    "visibilityMap"
  ],
  "collider": [
    "offset",
    "radius",
    "shape",
    "size"
  ],
  "data-layer": [
    "$",
    "storage",
    "typeMap"
  ],
  "event-collider": [
    "offset",
    "onEnter",
    "onExit",
    "radius",
    "shape",
    "size",
    "triggers",
    "while"
  ],
  "flag-manager": [
    "flags"
  ],
  "input-controller": [
    "_eventHandlers",
    "actionCallbacks",
    "activeInputs",
    "bindings",
    "preventDefault",
    "target"
  ],
  "light": [
    "brightness",
    "color",
    "direction",
    "hardness",
    "lightType",
    "radius"
  ],
  "messenger": [
    "listeners"
  ],
  "nexus": [
    "components",
    "paused",
    "script"
  ],
  "speed-dial": [
    "dialKey",
    "items",
    "radius"
  ],
  "sprite": [
    "anchor",
    "frame",
    "opacity",
    "showSilhouette",
    "silhouetteColor",
    "textureMapKeys",
    "tint"
  ],
  "texture-map": [
    "filePath",
    "frameIndexMap",
    "imageType",
    "originalFrames",
    "packedFrames",
    "textureMapKey"
  ],
  "timer": [
    "destroy",
    "duration",
    "events",
    "repeat",
    "running",
    "speed",
    "time"
  ],
  "transform": [
    "position",
    "rotation",
    "scale"
  ],
  "ui-overlay": [
    "_htmlConstructed",
    "bindings",
    "container",
    "cssOverrides",
    "element",
    "hideOverride",
    "htmlConstructorKey",
    "previousOverlayId",
    "showOverride"
  ],
  "viewport": [
    "backgroundColor",
    "canvas",
    "container",
    "gl",
    "height",
    "offsetX",
    "offsetY",
    "width"
  ]
};
