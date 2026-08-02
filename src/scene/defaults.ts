/**
 * Build a default SerializedComponent from E16 contributions (3b).
 */

import {
  resolveEditorType,
  type FieldSchema,
} from '../editor-api';
import type { SerializedComponent } from '../omoscene';
import { setNestedMutating } from './mutation';

export interface BuildDefaultComponentOptions {
  readonly type: string;
  readonly id: number;
  readonly engineVersion: string;
  readonly name?: string;
}

export function buildDefaultComponent(
  options: BuildDefaultComponentOptions,
): SerializedComponent {
  const base: Record<string, unknown> = {
    type: options.type,
    name: options.name ?? options.type,
    id: options.id,
    unique: 0,
  };

  if (options.type === 'nexus') {
    base.components = [];
  }

  const resolved = resolveEditorType(options.type, options.engineVersion);
  if (!resolved) {
    return base as SerializedComponent;
  }

  for (const field of resolved.fields) {
    const seeded = seedField(field);
    if (seeded === undefined) continue;
    setNestedMutating(base, field.name, seeded);
  }

  return base as SerializedComponent;
}

function seedField(field: FieldSchema): unknown {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case 'Vector2':
    case 'Vector2D':
      return zeroVector(2);
    case 'Vector3':
    case 'Vector3D':
      return zeroVector(3);
    case 'Vector4':
    case 'Vector4D':
    case 'Color3':
    case 'Color4':
      return field.type === 'Color3'
        ? { r: 1, g: 1, b: 1 }
        : field.type === 'Color4'
          ? { r: 1, g: 1, b: 1, a: 1 }
          : zeroVector(4);
    default:
      return undefined;
  }
}

function zeroVector(rank: 2 | 3 | 4): Record<string, unknown> {
  const out: Record<string, unknown> = {
    _vectorType: `Vector${rank}D`,
    x: 0,
    y: 0,
  };
  if (rank >= 3) out.z = 0;
  if (rank >= 4) out.w = 0;
  return out;
}
