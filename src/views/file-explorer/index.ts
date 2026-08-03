/**
 * File explorer — nested State Street inside the `:preserve` dock host (2f).
 */

import { State } from '@state-street/state-street';
import type { DirEntryDto } from '../../bridge/channels';
import { createTargetDir } from '../../scene/starter-scene';
import type { EditorOpenMode } from '../text-buffer/open-target';
import { showContextMenu } from './context-menu';

export const FILE_EXPLORER_VIEW_ID = 'file-explorer';

export const EDITOR_OPEN_BUS_TYPE = 'editor.open';

/** Delay before treating a click as single-click open (so dblclick can cancel). */
export const EXPLORER_OPEN_CLICK_MS = 250;

export interface EditorOpenPayload {
  readonly relativePath: string;
  readonly mode?: EditorOpenMode;
  readonly line?: number;
  readonly column?: number;
}

export interface FileExplorerDeps {
  readonly listDir: (relativePath?: string) => Promise<DirEntryDto[]>;
  readonly getWorkspaceRoot: () => Promise<string | null>;
  readonly onWorkspaceChanged: (
    callback: (root: string | null) => void,
  ) => () => void;
  /** Main-process chokidar → soft refresh while preserving expansion. */
  readonly onFsChanged?: (callback: () => void) => () => void;
  readonly revealInOs?: (relativePath: string) => Promise<void>;
  readonly requestOpenFile: (
    relativePath: string,
    mode: EditorOpenMode,
  ) => void;
  /**
   * Create a new `.omoscene` under `parentDir` (workspace-relative; `''` = root)
   * from an explorer context menu. Opens the scene in the Scene tab.
   */
  readonly createScene?: (parentDir: string) => Promise<void>;
}

export interface TreeNodeState {
  readonly entry: DirEntryDto;
  expanded: boolean;
  children: TreeNodeState[] | null;
  loading: boolean;
}

interface ExplorerData {
  hasRoot: boolean;
  errorMessage: string;
  rootEntries: TreeNodeState[];
}

const template = /* html */ `
<EmptyHint/>
<TreeBody/>
<ErrorHint/>
`;

/** Encode path for SS event args (slashes, dots, spaces). */
export function encodeExplorerPath(relativePath: string): string {
  return encodeURIComponent(relativePath);
}

export function decodeExplorerPath(encoded: string): string {
  try {
    return decodeURIComponent(String(encoded));
  } catch {
    return String(encoded);
  }
}

/** Pure tree HTML with State Street row bindings. */
export function renderFileTree(nodes: readonly TreeNodeState[]): string {
  return nodes.map((n) => renderNode(n, 0)).join('');
}

function renderNode(node: TreeNodeState, depth: number): string {
  const { entry } = node;
  const isDir = entry.kind === 'directory';
  const twisty = isDir
    ? node.loading
      ? '…'
      : node.expanded
        ? '▾'
        : '▸'
    : '';
  const label = escapeHtml(entry.name);
  const fileClass = entry.kind === 'file' ? ' file-explorer-openable' : '';
  const rel = encodeExplorerPath(entry.relativePath);
  const rows = [
    `<div class="file-explorer-row${fileClass}" role="treeitem" ` +
      `data-rel="${escapeAttr(entry.relativePath)}" data-kind="${entry.kind}" ` +
      `style="--depth:${depth}" ` +
      `:click=onRowClick(rel="${rel}",kind="${entry.kind}") ` +
      `:dblclick=onRowDblClick(rel="${rel}",kind="${entry.kind}") ` +
      `:contextmenu=onRowContext(rel="${rel}",kind="${entry.kind}")>` +
      `<span class="file-explorer-twisty" aria-hidden="true">${twisty}</span>` +
      `<span class="file-explorer-name">${label}</span>` +
      `</div>`,
  ];
  if (isDir && node.expanded && node.children) {
    for (const child of node.children) {
      rows.push(renderNode(child, depth + 1));
    }
  }
  return rows.join('');
}

