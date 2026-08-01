/**
 * Public API for the editor message protocol (E6).
 * Import from `../protocol` (or `src/protocol`) — not from leaf modules.
 */

export type {
  ComponentAddMessage,
  ComponentMoveMessage,
  ComponentRemoveMessage,
  ComponentSelectMessage,
  ComponentUpdateMessage,
  EditorMessage,
  EditorMessageKind,
  JsonPrimitive,
  JsonValue,
  PreviewLogMessage,
  PreviewPauseMessage,
  PreviewReadyMessage,
  PreviewResumeMessage,
  PreviewStepMessage,
  SceneLoadMessage,
  SceneSaveMessage,
} from './types';
export { assertNever, isRecord } from './types';
export { encodeMessage, ProtocolEncodeError } from './encode';
export { decodeMessage, ProtocolDecodeError } from './decode';
export {
  componentAdd,
  componentMove,
  componentRemove,
  componentSelect,
  componentUpdate,
  previewLog,
  previewPause,
  previewReady,
  previewResume,
  previewStep,
  sceneLoad,
  sceneSave,
} from './factories';
