/**
 * Tests for the extension-host document controller + message broker.
 *
 * Covers 5.1: injected I/O (no vscode), fan-out broker, scene:save
 * triggers writeFile, late-joiner hydration, unregister + dispose.
 */

import {
  componentSelect,
  componentUpdate,
  sceneLoad,
  sceneSave,
} from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import type { Bridge } from '../bridge/index.js';
import { createDocumentController } from '../app/document-controller.js';
import type { DocumentControllerDependencies } from '../app/document-controller.js';
import type { OmosceneFile } from '../omoscene/index.js';
import { assertDeepEqual, test } from './harness.js';
import { makeScene } from './fixtures.js';

interface FakeUri {
  readonly fsPath: string;
}
function fakeUri(path: string): FakeUri {
  return { fsPath: path };
}

interface FakeBridge extends Bridge {
  readonly __received: EditorMessage[];
  readonly __deliver: (msg: EditorMessage) => void;
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
    __deliver: (msg: EditorMessage): void => {
      for (const l of [...listeners]) l(msg);
    },
  };
}

function fakeDeps(initialFile: OmosceneFile): DocumentControllerDependencies & {
  __reads: FakeUri[];
  __writes: Array<{ uri: FakeUri; file: OmosceneFile }>;
  __saveErrors: Error[];
} {
  const reads: FakeUri[] = [];
  const writes: Array<{ uri: FakeUri; file: OmosceneFile }> = [];
  const saveErrors: Error[] = [];
  return {
    readFile: async (uri): Promise<OmosceneFile> => {
      reads.push(uri as unknown as FakeUri);
      return Promise.resolve(initialFile);
    },
    writeFile: async (uri, file): Promise<void> => {
      writes.push({ uri: uri as unknown as FakeUri, file });
      return Promise.resolve();
    },
    onSaveError: (err) => saveErrors.push(err),
    __reads: reads,
    __writes: writes,
    __saveErrors: saveErrors,
  };
}

