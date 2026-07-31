import { State } from '@state-street/state-street';
import type {
  DirEntryDto,
  FileFilter,
  PopOutRequest,
  PopOutResult,
  ShellBusEnvelope,
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
import {
  DockController,
  DockViewRegistry,
  collectViewIds,
  createDefaultLayout,
  createIdFactory,
  createSingleViewLayout,
  insertView,
  registerPlaceholderViews,
  renderDockNode,
  viewHostElementId,
  type DockLayout,
} from '../dock/index';
import { parseWindowInfoFromLocation } from './window-info';

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
      listDir: (relativePath?: string) => Promise<DirEntryDto[]>;
      readTextFile: (relativePath: string) => Promise<string>;
      writeTextFile: (relativePath: string, contents: string) => Promise<string>;
      getWindowInfo: () => Promise<WindowInfo>;
      popOutView: (request: PopOutRequest) => Promise<PopOutResult>;
      dragStart: (
        request: WindowDragStartRequest,
      ) => Promise<{ sessionId: string }>;
      dragMove: (request: WindowDragMoveRequest) => Promise<void>;
      dragEnd: (request: WindowDragEndRequest) => Promise<WindowDragEndResult>;
      dragCancel: () => Promise<void>;
      ackDragAttach: (ack: WindowDragAttachAck) => void;
      publishShellBus: (message: {
        type: string;
        payload?: unknown;
      }) => Promise<void>;
      onWorkspaceChanged: (
        callback: (root: string | null) => void,
      ) => () => void;
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
  title: string;
  toolbarLabel: string;
  statusMessage: string;
  bridgeStatus: string;
  workspaceLabel: string;
  layout: DockLayout;
  isPopout: boolean;
  popoutViewTitle: string;
}

const registry = new DockViewRegistry();
registerPlaceholderViews(registry);

const hostPoolHtml = registry
  .list()
  .map(
    (view) =>
      `<div :preserve id="${viewHostElementId(view.id)}" class="dock-view-host" hidden></div>`,
  )
  .join('');

const template = /* html */ `
<div class="app-shell">
  <Toolbar/>
  <main id="dock-root" class="dock-region" aria-label="Dock content">
    <DockChrome/>
    <div class="dock-host-pool" aria-hidden="true">${hostPoolHtml}</div>
  </main>
  <StatusBar/>
</div>
`;

