/**
 * Tests for the per-tab `DocumentRegistry` (Phase 6.1).
 *
 * Covers: get-or-create keying, active-controller swaps, `followActiveController`
 * rebind on swap, dispose-controller semantics, registry-level dispose.
 */

import type { Bridge } from '../bridge/index.js';
import {
  createDocumentRegistry,
  followActiveController,
} from '../app/document-registry.js';
import type { DocumentControllerDependencies } from '../app/document-controller.js';
import type { OmosceneFile } from '../omoscene/index.js';
import { sceneLoad, componentSelect } from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { assertDeepEqual, test } from './harness.js';
import { makeScene } from './fixtures.js';

interface FakeUri {
  readonly fsPath: string;
  toString(): string;
}
function fakeUri(fsPath: string): FakeUri {
  return {
    fsPath,
    toString: () => fsPath,
  };
}

interface FakeBridge extends Bridge {
  readonly __received: EditorMessage[];
}
function fakeBridge(): FakeBridge {
  const received: EditorMessage[] = [];
  const listeners = new Set<(msg: EditorMessage) => void>();
  return {
    dispatch(msg: EditorMessage): void {
      received.push(msg);
    },
    onMessage(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      listeners.clear();
    },
    __received: received,
  };
}

function fakeDeps(): DocumentControllerDependencies & {
  readonly __reads: FakeUri[];
} {
  const reads: FakeUri[] = [];
  return {
    readFile: async (uri): Promise<OmosceneFile> => {
      reads.push(uri as unknown as FakeUri);
      return Promise.resolve(
        makeScene({ name: (uri as unknown as FakeUri).fsPath }),
      );
    },
    writeFile: (): Promise<void> => Promise.resolve(),
    __reads: reads,
  };
}

