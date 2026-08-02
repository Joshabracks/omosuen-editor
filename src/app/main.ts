import { State } from '@state-street/state-street';
import type {
  ChoicePromptRequest,
  DirEntryDto,
  FileFilter,
  FsChangedEvent,
  PopOutRequest,
  PopOutResult,
  ShellBusEnvelope,
  TextPromptRequest,
  WindowClosedEvent,
  WindowDragAttachAck,
  WindowDragAttachEvent,
  WindowDragDetachEvent,
  WindowDragEndRequest,
  WindowDragEndResult,
  WindowDragHoverEvent,
  WindowDragMoveRequest,
  WindowDragStartRequest,
  WindowInfo,
} from '../bridge/channels';
import { isMenuCommandId } from '../bridge/channels';
import '../component';
import { createEmptyOmosceneFile, withEditorMetadata } from '../omoscene';
import { componentSelect } from '../protocol';
import {
  buildDefaultComponent,
  findComponentById,
  insertChildComponent,
} from '../scene';
import { createDocumentController } from './document-controller';
import {
  DockController,
  DockViewRegistry,
  SHELL_DOCK_LAYOUT_KEY,
  closeTab,
  collectViewIds,
  createDefaultLayout,
  createIdFactory,
  createPopOutLayout,
  insertView,
  readPersistedLayout,
  registerPlaceholderViews,
  renderDockNode,
  viewHostElementId,
  type DockLayout,
} from '../dock/index';
import { registerShellViews } from '../dock/shell-views';
import {
  EDITOR_OPEN_BUS_TYPE,
  type EditorOpenPayload,
} from '../views/file-explorer';
import { getInspectorHandle } from '../views/inspector';
import { appendOutput } from '../views/output';
import {
  getProblemsHandle,
  type ProblemDiagnostic,
} from '../views/problems';
import {
  TEXT_BUFFER_VIEW_ID,
  getEditorsHandle,
  type EditorOpenMode,
  type EditorReveal,
} from '../views/text-buffer';
import {
  parseViewIdsFromLocation,
  parseWindowInfoFromLocation,
} from './window-info';

export {};

declare global {
  interface Window {
    omosuen?: {
      ping: () => Promise<string>;
      getSetting: (key: string) => Promise<unknown>;
      setSetting: (key: string, value: unknown) => Promise<unknown>;
      getWorkspaceRoot: () => Promise<string | null>;
      openFolder: () => Promise<string | null>;
      openFile: (filters?: FileFilter[]) => Promise<string | null>;
      saveFile: (
        defaultName?: string,
        filters?: FileFilter[],
      ) => Promise<string | null>;
      promptText: (request: TextPromptRequest) => Promise<string | null>;
      promptChoice: (request: ChoicePromptRequest) => Promise<string | null>;
      listDir: (relativePath?: string) => Promise<DirEntryDto[]>;
      readTextFile: (relativePath: string) => Promise<string>;
      writeTextFile: (relativePath: string, contents: string) => Promise<string>;
      revealInOs: (relativePath: string) => Promise<void>;
      listEngineVersions: () => Promise<
        ReadonlyArray<{
          readonly tag: string;
          readonly label: string;
          readonly prerelease?: boolean;
        }>
      >;
      getProjectManifest: () => Promise<{
        name: string;
        engineVersion: string;
        mainScene: string;
      } | null>;
      createProject: (request: {
        name: string;
        engineVersion?: string;
      }) => Promise<{
        projectDir: string;
        slug: string;
        manifest: { name: string; engineVersion: string };
      } | null>;
      changeEngineVersion: () => Promise<{ version: string } | null>;
      ensureEngine: (version?: string) => Promise<{
        version: string;
        cacheDir: string;
        umdPath: string;
        umdUrl: string;
        extraPaths: readonly string[];
        downloaded: boolean;
      }>;
      resolveEngine: (version: string) => Promise<{
        version: string;
        cacheDir: string;
        umdPath: string;
        umdUrl: string;
        extraPaths: readonly string[];
        downloaded: boolean;
      }>;
      getWindowInfo: () => Promise<WindowInfo>;
      popOutView: (request: PopOutRequest) => Promise<PopOutResult>;
      dragStart: (
        request: WindowDragStartRequest,
      ) => Promise<{ sessionId: string }>;
      dragMove: (request: WindowDragMoveRequest) => Promise<void>;
      dragEnd: (request: WindowDragEndRequest) => Promise<WindowDragEndResult>;
      dragCancel: () => Promise<void>;
      closeAllPopouts: () => Promise<void>;
      syncViews: (viewIds: string[]) => Promise<void>;
      returnView: (viewId: string) => Promise<void>;
      ackDragAttach: (ack: WindowDragAttachAck) => void;
      publishShellBus: (message: {
        type: string;
        payload?: unknown;
      }) => Promise<void>;
      onWorkspaceChanged: (
        callback: (root: string | null) => void,
      ) => () => void;
      onFsChanged: (callback: (event: FsChangedEvent) => void) => () => void;
      onMenuCommand: (callback: (command: string) => void) => () => void;
      onWindowClosed: (
        callback: (event: WindowClosedEvent) => void,
      ) => () => void;
      onShellBus: (callback: (message: ShellBusEnvelope) => void) => () => void;
      onDragDetach: (
        callback: (event: WindowDragDetachEvent) => void,
      ) => () => void;
      onDragHover: (
        callback: (event: WindowDragHoverEvent) => void,
      ) => () => void;
      onDragLeave: (
        callback: (event: { sessionId: string }) => void,
      ) => () => void;
      onDragAttach: (
        callback: (event: WindowDragAttachEvent) => void,
      ) => () => void;
    };
  }
}

