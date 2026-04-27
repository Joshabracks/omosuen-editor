/**
 * Tests for `resolveDynamicEnum` / `collectComponentRefValues`.
 *
 * Pure tree-walking + field-resolution logic; testable without DOM
 * or vscode. Each test builds a small SerializedComponent tree and
 * asserts the resolved values list.
 */

import {
  collectComponentRefValues,
  resolveDynamicEnum,
  resolveSameComponentEnum,
} from '../state/component-refs.js';
import type { PropertySchema } from '../schema/index.js';
import type { SerializedComponent } from '../omoscene/index.js';
import { assertDeepEqual, test } from './harness.js';

function tree(): SerializedComponent {
  return {
    type: 'nexus',
    name: 'Root',
    id: 0,
    components: [
      {
        type: 'texture-map',
        name: 'tm-hero',
        id: 1,
        textureMapKey: 'hero',
        filePath: 'assets/hero.png',
      },
      {
        type: 'nexus',
        name: 'group',
        id: 2,
        components: [
          {
            type: 'texture-map',
            name: 'tm-tiles',
            id: 3,
            textureMapKey: 'tiles',
          },
          {
            type: 'sprite',
            name: 'spr',
            id: 4,
            textureMapKeys: {
              albedo: 'hero',
              normal: '',
              material: '',
              emission: '',
            },
          },
        ],
      },
      {
        // Empty-key texture-map should be filtered out.
        type: 'texture-map',
        name: 'tm-empty',
        id: 5,
        textureMapKey: '',
      },
    ],
  } as unknown as SerializedComponent;
}

const componentRefField: PropertySchema = {
  name: 'textureMapKeys.albedo',
  type: 'enum',
  label: 'Albedo',
  componentRef: { componentType: 'texture-map', keyField: 'textureMapKey' },
};

export function runComponentRefsTests(): void {
  // --- collectComponentRefValues -----------------------------------

  test('collectComponentRefValues: scans nested tree, dedupes + sorts', () => {
    const out = collectComponentRefValues(
      tree(),
      'texture-map',
      'textureMapKey',
    );
    assertDeepEqual(out, ['hero', 'tiles']);
  });

  test('collectComponentRefValues: drops empty + non-string values', () => {
    const root: SerializedComponent = {
      type: 'nexus',
      name: 'r',
      id: 0,
      components: [
        { type: 'texture-map', name: 'a', id: 1, textureMapKey: '' },
        { type: 'texture-map', name: 'b', id: 2, textureMapKey: 42 },
        { type: 'texture-map', name: 'c', id: 3, textureMapKey: 'real' },
      ],
    } as unknown as SerializedComponent;
    const out = collectComponentRefValues(root, 'texture-map', 'textureMapKey');
    assertDeepEqual(out, ['real']);
  });

  test('collectComponentRefValues: returns empty when type missing', () => {
    const out = collectComponentRefValues(tree(), 'cell-map', 'someKey');
    assertDeepEqual(out, []);
  });

  // --- resolveDynamicEnum ------------------------------------------

  test('resolveDynamicEnum: pass-through when no componentRef', () => {
    const field: PropertySchema = {
      name: 'foo',
      type: 'string',
      label: 'Foo',
    };
    const out = resolveDynamicEnum(field, 'value', tree());
    if (out !== field) {
      throw new Error('expected reference identity for non-componentRef field');
    }
  });

  test('resolveDynamicEnum: populates values + prepends empty option', () => {
    const out = resolveDynamicEnum(componentRefField, 'hero', tree());
    assertDeepEqual(out.values, ['', 'hero', 'tiles']);
  });

  test('resolveDynamicEnum: includes stale current value', () => {
    // User's saved key references a since-deleted texture-map. The
    // dropdown must still show that key so the user knows what's
    // saved + can pick a real replacement instead of silently
    // resetting to the first scanned option.
    const out = resolveDynamicEnum(componentRefField, 'ghost', tree());
    assertDeepEqual(out.values, ['', 'ghost', 'hero', 'tiles']);
  });

  test('resolveDynamicEnum: empty current value still results in empty option present', () => {
    const out = resolveDynamicEnum(componentRefField, '', tree());
    assertDeepEqual(out.values, ['', 'hero', 'tiles']);
  });

  test('resolveDynamicEnum: non-string current value treated as empty', () => {
    const out = resolveDynamicEnum(componentRefField, undefined, tree());
    assertDeepEqual(out.values, ['', 'hero', 'tiles']);
  });

  // --- resolveSameComponentEnum ------------------------------------

  const animController = (animations: unknown): SerializedComponent =>
    ({
      type: 'animation-controller',
      name: 'ac',
      id: 7,
      animations,
    }) as unknown as SerializedComponent;

  const sameCompField = (mapField?: string): PropertySchema => ({
    name: 'currentAnimation',
    type: 'enum',
    label: 'Current Animation',
    valuesFromField:
      mapField === undefined
        ? { fieldName: 'animations' }
        : { fieldName: 'animations', mapField },
  });

  test('resolveSameComponentEnum: pass-through when valuesFromField unset', () => {
    const field: PropertySchema = {
      name: 'speed',
      type: 'number',
      label: 'Speed',
    };
    const out = resolveSameComponentEnum(field, animController([]));
    if (out !== field) {
      throw new Error(
        'expected reference identity for non-valuesFromField field',
      );
    }
  });

  test('resolveSameComponentEnum: extracts mapField from object array', () => {
    const out = resolveSameComponentEnum(
      sameCompField('name'),
      animController([
        { name: 'walk', frames: [0, 1] },
        { name: 'idle', frames: [2] },
        { name: 'jump', frames: [3, 4, 5] },
      ]),
    );
    assertDeepEqual(out.values, ['', 'idle', 'jump', 'walk']);
  });

  test('resolveSameComponentEnum: skips items missing mapField', () => {
    const out = resolveSameComponentEnum(
      sameCompField('name'),
      animController([
        { name: 'walk' },
        { frames: [0] }, // no name; skipped
        { name: '' }, // empty name; skipped
        'not-an-object', // wrong type; skipped
        null,
        { name: 'idle' },
      ]),
    );
    assertDeepEqual(out.values, ['', 'idle', 'walk']);
  });

  test('resolveSameComponentEnum: accepts string[] when no mapField', () => {
    const out = resolveSameComponentEnum(
      sameCompField(),
      animController(['walk', 'idle', 'walk', '']),
    );
    assertDeepEqual(out.values, ['', 'idle', 'walk']);
  });

  test('resolveSameComponentEnum: missing/non-array source yields just empty option', () => {
    assertDeepEqual(
      resolveSameComponentEnum(sameCompField('name'), animController(undefined))
        .values,
      [''],
    );
    assertDeepEqual(
      resolveSameComponentEnum(
        sameCompField('name'),
        animController('not-an-array'),
      ).values,
      [''],
    );
  });
}
