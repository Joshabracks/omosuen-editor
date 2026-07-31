/**
 * Tests for the scene-mutation + component-defaults helpers.
 *
 * Coverage:
 *   - `insertChildComponent` — happy path, non-nexus parent rejection,
 *     missing-parent no-op, nested-parent descent.
 *   - `nextComponentId` — traversal over nested trees.
 *   - `buildDefaultComponent` — structural minimum, nexus `components:
 *     []`, schema field-default seeding, zero-vector fallback for
 *     declared Vector fields.
 */

import {
  applyComponentUpdate,
  buildDefaultComponent,
  getNestedProperty,
  insertChildComponent,
  moveComponent,
  nextComponentId,
  removeComponent,
  reparentComponent,
} from '../state/index.js';
import type { SerializedComponent } from '../omoscene/index.js';
import { makeScene } from './fixtures.js';
import { assertDeepEqual, test } from './harness.js';

function sampleScene(): ReturnType<typeof makeScene> {
  return makeScene({
    scene: {
      type: 'nexus',
      name: 'Root',
      id: 0,
      unique: 0,
      components: [
        { type: 'transform', name: 't', id: 1, unique: 0 },
        {
          type: 'nexus',
          name: 'Child',
          id: 2,
          unique: 0,
          components: [{ type: 'sprite', name: 's', id: 3, unique: 0 }],
        },
      ],
    },
  });
}

function newSprite(id: number): SerializedComponent {
  return { type: 'sprite', name: 'new', id, unique: 0 };
}

