import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDocumentRegistry,
  followActiveController,
} from '../app/document-registry';
import type { DocumentControllerDependencies } from '../app/document-controller';
import type { Bridge } from '../bridge/protocol-bridge';
import {
  createEmptyOmosceneFile,
  type OmosceneFile,
} from '../omoscene';
import { sceneLoad, type EditorMessage } from '../protocol';

function sampleScene(): OmosceneFile {
  return createEmptyOmosceneFile({ name: 'Sample', engine: '0.1.0' });
}

function fakeDeps(
  file: OmosceneFile = sampleScene(),
): DocumentControllerDependencies {
  return {
    readFile: async () => file,
    writeFile: async () => undefined,
  };
}

interface FakeBridge extends Bridge {
  readonly __received: EditorMessage[];
}

function fakeBridge(): FakeBridge {
  const received: EditorMessage[] = [];
  const listeners = new Set<(msg: EditorMessage) => void>();
  return {
    dispatch(msg) {
      received.push(msg);
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
    },
    __received: received,
  };
}

test('getOrCreateController returns same instance per uri', () => {
  const registry = createDocumentRegistry(fakeDeps());
  const a = registry.getOrCreateController('/a.omoscene');
  const b = registry.getOrCreateController('/a.omoscene');
  assert.equal(a, b);
  assert.notEqual(a, registry.getOrCreateController('/b.omoscene'));
  registry.dispose();
});

test('setActiveUri tracks activeController store', () => {
  const registry = createDocumentRegistry(fakeDeps());
  const ctrl = registry.getOrCreateController('/a.omoscene');
  assert.equal(registry.activeController.get(), null);
  registry.setActiveUri('/a.omoscene');
  assert.equal(registry.activeController.get(), ctrl);
  registry.setActiveUri(null);
  assert.equal(registry.activeController.get(), null);
  registry.dispose();
});

test('disposeController clears active when needed', () => {
  const registry = createDocumentRegistry(fakeDeps());
  const ctrl = registry.getOrCreateController('/a.omoscene');
  registry.setActiveUri('/a.omoscene');
  registry.disposeController('/a.omoscene');
  assert.equal(registry.getController('/a.omoscene'), null);
  assert.equal(registry.activeController.get(), null);
  void ctrl;
  registry.dispose();
});

test('followActiveController hydrates on bind after load', async () => {
  const file = sampleScene();
  const registry = createDocumentRegistry(fakeDeps(file));
  const ctrl = registry.getOrCreateController('/a.omoscene');
  await ctrl.load('/a.omoscene');

  const bridge = fakeBridge();
  const stop = followActiveController(bridge, registry);
  assert.equal(bridge.__received.length, 0);

  registry.setActiveUri('/a.omoscene');
  assert.deepEqual(bridge.__received, [sceneLoad(file)]);

  stop();
  registry.dispose();
});

test('onControllerCreated fires once per new uri', () => {
  const registry = createDocumentRegistry(fakeDeps());
  const seen: string[] = [];
  const unsub = registry.onControllerCreated((c) => {
    seen.push(c.uri ?? 'new');
  });
  registry.getOrCreateController('/a.omoscene');
  registry.getOrCreateController('/a.omoscene');
  registry.getOrCreateController('/b.omoscene');
  assert.equal(seen.length, 2);
  unsub();
  registry.dispose();
});