interface ShellData {
  statusMessage: string;
  bridgeStatus: string;
  layout: DockLayout;
  isPopout: boolean;
}

const registry = new DockViewRegistry();
registerPlaceholderViews(registry);

function createDemoScene() {
  const base = createEmptyOmosceneFile({
    name: 'Demo',
    engine: 'v0.24.1',
  });
  // Scene root nexus (id 0) is the scene — not shown in the tree.
  // Child nexus + transform mirrors a typical authored entity.
  let file = insertChildComponent(base, 0, {
    type: 'nexus',
    name: 'Player',
    id: 1,
    unique: 0,
    components: [],
  });
  file = insertChildComponent(
    file,
    1,
    buildDefaultComponent({
      type: 'transform',
      id: 2,
      engineVersion: 'v0.24.1',
      name: 'Transform',
    }),
  );
  return withEditorMetadata(file, {
    ...file.editor,
    treeState: { '1': true },
    selection: [2],
  });
}

/** In-process document broker for scene tree + inspector. */
const shellDocument = createDocumentController({
  readFile: async () => createDemoScene(),
  writeFile: async () => undefined,
});

function syncInspectorFromDocument(): void {
  const file = shellDocument.editorState.sceneDocument.get();
  const ids = shellDocument.editorState.selection.get();
  const handle = getInspectorHandle();
  if (!handle) return;
  if (!file || ids.length === 0) {
    handle.setSelection(null);
    return;
  }
  const components = ids
    .map((id) => findComponentById(file.scene, id))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({ ...c, id: c.id!, type: c.type }));
  handle.setSelection(components.length > 0 ? { components } : null);
}

let requestOpenFileImpl: (
  relativePath: string,
  mode: EditorOpenMode,
  reveal?: EditorReveal,
) => void = () => {
  // assigned after shell boots
};

let statusSink: ((message: string) => void) | null = null;