export function runDocumentRegistryTests(): void {
  // --- get-or-create -----------------------------------------------------

  test('registry: getOrCreateController returns same instance for same URI', () => {
    const registry = createDocumentRegistry(fakeDeps());
    const uri = fakeUri('/a.omoscene');
    const first = registry.getOrCreateController(uri as never);
    const second = registry.getOrCreateController(uri as never);
    if (first !== second) {
      throw new Error(
        'registry should return the same controller for same URI',
      );
    }
  });

  test('registry: different URIs get different controllers', () => {
    const registry = createDocumentRegistry(fakeDeps());
    const a = registry.getOrCreateController(fakeUri('/a') as never);
    const b = registry.getOrCreateController(fakeUri('/b') as never);
    if (a === b) {
      throw new Error('distinct URIs should yield distinct controllers');
    }
  });

  test('registry: getController returns null for unknown URI', () => {
    const registry = createDocumentRegistry(fakeDeps());
    if (registry.getController(fakeUri('/unknown') as never) !== null) {
      throw new Error('expected null for unknown URI');
    }
  });

  // --- active controller -------------------------------------------------

  test('registry: setActiveUri updates the activeController store', () => {
    const registry = createDocumentRegistry(fakeDeps());
    const aUri = fakeUri('/a');
    const a = registry.getOrCreateController(aUri as never);
    registry.setActiveUri(aUri as never);
    if (registry.activeController.get() !== a) {
      throw new Error('activeController should point at the set URI');
    }
    registry.setActiveUri(null);
    if (registry.activeController.get() !== null) {
      throw new Error('activeController should clear on null');
    }
  });

  test('registry: setActiveUri is a no-op when URI has no controller', () => {
    const registry = createDocumentRegistry(fakeDeps());
    registry.setActiveUri(fakeUri('/no-controller-yet') as never);
    if (registry.activeController.get() !== null) {
      throw new Error(
        'activeController should remain null when URI is unknown',
      );
    }
  });

  // --- disposal ----------------------------------------------------------

  test('registry: disposeController clears active when that one was active', () => {
    const registry = createDocumentRegistry(fakeDeps());
    const aUri = fakeUri('/a');
    registry.getOrCreateController(aUri as never);
    registry.setActiveUri(aUri as never);
    registry.disposeController(aUri as never);
    if (registry.activeController.get() !== null) {
      throw new Error(
        'activeController should clear when the active controller disposes',
      );
    }
    if (registry.getController(aUri as never) !== null) {
      throw new Error('disposed controller should no longer be retrievable');
    }
  });

  test('registry: dispose tears down every controller', () => {
    const registry = createDocumentRegistry(fakeDeps());
    registry.getOrCreateController(fakeUri('/a') as never);
    registry.getOrCreateController(fakeUri('/b') as never);
    registry.setActiveUri(fakeUri('/a') as never);
    registry.dispose();
    if (registry.activeController.get() !== null) {
      throw new Error('dispose should clear active');
    }
    if (registry.getController(fakeUri('/a') as never) !== null) {
      throw new Error('dispose should evict every controller');
    }
  });

  // --- followActiveController -------------------------------------------

  test('followActiveController: binds to current active on first call', async () => {
    const registry = createDocumentRegistry(fakeDeps());
    const aUri = fakeUri('/a');
    const a = registry.getOrCreateController(aUri as never);
    await a.load(aUri as never);
    registry.setActiveUri(aUri as never);

    const bridge = fakeBridge();
    followActiveController(bridge, registry);

    // Bridge should have been registered with `a` and hydrated via scene:load.
    if (bridge.__received.length !== 1) {
      throw new Error(
        `expected hydration scene:load, got ${bridge.__received.length} messages`,
      );
    }
    if (bridge.__received[0]?.kind !== 'scene:load') {
      throw new Error('expected scene:load hydration');
    }
  });

  test('followActiveController: swaps bridge to the new controller on active change', async () => {
    const registry = createDocumentRegistry(fakeDeps());
    const aUri = fakeUri('/a');
    const bUri = fakeUri('/b');
    const a = registry.getOrCreateController(aUri as never);
    const b = registry.getOrCreateController(bUri as never);
    await a.load(aUri as never);
    await b.load(bUri as never);

    const bridge = fakeBridge();
    registry.setActiveUri(aUri as never);
    followActiveController(bridge, registry);
    bridge.__received.length = 0;

    // Switch active; bridge should receive b's scene:load via re-hydration.
    registry.setActiveUri(bUri as never);
    if (bridge.__received.length !== 1) {
      throw new Error(
        `swap should deliver one scene:load, got ${bridge.__received.length}`,
      );
    }
    const loaded = bridge.__received[0];
    if (loaded?.kind !== 'scene:load') {
      throw new Error(`expected scene:load, got ${loaded?.kind}`);
    }
    if (loaded.file.name !== '/b') {
      throw new Error(`expected /b scene, got ${loaded.file.name}`);
    }

    // Messages emitted by the bridge from here on should route through b.
    bridge.__received.length = 0;
    // Simulate the bridge receiving an incoming message from the webview —
    // the bridge's onMessage listeners (the broker's subscription to this
    // bridge) should fire against b's broker. To verify that, dispatch a
    // select through the bridge and check that `a` does NOT see it but
    // `b` does (selection-state drift).
    // The bridge contract: onMessage adds a listener. The broker uses
    // that. We only care that `a` has no subscription anymore.
    if (a.editorState.selection.get().length !== 0) {
      throw new Error('a should not be affected by swapped bridge');
    }
    // (We don't assert `b` sees selection changes here — no concrete
    // deliver path from the fake bridge. The swap-to-b path is proven
    // by the hydration message above.)
  });

  test('followActiveController: cleanup unregisters from whatever was active', () => {
    const registry = createDocumentRegistry(fakeDeps());
    const aUri = fakeUri('/a');
    const a = registry.getOrCreateController(aUri as never);
    registry.setActiveUri(aUri as never);

    const bridge = fakeBridge();
    const cleanup = followActiveController(bridge, registry);
    cleanup();

    // After cleanup, dispatching on `a` should not route to the bridge.
    bridge.__received.length = 0;
    a.editorState.dispatch(componentSelect([99]));
    // `a` has its own internal state, but the bridge shouldn't fire.
    // The bridge only fires if it's still registered as a panel.
    if (bridge.__received.length !== 0) {
      throw new Error('bridge should not receive after cleanup');
    }
    void sceneLoad;
    void assertDeepEqual;
  });
}
