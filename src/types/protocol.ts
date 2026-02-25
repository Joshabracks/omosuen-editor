/**
 * WebSocket communication protocol between VS Code extension and browser preview.
 * Protocol version: omosuen-editor/v1
 */

import type { SerializedComponent } from './engine';

export const PROTOCOL_VERSION = 'omosuen-editor/v1';

/**
 * Messages the extension sends to the preview
 */
export type ExtensionMessageType =
  | 'scene:load'
  | 'scene:reload'
  | 'component:select'
  | 'component:update'
  | 'component:add'
  | 'component:instantiate'
  | 'component:remove'
  | 'component:move'
  | 'preview:pause'
  | 'preview:resume'
  | 'preview:step'
  | 'preview:togglePerf';

/**
 * Messages the preview sends to the extension
 */
export type PreviewMessageType =
  | 'preview:ready'
  | 'component:selected'
  | 'component:changed'
  | 'preview:log'
  | 'preview:error'
  | 'preview:fps'
  | 'preview:pauseState'
  | 'editor:cameraState'
  | 'scene:state';

export type MessageType = ExtensionMessageType | PreviewMessageType;

/**
 * Versioned message envelope
 */
export interface EditorMessage {
  protocol: typeof PROTOCOL_VERSION;
  id: string;
  type: MessageType;
  payload: unknown;
}

/**
 * Payload types for specific messages
 */
export interface SceneLoadPayload {
  scene: SerializedComponent;
}

export interface ComponentSelectPayload {
  componentId: number;
}

export interface ComponentUpdatePayload {
  componentId: number;
  property: string;
  value: unknown;
}

export interface ComponentSelectedPayload {
  componentId: number;
}

export interface PreviewReadyPayload {
  engineVersion: string;
  contractVersion: number;
}

export interface PreviewLogPayload {
  level: 'info' | 'warn' | 'error';
  message: string;
  tag?: string;
}

export interface PreviewFpsPayload {
  fps: number;
}

export interface SceneStatePayload {
  scene: SerializedComponent;
}

export interface ComponentMovePayload {
  componentId: number;
  oldParentId: number;
  newParentId: number;
  index: number;
}

export interface ComponentInstantiatePayload {
  parentId: number;
  component: SerializedComponent;
}

export interface PreviewPauseStatePayload {
  paused: boolean;
}

export interface EditorCameraStatePayload {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Creates a new EditorMessage with a unique ID
 */
let messageCounter = 0;
export function createMessage(
  type: MessageType,
  payload: unknown
): EditorMessage {
  return {
    protocol: PROTOCOL_VERSION,
    id: `msg_${Date.now()}_${messageCounter++}`,
    type,
    payload,
  };
}

/**
 * Type guard: is this a valid EditorMessage?
 */
export function isEditorMessage(data: unknown): data is EditorMessage {
  if (typeof data !== 'object' || data === null) {return false;}
  const msg = data as Record<string, unknown>;
  return (
    msg.protocol === PROTOCOL_VERSION &&
    typeof msg.id === 'string' &&
    typeof msg.type === 'string'
  );
}