registerShellViews(
  registry,
  {
    listDir: (relativePath) => {
      const api = window.omosuen;
      if (!api) return Promise.reject(new Error('bridge unavailable'));
      return api.listDir(relativePath);
    },
    getWorkspaceRoot: () => {
      const api = window.omosuen;
      if (!api) return Promise.resolve(null);
      return api.getWorkspaceRoot();
    },
    onWorkspaceChanged: (callback) => {
      const api = window.omosuen;
      if (!api) return () => {};
      return api.onWorkspaceChanged(callback);
    },
    onFsChanged: (callback) => {
      const api = window.omosuen;
      if (!api?.onFsChanged) return () => {};
      return api.onFsChanged(() => {
        callback();
      });
    },
    revealInOs: async (relativePath) => {
      const api = window.omosuen;
      if (!api) throw new Error('bridge unavailable');
      await api.revealInOs(relativePath);
    },
    requestOpenFile: (relativePath, mode) => {
      requestOpenFileImpl(relativePath, mode);
    },
  },
  {
    writeTextFile: (relativePath, contents) => {
      const api = window.omosuen;
      if (!api) return Promise.reject(new Error('bridge unavailable'));
      return api.writeTextFile(relativePath, contents);
    },
    readTextFile: (relativePath) => {
      const api = window.omosuen;
      if (!api) return Promise.reject(new Error('bridge unavailable'));
      return api.readTextFile(relativePath);
    },
    listDir: (relativePath) => {
      const api = window.omosuen;
      if (!api) return Promise.reject(new Error('bridge unavailable'));
      return api.listDir(relativePath);
    },
    getWorkspaceRoot: () => {
      const api = window.omosuen;
      if (!api) return Promise.resolve(null);
      return api.getWorkspaceRoot();
    },
    onWorkspaceChanged: (callback) => {
      const api = window.omosuen;
      if (!api) return () => {};
      return api.onWorkspaceChanged(callback);
    },
    onStatus: (message) => {
      statusSink?.(message);
    },
  },
  {
    requestOpenLocation: ({ relativePath, line, column }) => {
      requestOpenFileImpl(
        relativePath,
        'reuse',
        line !== undefined ? { line, column } : undefined,
      );
    },
  },
  {
    engineVersion: 'v0.24.1',
    onDispatch: (msg) => {
      shellDocument.dispatchFromHost(msg);
      if (msg.kind === 'component:update') {
        appendOutput(
          `component:update ${msg.componentType}.${msg.property}`,
          'debug',
        );
        statusSink?.(`Updated ${msg.componentType}.${msg.property}`);
      }
      if (
        msg.kind === 'component:add' ||
        msg.kind === 'component:remove' ||
        msg.kind === 'component:move'
      ) {
        appendOutput(msg.kind, 'debug');
      }
    },
    browseForFile: async (extensions) => {
      const api = window.omosuen;
      if (!api?.openFile) return null;
      const filters =
        extensions.length > 0
          ? [
              {
                name: 'Assets',
                extensions: extensions.map((e) => e.replace(/^\./, '')),
              },
            ]
          : undefined;
      return api.openFile(filters);
    },
  },
  {
    getDocument: () => shellDocument.editorState.sceneDocument.get(),
    subscribeDocument: (cb) =>
      shellDocument.editorState.sceneDocument.subscribe(() => cb()),
    getSelection: () => shellDocument.editorState.selection.get(),
    subscribeSelection: (cb) =>
      shellDocument.editorState.selection.subscribe(() => cb()),
    onDispatch: (msg) => {
      shellDocument.dispatchFromHost(msg);
    },
    applyDocument: (file, selectIds) => {
      shellDocument.replaceDocument(file, { selectIds, dirty: true });
    },
    promptText: async (request) => {
      const api = window.omosuen;
      if (!api?.promptText) return null;
      return api.promptText(request);
    },
  },
);

const hostPoolHtml = registry
  .list()
  .map(
    (view) =>
      `<div :preserve id="${viewHostElementId(view.id)}" class="dock-view-host" hidden></div>`,
  )
  .join('');

const template = /* html */ `
<div class="app-shell">
  <main id="dock-root" class="dock-region" aria-label="Dock content">
    <DockChrome/>
    <div class="dock-host-pool" aria-hidden="true">${hostPoolHtml}</div>
  </main>
  <StatusBar/>
</div>
`;

const components = {
  StatusBar: () => /* html */ `
    <footer class="statusbar" role="status" aria-live="polite">
      <span class="status-bridge">{{bridgeStatus}}</span>
      <span class="status-message">{{statusMessage}}</span>
    </footer>
  `,
  DockChrome: ({ state }: { state: { data: ShellData } }) => {
    const tree = renderDockNode(state.data.layout.root, registry);
    return `<div class="dock-chrome">${tree}</div>`;
  },
};

const layoutIds = createIdFactory('dock');
let shellState: InstanceType<typeof State> & { data: ShellData };
let dock: DockController;
let tearingDown = false;
let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
let persistLayoutEnabled = false;

void boot();

