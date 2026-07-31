/**
 * State module tests.
 *
 * Covers:
 *   - Generic `createStore` subscription / unsubscribe / reference-equality.
 *   - `createEditorState` factory: each call returns an isolated instance
 *     with its own stores, dispatcher, and message subscribers (the
 *     per-document scoping decision from Phase 3.5.1 Option A).
 *   - `dispatch` routing for every protocol variant, including raw-message
 *     subscribers.
 *   - `applyComponentUpdate` / `updateComponentProperty` tree-walk purity:
 *     immutable subtree sharing, unrelated components untouched, no-op when
 *     the target id is missing.
 *
 * This is the Phase 3 exit-criterion proving ground — "a fake selection
 * message flows through the store; mock subscribers observe the change."
 */

import type { OmosceneFile, SerializedScene } from '../omoscene/index.js';
import {
  componentSelect,
  componentUpdate,
  sceneLoad,
  sceneSave,
} from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import {
  applyComponentUpdate,
  createEditorState,
  createStore,
  updateComponentProperty,
} from '../state/index.js';
import { loadSingleFixture, makeScene as makeBaseScene } from './fixtures.js';
import { assertDeepEqual, test } from './harness.js';

// Multi-component tree with a nested nexus — covers the scene-mutation
// walk's primary cases (sibling traversal, nested descent, deep matches).
// Wraps the shared `makeScene` base so each test gets a fresh reference.
function makeScene(): OmosceneFile {
  return makeBaseScene({
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
  });
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

  test('createStore: unsubscribing a not-yet-visited listener mid-notify still delivers this event', () => {
    // Regression for 3.5.3: without snapshotting the listener set before
    // iteration, Set iteration semantics skip entries deleted after the
    // iterator started but before they were yielded. A (subscribed first)
    // unsubscribes B (subscribed second, not yet visited); B should still
    // receive the current event because B existed at set() time.
    const s = createStore(0);
    const receivedByB: number[] = [];
    let unsubB = (): void => undefined;
    s.subscribe(() => {
      unsubB();
    });
    unsubB = s.subscribe((next) => {
      receivedByB.push(next);
    });
    s.set(1);
    s.set(2); // B is gone by now; should not receive.
    assertDeepEqual(receivedByB, [1]);
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

  test('updateComponentProperty: preceding sibling refs preserved when a later sibling changes (3.5.6 lazy rebuild)', () => {
    // After the lazy-rebuild change, siblings encountered before the
    // first divergence keep their references — only from the divergence
    // point onward do we hold new references. Proves the slice-from-index
    // back-fill, not a slice-from-zero.
    const scene = makeScene().scene;
    const originalChildren = scene.components as readonly unknown[];
    // id=3 is the Child nexus, the *third* sibling — updating it forces
    // a rebuild starting at index 2, so [0] and [1] must stay intact.
    const { scene: next, changed } = updateComponentProperty(
      scene,
      3,
      'nexus',
      'label',
      'updated',
    );
    if (!changed) throw new Error('expected changed=true');
    const nextChildren = next.components as readonly unknown[];
    if (nextChildren[0] !== originalChildren[0]) {
      throw new Error('preceding sibling [0] should keep its reference');
    }
    if (nextChildren[1] !== originalChildren[1]) {
      throw new Error('preceding sibling [1] should keep its reference');
    }
    if (nextChildren[2] === originalChildren[2]) {
      throw new Error('matched sibling [2] should be a new reference');
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

  // --- createEditorState isolation ----------------------------------------

  test('createEditorState: two instances have independent stores', () => {
    const a = createEditorState();
    const b = createEditorState();
    a.dispatch(componentSelect([1]));
    b.dispatch(componentSelect([2]));
    assertDeepEqual(a.selection.get(), [1]);
    assertDeepEqual(b.selection.get(), [2]);
  });

  test('createEditorState: message subscribers do not cross instances', () => {
    const a = createEditorState();
    const b = createEditorState();
    const seenByA: EditorMessage[] = [];
    a.subscribeMessages((msg) => seenByA.push(msg));
    b.dispatch(componentSelect([7]));
    if (seenByA.length !== 0) {
      throw new Error(
        `a's listener should not see b's messages; saw ${seenByA.length}`,
      );
    }
  });

  // --- dispatch + stores (per-instance) -----------------------------------

  test('dispatch: component:select updates selection store', () => {
    const state = createEditorState();
    const observed: Array<readonly number[]> = [];
    state.selection.subscribe((next) => observed.push(next));
    state.dispatch(componentSelect([42]));
    state.dispatch(componentSelect([1, 2, 3]));
    state.dispatch(componentSelect([]));
    assertDeepEqual(observed, [[42], [1, 2, 3], []]);
    assertDeepEqual(state.selection.get(), []);
  });

  test('dispatch: scene:load populates the document store', () => {
    const state = createEditorState();
    const file = makeScene();
    state.dispatch(sceneLoad(file));
    if (state.sceneDocument.get() !== file) {
      throw new Error('expected sceneDocument to hold the loaded file');
    }
  });

  test('dispatch: scene:load hydrates selection from file.editor.selection', () => {
    const state = createEditorState();
    const file = makeScene();
    file.editor.selection = [1, 4];
    state.dispatch(sceneLoad(file));
    assertDeepEqual(state.selection.get(), [1, 4]);
  });

  test('dispatch: scene:load selection hydration is a defensive copy', () => {
    // Mutating file.editor.selection after dispatch must not leak into the
    // store's held array. The store should hold its own copy.
    const state = createEditorState();
    const file = makeScene();
    file.editor.selection = [5];
    state.dispatch(sceneLoad(file));
    file.editor.selection.push(6);
    assertDeepEqual(state.selection.get(), [5]);
  });

  test('dispatch: component:update mutates the scene document immutably', () => {
    const state = createEditorState();
    const file = makeScene();
    state.dispatch(sceneLoad(file));
    state.dispatch(componentUpdate(2, 'sprite', 'opacity', 0.42));
    const current = state.sceneDocument.get();
    if (current === null) throw new Error('expected a document');
    if (current === file) throw new Error('expected new file reference');
    const sprite = (
      current.scene.components as readonly { id?: number }[]
    ).find((c) => c.id === 2) as { opacity: number };
    if (sprite.opacity !== 0.42) {
      throw new Error(`expected opacity=0.42, got ${sprite.opacity}`);
    }
  });

  test('dispatch: component:update with stale id warns via console.warn (3.5.13)', () => {
    const state = createEditorState();
    state.dispatch(sceneLoad(makeScene()));

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args);
    };
    try {
      state.dispatch(componentUpdate(9999, 'transform', 'x', 0));
    } finally {
      console.warn = originalWarn;
    }

    if (warnings.length !== 1) {
      throw new Error(`expected 1 warning, got ${warnings.length}`);
    }
    const message = String(warnings[0]?.[0] ?? '');
    if (!message.includes('target not found')) {
      throw new Error(`unexpected warning message: ${message}`);
    }
    if (!message.includes('9999')) {
      throw new Error(`warning should include the stale id; got: ${message}`);
    }
  });

  test('dispatch: component:update with no document open is a no-op', () => {
    const state = createEditorState();
    let calls = 0;
    state.sceneDocument.subscribe(() => {
      calls += 1;
    });
    state.dispatch(componentUpdate(1, 'transform', 'x', 0));
    if (calls !== 0) throw new Error('did not expect sceneDocument to change');
    if (state.sceneDocument.get() !== null) {
      throw new Error('expected sceneDocument to remain null');
    }
  });

  test('dispatch: component:update works against a real engine-fixture scene (3.6.1 structural canary)', () => {
    // Structural canary: load a real engine-fixture, inject ids (engine
    // assigns them during deserialize; hand-authored fixtures omit them),
    // dispatch a property update, assert it took effect. If engine output
    // ever uses a different tree shape — `children` instead of
    // `components`, `kind` instead of `type`, etc. — the fixture updates
    // in lockstep (driven by `engine-fixtures.test.ts` failing first),
    // the scene-mutation walk fails to match, and this test fails —
    // forcing `src/state/scene-mutation.ts` to be updated alongside.
    const loaded = loadSingleFixture('pass/02-single-transform.omoscene');
    const loadedChildren = loaded.scene.components ?? [];
    const augmentedScene: SerializedScene = {
      ...loaded.scene,
      id: 0,
      components: loadedChildren.map((c, i) => ({ ...c, id: i + 1 })),
    };
    const file = makeBaseScene({ scene: augmentedScene });

    const state = createEditorState();
    state.dispatch(sceneLoad(file));
    state.dispatch(
      componentUpdate(1, 'transform', 'scale', {
        _vectorType: 'Vector3D',
        x: 2,
        y: 2,
        z: 2,
      }),
    );

    const current = state.sceneDocument.get();
    if (current === null) throw new Error('expected a document');
    const components = current.scene.components as
      | readonly { id?: number; scale?: unknown }[]
      | undefined;
    const transform = components?.find((c) => c.id === 1);
    if (!transform) {
      throw new Error(
        'transform[id=1] not found — structural drift in engine output?',
      );
    }
    const scale = transform.scale as { x?: number };
    if (scale.x !== 2) {
      throw new Error(`expected scale.x=2, got ${String(scale.x)}`);
    }
  });

  test('dispatch: scene:save does not mutate stores', () => {
    const state = createEditorState();
    let sceneCalls = 0;
    let selectionCalls = 0;
    state.sceneDocument.subscribe(() => {
      sceneCalls += 1;
    });
    state.selection.subscribe(() => {
      selectionCalls += 1;
    });
    state.dispatch(sceneSave());
    if (sceneCalls !== 0 || selectionCalls !== 0) {
      throw new Error('scene:save must not mutate stores');
    }
  });

  test('subscribeMessages: observes every dispatched message', () => {
    const state = createEditorState();
    const observed: EditorMessage[] = [];
    const unsub = state.subscribeMessages((msg) => observed.push(msg));
    state.dispatch(componentSelect([1]));
    state.dispatch(sceneSave());
    unsub();
    state.dispatch(componentSelect([2]));
    assertDeepEqual(observed, [componentSelect([1]), sceneSave()]);
  });

  test('subscribeMessages: unsubscribe stops delivery', () => {
    const state = createEditorState();
    let calls = 0;
    const unsub = state.subscribeMessages(() => {
      calls += 1;
    });
    state.dispatch(componentSelect([1]));
    unsub();
    state.dispatch(componentSelect([2]));
    if (calls !== 1) throw new Error(`expected 1 message, got ${calls}`);
  });

  test('subscribeMessages: unsubscribing a not-yet-visited listener mid-dispatch still delivers this message', () => {
    // Regression for 3.5.3 on the message-listener set. Same semantics as
    // the store-level test above: listeners present at dispatch() time
    // receive the message even if a preceding listener unsubscribed them.
    const state = createEditorState();
    const seenByB: EditorMessage[] = [];
    let unsubB = (): void => undefined;
    state.subscribeMessages(() => {
      unsubB();
    });
    unsubB = state.subscribeMessages((msg) => {
      seenByB.push(msg);
    });
    state.dispatch(componentSelect([1]));
    state.dispatch(componentSelect([2])); // B is gone by now; should not receive.
    if (seenByB.length !== 1) {
      throw new Error(`expected B to see 1 message, got ${seenByB.length}`);
    }
  });
}
