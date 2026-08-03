/**
 * Per-open-document controller + multi-panel protocol message broker (E5/E6).
 *
 * Structural verbs (`component:add` / `remove` / `move`) are fanned out as
 * incremental messages — never rewritten as a full `scene:load`. Rejected
 * mutations (e.g. cycle reparent) are not broadcast.
 */

import type { Bridge } from '../bridge/protocol-bridge';
import type { OmosceneFile } from '../omoscene';
import { withEditorMetadata } from '../omoscene';
import {
  componentSelect,
  sceneLoad,
  type EditorMessage,
} from '../protocol';
import { createEditorState, type EditorState } from '../state';

/** Stable string key for an open document (absolute path or file URL). */
export type DocumentUri = string;

export interface DocumentControllerDependencies {
  readFile(uri: DocumentUri): Promise<OmosceneFile>;
  writeFile(uri: DocumentUri, file: OmosceneFile): Promise<void>;
  onSaveError?: (error: Error) => void;
}

export interface DocumentController {
  readonly editorState: EditorState;
  readonly uri: DocumentUri | null;
  load(uri: DocumentUri): Promise<void>;
  save(): Promise<void>;
  /**
   * Replace the in-memory document (e.g. duplicate) without clearing dirty.
   * Broadcasts `scene:load` to panels and optionally updates selection.
   */
  replaceDocument(
    file: OmosceneFile,
    options?: { readonly selectIds?: readonly number[]; readonly dirty?: boolean },
  ): void;
  /** Clear the loaded document (e.g. project closed). */
  unload(): void;
  /**
   * Attach a panel bridge. Late joiners receive `scene:load` when a
   * document is already loaded. Returns unregister.
   */
  registerPanel(bridge: Bridge): () => void;
  rebroadcastSceneLoad(): void;
  /** Host-originated message — apply + broadcast to every panel. */
  dispatchFromHost(msg: EditorMessage): void;
  dispose(): void;
}

function isStructuralMessage(msg: EditorMessage): boolean {
  return (
    msg.kind === 'component:add' ||
    msg.kind === 'component:remove' ||
    msg.kind === 'component:move'
  );
}

export function createDocumentController(
  deps: DocumentControllerDependencies,
): DocumentController {
  const editorState = createEditorState();
  const panels = new Set<Bridge>();
  const perBridgeUnsub = new Map<Bridge, () => void>();
  const onSaveError = deps.onSaveError ?? defaultOnSaveError;
  let currentUri: DocumentUri | null = null;
  let disposed = false;

  function fanOut(source: Bridge | null, msg: EditorMessage): void {
    for (const other of [...panels]) {
      if (other === source) continue;
      other.dispatch(msg);
    }
  }

  function applyAndBroadcast(
    source: Bridge | null,
    msg: EditorMessage,
  ): void {
    if (disposed) return;

    if (msg.kind === 'scene:save') {
      void save().catch((err: unknown) => {
        onSaveError(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    }

    const beforeDoc = editorState.sceneDocument.get();
    const beforeSel = editorState.selection.get();
    editorState.dispatch(msg);

    if (isStructuralMessage(msg)) {
      const afterDoc = editorState.sceneDocument.get();
      if (afterDoc === beforeDoc) {
        // Rejected (uniqueness, cycle, missing parent, …) — do not fan out.
        return;
      }
      fanOut(source, msg);
      const afterSel = editorState.selection.get();
      if (afterSel !== beforeSel) {
        fanOut(source, componentSelect([...afterSel]));
      }
      return;
    }

    fanOut(source, msg);
  }

  function dispatchFromHost(msg: EditorMessage): void {
    applyAndBroadcast(null, msg);
  }

  async function load(uri: DocumentUri): Promise<void> {
    const file = await deps.readFile(uri);
    currentUri = uri;
    const loadMsg = sceneLoad(file);
    editorState.dispatch(loadMsg);
    for (const bridge of [...panels]) {
      bridge.dispatch(loadMsg);
    }
  }

  async function save(): Promise<void> {
    if (currentUri === null) {
      throw new Error('save() called with no document loaded');
    }
    const file = editorState.sceneDocument.get();
    if (file === null) {
      throw new Error('save() called with no scene in editor state');
    }
    const toWrite = withEditorMetadata(file, {
      ...file.editor,
      selection: [...editorState.selection.get()],
    });
    await deps.writeFile(currentUri, toWrite);
    editorState.sceneDocument.set(toWrite);
    editorState.dirty.set(false);
  }

  function replaceDocument(
    file: OmosceneFile,
    options?: { readonly selectIds?: readonly number[]; readonly dirty?: boolean },
  ): void {
    if (disposed) return;
    editorState.sceneDocument.set(file);
    if (options?.selectIds) {
      editorState.selection.set([...options.selectIds]);
    }
    editorState.dirty.set(options?.dirty ?? true);
    const loadMsg = sceneLoad(file);
    for (const bridge of [...panels]) {
      bridge.dispatch(loadMsg);
    }
  }

  function unload(): void {
    if (disposed) return;
    currentUri = null;
    editorState.sceneDocument.set(null);
    editorState.selection.set([]);
    editorState.dirty.set(false);
  }

  function registerPanel(bridge: Bridge): () => void {
    if (disposed) {
      return (): void => undefined;
    }
    panels.add(bridge);
    const unsub = bridge.onMessage((msg) => {
      applyAndBroadcast(bridge, msg);
    });
    perBridgeUnsub.set(bridge, unsub);

    const currentFile = editorState.sceneDocument.get();
    if (currentFile !== null) {
      bridge.dispatch(sceneLoad(currentFile));
    }

    return (): void => {
      panels.delete(bridge);
      const u = perBridgeUnsub.get(bridge);
      if (u !== undefined) {
        u();
        perBridgeUnsub.delete(bridge);
      }
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const u of [...perBridgeUnsub.values()]) u();
    perBridgeUnsub.clear();
    panels.clear();
  }

  function rebroadcastSceneLoad(): void {
    if (disposed) return;
    const currentFile = editorState.sceneDocument.get();
    if (currentFile === null) return;
    const loadMsg = sceneLoad(currentFile);
    for (const bridge of [...panels]) {
      bridge.dispatch(loadMsg);
    }
  }

  return {
    editorState,
    get uri(): DocumentUri | null {
      return currentUri;
    },
    load,
    save,
    replaceDocument,
    unload,
    registerPanel,
    rebroadcastSceneLoad,
    dispatchFromHost,
    dispose,
  };
}

function defaultOnSaveError(error: Error): void {
  console.warn(`[document-controller] save failed: ${error.message}`);
}