export function runDocumentControllerTests(): void {
  // --- Construction / initial state ---------------------------------------

  test('createDocumentController: starts with no document loaded', () => {
    const deps = fakeDeps(makeScene());
    const controller = createDocumentController(deps);
    if (controller.uri !== null) throw new Error('expected null uri on boot');
    if (controller.editorState.sceneDocument.get() !== null) {
      throw new Error('expected null sceneDocument on boot');
    }
  });

  // --- load / save --------------------------------------------------------

  test('load: reads via deps and dispatches scene:load to editorState', async () => {
    const file = makeScene({ name: 'loaded-scene' });
    const deps = fakeDeps(file);
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/tmp/a.omoscene') as never);
    if (controller.editorState.sceneDocument.get() !== file) {
      throw new Error('editorState did not receive the loaded file');
    }
    if (deps.__reads.length !== 1) {
      throw new Error(`expected 1 read, got ${deps.__reads.length}`);
    }
  });

  test('save: throws if no document has been loaded', async () => {
    const deps = fakeDeps(makeScene());
    const controller = createDocumentController(deps);
    try {
      await controller.save();
      throw new Error('expected save() to throw');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('no document')) {
        throw new Error(`unexpected error: ${String(err)}`);
      }
    }
  });

  test('save: writes current editorState scene back through deps.writeFile', async () => {
    const original = makeScene({ name: 'original' });
    const deps = fakeDeps(original);
    const controller = createDocumentController(deps);
    const uri = fakeUri('/tmp/b.omoscene');
    await controller.load(uri as never);
    await controller.save();
    if (deps.__writes.length !== 1) {
      throw new Error(`expected 1 write, got ${deps.__writes.length}`);
    }
    const write = deps.__writes[0];
    if (!write) throw new Error('no write recorded');
    if (write.uri.fsPath !== '/tmp/b.omoscene') {
      throw new Error(`unexpected uri: ${write.uri.fsPath}`);
    }
    if (write.file !== original) {
      throw new Error('expected write.file to match loaded scene');
    }
  });

  // --- Broker / fan-out ---------------------------------------------------

  test('broker: message from panel A reaches editorState AND panel B', async () => {
    const file = makeScene();
    const deps = fakeDeps(file);
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/x') as never);

    const a = fakeBridge();
    const b = fakeBridge();
    controller.registerPanel(a);
    controller.registerPanel(b);

    // Clear the hydration scene:load deliveries so assertions below are clean.
    a.__received.length = 0;
    b.__received.length = 0;

    a.__deliver(componentSelect([42]));

    if (controller.editorState.selection.get()[0] !== 42) {
      throw new Error('host editorState selection did not update');
    }
    assertDeepEqual(b.__received, [componentSelect([42])]);
    if (a.__received.length !== 0) {
      throw new Error('source panel must not receive its own message back');
    }
  });

  test('broker: scene:save triggers writeFile (not a broadcast)', async () => {
    const file = makeScene();
    const deps = fakeDeps(file);
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/save-test') as never);

    const a = fakeBridge();
    const b = fakeBridge();
    controller.registerPanel(a);
    controller.registerPanel(b);
    a.__received.length = 0;
    b.__received.length = 0;

    a.__deliver(sceneSave());
    // save() is async; let the microtask queue drain.
    await Promise.resolve();
    await Promise.resolve();

    if (deps.__writes.length !== 1) {
      throw new Error(`expected 1 write, got ${deps.__writes.length}`);
    }
    if (b.__received.length !== 0) {
      throw new Error('scene:save must not be broadcast to other panels');
    }
  });

  test('broker: component:update mutates host state AND fans out to peers', async () => {
    const file = makeScene({
      scene: {
        type: 'nexus',
        name: 'Root',
        id: 0,
        unique: 0,
        components: [{ type: 'sprite', id: 7, opacity: 1 }],
      },
    });
    const deps = fakeDeps(file);
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/m') as never);

    const a = fakeBridge();
    const b = fakeBridge();
    controller.registerPanel(a);
    controller.registerPanel(b);
    a.__received.length = 0;
    b.__received.length = 0;

    a.__deliver(componentUpdate(7, 'sprite', 'opacity', 0.25));

    const current = controller.editorState.sceneDocument.get();
    if (current === null) throw new Error('expected document');
    const sprite = (
      current.scene.components as readonly { id?: number; opacity?: number }[]
    ).find((c) => c.id === 7);
    if (sprite?.opacity !== 0.25) {
      throw new Error(`host state not updated, got ${String(sprite?.opacity)}`);
    }
    assertDeepEqual(b.__received, [
      componentUpdate(7, 'sprite', 'opacity', 0.25),
    ]);
  });

  // --- Panel lifecycle ----------------------------------------------------

  test('registerPanel: late-joiner is hydrated with current scene:load', async () => {
    const file = makeScene({ name: 'hydrate-test' });
    const deps = fakeDeps(file);
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/h') as never);

    const late = fakeBridge();
    controller.registerPanel(late);

    assertDeepEqual(late.__received, [sceneLoad(file)]);
  });

  test('registerPanel: unregister stops routing from that panel', async () => {
    const deps = fakeDeps(makeScene());
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/u') as never);

    const a = fakeBridge();
    const b = fakeBridge();
    const unregA = controller.registerPanel(a);
    controller.registerPanel(b);
    a.__received.length = 0;
    b.__received.length = 0;

    unregA();
    a.__deliver(componentSelect([1]));

    // Host editorState should NOT have updated (a is gone).
    if (controller.editorState.selection.get().length !== 0) {
      throw new Error('unregistered panel messages must not route');
    }
    if (b.__received.length !== 0) {
      throw new Error('no peer should receive a gone-panel message');
    }
  });

  test('dispose: severs every panel', async () => {
    const deps = fakeDeps(makeScene());
    const controller = createDocumentController(deps);
    await controller.load(fakeUri('/d') as never);

    const a = fakeBridge();
    const b = fakeBridge();
    controller.registerPanel(a);
    controller.registerPanel(b);
    a.__received.length = 0;
    b.__received.length = 0;

    controller.dispose();
    a.__deliver(componentSelect([5]));

    if (controller.editorState.selection.get().length !== 0) {
      throw new Error('messages after dispose must not route');
    }
    if (b.__received.length !== 0) {
      throw new Error('peer should receive nothing after dispose');
    }
  });

  test('broker: surface save errors via onSaveError', async () => {
    const boomDeps: DocumentControllerDependencies & {
      __saveErrors: Error[];
    } = {
      readFile: async (): Promise<OmosceneFile> => Promise.resolve(makeScene()),
      writeFile: (): Promise<void> => Promise.reject(new Error('disk full')),
      onSaveError: (err) => boomDeps.__saveErrors.push(err),
      __saveErrors: [],
    };
    const controller = createDocumentController(boomDeps);
    await controller.load(fakeUri('/boom') as never);
    const a = fakeBridge();
    controller.registerPanel(a);

    a.__deliver(sceneSave());
    await Promise.resolve();
    await Promise.resolve();

    if (boomDeps.__saveErrors.length !== 1) {
      throw new Error(
        `expected 1 save error, got ${boomDeps.__saveErrors.length}`,
      );
    }
    const msg = boomDeps.__saveErrors[0]?.message ?? '';
    if (!msg.includes('disk full')) {
      throw new Error(`unexpected save error: ${msg}`);
    }
  });
}
