import { installMonacoEnvironment } from './monaco-env';
installMonacoEnvironment();

import * as monaco from 'monaco-editor';
import {
  resolveOpenTarget,
  type EditorOpenMode,
} from './open-target';
import { languageIdForPath } from './language';
import {
  ensureTypescriptLanguageService,
  syncWorkspaceTypescript,
  workspaceFileUri,
} from './typescript-service';

export type { EditorOpenMode } from './open-target';
export { resolveOpenTarget } from './open-target';
export { languageIdForPath } from './language';

export const EDITORS_VIEW_ID = 'text-buffer';

/** @deprecated Prefer EDITORS_VIEW_ID */
export const TEXT_BUFFER_VIEW_ID = EDITORS_VIEW_ID;

export interface EditorBuffer {
  readonly id: string;
  relativePath: string;
  /** Last saved (or loaded) contents — dirty when model differs. */
  savedContents: string;
  preview: boolean;
  model: monaco.editor.ITextModel;
}

export interface EditorsDeps {
  readonly writeTextFile: (
    relativePath: string,
    contents: string,
  ) => Promise<string>;
  readonly readTextFile: (relativePath: string) => Promise<string>;
  readonly listDir: (
    relativePath?: string,
  ) => Promise<
    ReadonlyArray<{ readonly name: string; readonly kind: string }>
  >;
  readonly getWorkspaceRoot: () => Promise<string | null>;
  readonly onWorkspaceChanged: (
    callback: (root: string | null) => void,
  ) => () => void;
  readonly onStatus?: (message: string) => void;
}

export interface EditorReveal {
  /** 1-based line. */
  readonly line: number;
  /** 1-based column (defaults to 1). */
  readonly column?: number;
}

export interface EditorsHandle {
  readonly open: (
    relativePath: string,
    contents: string,
    mode: EditorOpenMode,
    reveal?: EditorReveal,
  ) => string;
  readonly saveActive: () => Promise<boolean>;
  readonly syncTypescript: () => Promise<void>;
  readonly buffers: () => readonly EditorBuffer[];
  readonly activeId: () => string | null;
  readonly lastInteractedId: () => string | null;
  readonly layout: () => void;
}

let handle: EditorsHandle | null = null;
let nextBufferSeq = 1;

export function getEditorsHandle(): EditorsHandle | null {
  return handle;
}

/** @deprecated Prefer getEditorsHandle */
export function getTextBufferHandle(): EditorsHandle | null {
  return handle;
}

