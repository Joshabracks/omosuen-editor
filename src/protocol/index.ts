/**
 * Public API for the editor message protocol.
 *
 * Both the extension host and webview import from here. Never from
 * `./types.js` or `./encode.js` / `./decode.js` directly — those are
 * implementation modules. Requirement 4.3: single home for protocol types.
 */

export type {
  ComponentSelectMessage,
  ComponentUpdateMessage,
  EditorMessage,
  EditorMessageKind,
  SceneLoadMessage,
  SceneSaveMessage,
} from './types.js';
export { assertNever } from './types.js';
export { encodeMessage } from './encode.js';
export { decodeMessage, ProtocolDecodeError } from './decode.js';
export {
  componentSelect,
  componentUpdate,
  sceneLoad,
  sceneSave,
} from './factories.js';