async function boot(): Promise<void> {
  const info = await resolveWindowInfo();
  const isPopout = info.role === 'popout';
  const popViewId = info.viewId;
  const popTitle =
    (popViewId && registry.get(popViewId)?.title) || popViewId || 'Pop-out';

  const apiEarly = window.omosuen;
  let initialLayout = createDefaultLayout();
  if (!isPopout && apiEarly) {
    try {
      const saved = readPersistedLayout(
        await apiEarly.getSetting(SHELL_DOCK_LAYOUT_KEY),
      );
      if (saved) initialLayout = saved;
    } catch {
      // fall back to default
    }
  } else if (isPopout) {
    const viewIds = parseViewIdsFromLocation(window.location.search);
    initialLayout = createPopOutLayout(
      viewIds.length > 0 ? viewIds : popViewId ? [popViewId] : [],
    );
  }

  shellState = new State(
    template,
    {
      statusMessage: isPopout ? `Pop-out: ${popTitle}` : 'Ready',
      bridgeStatus: 'bridge: …',
      layout: initialLayout,
      isPopout,
    } satisfies ShellData,
    components,
    {
      resetLayout: ({
        state,
      }: {
        state: { data: ShellData };
      }) => {
        void resetLayoutToDefault(state);
      },
    },
    { mountTarget: '#app' },
  ) as InstanceType<typeof State> & { data: ShellData };

  persistLayoutEnabled = !isPopout;

  const dockRoot = document.getElementById('dock-root');
  if (!dockRoot) {
    throw new Error('#dock-root missing after State Street mount');
  }

  const api = window.omosuen;
  dock = new DockController({
    registry,
    interactionRoot: dockRoot,
    newId: layoutIds,
    allowPopOut: Boolean(api),
    onPopOut: api
      ? (viewId, screenX, screenY) => {
          void popOutView(viewId, screenX, screenY);
        }
      : undefined,
    onReturnView: isPopout
      ? (viewId) => {
          void returnViewToPrimary(viewId);
        }
      : undefined,
    windowDrag: api
      ? {
            begin: async (viewId, title, screenX, screenY) => {
              await api.dragStart({
                viewId,
                title,
                screenX,
                screenY,
              });
            },
            move: (screenX, screenY) => {
              void api.dragMove({ screenX, screenY }).catch(() => {
                // non-fatal — session may already have ended
              });
            },
            end: async (screenX, screenY) => {
              const result = await api.dragEnd({ screenX, screenY });
              return result.kind;
            },
            cancel: () => {
              void api.dragCancel();
            },
          }
      : undefined,
    shell: {
      getLayout: () => shellState.data.layout as DockLayout,
      setLayout: (layout) => {
        shellState.data.layout = layout;
        scheduleLayoutPersist();
        scheduleViewSync();
      },
      flush: () => {
        shellState.forceUpdate();
      },
    },
  });

  dock.bootstrap();
  scheduleViewSync();
  statusSink = (message) => {
    shellState.data.statusMessage = message;
    appendOutput(message, 'info');
  };
  requestOpenFileImpl = (relativePath, mode, reveal) => {
    void openEditorFile(relativePath, { mode, reveal });
  };
  wireTeardown();
  await bootBridge(info);
  appendOutput('Shell ready', 'info');
  seedMockProblem();
  await shellDocument.load('demo://scene');
  shellDocument.editorState.sceneDocument.subscribe(() => {
    syncInspectorFromDocument();
  });
  shellDocument.editorState.selection.subscribe(() => {
    syncInspectorFromDocument();
  });
  shellDocument.dispatchFromHost(componentSelect([2]));
  syncInspectorFromDocument();
}

function resolveWindowInfo(): Promise<WindowInfo> {
  const fromQuery = parseWindowInfoFromLocation(window.location.search);
  const api = window.omosuen;
  if (!api?.getWindowInfo) {
    return Promise.resolve(fromQuery);
  }
  return api.getWindowInfo().catch(() => fromQuery);
}

function applyLayout(next: DockLayout): void {
  shellState.data.layout = next;
  shellState.forceUpdate();
  dock.reconcileHosts();
  scheduleLayoutPersist();
  scheduleViewSync();
}

async function openEditorFile(
  relativePath: string,
  options?: {
    broadcast?: boolean;
    mode?: EditorOpenMode;
    reveal?: EditorReveal;
  },
): Promise<void> {
  const api = window.omosuen;
  if (!api) return;
  const mode: EditorOpenMode = options?.mode ?? 'reuse';
  const reveal = options?.reveal;

  if (options?.broadcast !== false) {
    void api
      .publishShellBus({
        type: EDITOR_OPEN_BUS_TYPE,
        payload: {
          relativePath,
          mode,
          line: reveal?.line,
          column: reveal?.column,
        } satisfies EditorOpenPayload,
      })
      .catch(() => {
        // bus is best-effort until Monaco owns the subscription
      });
  }

  try {
    const contents = await api.readTextFile(relativePath);
    applyLayout(
      insertView(
        shellState.data.layout as DockLayout,
        TEXT_BUFFER_VIEW_ID,
        layoutIds,
      ),
    );
    getEditorsHandle()?.open(relativePath, contents, mode, reveal);
    shellState.data.statusMessage = `Opened ${relativePath}`;
  } catch (err) {
    shellState.data.statusMessage =
      err instanceof Error ? err.message : 'Failed to open file';
  }
}

