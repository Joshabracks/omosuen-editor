/**
 * Parse a transport-encoded string back into a validated `EditorMessage`,
 * throwing `ProtocolDecodeError` on anything malformed.
 *
 * Validation here enforces only *protocol-layer* invariants: the
 * discriminant `kind`, required fields, coarse field types. Per-message
 * semantic checks (e.g. "does this component id exist in the current
 * scene?") are the dispatcher's responsibility.
 *
 * `scene:load`'s file payload is validated by delegating to the omoscene
 * parser — there is one source of truth for "is this a valid OmosceneFile",
 * and it lives in `src/omoscene/parse.ts`.
 */

import { parse } from '../omoscene/index.js';
import type { EditorMessage, EditorMessageKind } from './types.js';

export class ProtocolDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolDecodeError';
  }
}

const KNOWN_KINDS: ReadonlySet<EditorMessageKind> = new Set([
  'component:update',
  'component:select',
  'scene:load',
  'scene:save',
] satisfies EditorMessageKind[]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeMessage(text: string): EditorMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ProtocolDecodeError(`invalid JSON: ${detail}`);
  }

  if (!isRecord(raw)) {
    throw new ProtocolDecodeError('message must be a JSON object');
  }

  const kind = raw['kind'];
  if (typeof kind !== 'string') {
    throw new ProtocolDecodeError('message is missing string field `kind`');
  }
  if (!KNOWN_KINDS.has(kind as EditorMessageKind)) {
    throw new ProtocolDecodeError(`unknown message kind: ${kind}`);
  }

  switch (kind as EditorMessageKind) {
    case 'component:update': {
      const id = raw['id'];
      const componentType = raw['componentType'];
      const property = raw['property'];
      if (typeof id !== 'number' || !Number.isFinite(id)) {
        throw new ProtocolDecodeError(
          'component:update requires finite numeric `id`',
        );
      }
      if (typeof componentType !== 'string' || componentType === '') {
        throw new ProtocolDecodeError(
          'component:update requires non-empty string `componentType`',
        );
      }
      if (typeof property !== 'string' || property === '') {
        throw new ProtocolDecodeError(
          'component:update requires non-empty string `property`',
        );
      }
      if (!('value' in raw)) {
        throw new ProtocolDecodeError(
          'component:update requires `value` field (may be any JSON-compatible value)',
        );
      }
      return {
        kind: 'component:update',
        id,
        componentType,
        property,
        value: raw['value'],
      };
    }

    case 'component:select': {
      const id = raw['id'];
      if (id !== null && (typeof id !== 'number' || !Number.isFinite(id))) {
        throw new ProtocolDecodeError(
          'component:select requires `id` to be a finite number or null',
        );
      }
      return { kind: 'component:select', id };
    }

    case 'scene:load': {
      const file = raw['file'];
      if (!isRecord(file)) {
        throw new ProtocolDecodeError(
          'scene:load requires object `file` field',
        );
      }
      try {
        const validated = parse(JSON.stringify(file));
        return { kind: 'scene:load', file: validated };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new ProtocolDecodeError(`scene:load file invalid: ${detail}`);
      }
    }

    case 'scene:save': {
      return { kind: 'scene:save' };
    }
  }
}
