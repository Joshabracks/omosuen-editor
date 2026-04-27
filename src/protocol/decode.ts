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

import { validateOmosceneFile } from '../omoscene/index.js';
import { isRecord } from '../util/guards.js';
import type { EditorMessage, EditorMessageKind, JsonValue } from './types.js';

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
  'preview:ready',
  'preview:log',
  'command:invoke',
  'image:loaded',
] satisfies EditorMessageKind[]);

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
      // `JSON.parse` cannot produce `NaN`, `Infinity`, `undefined`, or
      // other non-JSON values — the grammar forbids them — so the parsed
      // `value` is structurally `JsonValue` and the cast is sound.
      return {
        kind: 'component:update',
        id,
        componentType,
        property,
        value: raw['value'] as JsonValue,
      };
    }

    case 'component:select': {
      const ids = raw['ids'];
      if (!Array.isArray(ids)) {
        throw new ProtocolDecodeError(
          'component:select requires `ids` to be an array of finite numbers (use [] to clear)',
        );
      }
      for (const entry of ids) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
          throw new ProtocolDecodeError(
            'component:select `ids` entries must all be finite numbers',
          );
        }
      }
      return { kind: 'component:select', ids: ids as readonly number[] };
    }

    case 'scene:load': {
      try {
        const validated = validateOmosceneFile(raw['file']);
        return { kind: 'scene:load', file: validated };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new ProtocolDecodeError(`scene:load file invalid: ${detail}`);
      }
    }

    case 'scene:save': {
      return { kind: 'scene:save' };
    }

    case 'preview:ready': {
      const engineVersion = raw['engineVersion'];
      if (typeof engineVersion !== 'string') {
        throw new ProtocolDecodeError(
          'preview:ready requires string `engineVersion`',
        );
      }
      return { kind: 'preview:ready', engineVersion };
    }

    case 'preview:log': {
      const level = raw['level'];
      const message = raw['message'];
      if (level !== 'info' && level !== 'warn' && level !== 'error') {
        throw new ProtocolDecodeError(
          'preview:log `level` must be one of "info" | "warn" | "error"',
        );
      }
      if (typeof message !== 'string') {
        throw new ProtocolDecodeError('preview:log requires string `message`');
      }
      return { kind: 'preview:log', level, message };
    }

    case 'command:invoke': {
      const command = raw['command'];
      const args = raw['args'];
      if (typeof command !== 'string' || command === '') {
        throw new ProtocolDecodeError(
          'command:invoke requires non-empty string `command`',
        );
      }
      if (!Array.isArray(args)) {
        throw new ProtocolDecodeError(
          'command:invoke requires `args` to be an array (use [] for no arguments)',
        );
      }
      // JSON.parse cannot produce NaN / Infinity / undefined, so
      // `args` is structurally `JsonValue[]` and the cast is sound.
      return {
        kind: 'command:invoke',
        command,
        args: args as readonly JsonValue[],
      };
    }

    case 'image:loaded': {
      const dataUri = raw['dataUri'];
      const sourceFilePath = raw['sourceFilePath'];
      if (dataUri !== null && typeof dataUri !== 'string') {
        throw new ProtocolDecodeError(
          'image:loaded requires `dataUri` to be a string or null',
        );
      }
      if (typeof sourceFilePath !== 'string') {
        throw new ProtocolDecodeError(
          'image:loaded requires string `sourceFilePath`',
        );
      }
      return { kind: 'image:loaded', dataUri, sourceFilePath };
    }
  }
}
