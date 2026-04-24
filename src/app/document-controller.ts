/**
 * Per-open-document controller + multi-panel message broker.
 *
 * Phase 5 supports one open scene at a time. `createDocumentController`
 * instantiates a host-side `EditorState` that owns the loaded
 * `OmosceneFile` and mirrors every mutation that arrives from any
 * registered panel. Panels connect via `registerPanel(bridge)`; the
 * controller then:
 *
 *   1. Applies every incoming message to its `editorState` (keeping the
 *      host as the canonical copy for persistence).
 *   2. Re-broadcasts the message to every OTHER registered panel so all
 *      panels stay in sync.
 *   3. Special-cases `scene:save` — the broker writes to disk instead
 *      of broadcasting (save is a command, not a state mutation).
 *
 * File I/O is injected via the `readFile` / `writeFile` deps so this
 * module is Node-testable. In production: wire `vscode.workspace.fs`
 * via `readOmoscene` / `writeOmoscene` from `../omoscene/fs.js`.
 *
 * Host-side state ownership is compatible with Phase 3.5.1 Option A:
 * the factory pattern applies equally to webview and host; the host's
 * `EditorState` is scoped to the lifetime of the open document.
 */

import type { Uri } from 'vscode';
import type { Bridge } from '../bridge/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { sceneLoad } from '../protocol/index.js';
import type { OmosceneFile } from '../omoscene/index.js';
import type { EditorState } from '../state/index.js';
import { createEditorState } from '../state/index.js';

export interface DocumentControllerDependencies {
  readFile(uri: Uri): Promise<OmosceneFile>;
  writeFile(uri: Uri, file: OmosceneFile): Promise<void>;
  /**
   * Called when a `scene:save` operation fails. Defaults to
   * `console.warn`. The controller never rethrows save errors — the
   * save is fire-and-forget from the broker's perspective.
   */
  onSaveError?: (error: Error) => void;
}

export interface DocumentController {
  readonly editorState: EditorState;
  readonly uri: Uri | null;
  load(uri: Uri): Promise<void>;
  save(): Promise<void>;
  /**
   * Attach a panel's bridge. Messages from the panel route through the
   * broker (apply to host state + broadcast to other panels). Returns
   * an unregister function — call on panel disposal.
   *
   * If a document is already loaded when a panel registers, the panel
   * is hydrated by dispatching the current `scene:load` to it. Late
   * joiners thus see the current scene without needing to request it.
   */
  registerPanel(bridge: Bridge): () => void;
  /**
   * Re-dispatch the current host-side document to every registered
   * panel as a fresh `scene:load`. Used by host-originated mutations
   * (e.g. the Post-8 `omosuen.addChildComponent` command) where the
   * mutation happens outside the panel-broker pipeline but still needs
   * every panel to re-hydrate. No-op when no document is loaded.
   */
  rebroadcastSceneLoad(): void;
  /**
   * Host-originated equivalent of what a registered panel's bridge
   * does when it dispatches an `EditorMessage`: apply to the canonical
   * `editorState` AND broadcast to every registered panel (no source
   * to skip — host has no bridge).
   *
   * Used by the native scene tree provider (which is NOT a webview
   * and has no bridge) to route `component:select` + friends through
   * the same broker pipeline, keeping every panel in sync.
   *
   * Special-cases `scene:save` identically to the broker — persists
   * via `save()` and does not broadcast.
   */
  dispatchFromHost(msg: EditorMessage): void;
  /** Tears down every per-panel subscription. Idempotent. */
  dispose(): void;
}

export function createDocumentController(
  deps: DocumentControllerDependencies,
): DocumentController {
  const editorState = createEditorState();
  const panels = new Set<Bridge>();
  const perBridgeUnsub = new Map<Bridge, () => void>();
  const onSaveError = deps.onSaveError ?? defaultOnSaveError;
  let currentUri: Uri | null = null;
  let disposed = false;

  function applyAndBroadcast(source: Bridge | null, msg: EditorMessage): void {
    if (disposed) return;

    if (msg.kind === 'scene:save') {
      // `scene:save` is a command, not a state mutation — write to disk
      // and do not broadcast back. Errors surface via `onSaveError`.
      void save().catch((err: unknown) => {
        onSaveError(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    }

    editorState.dispatch(msg);

    // Snapshot before iterating — see Phase 3.5.3. A broker subscriber
    // that unregisters mid-fan-out must not disturb delivery to peers
    // that existed when this message arrived. `source === null` means
    // the message originated from host-side code (no bridge to skip).
    for (const other of [...panels]) {
      if (other === source) continue;
      other.dispatch(msg);
    }
  }

  function broker(source: Bridge, msg: EditorMessage): void {
    applyAndBroadcast(source, msg);
  }

  function dispatchFromHost(msg: EditorMessage): void {
    applyAndBroadcast(null, msg);
  }

  async function load(uri: Uri): Promise<void> {
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
    await deps.writeFile(currentUri, file);
  }

  function registerPanel(bridge: Bridge): () => void {
    if (disposed) {
      return (): void => undefined;
    }
    panels.add(bridge);
    const unsub = bridge.onMessage((msg) => {
      broker(bridge, msg);
    });
    perBridgeUnsub.set(bridge, unsub);

    // Hydrate late-joining panels with the current document (if any).
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
    get uri(): Uri | null {
      return currentUri;
    },
    load,
    save,
    registerPanel,
    rebroadcastSceneLoad,
    dispatchFromHost,
    dispose,
  };
}

function defaultOnSaveError(error: Error): void {
  console.warn(`[document-controller] save failed: ${error.message}`);
}
