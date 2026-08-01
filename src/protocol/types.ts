/**
 * Editor message protocol — typed catalog shared by main, renderer, and
 * (later) preview WebSocket. Discriminated on `kind` (E6).
 */

/** JSON-safe value that can round-trip through `JSON.stringify` without loss. */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Inspector-driven property edit for one component. */
export interface ComponentUpdateMessage {
  readonly kind: 'component:update';
  readonly id: number;
  readonly componentType: string;
  readonly property: string;
  readonly value: JsonValue;
}

/** Selection change — empty array clears focus. */
export interface ComponentSelectMessage {
  readonly kind: 'component:select';
  readonly ids: readonly number[];
}

/** Insert a component under `parentId`. */
export interface ComponentAddMessage {
  readonly kind: 'component:add';
  readonly parentId: number;
  readonly componentType: string;
  readonly name?: string;
  readonly props?: JsonValue;
}

/** Remove a component by id. */
export interface ComponentRemoveMessage {
  readonly kind: 'component:remove';
  readonly id: number;
}

/** Reparent / reorder a component. */
export interface ComponentMoveMessage {
  readonly kind: 'component:move';
  readonly id: number;
  readonly parentId: number;
  /** Optional sibling index under the new parent. */
  readonly index?: number;
}

/**
 * Load a scene document into the store.
 * Payload is opaque JSON until the omoscene module (3a) owns validation.
 */
export interface SceneLoadMessage {
  readonly kind: 'scene:load';
  readonly file: JsonValue;
}

/** Request persistence of the current document (no payload). */
export interface SceneSaveMessage {
  readonly kind: 'scene:save';
}

/** Preview game connected — carries engine version string. */
export interface PreviewReadyMessage {
  readonly kind: 'preview:ready';
  readonly engineVersion: string;
}

/** Console line from the running preview. */
export interface PreviewLogMessage {
  readonly kind: 'preview:log';
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface PreviewPauseMessage {
  readonly kind: 'preview:pause';
}

export interface PreviewResumeMessage {
  readonly kind: 'preview:resume';
}

export interface PreviewStepMessage {
  readonly kind: 'preview:step';
}

/**
 * Full v1 core catalog (E6 must + preview control should).
 * Media verbs (`image:loaded`, etc.) are deferred.
 */
export type EditorMessage =
  | ComponentUpdateMessage
  | ComponentSelectMessage
  | ComponentAddMessage
  | ComponentRemoveMessage
  | ComponentMoveMessage
  | SceneLoadMessage
  | SceneSaveMessage
  | PreviewReadyMessage
  | PreviewLogMessage
  | PreviewPauseMessage
  | PreviewResumeMessage
  | PreviewStepMessage;

export type EditorMessageKind = EditorMessage['kind'];

/** Exhaustiveness helper for `switch (msg.kind)` defaults. */
export function assertNever(value: never): never {
  throw new Error(
    `unhandled protocol variant: ${JSON.stringify(value as unknown)}`,
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
