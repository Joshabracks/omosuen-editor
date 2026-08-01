/**
 * Per-document editor state — stub until omoscene mutation (3a/3b).
 * Holds opaque scene JSON + selection + dirty flag.
 */

import {
  assertNever,
  isRecord,
  type EditorMessage,
  type JsonValue,
} from '../protocol';
import { createStore, type Store } from './store';

export type MessageListener = (msg: EditorMessage) => void;

export interface EditorState {
  readonly sceneDocument: Store<JsonValue | null>;
  readonly selection: Store<readonly number[]>;
  readonly dirty: Store<boolean>;
  dispatch(msg: EditorMessage): void;
  subscribeMessages(listener: MessageListener): () => void;
}

export function createEditorState(): EditorState {
  const sceneDocument = createStore<JsonValue | null>(null);
  const selection = createStore<readonly number[]>([]);
  const dirty = createStore(false);
  const messageListeners = new Set<MessageListener>();

  function dispatch(msg: EditorMessage): void {
    switch (msg.kind) {
      case 'component:select':
        selection.set(msg.ids);
        break;
      case 'scene:load':
        sceneDocument.set(msg.file);
        selection.set(selectionFromFile(msg.file));
        dirty.set(false);
        break;
      case 'component:update':
      case 'component:add':
      case 'component:remove':
      case 'component:move':
        // Deep tree mutation lands in 3b/3c — stub marks dirty only.
        dirty.set(true);
        break;
      case 'scene:save':
      case 'preview:ready':
      case 'preview:log':
      case 'preview:pause':
      case 'preview:resume':
      case 'preview:step':
        break;
      default:
        assertNever(msg);
    }

    for (const listener of [...messageListeners]) {
      listener(msg);
    }
  }

  return {
    sceneDocument,
    selection,
    dirty,
    dispatch,
    subscribeMessages(listener) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
  };
}

function selectionFromFile(file: JsonValue): readonly number[] {
  if (!isRecord(file)) return [];
  const editor = file.editor;
  if (!isRecord(editor)) return [];
  const sel = editor.selection;
  if (!Array.isArray(sel)) return [];
  const out: number[] = [];
  for (const entry of sel) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out.push(entry);
  }
  return out;
}
