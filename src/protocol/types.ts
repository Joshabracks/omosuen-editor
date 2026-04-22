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
 * A value that can be round-tripped through JSON without loss.
 *
 * Excludes `undefined`, `Map`, `Set`, `Date`, cyclic refs, functions, and
 * symbols — all of which `JSON.stringify` silently drops or mangles. Note
 * that `NaN`, `Infinity`, and `-Infinity` pass as `number` but serialize
 * to `null`; the encoder's runtime check catches those specifically.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Inspector-driven property edit for one component.
 *
 * Dispatched when the user commits a field change. `value` is `JsonValue`
 * — property shapes are per-component (a transform's `position` is a
 * Vector3D; a sprite's `opacity` is a number), but all of them serialize
 * cleanly through JSON. Non-JSON values (`undefined`, `Map`, cyclic refs)
 * are rejected at compile time; non-finite numbers (`NaN` / `Infinity`)
 * sneak past the type system as plain `number`, so the encoder walks
 * the value at runtime to reject them (Phase 3.5.12).
 */
export interface ComponentUpdateMessage {
  readonly kind: 'component:update';
  readonly id: number;
  readonly componentType: string;
  readonly property: string;
  readonly value: JsonValue;
}

/**
 * Selection change. The selection is a list of component ids — matches
 * `EditorMetadata.selection`'s on-disk shape. Empty array clears the
 * selection (nothing focused). Single-select is just `[id]`.
 */
export interface ComponentSelectMessage {
  readonly kind: 'component:select';
  readonly ids: readonly number[];
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
 * when it sees this. Carries no payload.
 *
 * **Scope**: each webview owns exactly one document via its own
 * `createEditorState()` instance (Phase 3.5.1 Option A). The extension
 * host correlates `scene:save` to a target file by the *webview the
 * message came from* — resolved at the postMessage-bridge layer — not by
 * a field on the message. Adding a `path` field here would be redundant
 * and invite drift between the message's stated target and the webview's
 * actual held state.
 */
export interface SceneSaveMessage {
  readonly kind: 'scene:save';
}

/**
 * The full editor protocol. Adding a new variant here requires:
 *   1. A new interface (payload shape).
 *   2. A factory in `./factories.ts`.
 *   3. A decoder case in `./decode.ts` with field validation.
 *   4. A dispatch case in `src/state/editor-state.ts` (the exhaustive
 *      `switch(msg.kind)` produces a compile error until handled).
 *   5. A round-trip test in `src/test/protocol.test.ts` (requirement 5.3).
 *
 * Future mutation verbs — `component:add`, `component:remove`,
 * `component:move`, possibly `nexus:rename`, plus editor-metadata verbs —
 * are catalogued in `.design/03-scope.md` → "Future protocol expansion".
 */
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
