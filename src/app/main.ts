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
import { registerEditorTool } from '../editor-api';
import { parse, stringify, withEditorMetadata } from '../omoscene';
import {
  createStarterScene,
  ensureOmosceneFileName,
  findComponentById,
  joinRelative,
  sceneNameFromFileName,
} from '../scene';
import {
  getAnimationTimelineHandle,
  ANIMATION_TIMELINE_VIEW_ID,
} from '../scene/animation-timeline';
import {
  getTextureFrameHandle,
  TEXTURE_FRAME_VIEW_ID,
} from '../scene/texture-frame';
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
  readPersistedOpenScene,
  registerPlaceholderViews,
  renderDockNode,
  SHELL_OPEN_SCENE_KEY,
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
import { SCENE_TREE_VIEW_ID } from '../views/scene-tree';
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
      readDataUrl: (relativePath: string) => Promise<string>;
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
      readEngineUmd: (version: string) => Promise<string>;
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

/** In-process document broker for scene tree + inspector + viewport. */
const shellDocument = createDocumentController({
  readFile: async (uri) => {
    const api = window.omosuen;
    if (!api) throw new Error('bridge unavailable');
    const text = await api.readTextFile(uri);
    return parse(text);
  },
  writeFile: async (uri, file) => {
    const api = window.omosuen;
    if (!api) throw new Error('bridge unavailable');
    await api.writeTextFile(uri, stringify(file));
  },
  onSaveError: (error) => {
    const message = error.message;
    statusSink?.(message, 'warn');
    appendOutput(`Scene save failed: ${message}`, 'error');
  },
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

let statusSink: ((message: string, level?: 'info' | 'warn') => void) | null =
  null;

let openTextureFrameImpl: (componentId: number) => void = () => {
  // assigned after dock boots
};

let openAnimationTimelineImpl: (componentId: number) => void = () => {
  // assigned after dock boots
};

registerEditorTool({
  id: 'texture-frame',
  open(ctx) {
    const id =
      typeof ctx.componentId === 'number'
        ? ctx.componentId
        : Number(ctx.componentId);
    if (!Number.isFinite(id)) return;
    openTextureFrameImpl(id);
  },
});

registerEditorTool({
  id: 'animation-timeline',
  open(ctx) {
    const id =
      typeof ctx.componentId === 'number'
        ? ctx.componentId
        : Number(ctx.componentId);
    if (!Number.isFinite(id)) return;
    openAnimationTimelineImpl(id);
  },
});

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
    createScene: async (parentDir) => {
      await createSceneInDir(parentDir);
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
  {
    getDocument: () => shellDocument.editorState.sceneDocument.get(),
    subscribeDocument: (cb) =>
      shellDocument.editorState.sceneDocument.subscribe(() => cb()),
    getSelection: () => shellDocument.editorState.selection.get(),
    subscribeSelection: (cb) =>
      shellDocument.editorState.selection.subscribe(() => cb()),
    onDispatch: (msg) => {
      shellDocument.dispatchFromHost(msg);
      if (msg.kind === 'component:update') {
        appendOutput(
          `component:update ${msg.componentType}.${msg.property}`,
          'debug',
        );
        statusSink?.(`Updated ${msg.componentType}.${msg.property}`);
      }
      if (msg.kind === 'component:select') {
        appendOutput(
          `component:select [${msg.ids.join(', ')}]`,
          'debug',
        );
      }
    },
    applyEditorCamera: (camera) => {
      const file = shellDocument.editorState.sceneDocument.get();
      if (!file) return;
      shellDocument.replaceDocument(
        withEditorMetadata(file, { ...file.editor, camera }),
        { dirty: true },
      );
    },
    resolveEngineVersion: async () => {
      const file = shellDocument.editorState.sceneDocument.get();
      if (file?.engine) return file.engine;
      const api = window.omosuen;
      const manifest = api?.getProjectManifest
        ? await api.getProjectManifest()
        : null;
      return manifest?.engineVersion ?? 'v0.24.1';
    },
    ensureEngine: async (version) => {
      const api = window.omosuen;
      if (!api?.ensureEngine) {
        throw new Error('Engine bridge unavailable');
      }
      return api.ensureEngine(version);
    },
    readEngineUmd: async (version) => {
      const api = window.omosuen;
      if (!api?.readEngineUmd) {
        throw new Error('Engine UMD bridge unavailable');
      }
      return api.readEngineUmd(version);
    },
    getProjectEngineVersion: async () => {
      const api = window.omosuen;
      if (!api?.getProjectManifest) return null;
      const manifest = await api.getProjectManifest();
      return manifest?.engineVersion ?? null;
    },
    onStatus: (message) => {
      statusSink?.(message);
    },
    onWarn: (message) => {
      statusSink?.(message, 'warn');
      const problems = getProblemsHandle();
      if (!problems) return;
      const next = problems
        .problems()
        .filter((p) => p.id !== 'engine-version-mismatch');
      problems.setProblems([
        ...next,
        {
          id: 'engine-version-mismatch',
          severity: 'warning',
          message,
          source: 'viewport',
        },
      ]);
    },
  },
  {
    getDocument: () => shellDocument.editorState.sceneDocument.get(),
    subscribeDocument: (cb) =>
      shellDocument.editorState.sceneDocument.subscribe(() => cb()),
    onDispatch: (msg) => {
      shellDocument.dispatchFromHost(msg);
    },
    readImageDataUrl: async (relativePath) => {
      const api = window.omosuen;
      if (!api?.readDataUrl) return null;
      try {
        return await api.readDataUrl(relativePath);
      } catch {
        return null;
      }
    },
  },
  {
    getDocument: () => shellDocument.editorState.sceneDocument.get(),
    subscribeDocument: (cb) =>
      shellDocument.editorState.sceneDocument.subscribe(() => cb()),
    onDispatch: (msg) => {
      shellDocument.dispatchFromHost(msg);
    },
    readImageDataUrl: async (relativePath) => {
      const api = window.omosuen;
      if (!api?.readDataUrl) return null;
      try {
        return await api.readDataUrl(relativePath);
      } catch {
        return null;
      }
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
  statusSink = (message, level = 'info') => {
    shellState.data.statusMessage = message;
    appendOutput(message, level);
  };
  requestOpenFileImpl = (relativePath, mode, reveal) => {
    void openWorkspaceFile(relativePath, { mode, reveal });
  };
  openTextureFrameImpl = (componentId) => {
    applyLayout(
      insertView(
        shellState.data.layout as DockLayout,
        TEXTURE_FRAME_VIEW_ID,
        layoutIds,
      ),
    );
    getTextureFrameHandle()?.open(componentId);
    shellState.data.statusMessage = `Frames — component ${componentId}`;
    appendOutput(`Opened texture-frame tool for #${componentId}`, 'debug');
  };
  openAnimationTimelineImpl = (componentId) => {
    applyLayout(
      insertView(
        shellState.data.layout as DockLayout,
        ANIMATION_TIMELINE_VIEW_ID,
        layoutIds,
      ),
    );
    getAnimationTimelineHandle()?.open(componentId);
    shellState.data.statusMessage = `Animations — component ${componentId}`;
    appendOutput(`Opened animation-timeline tool for #${componentId}`, 'debug');
  };
  wireTeardown();
  await bootBridge(info);
  appendOutput('Shell ready', 'info');
  seedMockProblem();
  shellDocument.editorState.sceneDocument.subscribe(() => {
    syncInspectorFromDocument();
  });
  shellDocument.editorState.selection.subscribe(() => {
    syncInspectorFromDocument();
  });
  syncInspectorFromDocument();
  if (!isPopout) {
    await restoreOpenScene();
  }
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

async function openWorkspaceFile(
  relativePath: string,
  options?: {
    broadcast?: boolean;
    mode?: EditorOpenMode;
    reveal?: EditorReveal;
  },
): Promise<void> {
  if (isOmoscenePath(relativePath)) {
    await openSceneFile(relativePath);
    return;
  }
  await openEditorFile(relativePath, options);
}

function isOmoscenePath(relativePath: string): boolean {
  return /\.omoscene$/i.test(relativePath);
}

async function resolveProjectEngineVersion(): Promise<string> {
  const api = window.omosuen;
  if (!api?.getProjectManifest) return 'v0.24.1';
  try {
    const manifest = await api.getProjectManifest();
    return manifest?.engineVersion ?? 'v0.24.1';
  } catch {
    return 'v0.24.1';
  }
}

async function createSceneInDir(parentDir: string): Promise<void> {
  const api = window.omosuen;
  if (!api) throw new Error('bridge unavailable');
  const nameRaw = await api.promptText({
    title: 'New Scene',
    label: 'Scene name',
    defaultValue: 'Main',
    okLabel: 'Create',
  });
  if (nameRaw === null) return;
  const fileName = ensureOmosceneFileName(nameRaw);
  const relativePath = joinRelative(parentDir, fileName);

  let exists = false;
  try {
    await api.readTextFile(relativePath);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error(`Scene already exists: ${relativePath}`);
  }

  const engine = await resolveProjectEngineVersion();
  const file = createStarterScene({
    name: sceneNameFromFileName(fileName),
    engine,
  });
  await api.writeTextFile(relativePath, stringify(file));
  await openSceneFile(relativePath);
  appendOutput(`Created scene ${relativePath}`, 'info');
}

async function openSceneFile(relativePath: string): Promise<void> {
  try {
    await shellDocument.load(relativePath);
    persistOpenScenePath(relativePath);
    applyLayout(
      insertView(
        shellState.data.layout as DockLayout,
        SCENE_TREE_VIEW_ID,
        layoutIds,
      ),
    );
    syncInspectorFromDocument();
    shellState.data.statusMessage = `Scene: ${relativePath}`;
    appendOutput(`Opened scene ${relativePath}`, 'info');
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to open scene';
    shellState.data.statusMessage = message;
    appendOutput(message, 'error');
  }
}

function persistOpenScenePath(relativePath: string | null): void {
  const api = window.omosuen;
  if (!api || tearingDown) return;
  void api.setSetting(SHELL_OPEN_SCENE_KEY, relativePath).catch(() => {
    // non-fatal
  });
}

async function restoreOpenScene(): Promise<void> {
  const api = window.omosuen;
  if (!api) return;
  const root = await api.getWorkspaceRoot();
  if (!root) return;
  let relative: string | null = null;
  try {
    relative = readPersistedOpenScene(await api.getSetting(SHELL_OPEN_SCENE_KEY));
  } catch {
    return;
  }
  if (!relative) return;
  try {
    await api.readTextFile(relative);
  } catch {
    persistOpenScenePath(null);
    appendOutput(
      `Previous scene missing (${relative}) — Scene tab left empty`,
      'warn',
    );
    return;
  }
  await openSceneFile(relative);
}

async function saveWorkspaceDocuments(): Promise<void> {
  const savedText = (await getEditorsHandle()?.saveActive()) ?? false;
  if (shellDocument.uri) {
    try {
      await shellDocument.save();
      shellState.data.statusMessage = `Saved ${shellDocument.uri}`;
      appendOutput(`Saved scene ${shellDocument.uri}`, 'info');
      return;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to save scene';
      shellState.data.statusMessage = message;
      appendOutput(message, 'error');
      return;
    }
  }
  if (!savedText) {
    shellState.data.statusMessage = 'Nothing to save — open or create a scene';
  }
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
      shellDocument.unload();
      syncInspectorFromDocument();
      // Keep remembered scene across editor quit; clear only on Close Project.
      if (!tearingDown) persistOpenScenePath(null);
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

  // Folder switched while running — reload remembered scene if it exists here.
  if (shellDocument.uri === null) {
    await restoreOpenScene();
  } else {
    // Re-validate current scene against the new root.
    try {
      await api.readTextFile(shellDocument.uri);
    } catch {
      shellDocument.unload();
      syncInspectorFromDocument();
      await restoreOpenScene();
    }
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
      void saveWorkspaceDocuments();
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