function seedMockProblem(): void {
  const mock: ProblemDiagnostic = {
    id: 'mock-shell-1',
    severity: 'info',
    message: 'Mock diagnostic — click to open package.json',
    relativePath: 'package.json',
    line: 1,
    column: 1,
    source: 'shell',
  };
  getProblemsHandle()?.setProblems([mock]);
}

function scheduleViewSync(): void {
  if (tearingDown) return;
  const api = window.omosuen;
  if (!api?.syncViews) return;
  const ids = collectViewIds((shellState.data.layout as DockLayout).root);
  void api.syncViews(ids).catch(() => {
    // non-fatal
  });
}

function scheduleLayoutPersist(): void {
  if (!persistLayoutEnabled || tearingDown) return;
  const api = window.omosuen;
  if (!api) return;
  if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(() => {
    layoutSaveTimer = null;
    const plain = JSON.parse(
      JSON.stringify(shellState.data.layout),
    ) as DockLayout;
    void api.setSetting(SHELL_DOCK_LAYOUT_KEY, plain).catch(() => {
      // non-fatal
    });
  }, 200);
}

async function returnViewToPrimary(viewId: string): Promise<void> {
  const api = window.omosuen;
  applyLayout(closeTab(shellState.data.layout as DockLayout, viewId));
  if (!api?.returnView) return;
  try {
    await api.returnView(viewId);
    const title = registry.get(viewId)?.title ?? viewId;
    shellState.data.statusMessage = `Returned ${title}`;
  } catch (err) {
    shellState.data.statusMessage =
      err instanceof Error ? err.message : 'Return view failed';
  }
}

async function resetLayoutToDefault(state: {
  data: ShellData;
}): Promise<void> {
  if (state.data.isPopout) return;
  const api = window.omosuen;
  try {
    if (api?.closeAllPopouts) {
      await api.closeAllPopouts();
    }
    applyLayout(createDefaultLayout());
    if (api) {
      await api.setSetting(
        SHELL_DOCK_LAYOUT_KEY,
        JSON.parse(JSON.stringify(createDefaultLayout())),
      );
    }
    state.data.statusMessage = 'Layout reset to default';
  } catch (err) {
    state.data.statusMessage =
      err instanceof Error ? err.message : 'Reset Layout failed';
  }
}

async function popOutView(
  viewId: string,
  screenX: number,
  screenY: number,
): Promise<void> {
  const api = window.omosuen;
  if (!api) {
    shellState.data.statusMessage = 'bridge unavailable';
    return;
  }
  try {
    const title = registry.get(viewId)?.title;
    const result = await api.popOutView({ viewId, title, screenX, screenY });
    if (result.created) {
      shellState.data.statusMessage = `Popped out ${title ?? viewId}`;
    } else {
      shellState.data.statusMessage = `Focused existing pop-out: ${title ?? viewId}`;
    }
  } catch (err) {
    shellState.data.statusMessage =
      err instanceof Error ? err.message : 'Pop-out failed';
  }
}

function wireTeardown(): void {
  const teardown = (): void => {
    if (tearingDown) return;
    tearingDown = true;
    window.removeEventListener('beforeunload', teardown);
    try {
      dock.dispose();
    } catch {
      // ignore
    }
    try {
      shellState.destroy();
    } catch {
      // ignore — window may already be gone
    }
  };
  window.addEventListener('beforeunload', teardown);
}

function describeMenuCommand(command: string): string {
  if (!isMenuCommandId(command)) return `Menu: ${command}`;
  const labels: Record<typeof command, string> = {
    'file.openFolder': 'Open Folder…',
    'file.newProject': 'New Project…',
    'file.closeProject': 'Close Project',
    'file.changeEngineVersion': 'Change Engine Version…',
    'file.save': 'Save',
    'view.resetLayout': 'Reset Layout',
    'help.about': 'Omosuen Editor — Electron shell (Phase 0)',
  };
  return labels[command];
}

async function refreshWorkspace(root: string | null): Promise<void> {
  const api = window.omosuen;
  if (!root || !api) {
    if (!root) {
      shellState.data.statusMessage = 'No project open';
    }
    dock?.reconcileHosts();
    return;
  }

  try {
    const manifest = api.getProjectManifest
      ? await api.getProjectManifest()
      : null;
    if (manifest && typeof manifest.name === 'string') {
      shellState.data.statusMessage = `Project: ${manifest.name} · engine ${manifest.engineVersion}`;
    } else {
      const entries = await api.listDir();
      shellState.data.statusMessage = `Workspace: ${entries.length} items`;
    }
  } catch (err) {
    shellState.data.statusMessage =
      err instanceof Error ? err.message : 'Failed to list workspace';
  }
  // Hosts can snap back to the pool if chrome re-renders; re-seat them.
  queueMicrotask(() => {
    try {
      dock.reconcileHosts();
    } catch {
      // ignore during teardown
    }
  });
}

