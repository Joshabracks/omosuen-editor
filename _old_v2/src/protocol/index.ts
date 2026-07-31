/**
 * Public API for the editor message protocol.
 *
 * Both the extension host and webview import from here. Never from
 * `./types.js` or `./encode.js` / `./decode.js` directly — those are
 * implementation modules. Requirement 4.3: single home for protocol types.
 */

export type {
  AudioTrackEntry,
  AudioTracksMessage,
  CommandInvokeMessage,
  ComponentSelectMessage,
  ComponentUpdateMessage,
  EditorMessage,
  EditorMessageKind,
  ImageLoadedMessage,
  JsonPrimitive,
  JsonValue,
  MessengerSendMessage,
  PreviewLogMessage,
  PreviewReadyMessage,
  SceneLoadMessage,
  SceneSaveMessage,
} from './types.js';
export { assertNever } from './types.js';
export { encodeMessage, ProtocolEncodeError } from './encode.js';
export { decodeMessage, ProtocolDecodeError } from './decode.js';
export {
  audioTracks,
  commandInvoke,
  componentSelect,
  componentUpdate,
  imageLoaded,
  messengerSend,
  previewLog,
  previewReady,
  sceneLoad,
  sceneSave,
} from './factories.js';
