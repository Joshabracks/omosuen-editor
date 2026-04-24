/**
 * Default-value builder for newly-inserted components.
 *
 * Reads the current engine's floor-matched schema version from the
 * schema registry and seeds one field per `PropertySchema`:
 *   - `string` / `number` / `boolean` / `enum` — `field.default` if set,
 *     otherwise the field is omitted (engine initializes on load).
 *   - `Vector2D` / `Vector3D` / `Vector4D` — `field.default` if set and
 *     of the right shape, otherwise a zero vector of the right rank.
 *   - `object` / `array` / `map` — omitted unless `field.default` is
 *     declared. The engine creates the container on init.
 *
 * Every component gets the structural minimum: `{ type, name, id,
 * unique }`. Nexus additionally gets `components: []`.
 *
 * Kept separate from [scene-mutation.ts](./scene-mutation.ts) because
 * mutation code is pure-tree, while defaults pulls the schema registry
 * (which does DOM-free side-effect imports). The split keeps the
 * mutation module dependency-light and easy to audit.
 */

import {
  getComponentSchemas,
  resolveSchema,
  type PropertySchema,
} from '../schema/index.js';
import type { SerializedComponent } from '../omoscene/index.js';

export interface BuildDefaultComponentOptions {
  readonly type: string;
  readonly id: number;
  /** Floor-matched engine version for schema selection (e.g. "v0.1.30"). */
  readonly engineVersion: string;
}

export function buildDefaultComponent(
  options: BuildDefaultComponentOptions,
): SerializedComponent {
  const base: Record<string, unknown> = {
    type: options.type,
    name: options.type,
    id: options.id,
    unique: 0,
  };

  if (options.type === 'nexus') {
    base['components'] = [];
  }

  const schemas = getComponentSchemas(options.type);
  if (schemas === null) {
    return base as SerializedComponent;
  }
  const schema = resolveSchema(schemas.versions, options.engineVersion);
  if (schema === null) {
    return base as SerializedComponent;
  }

  for (const field of schema.fields) {
    const seeded = seedField(field);
    if (seeded !== undefined) base[field.name] = seeded;
  }

  return base as SerializedComponent;
}

function seedField(field: PropertySchema): unknown {
  if (field.default !== undefined) return field.default;
  if (field.type === 'Vector2D') return zeroVector(2);
  if (field.type === 'Vector3D') return zeroVector(3);
  if (field.type === 'Vector4D') return zeroVector(4);
  // number / string / boolean / enum / object / array / map without a
  // declared default are left unset — the engine's own init seeds them.
  return undefined;
}

function zeroVector(rank: 2 | 3 | 4): Record<string, unknown> {
  const out: Record<string, unknown> = {
    _vectorType: `Vector${rank}D`,
    x: 0,
    y: 0,
  };
  if (rank >= 3) out['z'] = 0;
  if (rank >= 4) out['w'] = 0;
  return out;
}