async function bootBridge(info: WindowInfo): Promise<void> {
  const api = window.omosuen;
  if (!api) {
    shellState.data.bridgeStatus = 'bridge unavailable';
    return;
  }

  api.onMenuCommand((command) => {
    // New Project / Open Folder / Close Project are handled in the main process.
    if (
      command === 'file.openFolder' ||
      command === 'file.newProject' ||
      command === 'file.closeProject' ||
      command === 'file.changeEngineVersion'
    ) {
      return;
    }
    if (command === 'file.save') {
      void getEditorsHandle()?.saveActive();
      return;
    }
    if (command === 'view.resetLayout') {
      void resetLayoutToDefault(shellState);
      return;
    }
    shellState.data.statusMessage = describeMenuCommand(command);
  });

  api.onWorkspaceChanged((root) => {
    void refreshWorkspace(root);
  });

  api.onShellBus((message) => {
    if (message.type === EDITOR_OPEN_BUS_TYPE) {
      const payload = message.payload as EditorOpenPayload | undefined;
      const relativePath =
        payload && typeof payload.relativePath === 'string'
          ? payload.relativePath
          : null;
      const mode: EditorOpenMode =
        payload?.mode === 'new-preview' ? 'new-preview' : 'reuse';
      const reveal =
        payload?.line !== undefined
          ? { line: payload.line, column: payload.column }
          : undefined;
      if (relativePath && message.fromWindowId !== info.windowId) {
        void openEditorFile(relativePath, {
          broadcast: false,
          mode,
          reveal,
        });
      }
      return;
    }
    if (message.type === 'selection.stub') {
      const viewId =
        typeof message.payload === 'object' &&
        message.payload &&
        'viewId' in message.payload
          ? String((message.payload as { viewId: unknown }).viewId)
          : '?';
      shellState.data.statusMessage = `Selection stub ← ${message.fromWindowId}: ${viewId}`;
    }
  });

  api.onDragDetach((event) => {
    dock.detachView(event.viewId);
    shellState.data.statusMessage = `Dragging ${event.viewId}…`;
  });

  api.onDragHover((event) => {
    dock.showExternalHover(event.viewId, event.clientX, event.clientY);
  });

  api.onDragLeave(() => {
    dock.clearExternalHover();
  });

  api.onDragAttach((event) => {
    const accepted = dock.acceptExternalAttach(
      event.viewId,
      event.clientX,
      event.clientY,
    );
    api.ackDragAttach({
      sessionId: event.sessionId,
      viewId: event.viewId,
      accepted,
    });
    if (accepted) {
      const title = registry.get(event.viewId)?.title ?? event.viewId;
      shellState.data.statusMessage = `Docked ${title}`;
    }
  });

  // Closing a pop-out redocks all of its views into this shell (primary preferred).
  api.onWindowClosed((event) => {
    if (event.reason !== 'redock') return;
    const viewIds =
      'viewIds' in event && Array.isArray(event.viewIds)
        ? event.viewIds
        : [];
    if (viewIds.length === 0) return;

    let layout = shellState.data.layout as DockLayout;
    let restored = 0;
    for (const viewId of viewIds) {
      if (collectViewIds(layout.root).includes(viewId)) continue;
      layout = insertView(layout, viewId, layoutIds);
      restored += 1;
    }
    if (restored === 0) return;
    applyLayout(layout);
    shellState.data.statusMessage =
      restored === 1
        ? `Restored ${registry.get(viewIds[0]!)?.title ?? viewIds[0]}`
        : `Restored ${restored} views`;
  });

  try {
    const reply = await api.ping();
    shellState.data.bridgeStatus = `bridge: ${reply} · ${info.windowId}`;
  } catch {
    shellState.data.bridgeStatus = 'bridge error';
  }

  if (info.role === 'primary') {
    try {
      const bootAt = new Date().toISOString();
      await api.setSetting('shell.lastBoot', bootAt);
    } catch {
      // non-fatal
    }
  }

  const existing = await api.getWorkspaceRoot();
  await refreshWorkspace(existing);
}
