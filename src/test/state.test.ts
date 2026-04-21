/**
 * State module tests.
 *
 * Covers:
 *   - Generic `createStore` subscription / unsubscribe / reference-equality.
 *   - `dispatch` routing for every protocol variant, including raw-message
 *     subscribers.
 *   - `applyComponentUpdate` / `updateComponentProperty` tree-walk purity:
 *     immutable subtree sharing, unrelated components untouched, no-op when
 *     the target id is missing.
 *
 * This is the Phase 3 exit-criterion proving ground — "a fake selection
 * message flows through the store; mock subscribers observe the change."
 */

import {
  OMOSCENE_FORMAT_VERSION,
  defaultEditorMetadata,
} from '../omoscene/index.js';
import type { OmosceneFile } from '../omoscene/index.js';
import {
  componentSelect,
  componentUpdate,
  sceneLoad,
  sceneSave,
} from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import {
  applyComponentUpdate,
  createStore,
  dispatch,
  resetStateForTests,
  sceneDocument,
  selection,
  subscribeMessages,
  updateComponentProperty,
} from '../state/index.js';
import { assertDeepEqual, test } from './harness.js';

function makeScene(): OmosceneFile {
  return {
    omoscene: OMOSCENE_FORMAT_VERSION,
    engine: '0.0.0-test',
    name: 'state-test',
    editor: defaultEditorMetadata(),
    scene: {
      type: 'nexus',
      name: 'Root',
      id: 0,
      unique: 0,
      components: [
        {
          type: 'transform',
          id: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          type: 'sprite',
          id: 2,
          opacity: 1,
        },
        {
          type: 'nexus',
          name: 'Child',
          id: 3,
          unique: 1,
          components: [{ type: 'transform', id: 4, position: [1, 1, 1] }],
        },
      ],
    },
  };
}

