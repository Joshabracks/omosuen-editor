/**
 * Property schemas for the 5 Phase 1 component types.
 * Derived from engine's PROPERTY_ALLOWLIST and *Options interfaces in each data.ts.
 * Source: https://github.com/Joshabracks/omosuen/tree/0.1.0
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
  | 'readonly';

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
}

/**
 * Phase 1 schemas: nexus, transform, sprite, camera, viewport
 */
export const COMPONENT_SCHEMAS: Partial<
  Record<COMPONENT_TYPE, PropertySchema[]>
> = {
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
};

/**
 * Returns the property schema for a given component type, or empty array if unsupported.
 */
export function getSchemaForType(type: COMPONENT_TYPE): PropertySchema[] {
  return COMPONENT_SCHEMAS[type] ?? [];
}