export function mountFileExplorer(
  container: HTMLElement,
  deps: FileExplorerDeps,
): () => void {
  container.classList.add('file-explorer');

  let disposed = false;
  let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInFlight: Promise<void> | null = null;

  const bumpTree = (state: { data: ExplorerData }): void => {
    // Force TreeBody re-render after nested mutations.
    state.data.rootEntries = [...state.data.rootEntries];
  };

  const clearPendingOpen = (): void => {
    if (pendingOpenTimer) {
      clearTimeout(pendingOpenTimer);
      pendingOpenTimer = null;
    }
  };

  const showError = (
    state: { data: ExplorerData },
    message: string | null,
  ): void => {
    state.data.errorMessage = message ?? '';
  };

  const findNode = (
    nodes: TreeNodeState[],
    relativePath: string,
  ): TreeNodeState | undefined => {
    for (const node of nodes) {
      if (node.entry.relativePath === relativePath) return node;
      if (node.children) {
        const found = findNode(node.children, relativePath);
        if (found) return found;
      }
    }
    return undefined;
  };

  const expandDir = async (
    state: { data: ExplorerData },
    node: TreeNodeState,
  ): Promise<void> => {
    if (node.loading) return;
    if (node.children) {
      node.expanded = true;
      bumpTree(state);
      return;
    }
    node.loading = true;
    bumpTree(state);
    try {
      const entries = await deps.listDir(node.entry.relativePath);
      if (disposed) return;
      node.children = entries.map(toNode);
      node.expanded = true;
    } catch (err) {
      showError(
        state,
        err instanceof Error ? err.message : 'Failed to list folder',
      );
    } finally {
      node.loading = false;
      if (!disposed) bumpTree(state);
    }
  };

  const toggleDir = async (
    state: { data: ExplorerData },
    node: TreeNodeState,
  ): Promise<void> => {
    if (node.loading) return;
    if (node.expanded) {
      node.expanded = false;
      bumpTree(state);
      return;
    }
    await expandDir(state, node);
  };

  const reloadRoot = async (
    state: { data: ExplorerData },
    knownRoot?: string | null,
  ): Promise<void> => {
    if (disposed) return;
    showError(state, null);
    const root =
      knownRoot !== undefined ? knownRoot : await deps.getWorkspaceRoot();
    if (disposed) return;
    state.data.hasRoot = Boolean(root);
    if (!state.data.hasRoot) {
      state.data.rootEntries = [];
      return;
    }
    try {
      const entries = await deps.listDir();
      if (disposed) return;
      state.data.rootEntries = entries.map(toNode);
    } catch (err) {
      if (disposed) return;
      state.data.rootEntries = [];
      showError(
        state,
        err instanceof Error ? err.message : 'Failed to list folder',
      );
    }
  };

  const softRefresh = async (state: {
    data: ExplorerData;
  }): Promise<void> => {
    if (disposed || !state.data.hasRoot) return;
    if (refreshInFlight) return refreshInFlight;
    const expanded = collectExpandedPaths(state.data.rootEntries);
    refreshInFlight = (async () => {
      await reloadRoot(state);
      for (const rel of expanded) {
        if (disposed) return;
        const node = findNode(state.data.rootEntries, rel);
        if (!node || node.entry.kind !== 'directory') continue;
        await expandDir(state, node);
      }
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  const explorerState = new State(
    template,
    {
      hasRoot: false,
      errorMessage: '',
      rootEntries: [],
    } satisfies ExplorerData,
    {
      EmptyHint: ({ state }: { state: { data: ExplorerData } }) =>
        state.data.hasRoot
          ? ''
          : `<div class="file-explorer-empty">No folder open</div>`,
      TreeBody: ({ state }: { state: { data: ExplorerData } }) => {
        if (!state.data.hasRoot) return '';
        return (
          `<div class="file-explorer-tree" role="tree">` +
          renderFileTree(state.data.rootEntries) +
          `</div>`
        );
      },
      ErrorHint: ({ state }: { state: { data: ExplorerData } }) =>
        state.data.errorMessage
          ? `<div class="file-explorer-error">${escapeHtml(state.data.errorMessage)}</div>`
          : '',
    },
    {
      onRowClick: ({
        state,
        event,
        rel,
        kind,
      }: {
        state: { data: ExplorerData };
        event: Event;
        rel: string;
        kind: string;
      }) => {
        if ((event as MouseEvent).detail > 1) return;
        const path = decodeExplorerPath(rel);
        if (kind === 'directory') {
          clearPendingOpen();
          const node = findNode(state.data.rootEntries, path);
          if (!node) return;
          void toggleDir(state, node);
          return;
        }
        if (kind === 'file') {
          clearPendingOpen();
          pendingOpenTimer = setTimeout(() => {
            pendingOpenTimer = null;
            deps.requestOpenFile(path, 'reuse');
          }, EXPLORER_OPEN_CLICK_MS);
        }
      },
      onRowDblClick: ({
        event,
        rel,
        kind,
      }: {
        event: Event;
        rel: string;
        kind: string;
      }) => {
        if (kind !== 'file') return;
        event.preventDefault();
        clearPendingOpen();
        deps.requestOpenFile(decodeExplorerPath(rel), 'new-preview');
      },
      onRowContext: ({
        state,
        event,
        rel,
        kind,
      }: {
        state: { data: ExplorerData };
        event: Event;
        rel: string;
        kind: string;
      }) => {
        event.preventDefault();
        clearPendingOpen();
        const relativePath = decodeExplorerPath(rel);
        const entryKind =
          kind === 'directory' || kind === 'file'
            ? kind
            : (findNode(state.data.rootEntries, relativePath)?.entry.kind ??
              'file');
        const mouse = event as MouseEvent;
        const items = [
          {
            label: 'New',
            disabled: !deps.createScene || !state.data.hasRoot,
            children: [
              {
                id: 'new-scene',
                label: 'Scene',
                disabled: !deps.createScene || !state.data.hasRoot,
              },
            ],
          },
          {
            id: 'reveal',
            label: 'Reveal in OS',
            disabled: !deps.revealInOs,
          },
        ];
        showContextMenu({
          x: mouse.clientX,
          y: mouse.clientY,
          items,
          onSelect: (id) => {
            if (id === 'new-scene' && deps.createScene) {
              const parentDir = createTargetDir(relativePath, entryKind);
              void deps.createScene(parentDir).catch((err) => {
                showError(
                  state,
                  err instanceof Error ? err.message : 'Create scene failed',
                );
              });
              return;
            }
            if (id !== 'reveal' || !deps.revealInOs) return;
            void deps.revealInOs(relativePath).catch((err) => {
              showError(
                state,
                err instanceof Error ? err.message : 'Reveal failed',
              );
            });
          },
        });
      },
    },
    { mountTarget: container },
  ) as InstanceType<typeof State> & { data: ExplorerData };

  const unsubWorkspace = deps.onWorkspaceChanged((root) => {
    void reloadRoot(explorerState, root);
  });
  const unsubFs = deps.onFsChanged?.(() => {
    void softRefresh(explorerState);
  });

  void reloadRoot(explorerState);

  return () => {
    disposed = true;
    clearPendingOpen();
    unsubWorkspace();
    unsubFs?.();
    explorerState.destroy();
    container.classList.remove('file-explorer');
    container.replaceChildren();
  };
}

export function collectExpandedPaths(nodes: TreeNodeState[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.entry.kind !== 'directory' || !node.expanded) continue;
    out.push(node.entry.relativePath);
    if (node.children) out.push(...collectExpandedPaths(node.children));
  }
  return out;
}

function toNode(entry: DirEntryDto): TreeNodeState {
  return {
    entry,
    expanded: false,
    children: null,
    loading: false,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
