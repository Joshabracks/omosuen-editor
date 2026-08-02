import type { OmosceneFile } from '../omoscene';
import type {
  ComponentAddMessage,
  ComponentMoveMessage,
  ComponentRemoveMessage,
  ComponentSelectMessage,
  ComponentUpdateMessage,
  JsonValue,
  PreviewLogMessage,
  PreviewPauseMessage,
  PreviewReadyMessage,
  PreviewResumeMessage,
  PreviewStepMessage,
  SceneLoadMessage,
  SceneSaveMessage,
} from './types';

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

export function componentAdd(
  parentId: number,
  componentType: string,
  options?: { readonly name?: string; readonly props?: JsonValue },
): ComponentAddMessage {
  return {
    kind: 'component:add',
    parentId,
    componentType,
    ...(options?.name !== undefined ? { name: options.name } : {}),
    ...(options?.props !== undefined ? { props: options.props } : {}),
  };
}

export function componentRemove(id: number): ComponentRemoveMessage {
  return { kind: 'component:remove', id };
}

export function componentMove(
  id: number,
  parentId: number,
  index?: number,
): ComponentMoveMessage {
  return index === undefined
    ? { kind: 'component:move', id, parentId }
    : { kind: 'component:move', id, parentId, index };
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

export function previewPause(): PreviewPauseMessage {
  return { kind: 'preview:pause' };
}

export function previewResume(): PreviewResumeMessage {
  return { kind: 'preview:resume' };
}

export function previewStep(): PreviewStepMessage {
  return { kind: 'preview:step' };
}