export function runStateTests(): void {
  // --- createStore primitive ----------------------------------------------

  test('createStore: get returns initial value', () => {
    const s = createStore(7);
    if (s.get() !== 7) throw new Error(`expected 7, got ${s.get()}`);
  });

  test('createStore: set notifies subscribers with prev + next', () => {
    const s = createStore(0);
    const events: Array<[number, number]> = [];
    s.subscribe((next, prev) => events.push([prev, next]));
    s.set(1);
    s.set(5);
    assertDeepEqual(events, [
      [0, 1],
      [1, 5],
    ]);
  });

  test('createStore: set with updater fn receives previous', () => {
    const s = createStore(10);
    s.set((prev) => prev + 1);
    if (s.get() !== 11) throw new Error(`expected 11, got ${s.get()}`);
  });

  test('createStore: same-reference set is a no-op', () => {
    const obj = { a: 1 };
    const s = createStore(obj);
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.set(obj);
    if (calls !== 0) throw new Error(`expected 0 notifications, got ${calls}`);
  });

  test('createStore: unsubscribe stops notifications', () => {
    const s = createStore(0);
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls += 1;
    });
    s.set(1);
    unsub();
    s.set(2);
    if (calls !== 1) throw new Error(`expected 1 notification, got ${calls}`);
  });

  // --- updateComponentProperty (pure) -------------------------------------

  test('updateComponentProperty: sets property on matching id', () => {
    const scene = makeScene().scene;
    const { scene: next, changed } = updateComponentProperty(
      scene,
      2,
      'sprite',
      'opacity',
      0.25,
    );
    if (!changed) throw new Error('expected changed=true');
    const sprite = (next.components as readonly { id?: number }[]).find(
      (c) => c.id === 2,
    ) as { opacity: number };
    if (sprite.opacity !== 0.25) {
      throw new Error(`expected opacity=0.25, got ${sprite.opacity}`);
    }
  });

  test('updateComponentProperty: returns same reference when id not found', () => {
    const scene = makeScene().scene;
    const { scene: next, changed } = updateComponentProperty(
      scene,
      999,
      'transform',
      'opacity',
      0.5,
    );
    if (changed) throw new Error('expected changed=false');
    if (next !== scene) {
      throw new Error('expected same reference when nothing changed');
    }
  });

  test('updateComponentProperty: returns same reference on type mismatch', () => {
    const scene = makeScene().scene;
    // id 1 is a transform, not a sprite — no match.
    const { scene: next, changed } = updateComponentProperty(
      scene,
      1,
      'sprite',
      'opacity',
      0.5,
    );
    if (changed) throw new Error('expected changed=false');
    if (next !== scene) throw new Error('expected same reference');
  });

  test('updateComponentProperty: unrelated subtrees keep their references', () => {
    const scene = makeScene().scene;
    const originalChildren = scene.components as readonly unknown[];
    const { scene: next } = updateComponentProperty(
      scene,
      2,
      'sprite',
      'opacity',
      0.5,
    );
    const nextChildren = next.components as readonly unknown[];
    // Children that did not match should be the same reference — immutable
    // subtree sharing.
    if (nextChildren[0] !== originalChildren[0]) {
      throw new Error('unrelated transform child should keep its reference');
    }
    if (nextChildren[2] !== originalChildren[2]) {
      throw new Error('unrelated nested nexus should keep its reference');
    }
  });

  test('updateComponentProperty: reaches into nested nexus children', () => {
    const scene = makeScene().scene;
    const { scene: next, changed } = updateComponentProperty(
      scene,
      4,
      'transform',
      'position',
      [9, 9, 9],
    );
    if (!changed) throw new Error('expected changed=true');
    const nested = (next.components as readonly { id?: number }[])[2] as {
      components: readonly { position?: number[] }[];
    };
    const inner = nested.components[0];
    assertDeepEqual(inner?.position, [9, 9, 9]);
  });

  // --- applyComponentUpdate (thin wrapper) --------------------------------

  test('applyComponentUpdate: returns same file when no match', () => {
    const file = makeScene();
    const next = applyComponentUpdate(file, 999, 'transform', 'x', 0);
    if (next !== file) throw new Error('expected same file reference');
  });

  test('applyComponentUpdate: returns new file with updated scene', () => {
    const file = makeScene();
    const next = applyComponentUpdate(file, 2, 'sprite', 'opacity', 0.1);
    if (next === file) throw new Error('expected new file reference');
    if (next.scene === file.scene) {
      throw new Error('expected new scene reference');
    }
    if (next.name !== file.name) {
      throw new Error('unrelated top-level fields should carry through');
    }
  });

  // --- dispatch + stores --------------------------------------------------

  test('dispatch: component:select updates selection store', () => {
    resetStateForTests();
    const observed: Array<number | null> = [];
    selection.subscribe((next) => observed.push(next));
    dispatch(componentSelect(42));
    dispatch(componentSelect(null));
    assertDeepEqual(observed, [42, null]);
    if (selection.get() !== null) {
      throw new Error(`expected null selection, got ${selection.get()}`);
    }
  });

  test('dispatch: scene:load populates the document store', () => {
    resetStateForTests();
    const file = makeScene();
    dispatch(sceneLoad(file));
    if (sceneDocument.get() !== file) {
      throw new Error('expected sceneDocument to hold the loaded file');
    }
  });

  test('dispatch: component:update mutates the scene document immutably', () => {
    resetStateForTests();
    const file = makeScene();
    dispatch(sceneLoad(file));
    dispatch(componentUpdate(2, 'sprite', 'opacity', 0.42));
    const current = sceneDocument.get();
    if (current === null) throw new Error('expected a document');
    if (current === file) throw new Error('expected new file reference');
    const sprite = (
      current.scene.components as readonly { id?: number }[]
    ).find((c) => c.id === 2) as { opacity: number };
    if (sprite.opacity !== 0.42) {
      throw new Error(`expected opacity=0.42, got ${sprite.opacity}`);
    }
  });

  test('dispatch: component:update with no document open is a no-op', () => {
    resetStateForTests();
    let calls = 0;
    sceneDocument.subscribe(() => {
      calls += 1;
    });
    dispatch(componentUpdate(1, 'transform', 'x', 0));
    if (calls !== 0) throw new Error('did not expect sceneDocument to change');
    if (sceneDocument.get() !== null) {
      throw new Error('expected sceneDocument to remain null');
    }
  });

  test('dispatch: scene:save does not mutate stores', () => {
    resetStateForTests();
    let sceneCalls = 0;
    let selectionCalls = 0;
    sceneDocument.subscribe(() => {
      sceneCalls += 1;
    });
    selection.subscribe(() => {
      selectionCalls += 1;
    });
    dispatch(sceneSave());
    if (sceneCalls !== 0 || selectionCalls !== 0) {
      throw new Error('scene:save must not mutate stores');
    }
  });

  test('subscribeMessages: observes every dispatched message', () => {
    resetStateForTests();
    const observed: EditorMessage[] = [];
    const unsub = subscribeMessages((msg) => observed.push(msg));
    dispatch(componentSelect(1));
    dispatch(sceneSave());
    unsub();
    dispatch(componentSelect(2));
    assertDeepEqual(observed, [componentSelect(1), sceneSave()]);
  });

  test('subscribeMessages: unsubscribe stops delivery', () => {
    resetStateForTests();
    let calls = 0;
    const unsub = subscribeMessages(() => {
      calls += 1;
    });
    dispatch(componentSelect(1));
    unsub();
    dispatch(componentSelect(2));
    if (calls !== 1) throw new Error(`expected 1 message, got ${calls}`);
  });
}
