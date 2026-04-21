/**
 * Editor message protocol — the single typed contract across the
 * extension-host ↔ webview boundary.
 *
 * `EditorMessage` is a discriminated union keyed on `kind`. Every branch has
 * a fixed payload shape. Switching over `kind` with an `assertNever` default
 * produces a compile error when a new branch is added but not handled
 * somewhere, which is how requirement 3.4 ("receivers can't silently drop a
 * case") is enforced at the type layer.
 *
 * A requirement 4.3 consequence: this module is the single home for
 * protocol types. Both sides of the boundary import from here; neither
 * declares its own copy.
 */

import type { OmosceneFile } from '../omoscene/index.js';

/**
 * Inspector-driven property edit for one component.
 *
 * Dispatched when the user commits a field change. `value` is unknown at
 * the protocol layer because property shapes are per-component (a
 * transform's `position` is a Vector3D; a sprite's `opacity` is a number).
 * The state store's scene-mutation helper walks the scene tree by `id`,
 * finds the component of the given `componentType`, and assigns `value`
 * to `property`.
 */
export interface ComponentUpdateMessage {
  readonly kind: 'component:update';
  readonly id: number;
  readonly componentType: string;
  readonly property: string;
  readonly value: unknown;
}

/**
 * Selection change. `id === null` clears the selection (nothing focused).
 */
export interface ComponentSelectMessage {
  readonly kind: 'component:select';
  readonly id: number | null;
}

/**
 * Load a parsed `.omoscene` file into the store. Sent by the extension
 * host after reading from disk. Replaces any currently-held document.
 */
export interface SceneLoadMessage {
  readonly kind: 'scene:load';
  readonly file: OmosceneFile;
}

/**
 * Request persistence of the current document. The extension host
 * subscribes to the raw message bus and writes the current scene to disk
 * when it sees this. Carries no payload — readers pull state from the
 * store.
 */
export interface SceneSaveMessage {
  readonly kind: 'scene:save';
}

export type EditorMessage =
  | ComponentUpdateMessage
  | ComponentSelectMessage
  | SceneLoadMessage
  | SceneSaveMessage;

export type EditorMessageKind = EditorMessage['kind'];

/**
 * Exhaustiveness helper. Placing `assertNever(msg)` in a `switch(msg.kind)`
 * default branch makes the compiler surface unhandled variants as errors.
 */
export function assertNever(value: never): never {
  throw new Error(
    `unhandled protocol variant: ${JSON.stringify(value as unknown)}`,
  );
}
