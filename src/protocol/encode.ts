/**
 * Serialize an `EditorMessage` to a JSON string suitable for any transport
 * (WebSocket, `postMessage`, clipboard). The inverse lives in `./decode.js`.
 *
 * `component:update` carries a `JsonValue` (the property being written).
 * TypeScript's type system prevents most JSON-incompatible values at call
 * sites, but `NaN`, `Infinity`, and `-Infinity` pass as plain `number` —
 * and `JSON.stringify` silently converts them to `null`, which would be a
 * silent data corruption. The encoder walks `value` at runtime and throws
 * `ProtocolEncodeError` on any non-finite number it finds (Phase 3.5.12).
 */

import type { EditorMessage } from './types.js';

export class ProtocolEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolEncodeError';
  }
}

export function encodeMessage(msg: EditorMessage): string {
  if (msg.kind === 'component:update') {
    validateJsonValue(msg.value, 'component:update.value');
  }
  return JSON.stringify(msg);
}

/**
 * Walk a `JsonValue` and throw `ProtocolEncodeError` on non-finite numbers.
 * The shape of `JsonValue` makes everything else JSON-safe by construction;
 * this only needs to catch the NaN / Infinity escape through `number`.
 */
function validateJsonValue(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ProtocolEncodeError(
        `non-finite number at ${path}: ${String(value)} (JsonValue rejects NaN and ±Infinity — JSON would serialize them to null)`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      validateJsonValue(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      validateJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  // `undefined`, `symbol`, `function` — caught at runtime even if TS was
  // bypassed. `JSON.stringify` would drop them silently; we don't.
  throw new ProtocolEncodeError(`non-JSON value at ${path}: ${typeof value}`);
}
