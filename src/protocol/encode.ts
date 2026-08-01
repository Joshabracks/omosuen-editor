import type { EditorMessage } from './types';

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
  if (msg.kind === 'component:add' && msg.props !== undefined) {
    validateJsonValue(msg.props, 'component:add.props');
  }
  if (msg.kind === 'scene:load') {
    validateJsonValue(msg.file, 'scene:load.file');
  }
  return JSON.stringify(msg);
}

/**
 * Walk a `JsonValue` and throw on non-finite numbers / non-JSON values.
 * `NaN` / `±Infinity` pass the TS `number` type but corrupt via JSON.stringify.
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
        `non-finite number at ${path}: ${String(value)}`,
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
  throw new ProtocolEncodeError(`non-JSON value at ${path}: ${typeof value}`);
}
