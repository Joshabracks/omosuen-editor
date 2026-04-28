/**
 * Per-document editor state factory.
 *
 * Each webview instantiates this once on boot and holds the returned
 * `EditorState` for the lifetime of its document. VS Code's custom-editor
 * API supports multiple `.omoscene` tabs open simultaneously, so state
 * **must not** be module-scope — one tab's edits would otherwise mutate
 * another tab's view.
 *
 * The extension host never imports this module. It speaks only in
 * encoded protocol messages across the postMessage / WebSocket boundary;
 * each webview's factory-scoped `dispatch` handles its own document.
 *
 * Resolution of Phase 3.5.1 (Option A, factory). Earlier iterations held
 * module-scope stores; that was safe per-webview but a latent trap if the
 * extension host ever started reading state directly.
 */

import type { EditorMessage } from '../protocol/index.js';
import { assertNever } from '../protocol/index.js';
import type { OmosceneFile } from '../omoscene/index.js';
import { applyComponentUpdate } from './scene-mutation.js';
import { createStore } from './store.js';
import type { Store } from './store.js';

export type MessageListener = (msg: EditorMessage) => void;

export interface EditorState {
  readonly sceneDocument: Store<OmosceneFile | null>;
  readonly selection: Store<readonly number[]>;

  /**
   * Route an `EditorMessage` through the state module. Synchronous and
   * recursion-safe; never returns a promise or queues work.
   *
   * **Ordering within a single call:**
   *
   *   1. The switch-arm for `msg.kind` runs, calling `store.set(...)` on
   *      one or more stores. Each store's subscribers fire inline with
   *      its `set()`. For messages that touch multiple stores
   *      (`scene:load` updates `sceneDocument` **then** `selection`),
   *      the first store's subscribers see the second store still
   *      holding its prior value — stores are updated in source order,
   *      not atomically.
   *
   *   2. After all store updates for this message complete, listeners
   *      registered via `subscribeMessages` fire. They always see the
   *      fully settled post-message state across every store.
   *
   * **Reentrancy:** a listener (store subscriber or message subscriber)
   * that calls `dispatch(msg2)` from inside handling of `msg1` runs
   * `msg2` synchronously and depth-first — its entire store + message
   * pipeline completes before control returns to `msg1`'s remaining
   * listeners. This is correct but worth knowing: cascading listeners
   * can produce deep call stacks and counter-intuitive-looking orders in
   * a debugger.
   */
  dispatch(msg: EditorMessage): void;

  /**
   * Register a listener that receives every dispatched message **after**
   * all store mutations for that message have completed (see `dispatch`
   * for exact ordering). Returns an unsubscribe function. Used by the
   * extension-host side to react to commands like `scene:save`, and by
   * tests to observe the raw message stream.
   */
  subscribeMessages(listener: MessageListener): () => void;
}

export function createEditorState(): EditorState {
  const sceneDocument = createStore<OmosceneFile | null>(null);
  const selection = createStore<readonly number[]>([]);
  const messageListeners = new Set<MessageListener>();

  function dispatch(msg: EditorMessage): void {
    switch (msg.kind) {
      case 'component:select':
        selection.set(msg.ids);
        break;
      case 'scene:load':
        sceneDocument.set(msg.file);
        // Restore the file's persisted selection. Defensive copy so the
        // store's array is not aliased with `file.editor.selection` — a
        // later `component:select` must not mutate the file.
        selection.set([...msg.file.editor.selection]);
        break;
      case 'component:update': {
        // Phase 3.5.13 resolution: if `applyComponentUpdate` returns the
        // same file reference, no component matched — surface it so the
        // silent no-op isn't a hidden failure mode. The no-op behaviour
        // itself stays (a user undoing a component's creation while an
        // inspector still holds a stale reference is a valid flow).
        sceneDocument.set((previous) => {
          if (previous === null) return previous;
          const next = applyComponentUpdate(
            previous,
            msg.id,
            msg.componentType,
            msg.property,
            msg.value,
          );
          if (next === previous) {
            console.warn(
              `[state] component:update target not found: id=${String(msg.id)}, componentType="${msg.componentType}", property="${msg.property}"`,
            );
          }
          return next;
        });
        break;
      }
      case 'scene:save':
        // No store mutation — raw-message subscribers handle persistence.
        break;
      case 'preview:ready':
      case 'preview:log':
        // Bridge-layer notifications from the Phase 9 preview overlay.
        // No store mutation — raw-message subscribers (the extension-host
        // preview launcher) forward these to the "Omosuen Preview" output
        // channel.
        break;
      case 'command:invoke':
        // Phase 8.1 action-button dispatch. No store mutation — the
        // extension host subscribes to the raw message stream and
        // forwards to `vscode.commands.executeCommand` when it sees one.
        break;
      case 'image:loaded':
        // Phase 8.3 host → texture-map-editor push. No store mutation —
        // the texture-map webview subscribes to the raw message stream
        // and rebuilds its <img> source from the data URI.
        break;
      case 'audio:tracks':
        // Phase 8.4 host → audio-editor push. No store mutation —
        // the audio editor subscribes to the raw message stream and
        // refreshes its track-selector dropdown.
        break;
      default:
        assertNever(msg);
    }

    // Snapshot before iterating: a listener that unsubscribes itself or
    // another listener during notification must not disturb the delivery
    // of this message to the listeners that existed at dispatch time.
    for (const listener of [...messageListeners]) {
      listener(msg);
    }
  }

  function subscribeMessages(listener: MessageListener): () => void {
    messageListeners.add(listener);
    return () => {
      messageListeners.delete(listener);
    };
  }

  return { sceneDocument, selection, dispatch, subscribeMessages };
}
