import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDocumentController,
  type DocumentControllerDependencies,
} from '../app/document-controller';
import type { Bridge } from '../bridge/protocol-bridge';
import {
  componentSelect,
  componentUpdate,
  sceneLoad,
  sceneSave,
  type EditorMessage,
  type JsonValue,
} from '../protocol';

interface FakeBridge extends Bridge {
  readonly __received: EditorMessage[];
  readonly __deliver: (msg: EditorMessage) => void;
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
    __deliver(msg) {
      for (const l of [...listeners]) l(msg);
    },
  };
}

function sampleScene(selection: number[] = []): JsonValue {
  return {
    omoscene: 1,
    engine: '0.1.0',
    editor: { selection },
    scene: { type: 'nexus', id: 0, name: 'Root', components: [] },
  };
}

function fakeDeps(file: JsonValue): DocumentControllerDependencies & {
  readonly __writes: Array<{ uri: string; file: JsonValue }>;
} {
  const writes: Array<{ uri: string; file: JsonValue }> = [];
  return {
    readFile: async () => file,
    writeFile: async (uri, next) => {
      writes.push({ uri, file: next });
    },
    __writes: writes,
  };
}

test('createDocumentController starts unloaded', () => {
  const controller = createDocumentController(fakeDeps(sampleScene()));
  assert.equal(controller.uri, null);
  assert.equal(controller.editorState.sceneDocument.get(), null);
  assert.equal(controller.editorState.dirty.get(), false);
});

test('load hydrates editorState and registered panels', async () => {
  const file = sampleScene([3]);
  const controller = createDocumentController(fakeDeps(file));
  const a = fakeBridge();
  controller.registerPanel(a);
  a.__received.length = 0;

  await controller.load('/tmp/a.omoscene');
  assert.equal(controller.uri, '/tmp/a.omoscene');
  assert.deepEqual(controller.editorState.sceneDocument.get(), file);
  assert.deepEqual(controller.editorState.selection.get(), [3]);
  assert.deepEqual(a.__received, [sceneLoad(file)]);
});

test('two stub views stay in sync on component:update', async () => {
  const controller = createDocumentController(fakeDeps(sampleScene()));
  await controller.load('/tmp/sync.omoscene');

  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  const msg = componentUpdate(1, 'transform', 'opacity', 0.5);
  a.__deliver(msg);

  assert.deepEqual(b.__received, [msg]);
  assert.equal(a.__received.length, 0);
  assert.equal(controller.editorState.dirty.get(), true);
});

test('late-registered view receives current snapshot via scene:load', async () => {
  const file = sampleScene([9]);
  const controller = createDocumentController(fakeDeps(file));
  await controller.load('/tmp/late.omoscene');

  const late = fakeBridge();
  controller.registerPanel(late);
  assert.deepEqual(late.__received, [sceneLoad(file)]);
});

test('broker skips source panel on component:select', async () => {
  const controller = createDocumentController(fakeDeps(sampleScene()));
  await controller.load('/tmp/sel.omoscene');
  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  a.__deliver(componentSelect([42]));
  assert.deepEqual(controller.editorState.selection.get(), [42]);
  assert.deepEqual(b.__received, [componentSelect([42])]);
  assert.equal(a.__received.length, 0);
});

test('dispatchFromHost fans to every panel', async () => {
  const controller = createDocumentController(fakeDeps(sampleScene()));
  await controller.load('/tmp/host.omoscene');
  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  controller.dispatchFromHost(componentSelect([7]));
  assert.deepEqual(a.__received, [componentSelect([7])]);
  assert.deepEqual(b.__received, [componentSelect([7])]);
});

test('scene:save writes via deps and does not broadcast', async () => {
  const file = sampleScene();
  const deps = fakeDeps(file);
  const controller = createDocumentController(deps);
  await controller.load('/tmp/save.omoscene');
  const a = fakeBridge();
  controller.registerPanel(a);
  a.__received.length = 0;

  a.__deliver(sceneSave());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(deps.__writes.length, 1);
  assert.equal(deps.__writes[0]!.uri, '/tmp/save.omoscene');
  assert.equal(a.__received.length, 0);
  assert.equal(controller.editorState.dirty.get(), false);
});

test('unregister stops further fan-out to that panel', async () => {
  const controller = createDocumentController(fakeDeps(sampleScene()));
  await controller.load('/tmp/unreg.omoscene');
  const a = fakeBridge();
  const b = fakeBridge();
  const unregB = controller.registerPanel(b);
  controller.registerPanel(a);
  a.__received.length = 0;
  b.__received.length = 0;
  unregB();

  a.__deliver(componentSelect([1]));
  assert.equal(b.__received.length, 0);
});
