/**
 * Property schemas for all 20 component types.
 * Derived from engine's PROPERTY_ALLOWLIST and *Options interfaces in each data.ts.
 */

import type { COMPONENT_TYPE } from '../types/engine';

export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'Vector2D'
  | 'Vector3D'
  | 'Vector4D'
  | 'Color3'
  | 'Color4'
  | 'object'
  | 'readonly'
  | 'action'
  | 'frameList';

export interface PropertySchema {
  name: string;
  type: PropertyType;
  label: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  values?: string[];
  readOnly?: boolean;
  subFields?: PropertySchema[];
  /** VS Code command to execute when an 'action' type button is clicked */
  command?: string;
}

export const COMPONENT_SCHEMAS: Record<COMPONENT_TYPE, PropertySchema[]> = {
  nexus: [
    {
      name: 'paused',
      type: 'boolean',
      label: 'Paused',
      default: false,
    },
  ],

  transform: [
    {
      name: 'position',
      type: 'Vector3D',
      label: 'Position',
      default: { x: 0, y: 0, z: 0 },
    },
    {
      name: 'rotation',
      type: 'Vector3D',
      label: 'Rotation',
      default: { x: 0, y: 0, z: 0 },
    },
    {
      name: 'scale',
      type: 'Vector3D',
      label: 'Scale',
      default: { x: 1, y: 1, z: 1 },
    },
  ],

  sprite: [
    {
      name: 'textureMapKeys',
      type: 'object',
      label: 'Texture Maps',
      subFields: [
        { name: 'albedo', type: 'string', label: 'Albedo', default: '' },
        { name: 'normal', type: 'string', label: 'Normal', default: '' },
        { name: 'material', type: 'string', label: 'Material', default: '' },
        { name: 'emission', type: 'string', label: 'Emission', default: '' },
      ],
    },
    {
      name: 'frame',
      type: 'object',
      label: 'Frames',
      subFields: [
        { name: 'albedo', type: 'number', label: 'Albedo', default: 0, min: 0, step: 1 },
        { name: 'normal', type: 'number', label: 'Normal', default: 0, min: 0, step: 1 },
        { name: 'emission', type: 'number', label: 'Emission', default: 0, min: 0, step: 1 },
        { name: 'material', type: 'number', label: 'Material', default: 0, min: 0, step: 1 },
      ],
    },
    {
      name: 'anchor',
      type: 'Vector2D',
      label: 'Anchor',
      default: { x: 0, y: 0 },
    },
    {
      name: 'tint',
      type: 'Color4',
      label: 'Tint',
      default: { x: 1, y: 1, z: 1, w: 1 },
    },
    {
      name: 'opacity',
      type: 'number',
      label: 'Opacity',
      default: 1.0,
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
      type: 'Color4',
      label: 'Silhouette Color',
      default: { x: 0.2, y: 0.4, z: 0.8, w: 0.5 },
    },
  ],

  camera: [
    {
      name: 'zoom',
      type: 'number',
      label: 'Zoom',
      default: 1.0,
      min: 0.1,
      max: 10,
      step: 0.1,
    },
    {
      name: 'pixelScale',
      type: 'number',
      label: 'Pixel Scale',
      default: 2.0,
      min: 1,
      max: 8,
      step: 1,
    },
    {
      name: 'axonometricAngle',
      type: 'number',
      label: 'Axonometric Angle',
      default: 30,
      min: 0,
      max: 90,
      step: 1,
    },
    {
      name: 'viewportRef',
      type: 'string',
      label: 'Viewport Reference',
    },
    {
      name: 'revealYOffset',
      type: 'number',
      label: 'Reveal Y Offset',
      default: 16.0,
    },
    {
      name: 'revealFadeHeight',
      type: 'number',
      label: 'Reveal Fade Height',
      default: 8.0,
    },
    {
      name: 'revealRadius',
      type: 'number',
      label: 'Reveal Radius',
      default: 256.0,
    },
  ],

  viewport: [
    {
      name: 'width',
      type: 'number',
      label: 'Width',
      default: 800,
      min: 1,
      step: 1,
    },
    {
      name: 'height',
      type: 'number',
      label: 'Height',
      default: 600,
      min: 1,
      step: 1,
    },
    {
      name: 'offsetX',
      type: 'number',
      label: 'Offset X',
      default: 0,
    },
    {
      name: 'offsetY',
      type: 'number',
      label: 'Offset Y',
      default: 0,
    },
    {
      name: 'backgroundColor',
      type: 'Color4',
      label: 'Background Color',
      default: { x: 0.1, y: 0.1, z: 0.15, w: 1.0 },
    },
  ],

  collider: [
    {
      name: 'shape',
      type: 'enum',
      label: 'Shape',
      default: 'box',
      values: ['box', 'sphere'],
    },
    {
      name: 'size',
      type: 'Vector3D',
      label: 'Size',
      default: { x: 0.5, y: 0.5, z: 0.5 },
    },
    {
      name: 'radius',
      type: 'number',
      label: 'Radius',
      default: 0.5,
      min: 0,
      step: 0.1,
    },
    {
      name: 'offset',
      type: 'Vector3D',
      label: 'Offset',
      default: { x: 0, y: 0, z: 0 },
    },
  ],

  'event-collider': [
    {
      name: 'shape',
      type: 'enum',
      label: 'Shape',
      default: 'box',
      values: ['box', 'sphere'],
    },
    {
      name: 'size',
      type: 'Vector3D',
      label: 'Size',
      default: { x: 0.5, y: 0.5, z: 0.5 },
    },
    {
      name: 'radius',
      type: 'number',
      label: 'Radius',
      default: 0.5,
      min: 0,
      step: 0.1,
    },
    {
      name: 'offset',
      type: 'Vector3D',
      label: 'Offset',
      default: { x: 0, y: 0, z: 0 },
    },
  ],

  light: [
    {
      name: 'lightType',
      type: 'enum',
      label: 'Light Type',
      default: 'point',
      values: ['ambient', 'point', 'spot', 'directional'],
    },
    {
      name: 'color',
      type: 'Color3',
      label: 'Color',
      default: { x: 1, y: 1, z: 1 },
    },
    {
      name: 'brightness',
      type: 'number',
      label: 'Brightness',
      default: 1,
      min: 0,
      max: 10,
      step: 0.01,
    },
    {
      name: 'radius',
      type: 'number',
      label: 'Radius',
      default: 100,
      min: 0,
      step: 1,
    },
    {
      name: 'hardness',
      type: 'number',
      label: 'Hardness',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'direction',
      type: 'Vector3D',
      label: 'Direction',
      default: { x: 0, y: -1, z: 0 },
    },
  ],

  timer: [
    {
      name: 'duration',
      type: 'number',
      label: 'Duration (ms)',
      default: 1000,
      min: 0,
      step: 100,
    },
    {
      name: 'time',
      type: 'number',
      label: 'Current Time',
      default: 0,
      min: 0,
    },
    {
      name: 'speed',
      type: 'number',
      label: 'Speed',
      default: 1,
      step: 0.1,
    },
    {
      name: 'repeat',
      type: 'boolean',
      label: 'Repeat',
      default: false,
    },
    {
      name: 'destroy',
      type: 'boolean',
      label: 'Destroy on Complete',
      default: false,
    },
    {
      name: 'running',
      type: 'boolean',
      label: 'Running',
      default: false,
    },
  ],

  messenger: [
    {
      name: 'listeners',
      type: 'readonly',
      label: 'Listeners',
      readOnly: true,
    },
  ],

  'input-controller': [
    {
      name: 'preventDefault',
      type: 'boolean',
      label: 'Prevent Default',
      default: true,
    },
    {
      name: 'bindings',
      type: 'readonly',
      label: 'Bindings',
      readOnly: true,
    },
  ],

  'audio-manager': [
    {
      name: 'masterVolume',
      type: 'number',
      label: 'Master Volume',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'musicVolume',
      type: 'number',
      label: 'Music Volume',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'sfxVolume',
      type: 'number',
      label: 'SFX Volume',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'muted',
      type: 'boolean',
      label: 'Muted',
      default: false,
    },
  ],

  'audio-controller': [
    {
      name: 'volume',
      type: 'number',
      label: 'Volume',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'maxSFX',
      type: 'number',
      label: 'Max SFX',
      default: 16,
      min: 1,
      step: 1,
    },
  ],

  'animation-controller': [
    {
      name: 'speed',
      type: 'number',
      label: 'Speed',
      default: 1.0,
      min: 0,
      step: 0.1,
    },
    {
      name: 'state',
      type: 'enum',
      label: 'State',
      default: 'stopped',
      values: ['playing', 'paused', 'stopped'],
    },
    {
      name: 'currentAnimation',
      type: 'string',
      label: 'Current Animation',
      default: '',
    },
    {
      name: 'animations',
      type: 'action',
      label: 'Open Animation Editor',
      command: 'omosuen.openAnimationEditor',
    },
  ],

  'ui-overlay': [
    {
      name: 'htmlConstructorKey',
      type: 'string',
      label: 'HTML Constructor Key',
      default: '',
    },
    {
      name: 'showOverride',
      type: 'string',
      label: 'Show Override',
      default: '',
    },
    {
      name: 'hideOverride',
      type: 'string',
      label: 'Hide Override',
      default: '',
    },
    {
      name: 'cssOverrides',
      type: 'readonly',
      label: 'CSS Overrides',
      readOnly: true,
    },
  ],

  'data-layer': [
    {
      name: 'storage',
      type: 'readonly',
      label: 'Storage',
      readOnly: true,
    },
  ],

  'flag-manager': [
    {
      name: 'flags',
      type: 'readonly',
      label: 'Flags',
      readOnly: true,
    },
  ],

  'texture-map': [
    {
      name: 'textureMapKey',
      type: 'string',
      label: 'Texture Map Key',
      default: '',
    },
    {
      name: 'filePath',
      type: 'string',
      label: 'File Path',
      default: '',
    },
    {
      name: 'imageType',
      type: 'frameList',
      label: 'Frames',
    },
    {
      name: '_openFrameEditor',
      type: 'action',
      label: 'Edit Frames...',
      command: 'omosuen.openFrameEditor',
    },
  ],

  'atlas-manager': [
    {
      name: 'config',
      type: 'object',
      label: 'Config',
      subFields: [
        {
          name: 'atlasSize',
          type: 'enum',
          label: 'Atlas Size',
          default: '4096',
          values: ['1024', '2048', '4096', '8192'],
        },
        {
          name: 'maxAtlases',
          type: 'number',
          label: 'Max Atlases',
          default: 16,
          min: 1,
          max: 16,
          step: 1,
        },
        {
          name: 'padding',
          type: 'number',
          label: 'Padding',
          default: 1,
          min: 0,
          max: 4,
          step: 1,
        },
      ],
    },
  ],

  'cell-map': [
    {
      name: 'cellSize',
      type: 'Vector3D',
      label: 'Cell Size',
      readOnly: true,
    },
    {
      name: 'mapSize',
      type: 'Vector3D',
      label: 'Map Size',
      readOnly: true,
    },
    {
      name: 'smoothing',
      type: 'number',
      label: 'Smoothing',
      default: 0,
      min: 0,
      step: 1,
    },
    {
      name: 'normalSmoothing',
      type: 'number',
      label: 'Normal Smoothing',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      name: 'revealExempt',
      type: 'boolean',
      label: 'Reveal Exempt',
      default: false,
    },
    {
      name: 'materials',
      type: 'action',
      label: 'Open Materials Editor',
      command: 'omosuen.openCellMapMaterials',
    },
    // Cell-map editing is integrated into the main editor viewport (press T to toggle)
  ],
};

/**
 * Returns the property schema for a given component type.
 */
export function getSchemaForType(type: COMPONENT_TYPE): PropertySchema[] {
  return COMPONENT_SCHEMAS[type];
}