export function mountTextBuffer(
  container: HTMLElement,
  deps: EditorsDeps,
): () => void {
  container.classList.add('text-buffer', 'editors');
  container.innerHTML = `
    <div class="editors-tabs" role="tablist" aria-label="Open files"></div>
    <div class="editors-empty">No file open — single-click a file in the explorer</div>
    <div class="editors-pane" hidden>
      <div class="editors-monaco-host"></div>
    </div>
  `;

  const tabsEl = container.querySelector('.editors-tabs') as HTMLElement;
  const emptyEl = container.querySelector('.editors-empty') as HTMLElement;
  const paneEl = container.querySelector('.editors-pane') as HTMLElement;
  const monacoHost = container.querySelector(
    '.editors-monaco-host',
  ) as HTMLElement;

  const buffers = new Map<string, EditorBuffer>();
  let activeId: string | null = null;
  let lastInteractedId: string | null = null;
  let dirtyTick = 0;
  let workspaceRoot: string | null = null;

  ensureTypescriptLanguageService();

  const editor = monaco.editor.create(monacoHost, {
    automaticLayout: false,
    theme: 'vs-dark',
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    renderLineHighlight: 'line',
    padding: { top: 8 },
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void saveActive();
  });

  const resizeObserver = new ResizeObserver(() => {
    editor.layout();
  });
  resizeObserver.observe(monacoHost);

  const modelDisposable = editor.onDidChangeModelContent(() => {
    dirtyTick += 1;
    renderTabsOnly();
  });

  const unsubWorkspace = deps.onWorkspaceChanged((root) => {
    workspaceRoot = root;
    void syncTypescript();
  });

  tabsEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const closeBtn = target?.closest<HTMLElement>('[data-editor-close]');
    if (closeBtn?.dataset.bufferId) {
      event.preventDefault();
      event.stopPropagation();
      void closeBuffer(closeBtn.dataset.bufferId);
      return;
    }
    const tab = target?.closest<HTMLElement>('[data-buffer-id]');
    if (!tab?.dataset.bufferId) return;
    activate(tab.dataset.bufferId, true);
  });

  handle = {
    open(relativePath, contents, mode, reveal) {
      const target = resolveOpenTarget({
        mode,
        lastInteractedId,
        activeId,
        openIds: [...buffers.keys()],
      });

      if (target.kind === 'reuse') {
        const buf = buffers.get(target.bufferId)!;
        if (isDirty(buf) && buf.relativePath !== relativePath) {
          const ok = window.confirm(
            `Discard unsaved changes to ${fileName(buf.relativePath)}?`,
          );
          if (!ok) return target.bufferId;
        }
        replaceBufferContents(buf, relativePath, contents);
        activate(target.bufferId, true);
        applyReveal(reveal);
        void syncTypescript();
        return target.bufferId;
      }

      const id = `buf-${nextBufferSeq++}`;
      const model = createBufferModel(relativePath, contents);
      buffers.set(id, {
        id,
        relativePath,
        savedContents: contents,
        preview: target.preview,
        model,
      });
      activate(id, true);
      applyReveal(reveal);
      void syncTypescript();
      return id;
    },
    saveActive,
    syncTypescript,
    buffers: () => [...buffers.values()],
    activeId: () => activeId,
    lastInteractedId: () => lastInteractedId,
    layout: () => editor.layout(),
  };

  void (async () => {
    workspaceRoot = await deps.getWorkspaceRoot();
    await syncTypescript();
  })();

  render();

  return () => {
    handle = null;
    unsubWorkspace();
    resizeObserver.disconnect();
    modelDisposable.dispose();
    const models = new Set<monaco.editor.ITextModel>();
    for (const buf of buffers.values()) {
      models.add(buf.model);
    }
    buffers.clear();
    for (const model of models) {
      model.dispose();
    }
    editor.dispose();
    container.classList.remove('text-buffer', 'editors');
    container.innerHTML = '';
  };

  async function syncTypescript(): Promise<void> {
    try {
      await syncWorkspaceTypescript({
        getWorkspaceRoot: async () => workspaceRoot ?? deps.getWorkspaceRoot(),
        readTextFile: deps.readTextFile,
        listDir: deps.listDir,
      });
    } catch (err) {
      deps.onStatus?.(
        err instanceof Error
          ? `TypeScript sync: ${err.message}`
          : 'TypeScript sync failed',
      );
    }
  }

  async function saveActive(): Promise<boolean> {
    if (!activeId) return false;
    const buf = buffers.get(activeId);
    if (!buf) return false;
    const contents = buf.model.getValue();
    try {
      await deps.writeTextFile(buf.relativePath, contents);
      buf.savedContents = contents;
      if (buf.preview) buf.preview = false;
      renderTabsOnly();
      deps.onStatus?.(`Saved ${buf.relativePath}`);
      return true;
    } catch (err) {
      deps.onStatus?.(
        err instanceof Error ? err.message : 'Failed to save file',
      );
      return false;
    }
  }

  function createBufferModel(
    relativePath: string,
    contents: string,
  ): monaco.editor.ITextModel {
    const language = languageIdForPath(relativePath);
    // One model per path — URI must end with the real extension so the TS worker
    // classifies ScriptKind correctly (see workspaceFileUri docs).
    const uri = workspaceRoot
      ? workspaceFileUri(workspaceRoot, relativePath)
      : monaco.Uri.parse(
          `inmemory:///${relativePath.replace(/\\/g, '/')}`,
        );
    const existing = monaco.editor.getModel(uri);
    if (existing) {
      monaco.editor.setModelLanguage(existing, language);
      existing.setValue(contents);
      return existing;
    }
    return monaco.editor.createModel(contents, language, uri);
  }

  function applyReveal(reveal: EditorReveal | undefined): void {
    if (!reveal) return;
    const line = Math.max(1, Math.floor(reveal.line));
    const column = Math.max(1, Math.floor(reveal.column ?? 1));
    queueMicrotask(() => {
      editor.revealPositionInCenter({ lineNumber: line, column });
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    });
  }

  function replaceBufferContents(
    buf: EditorBuffer,
    relativePath: string,
    contents: string,
  ): void {
    if (buf.relativePath !== relativePath) {
      const old = buf.model;
      const next = createBufferModel(relativePath, contents);
      buf.relativePath = relativePath;
      buf.savedContents = contents;
      buf.preview = false;
      buf.model = next;
      if (editor.getModel() === old) {
        editor.setModel(next);
      }
      disposeModelIfOrphaned(old);
      return;
    }
    buf.savedContents = contents;
    buf.preview = false;
    const language = languageIdForPath(relativePath);
    monaco.editor.setModelLanguage(buf.model, language);
    buf.model.setValue(contents);
  }

  function activate(id: string, markInteracted: boolean): void {
    if (!buffers.has(id)) return;
    activeId = id;
    if (markInteracted) lastInteractedId = id;
    const buf = buffers.get(id)!;
    if (editor.getModel() !== buf.model) {
      editor.setModel(buf.model);
    }
    render();
    queueMicrotask(() => editor.layout());
    editor.focus();
  }

  async function closeBuffer(id: string): Promise<void> {
    const buf = buffers.get(id);
    if (!buf) return;
    if (isDirty(buf)) {
      const ok = window.confirm(
        `Discard unsaved changes to ${fileName(buf.relativePath)}?`,
      );
      if (!ok) return;
    }
    buffers.delete(id);
    disposeModelIfOrphaned(buf.model);
    if (activeId === id) {
      activeId = [...buffers.keys()].at(-1) ?? null;
      if (activeId) {
        editor.setModel(buffers.get(activeId)!.model);
      } else {
        editor.setModel(null);
      }
    }
    if (lastInteractedId === id) {
      lastInteractedId = activeId;
    }
    render();
  }

  function disposeModelIfOrphaned(model: monaco.editor.ITextModel): void {
    for (const other of buffers.values()) {
      if (other.model === model) return;
    }
    model.dispose();
  }

  function isDirty(buf: EditorBuffer): boolean {
    void dirtyTick;
    return buf.model.getValue() !== buf.savedContents;
  }

  function render(): void {
    renderTabsOnly();
    if (!activeId || !buffers.has(activeId)) {
      emptyEl.hidden = false;
      paneEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    paneEl.hidden = false;
  }

  function renderTabsOnly(): void {
    const list = [...buffers.values()];
    tabsEl.hidden = list.length === 0;
    tabsEl.innerHTML = list
      .map((buf) => {
        const name = fileName(buf.relativePath);
        const dirty = isDirty(buf);
        const active = buf.id === activeId ? ' editors-tab-active' : '';
        const preview = buf.preview ? ' editors-tab-preview' : '';
        const dirtyMark = dirty ? ' •' : '';
        return `<button type="button" class="editors-tab${active}${preview}" role="tab" data-buffer-id="${escapeAttr(buf.id)}" title="${escapeAttr(buf.relativePath)}" aria-selected="${buf.id === activeId}">
          <span class="editors-tab-label">${escapeHtml(name)}${dirtyMark}</span>
          <span class="editors-tab-close" data-editor-close data-buffer-id="${escapeAttr(buf.id)}" title="Close" aria-label="Close">×</span>
        </button>`;
      })
      .join('');
  }
}

function fileName(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
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
