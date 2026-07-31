/**
 * Factory helpers for producing well-formed `EditorMessage` values. Using
 * these at call sites keeps the `kind` discriminant and field names in one
 * place, so renaming a field requires only updating the factory (+ types).
 */

import type { OmosceneFile } from '../omoscene/index.js';
import type {
  AudioTrackEntry,
  AudioTracksMessage,
  CommandInvokeMessage,
  ComponentSelectMessage,
  ComponentUpdateMessage,
  ImageLoadedMessage,
  JsonValue,
  MessengerSendMessage,
  PreviewLogMessage,
  PreviewReadyMessage,
  SceneLoadMessage,
  SceneSaveMessage,
} from './types.js';

export function componentUpdate(
  id: number,
  componentType: string,
  property: string,
  value: JsonValue,
): ComponentUpdateMessage {
  return { kind: 'component:update', id, componentType, property, value };
}

export function componentSelect(
  ids: readonly number[],
): ComponentSelectMessage {
  return { kind: 'component:select', ids };
}

export function sceneLoad(file: OmosceneFile): SceneLoadMessage {
  return { kind: 'scene:load', file };
}

export function sceneSave(): SceneSaveMessage {
  return { kind: 'scene:save' };
}

export function previewReady(engineVersion: string): PreviewReadyMessage {
  return { kind: 'preview:ready', engineVersion };
}

export function previewLog(
  level: PreviewLogMessage['level'],
  message: string,
): PreviewLogMessage {
  return { kind: 'preview:log', level, message };
}

export function commandInvoke(
  command: string,
  args: readonly JsonValue[] = [],
): CommandInvokeMessage {
  return { kind: 'command:invoke', command, args };
}

export function imageLoaded(
  dataUri: string | null,
  sourceFilePath: string,
): ImageLoadedMessage {
  return { kind: 'image:loaded', dataUri, sourceFilePath };
}

export function audioTracks(
  tracks: readonly AudioTrackEntry[],
): AudioTracksMessage {
  return { kind: 'audio:tracks', tracks };
}

export function messengerSend(
  pattern: string,
  data: JsonValue,
): MessengerSendMessage {
  return { kind: 'messenger:send', pattern, data };
}