export function runSceneMutationTests(): void {
  // --- insertChildComponent ---------------------------------------------

  test('insertChildComponent: appends under the root nexus', () => {
    const file = makeScene();
    const out = insertChildComponent(file, 0, newSprite(99));
    if (out === file) throw new Error('expected new file reference');
    const children = out.scene.components;
    if (!Array.isArray(children) || children.length !== 1) {
      throw new Error(`expected 1 child, got ${String(children?.length)}`);
    }
    const added = children[0] as SerializedComponent;
    if (added.id !== 99 || added.type !== 'sprite') {
      throw new Error(`wrong child: ${JSON.stringify(added)}`);
    }
  });

  test('insertChildComponent: descends into a nested nexus', () => {
    const file = sampleScene();
    const out = insertChildComponent(file, 2, newSprite(10));
    const rootChildren = (
      out.scene as unknown as { components: SerializedComponent[] }
    ).components;
    const nested = rootChildren[1] as unknown as {
      components: SerializedComponent[];
    };
    if (nested.components.length !== 2) {
      throw new Error('nested nexus should have 2 children after insert');
    }
    const last = nested.components[1]!;
    if (last.id !== 10) throw new Error(`wrong insertion: ${String(last.id)}`);
  });

  test('insertChildComponent: no-op when parentId is not a nexus', () => {
    const file = sampleScene();
    const out = insertChildComponent(file, 1, newSprite(99)); // transform id=1
    if (out !== file) throw new Error('expected same file ref on non-nexus');
  });

  test('insertChildComponent: no-op when parentId not found', () => {
    const file = sampleScene();
    const out = insertChildComponent(file, 9999, newSprite(99));
    if (out !== file) throw new Error('expected same file ref on miss');
  });

  // --- nextComponentId --------------------------------------------------

  test('nextComponentId: returns max(id)+1 across nested tree', () => {
    const file = sampleScene();
    if (nextComponentId(file) !== 4) {
      throw new Error(`expected 4, got ${nextComponentId(file)}`);
    }
  });

  test('nextComponentId: returns 1 for a root with no id', () => {
    const file = makeScene({
      scene: { type: 'nexus', name: 'Root', id: 0, unique: 0, components: [] },
    });
    // Root has id 0 → next is 1.
    if (nextComponentId(file) !== 1) {
      throw new Error(`expected 1, got ${nextComponentId(file)}`);
    }
  });

  // --- buildDefaultComponent --------------------------------------------

  test('buildDefaultComponent: always emits type/name/id/unique', () => {
    const c = buildDefaultComponent({
      type: 'transform',
      id: 42,
      engineVersion: 'v0.1.30',
    });
    if (c.type !== 'transform') throw new Error('type missing');
    if (c.name !== 'transform') throw new Error('name should default to type');
    if (c.id !== 42) throw new Error('id not set');
    if (c.unique !== 0) throw new Error('unique not set');
  });

  test('buildDefaultComponent: nexus gets empty components array', () => {
    const c = buildDefaultComponent({
      type: 'nexus',
      id: 5,
      engineVersion: 'v0.1.30',
    });
    if (!Array.isArray((c as { components: unknown }).components)) {
      throw new Error('nexus must have components: []');
    }
  });

  test('buildDefaultComponent: non-nexus does NOT get components', () => {
    const c = buildDefaultComponent({
      type: 'transform',
      id: 5,
      engineVersion: 'v0.1.30',
    });
    if (Object.prototype.hasOwnProperty.call(c, 'components')) {
      throw new Error('non-nexus must not carry a components array');
    }
  });

  test('buildDefaultComponent: seeds Vector3D fields with a zero vector', () => {
    const c = buildDefaultComponent({
      type: 'transform',
      id: 1,
      engineVersion: 'v0.1.30',
    });
    // transform schema declares position / rotation / scale as Vector3D
    // without an explicit `default`, so all three should get zero vectors.
    const pos = (c as Record<string, unknown>)['position'];
    assertDeepEqual(pos, {
      _vectorType: 'Vector3D',
      x: 0,
      y: 0,
      z: 0,
    });
  });

  test('buildDefaultComponent: honors schema-declared field defaults', () => {
    // animation-controller has `state` enum default: "stopped", `speed`
    // number default: 1.
    const c = buildDefaultComponent({
      type: 'animation-controller',
      id: 7,
      engineVersion: 'v0.1.30',
    });
    const rec = c as Record<string, unknown>;
    if (rec['state'] !== 'stopped') {
      throw new Error(`state default not seeded: ${String(rec['state'])}`);
    }
    if (rec['speed'] !== 1) {
      throw new Error(`speed default not seeded: ${String(rec['speed'])}`);
    }
  });

  test('buildDefaultComponent: unknown type returns structural minimum only', () => {
    const c = buildDefaultComponent({
      type: 'does-not-exist',
      id: 1,
      engineVersion: 'v0.1.30',
    });
    assertDeepEqual(c as unknown, {
      type: 'does-not-exist',
      name: 'does-not-exist',
      id: 1,
      unique: 0,
    });
  });

  // --- moveComponent ----------------------------------------------------

  test('moveComponent: up swaps a middle sibling with its predecessor', () => {
    const file = sampleScene();
    // root components are: [transform id=1, nexus id=2]; moving id=2 up.
    const out = moveComponent(file, 2, 'up');
    const kids = out.scene.components as readonly SerializedComponent[];
    if (kids[0]!.id !== 2 || kids[1]!.id !== 1) {
      throw new Error(`unexpected order: ${kids.map((c) => c.id).join(',')}`);
    }
  });

  test('moveComponent: down swaps with the next sibling', () => {
    const file = sampleScene();
    const out = moveComponent(file, 1, 'down');
    const kids = out.scene.components as readonly SerializedComponent[];
    if (kids[0]!.id !== 2 || kids[1]!.id !== 1) {
      throw new Error(`unexpected order: ${kids.map((c) => c.id).join(',')}`);
    }
  });

  test('moveComponent: no-op on up at first position', () => {
    const file = sampleScene();
    const out = moveComponent(file, 1, 'up');
    if (out !== file) throw new Error('expected same file ref at boundary');
  });

  test('moveComponent: no-op on down at last position', () => {
    const file = sampleScene();
    const out = moveComponent(file, 2, 'down');
    if (out !== file) throw new Error('expected same file ref at boundary');
  });

  test('moveComponent: no-op when component is root', () => {
    const file = sampleScene();
    const out = moveComponent(file, 0, 'up');
    if (out !== file) throw new Error('root should be unmovable');
  });

  test('moveComponent: no-op when component not found', () => {
    const file = sampleScene();
    const out = moveComponent(file, 9999, 'up');
    if (out !== file) throw new Error('missing id should no-op');
  });

  // --- removeComponent --------------------------------------------------

  test('removeComponent: drops a direct child of the root', () => {
    const file = sampleScene();
    const out = removeComponent(file, 1);
    const kids = out.scene.components as readonly SerializedComponent[];
    if (kids.length !== 1 || kids[0]!.id !== 2) {
      throw new Error(`wrong post-remove state: ${JSON.stringify(kids)}`);
    }
  });

  test('removeComponent: drops a nested descendant with its subtree', () => {
    const file = sampleScene();
    const out = removeComponent(file, 3); // sprite inside nested nexus
    const nested = (
      out.scene.components as readonly SerializedComponent[]
    )[1] as SerializedComponent;
    const innerKids = nested.components as readonly SerializedComponent[];
    if (innerKids.length !== 0) {
      throw new Error('nested nexus should be empty after remove');
    }
  });

  test('removeComponent: no-op on root', () => {
    const file = sampleScene();
    const out = removeComponent(file, 0);
    if (out !== file) throw new Error('root delete must be rejected');
  });

  test('removeComponent: no-op on missing id', () => {
    const file = sampleScene();
    const out = removeComponent(file, 9999);
    if (out !== file) throw new Error('missing id should no-op');
  });

  // --- reparentComponent ------------------------------------------------

  test('reparentComponent: moves a leaf under a different nexus', () => {
    const file = sampleScene();
    // Move transform id=1 (root child) into nested nexus id=2.
    const out = reparentComponent(file, 1, 2);
    const rootKids = out.scene.components as readonly SerializedComponent[];
    if (rootKids.length !== 1 || rootKids[0]!.id !== 2) {
      throw new Error('transform should no longer be a root child');
    }
    const nested = rootKids[0] as SerializedComponent;
    const nestedKids = nested.components as readonly SerializedComponent[];
    if (nestedKids.length !== 2) {
      throw new Error(
        `nested nexus should have 2 children after reparent: ${nestedKids.length}`,
      );
    }
    if (!nestedKids.some((c) => c.id === 1)) {
      throw new Error('transform missing from new parent');
    }
  });

  test('reparentComponent: preserves subtree on move', () => {
    const file = sampleScene();
    // Move nested nexus id=2 (which contains sprite id=3) under root — no-op
    // since it's already there; use a different setup.
    const augmented = insertChildComponent(file, 0, {
      type: 'nexus',
      name: 'Second',
      id: 4,
      unique: 0,
      components: [],
    });
    // Reparent nested nexus id=2 into the new nexus id=4.
    const out = reparentComponent(augmented, 2, 4);
    const rootKids = out.scene.components as readonly SerializedComponent[];
    // rootKids should be [transform id=1, nexus id=4 {nexus id=2 {sprite id=3}}]
    const newParent = rootKids.find((c) => c.id === 4) as SerializedComponent;
    const moved = (newParent.components as readonly SerializedComponent[])[0]!;
    if (moved.id !== 2) throw new Error('moved wrong node');
    const sprite = (moved.components as readonly SerializedComponent[])[0]!;
    if (sprite.id !== 3) throw new Error('subtree not preserved');
  });

  test('reparentComponent: no-op on cycle (target is a descendant)', () => {
    const file = sampleScene();
    // Try to reparent nexus id=2 under sprite id=3 (its own descendant).
    // Also covers "target isn't a nexus" path.
    const out = reparentComponent(file, 2, 3);
    if (out !== file) throw new Error('cycle should be rejected');
  });

  test('reparentComponent: no-op when target is not a nexus', () => {
    const file = sampleScene();
    // transform id=1 is not a nexus — can't reparent under it.
    const out = reparentComponent(file, 2, 1);
    if (out !== file) throw new Error('non-nexus target should be rejected');
  });

  test('reparentComponent: no-op when already the direct child', () => {
    const file = sampleScene();
    // nexus id=2's parent is root id=0; re-attempt is a no-op.
    const out = reparentComponent(file, 2, 0);
    if (out !== file) throw new Error('same-parent reparent should no-op');
  });

  test('reparentComponent: no-op on root', () => {
    const file = sampleScene();
    const out = reparentComponent(file, 0, 2);
    if (out !== file) throw new Error('root cannot be reparented');
  });

  // --- Dotted-path support ---------------------------------------------

  test('getNestedProperty: walks dotted paths and returns undefined on miss', () => {
    const obj = { config: { atlasSize: 4096, nested: { deep: 'ok' } } };
    if (getNestedProperty(obj, 'config.atlasSize') !== 4096) {
      throw new Error('shallow read failed');
    }
    if (getNestedProperty(obj, 'config.nested.deep') !== 'ok') {
      throw new Error('deep read failed');
    }
    if (getNestedProperty(obj, 'config.missing') !== undefined) {
      throw new Error('missing leaf should be undefined');
    }
    if (getNestedProperty(obj, 'config.atlasSize.nope') !== undefined) {
      throw new Error('descend into non-object should be undefined');
    }
    if (getNestedProperty(null, 'a.b') !== undefined) {
      throw new Error('null root should be undefined');
    }
  });

  test('applyComponentUpdate: dotted property writes nested object immutably', () => {
    const file = makeScene({
      scene: {
        type: 'nexus',
        name: 'Root',
        id: 0,
        unique: 0,
        components: [
          {
            type: 'atlas-manager',
            name: 'Atlases',
            id: 1,
            unique: 0,
            config: { atlasSize: 4096, maxAtlases: 8, padding: 1 },
          },
        ],
      },
    });
    const out = applyComponentUpdate(
      file,
      1,
      'atlas-manager',
      'config.atlasSize',
      8192,
    );
    if (out === file) throw new Error('expected new file ref on update');
    const child = (out.scene.components as readonly SerializedComponent[])[0]!;
    const config = child['config'] as Record<string, unknown>;
    if (config['atlasSize'] !== 8192) throw new Error('atlasSize not updated');
    // Sibling sub-keys preserved through the immutable nested write.
    if (config['maxAtlases'] !== 8) {
      throw new Error('maxAtlases must survive sibling update');
    }
    if (config['padding'] !== 1) {
      throw new Error('padding must survive sibling update');
    }
  });

  test('applyComponentUpdate: dotted property creates missing intermediate object', () => {
    const file = makeScene({
      scene: {
        type: 'nexus',
        name: 'Root',
        id: 0,
        unique: 0,
        components: [
          { type: 'atlas-manager', name: 'A', id: 1, unique: 0 },
          // no `config` field present yet
        ],
      },
    });
    const out = applyComponentUpdate(
      file,
      1,
      'atlas-manager',
      'config.atlasSize',
      2048,
    );
    if (out === file) throw new Error('expected new file ref');
    const child = (out.scene.components as readonly SerializedComponent[])[0]!;
    const config = child['config'] as Record<string, unknown>;
    if (config?.['atlasSize'] !== 2048) {
      throw new Error('intermediate not created');
    }
  });

  test('buildDefaultComponent: dotted-name fields merge into one shared parent', () => {
    // atlas-manager's schema declares three `config.*` fields with
    // explicit defaults — all three should land in a single `config`
    // object on the new component, not as flat dotted keys.
    const c = buildDefaultComponent({
      type: 'atlas-manager',
      id: 7,
      engineVersion: 'v0.1.30',
    });
    const rec = c as Record<string, unknown>;
    const config = rec['config'] as Record<string, unknown> | undefined;
    if (config === undefined || typeof config !== 'object') {
      throw new Error('config object missing');
    }
    if (config['atlasSize'] !== 4096) {
      throw new Error('atlasSize default not seeded');
    }
    if (config['maxAtlases'] !== 8) {
      throw new Error('maxAtlases default not seeded');
    }
    if (config['padding'] !== 1) {
      throw new Error('padding default not seeded');
    }
    // Flat dotted keys must NOT exist alongside the nested form.
    if ('config.atlasSize' in rec) {
      throw new Error('flat dotted key should not be present');
    }
  });
}
