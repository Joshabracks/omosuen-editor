/**
 * Public API for the editor state module.
 *
 * Consumers import from here; never from submodules directly.
 *
 * Shape:
 *   - `sceneDocument` / `selection`: the two canonical stores (requirement 6.1).
 *   - `dispatch(msg)`: the single entry point for mutations.
 *   - `subscribeMessages`: observe the raw message stream (e.g. for
 *     `scene:save` persistence on the extension host side).
 *   - `createStore` / `Store`: re-exported so future specialized state
 *     (e.g. panel-local transient UI state) can use the same primitive.
 */

export { createStore } from './store.js';
export type { Listener, Store, Unsubscribe, Updater } from './store.js';
export { sceneDocument } from './scene-document.js';
export { selection } from './selection.js';
export {
  applyComponentUpdate,
  updateComponentProperty,
} from './scene-mutation.js';
export { dispatch, subscribeMessages, resetStateForTests } from './dispatch.js';
