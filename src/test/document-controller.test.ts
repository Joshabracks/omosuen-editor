import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDocumentController,
  type DocumentControllerDependencies,
} from '../app/document-controller';
import type { Bridge } from '../bridge/protocol-bridge';
import {
  createEmptyOmosceneFile,
  type OmosceneFile,
} from '../omoscene';
import {
  componentAdd,
  componentMove,
  componentRemove,
  componentSelect,
  componentUpdate,
  sceneLoad,
  sceneSave,
  type EditorMessage,
} from '../protocol';
import {
  findComponentById,
  insertChildComponent,
} from '../scene';

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

function sampleScene(selection: number[] = []): OmosceneFile {
  const file = createEmptyOmosceneFile({ name: 'Sample', engine: '0.1.0' });
  const withChild = insertChildComponent(file, 0, {
    type: 'transform',
    name: 'T',
    id: 1,
    unique: 0,
    opacity: 1,
  });
  return {
    ...withChild,
    editor: { ...withChild.editor, selection: [...selection] },
  };
}

/** Root → nexus(2) → nested nexus(3); transform(1) sibling of nexus(2). */
function nestedScene(): OmosceneFile {
  let file = sampleScene();
  file = insertChildComponent(file, 0, {
    type: 'nexus',
    name: 'Child',
    id: 2,
    unique: 0,
    components: [],
  });
  file = insertChildComponent(file, 2, {
    type: 'nexus',
    name: 'Grand',
    id: 3,
    unique: 0,
    components: [],
  });
  return file;
}

function fakeDeps(file: OmosceneFile): DocumentControllerDependencies & {
  readonly __writes: Array<{ uri: string; file: OmosceneFile }>;
} {
  const writes: Array<{ uri: string; file: OmosceneFile }> = [];
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

test('scene:save writes via deps, persists selection, clears dirty', async () => {
  const file = sampleScene();
  const deps = fakeDeps(file);
  const controller = createDocumentController(deps);
  await controller.load('/tmp/save.omoscene');
  controller.dispatchFromHost(componentSelect([11]));
  const a = fakeBridge();
  controller.registerPanel(a);
  a.__received.length = 0;

  a.__deliver(sceneSave());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(deps.__writes.length, 1);
  assert.equal(deps.__writes[0]!.uri, '/tmp/save.omoscene');
  assert.deepEqual(deps.__writes[0]!.file.editor.selection, [11]);
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

test('structural add fans incremental verb (not scene:load) + select', async () => {
  const controller = createDocumentController(fakeDeps(sampleScene()));
  await controller.load('/tmp/add.omoscene');
  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  const add = componentAdd(0, 'sprite', { name: 'Hero' });
  a.__deliver(add);

  assert.equal(
    b.__received.some((m) => m.kind === 'scene:load'),
    false,
    'peers must not get a full scene:load for structural add',
  );
  assert.equal(b.__received[0]?.kind, 'component:add');
  assert.deepEqual(b.__received[0], add);
  assert.equal(b.__received[1]?.kind, 'component:select');
  assert.equal(a.__received.length, 0);

  const doc = controller.editorState.sceneDocument.get();
  assert.ok(doc);
  const sprite = doc!.scene.components?.find((c) => c.type === 'sprite');
  assert.ok(sprite && typeof sprite.id === 'number');
  assert.deepEqual(controller.editorState.selection.get(), [sprite!.id]);
  assert.equal(controller.editorState.dirty.get(), true);
});

test('structural remove fans incremental verb and clears selection', async () => {
  const controller = createDocumentController(fakeDeps(sampleScene([1])));
  await controller.load('/tmp/rm.omoscene');
  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  const remove = componentRemove(1);
  controller.dispatchFromHost(remove);

  assert.deepEqual(a.__received[0], remove);
  assert.deepEqual(b.__received[0], remove);
  assert.equal(
    a.__received.some((m) => m.kind === 'scene:load'),
    false,
  );
  assert.deepEqual(a.__received[1], componentSelect([]));
  assert.equal(
    findComponentById(controller.editorState.sceneDocument.get()!.scene, 1),
    null,
  );
});

test('structural move fans incremental verb', async () => {
  const controller = createDocumentController(fakeDeps(nestedScene()));
  await controller.load('/tmp/move.omoscene');
  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  const move = componentMove(1, 2, 0);
  a.__deliver(move);

  assert.deepEqual(b.__received, [move]);
  assert.equal(a.__received.length, 0);
  const parent = findComponentById(
    controller.editorState.sceneDocument.get()!.scene,
    2,
  );
  assert.ok(
    parent?.components?.some((c) => c && (c as { id?: number }).id === 1),
  );
});

test('cycle reparent is rejected and not broadcast', async () => {
  const controller = createDocumentController(fakeDeps(nestedScene()));
  await controller.load('/tmp/cycle.omoscene');
  const before = controller.editorState.sceneDocument.get();
  const a = fakeBridge();
  const b = fakeBridge();
  controller.registerPanel(a);
  controller.registerPanel(b);
  a.__received.length = 0;
  b.__received.length = 0;

  // Move nexus 2 under its descendant 3 → cycle.
  a.__deliver(componentMove(2, 3));

  assert.equal(controller.editorState.sceneDocument.get(), before);
  assert.equal(b.__received.length, 0);
  assert.equal(a.__received.length, 0);
  assert.equal(controller.editorState.dirty.get(), false);
});
