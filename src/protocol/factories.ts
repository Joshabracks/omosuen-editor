/**
 * Factory helpers for producing well-formed `EditorMessage` values. Using
 * these at call sites keeps the `kind` discriminant and field names in one
 * place, so renaming a field requires only updating the factory (+ types).
 */

import type { OmosceneFile } from '../omoscene/index.js';
import type {
  ComponentSelectMessage,
  ComponentUpdateMessage,
  JsonValue,
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
