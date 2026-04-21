/**
 * Message dispatch — the one function every mutation flows through.
 *
 * `dispatch(msg)` does two things:
 *
 *   1. Routes the message to the correct store, applying a semantically-
 *      correct update for its `kind`. This is where requirement 3.4's
 *      exhaustive-handling discipline lives: the `switch(msg.kind)` has an
 *      `assertNever` default, so adding a new variant without handling it
 *      here is a compile error.
 *
 *   2. Notifies any "raw message" subscribers. Some messages (e.g.
 *      `scene:save`) are commands with no store side-effect — the extension
 *      host subscribes to the raw stream and reacts to them (writing the
 *      current document to disk in the case of `scene:save`).
 *
 * Panels never write to stores directly. They dispatch messages; stores
 * update; subscribers are notified. This is what structurally prevents the
 * old editor's inter-panel drift problem (requirement 6.1).
 */

import { assertNever } from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { sceneDocument } from './scene-document.js';
import { applyComponentUpdate } from './scene-mutation.js';
import { selection } from './selection.js';

type MessageListener = (msg: EditorMessage) => void;

const messageListeners = new Set<MessageListener>();

/**
 * Register a listener that receives every dispatched message. Returns an
 * unsubscribe function. Useful for the extension host's `scene:save`
 * handler and for test observation.
 */
export function subscribeMessages(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => {
    messageListeners.delete(listener);
  };
}

export function dispatch(msg: EditorMessage): void {
  switch (msg.kind) {
    case 'component:select':
      selection.set(msg.id);
      break;
    case 'scene:load':
      sceneDocument.set(msg.file);
      break;
    case 'component:update':
      sceneDocument.set((previous) =>
        previous === null
          ? previous
          : applyComponentUpdate(
              previous,
              msg.id,
              msg.componentType,
              msg.property,
              msg.value,
            ),
      );
      break;
    case 'scene:save':
      // No store mutation — raw-message subscribers handle persistence.
      break;
    default:
      assertNever(msg);
  }

  for (const listener of messageListeners) {
    listener(msg);
  }
}

/**
 * Test-only: clear all in-memory state. Used by unit tests to start from
 * a known-clean slate rather than relying on cross-test isolation.
 */
export function resetStateForTests(): void {
  selection.set(null);
  sceneDocument.set(null);
  messageListeners.clear();
}