const components = {
  Toolbar: ({ state }: { state: { data: ShellData } }) => {
    if (state.data.isPopout) {
      return /* html */ `
        <header class="toolbar" role="toolbar" aria-label="Pop-out toolbar">
          <span class="brand">{{popoutViewTitle}}</span>
          <div class="toolbar-actions">
            <span class="toolbar-hint">{{toolbarLabel}}</span>
          </div>
          <span class="workspace-label" title="{{workspaceLabel}}">{{workspaceLabel}}</span>
        </header>
      `;
    }
    return /* html */ `
      <header class="toolbar" role="toolbar" aria-label="Editor toolbar">
        <span class="brand">{{title}}</span>
        <div class="toolbar-actions">
          <button type="button" class="toolbar-btn" :click=openFolder()>Open Folder</button>
          <button type="button" class="toolbar-btn" :click=stubNewProject()>New Project</button>
          <span class="toolbar-hint">{{toolbarLabel}}</span>
        </div>
        <span class="workspace-label" title="{{workspaceLabel}}">{{workspaceLabel}}</span>
      </header>
    `;
  },
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

void boot();

async function boot(): Promise<void> {
  const info = await resolveWindowInfo();
  const isPopout = info.role === 'popout';
  const isFloating = info.floating;
  const popViewId = info.viewId;
  const popTitle =
    (popViewId && registry.get(popViewId)?.title) || popViewId || 'Pop-out';

  shellState = new State(
    template,
    {
      title: 'Omosuen Editor',
      toolbarLabel: isPopout
        ? 'drag tab into another window to dock'
        : 'drag tabs across windows · ⧉ pop out · edge=split · center=tab',
      statusMessage: isPopout ? `Pop-out: ${popTitle}` : 'Ready',
      bridgeStatus: 'bridge: …',
      workspaceLabel: 'No folder open',
      layout:
        isPopout && popViewId
          ? createSingleViewLayout(popViewId)
          : createDefaultLayout(),
      isPopout,
      popoutViewTitle: popTitle,
    } satisfies ShellData,
    components,
    {
      openFolder: ({
        state,
      }: {
        state: { data: ShellData };
      }) => {
        void (async () => {
          const api = window.omosuen;
          if (!api) {
            state.data.statusMessage = 'bridge unavailable';
            return;
          }
          try {
            const root = await api.openFolder();
            if (!root) {
              state.data.statusMessage = 'Open Folder canceled';
              return;
            }
            await refreshWorkspace(root);
          } catch (err) {
            state.data.statusMessage =
              err instanceof Error ? err.message : 'Open Folder failed';
          }
        })();
      },
      stubNewProject: ({
        state,
      }: {
        state: { data: ShellData };
      }) => {
        state.data.statusMessage = 'Menu stub: file.newProject';
      },
    },
    { mountTarget: '#app' },
  ) as InstanceType<typeof State> & { data: ShellData };

  const dockRoot = document.getElementById('dock-root');
  if (!dockRoot) {
    throw new Error('#dock-root missing after State Street mount');
  }

  const api = window.omosuen;
  dock = new DockController({
    registry,
    interactionRoot: dockRoot,
    newId: layoutIds,
    allowPopOut: !isFloating,
    onPopOut: isFloating
      ? undefined
      : (viewId, screenX, screenY) => {
          void popOutView(viewId, screenX, screenY);
        },
    windowDrag:
      !isFloating && api
        ? {
            begin: async (viewId, title, screenX, screenY) => {
              await api.dragStart({ viewId, title, screenX, screenY });
            },
            move: (screenX, screenY) => {
              void api.dragMove({ screenX, screenY });
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
      },
      flush: () => {
        shellState.forceUpdate();
      },
    },
  });

  dock.bootstrap();
  wireTeardown();
  await bootBridge(info);
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
    'file.newProject': 'Menu stub: file.newProject (New Project…)',
    'help.about': 'Omosuen Editor — Electron shell (Phase 0)',
  };
  return labels[command];
}

async function refreshWorkspace(root: string | null): Promise<void> {
  const api = window.omosuen;
  if (!root || !api) {
    shellState.data.workspaceLabel = 'No folder open';
    return;
  }

  shellState.data.workspaceLabel = root;
  try {
    const entries = await api.listDir();
    shellState.data.statusMessage = `Workspace: ${entries.length} items`;
  } catch (err) {
    shellState.data.statusMessage =
      err instanceof Error ? err.message : 'Failed to list workspace';
  }
}

async function bootBridge(info: WindowInfo): Promise<void> {
  const api = window.omosuen;
  if (!api) {
    shellState.data.bridgeStatus = 'bridge unavailable';
    return;
  }

  api.onMenuCommand((command) => {
    if (command === 'file.openFolder') return;
    shellState.data.statusMessage = describeMenuCommand(command);
  });

  api.onWorkspaceChanged((root) => {
    void refreshWorkspace(root);
  });

  api.onShellBus((message) => {
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

  // Closing a pop-out redocks the view into this shell (primary preferred).
  api.onWindowClosed((event) => {
    if (event.reason !== 'redock') return;
    if (collectViewIds((shellState.data.layout as DockLayout).root).includes(event.viewId)) {
      return;
    }
    applyLayout(
      insertView(shellState.data.layout as DockLayout, event.viewId, layoutIds),
    );
    const title = registry.get(event.viewId)?.title ?? event.viewId;
    shellState.data.statusMessage = `Restored ${title}`;
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
