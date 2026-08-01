import type { DirEntryDto } from '../../bridge/channels';
import type { EditorOpenMode } from '../text-buffer/open-target';
import { showContextMenu } from './context-menu';

export const FILE_EXPLORER_VIEW_ID = 'file-explorer';

export const EDITOR_OPEN_BUS_TYPE = 'editor.open';

/** Delay before treating a click as single-click open (so dblclick can cancel). */
export const EXPLORER_OPEN_CLICK_MS = 250;

export interface EditorOpenPayload {
  readonly relativePath: string;
  readonly mode?: EditorOpenMode;
}

export interface FileExplorerDeps {
  readonly listDir: (relativePath?: string) => Promise<DirEntryDto[]>;
  readonly getWorkspaceRoot: () => Promise<string | null>;
  readonly onWorkspaceChanged: (
    callback: (root: string | null) => void,
  ) => () => void;
  readonly revealInOs?: (relativePath: string) => Promise<void>;
  readonly requestOpenFile: (
    relativePath: string,
    mode: EditorOpenMode,
  ) => void;
}

interface TreeNodeState {
  readonly entry: DirEntryDto;
  expanded: boolean;
  children: TreeNodeState[] | null;
  loading: boolean;
}

export function mountFileExplorer(
  container: HTMLElement,
  deps: FileExplorerDeps,
): () => void {
  container.classList.add('file-explorer');
  container.innerHTML = `
    <div class="file-explorer-toolbar">
      <span class="file-explorer-title">Files</span>
      <button type="button" class="file-explorer-refresh" title="Refresh" aria-label="Refresh">↻</button>
    </div>
    <div class="file-explorer-empty" hidden>No folder open</div>
    <div class="file-explorer-tree" role="tree"></div>
    <div class="file-explorer-error" hidden></div>
  `;

  const toolbarRefresh = container.querySelector(
    '.file-explorer-refresh',
  ) as HTMLButtonElement;
  const emptyEl = container.querySelector(
    '.file-explorer-empty',
  ) as HTMLElement;
  const treeEl = container.querySelector('.file-explorer-tree') as HTMLElement;
  const errorEl = container.querySelector(
    '.file-explorer-error',
  ) as HTMLElement;

  let rootEntries: TreeNodeState[] = [];
  let hasRoot = false;
  let disposed = false;
  let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubWorkspace = deps.onWorkspaceChanged((root) => {
    void reloadRoot(root);
  });

  toolbarRefresh.addEventListener('click', () => {
    void reloadRoot();
  });

  treeEl.addEventListener('click', (event) => {
    if (event.detail > 1) return;
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-rel]') as HTMLElement | null;
    if (!row) return;
    const rel = row.dataset.rel;
    const kind = row.dataset.kind;
    if (!rel || !kind) return;

    if (kind === 'directory') {
      clearPendingOpen();
      const node = findNode(rootEntries, rel);
      if (!node) return;
      void toggleDir(node);
      return;
    }

    if (kind === 'file') {
      clearPendingOpen();
      pendingOpenTimer = setTimeout(() => {
        pendingOpenTimer = null;
        deps.requestOpenFile(rel, 'reuse');
      }, EXPLORER_OPEN_CLICK_MS);
    }
  });

  treeEl.addEventListener('dblclick', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-rel]') as HTMLElement | null;
    if (!row || row.dataset.kind !== 'file') return;
    const rel = row.dataset.rel;
    if (!rel) return;
    event.preventDefault();
    clearPendingOpen();
    deps.requestOpenFile(rel, 'new-preview');
  });

  treeEl.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest('[data-rel]') as HTMLElement | null;
    if (!row?.dataset.rel) return;
    event.preventDefault();
    clearPendingOpen();

    const relativePath = row.dataset.rel;
    showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: 'reveal',
          label: 'Reveal in OS',
          disabled: !deps.revealInOs,
        },
      ],
      onSelect: (id) => {
        if (id !== 'reveal' || !deps.revealInOs) return;
        void deps.revealInOs(relativePath).catch((err) => {
          showError(err instanceof Error ? err.message : 'Reveal failed');
        });
      },
    });
  });

  void reloadRoot();

  async function reloadRoot(knownRoot?: string | null): Promise<void> {
    if (disposed) return;
    showError(null);
    const root =
      knownRoot !== undefined ? knownRoot : await deps.getWorkspaceRoot();
    hasRoot = Boolean(root);
    emptyEl.hidden = hasRoot;
    treeEl.hidden = !hasRoot;
    toolbarRefresh.disabled = !hasRoot;
    if (!hasRoot) {
      rootEntries = [];
      renderTree();
      return;
    }
    try {
      const entries = await deps.listDir();
      rootEntries = entries.map(toNode);
      renderTree();
    } catch (err) {
      rootEntries = [];
      renderTree();
      showError(err instanceof Error ? err.message : 'Failed to list folder');
    }
  }

  async function toggleDir(node: TreeNodeState): Promise<void> {
    if (node.loading) return;
    if (node.expanded) {
      node.expanded = false;
      renderTree();
      return;
    }
    if (node.children) {
      node.expanded = true;
      renderTree();
      return;
    }
    node.loading = true;
    renderTree();
    try {
      const entries = await deps.listDir(node.entry.relativePath);
      node.children = entries.map(toNode);
      node.expanded = true;
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to list folder');
    } finally {
      node.loading = false;
      renderTree();
    }
  }

  function renderTree(): void {
    if (!hasRoot) {
      treeEl.innerHTML = '';
      return;
    }
    treeEl.innerHTML = rootEntries.map((n) => renderNode(n, 0)).join('');
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
    const rows = [
      `<div class="file-explorer-row${fileClass}" role="treeitem" data-rel="${escapeAttr(entry.relativePath)}" data-kind="${entry.kind}" style="--depth:${depth}">
        <span class="file-explorer-twisty" aria-hidden="true">${twisty}</span>
        <span class="file-explorer-name">${label}</span>
      </div>`,
    ];
    if (isDir && node.expanded && node.children) {
      for (const child of node.children) {
        rows.push(renderNode(child, depth + 1));
      }
    }
    return rows.join('');
  }

  function showError(message: string | null): void {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function clearPendingOpen(): void {
    if (pendingOpenTimer) {
      clearTimeout(pendingOpenTimer);
      pendingOpenTimer = null;
    }
  }

  return () => {
    disposed = true;
    clearPendingOpen();
    unsubWorkspace();
    container.classList.remove('file-explorer');
    container.innerHTML = '';
  };
}

function toNode(entry: DirEntryDto): TreeNodeState {
  return {
    entry,
    expanded: false,
    children: null,
    loading: false,
  };
}

function findNode(
  nodes: TreeNodeState[],
  relativePath: string,
): TreeNodeState | undefined {
  for (const node of nodes) {
    if (node.entry.relativePath === relativePath) return node;
    if (node.children) {
      const found = findNode(node.children, relativePath);
      if (found) return found;
    }
  }
  return undefined;
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
