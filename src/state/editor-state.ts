/**
 * Per-document editor state — scene document, selection, dirty (3a/3b).
 */

import type { OmosceneFile, SerializedComponent } from '../omoscene';
import { isRecord } from '../protocol';
import { assertNever, type EditorMessage } from '../protocol';
import {
  applyComponentUpdate,
  buildDefaultComponent,
  canAddComponentType,
  findComponentById,
  insertChildComponent,
  nextComponentId,
  removeComponent,
  reparentComponent,
} from '../scene';
import { createStore, type Store } from './store';

export type MessageListener = (msg: EditorMessage) => void;

export interface EditorState {
  readonly sceneDocument: Store<OmosceneFile | null>;
  readonly selection: Store<readonly number[]>;
  readonly dirty: Store<boolean>;
  dispatch(msg: EditorMessage): void;
  subscribeMessages(listener: MessageListener): () => void;
}

export function createEditorState(): EditorState {
  const sceneDocument = createStore<OmosceneFile | null>(null);
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
        selection.set([...msg.file.editor.selection]);
        dirty.set(false);
        break;
      case 'component:update': {
        const file = sceneDocument.get();
        if (!file) break;
        const next = applyComponentUpdate(
          file,
          msg.id,
          msg.componentType,
          msg.property,
          msg.value,
        );
        if (next !== file) {
          sceneDocument.set(next);
          dirty.set(true);
        }
        break;
      }
      case 'component:add': {
        const file = sceneDocument.get();
        if (!file) break;
        const parent = findComponentById(file.scene, msg.parentId);
        if (!parent || parent.type !== 'nexus') break;
        const gate = canAddComponentType(file, msg.parentId, msg.componentType);
        if (!gate.ok) {
          console.warn(`[editor-state] ${gate.reason ?? 'add blocked'}`);
          break;
        }
        const id = nextComponentId(file);
        const child = buildAddedComponent(file, msg, id);
        const next = insertChildComponent(file, msg.parentId, child);
        if (next !== file) {
          sceneDocument.set(next);
          dirty.set(true);
          selection.set([id]);
        }
        break;
      }
      case 'component:remove': {
        const file = sceneDocument.get();
        if (!file) break;
        const next = removeComponent(file, msg.id);
        if (next !== file) {
          sceneDocument.set(next);
          dirty.set(true);
          selection.set(selection.get().filter((sid) => sid !== msg.id));
        }
        break;
      }
      case 'component:move': {
        const file = sceneDocument.get();
        if (!file) break;
        const next = reparentComponent(
          file,
          msg.id,
          msg.parentId,
          msg.index,
        );
        if (next !== file) {
          sceneDocument.set(next);
          dirty.set(true);
        }
        break;
      }
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

function buildAddedComponent(
  file: OmosceneFile,
  msg: Extract<EditorMessage, { kind: 'component:add' }>,
  id: number,
): SerializedComponent {
  if (msg.props && isRecord(msg.props)) {
    const clone = JSON.parse(JSON.stringify(msg.props)) as Record<
      string,
      unknown
    >;
    clone.type = msg.componentType;
    clone.id = id;
    if (msg.name !== undefined) clone.name = msg.name;
    if (clone.type === 'nexus' && !Array.isArray(clone.components)) {
      clone.components = [];
    }
    return clone as SerializedComponent;
  }
  return buildDefaultComponent({
    type: msg.componentType,
    id,
    engineVersion: file.engine,
    name: msg.name,
  });
}
