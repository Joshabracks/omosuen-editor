/**
 * Public API for the editor state module.
 *
 * Consumers import from here; never from submodules directly.
 *
 * Shape:
 *   - `createEditorState()`: instantiates a per-document `EditorState` with
 *     its own stores, dispatcher, and message subscribers. Each webview
 *     calls this once on boot; the extension host does not import this
 *     module (it communicates only in encoded protocol messages).
 *   - `createStore` / `Store`: re-exported so future specialized state
 *     (e.g. panel-local transient UI state) can reuse the same primitive.
 *   - `applyComponentUpdate` / `updateComponentProperty`: pure scene-tree
 *     helpers. Exported for tests; the factory wires them into dispatch.
 */

export { createStore } from './store.js';
export type { Listener, Store, Unsubscribe, Updater } from './store.js';
export {
  applyComponentUpdate,
  insertChildComponent,
  moveComponent,
  nextComponentId,
  removeComponent,
  reparentComponent,
  updateComponentProperty,
} from './scene-mutation.js';
export type { MoveDirection } from './scene-mutation.js';
export { buildDefaultComponent } from './component-defaults.js';
export type { BuildDefaultComponentOptions } from './component-defaults.js';
export { createEditorState } from './editor-state.js';
export type { EditorState, MessageListener } from './editor-state.js';
