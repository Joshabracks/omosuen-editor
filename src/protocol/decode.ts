import {
  OmosceneParseError,
  validateOmosceneFile,
} from '../omoscene';
import {
  assertNever,
  isRecord,
  type EditorMessage,
  type EditorMessageKind,
  type JsonValue,
} from './types';

export class ProtocolDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolDecodeError';
  }
}

const KNOWN_KINDS: ReadonlySet<EditorMessageKind> = new Set([
  'component:update',
  'component:select',
  'component:add',
  'component:remove',
  'component:move',
  'scene:load',
  'scene:save',
  'preview:ready',
  'preview:log',
  'preview:pause',
  'preview:resume',
  'preview:step',
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

  const kind = raw.kind;
  if (typeof kind !== 'string') {
    throw new ProtocolDecodeError('message is missing string field `kind`');
  }
  if (!KNOWN_KINDS.has(kind as EditorMessageKind)) {
    throw new ProtocolDecodeError(`unknown message kind: ${kind}`);
  }

  switch (kind as EditorMessageKind) {
    case 'component:update':
      return decodeComponentUpdate(raw);
    case 'component:select':
      return decodeComponentSelect(raw);
    case 'component:add':
      return decodeComponentAdd(raw);
    case 'component:remove':
      return decodeComponentRemove(raw);
    case 'component:move':
      return decodeComponentMove(raw);
    case 'scene:load':
      return decodeSceneLoad(raw);
    case 'scene:save':
      return { kind: 'scene:save' };
    case 'preview:ready':
      return decodePreviewReady(raw);
    case 'preview:log':
      return decodePreviewLog(raw);
    case 'preview:pause':
      return { kind: 'preview:pause' };
    case 'preview:resume':
      return { kind: 'preview:resume' };
    case 'preview:step':
      return { kind: 'preview:step' };
    default:
      return assertNever(kind as never);
  }
}

function decodeComponentUpdate(raw: Record<string, unknown>): EditorMessage {
  const id = raw.id;
  const componentType = raw.componentType;
  const property = raw.property;
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
    throw new ProtocolDecodeError('component:update requires `value` field');
  }
  return {
    kind: 'component:update',
    id,
    componentType,
    property,
    value: raw.value as JsonValue,
  };
}

function decodeComponentSelect(raw: Record<string, unknown>): EditorMessage {
  const ids = raw.ids;
  if (!Array.isArray(ids)) {
    throw new ProtocolDecodeError(
      'component:select requires `ids` to be an array of finite numbers',
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

function decodeComponentAdd(raw: Record<string, unknown>): EditorMessage {
  const parentId = raw.parentId;
  const componentType = raw.componentType;
  if (typeof parentId !== 'number' || !Number.isFinite(parentId)) {
    throw new ProtocolDecodeError(
      'component:add requires finite numeric `parentId`',
    );
  }
  if (typeof componentType !== 'string' || componentType === '') {
    throw new ProtocolDecodeError(
      'component:add requires non-empty string `componentType`',
    );
  }
  let name: string | undefined;
  if ('name' in raw) {
    if (typeof raw.name !== 'string') {
      throw new ProtocolDecodeError(
        'component:add optional `name` must be a string',
      );
    }
    name = raw.name;
  }
  const props = 'props' in raw ? (raw.props as JsonValue) : undefined;
  return {
    kind: 'component:add',
    parentId,
    componentType,
    ...(name !== undefined ? { name } : {}),
    ...(props !== undefined ? { props } : {}),
  };
}

function decodeComponentRemove(raw: Record<string, unknown>): EditorMessage {
  const id = raw.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    throw new ProtocolDecodeError(
      'component:remove requires finite numeric `id`',
    );
  }
  return { kind: 'component:remove', id };
}

function decodeComponentMove(raw: Record<string, unknown>): EditorMessage {
  const id = raw.id;
  const parentId = raw.parentId;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    throw new ProtocolDecodeError(
      'component:move requires finite numeric `id`',
    );
  }
  if (typeof parentId !== 'number' || !Number.isFinite(parentId)) {
    throw new ProtocolDecodeError(
      'component:move requires finite numeric `parentId`',
    );
  }
  if (!('index' in raw) || raw.index === undefined) {
    return { kind: 'component:move', id, parentId };
  }
  if (typeof raw.index !== 'number' || !Number.isFinite(raw.index)) {
    throw new ProtocolDecodeError(
      'component:move optional `index` must be a finite number',
    );
  }
  return { kind: 'component:move', id, parentId, index: raw.index };
}

function decodeSceneLoad(raw: Record<string, unknown>): EditorMessage {
  if (!('file' in raw)) {
    throw new ProtocolDecodeError('scene:load requires `file` field');
  }
  if (raw.file === undefined) {
    throw new ProtocolDecodeError('scene:load `file` must not be undefined');
  }
  try {
    return { kind: 'scene:load', file: validateOmosceneFile(raw.file) };
  } catch (err) {
    if (err instanceof OmosceneParseError) {
      throw new ProtocolDecodeError(
        `scene:load \`file\` is not a valid .omoscene: ${err.message}`,
      );
    }
    throw err;
  }
}

function decodePreviewReady(raw: Record<string, unknown>): EditorMessage {
  const engineVersion = raw.engineVersion;
  if (typeof engineVersion !== 'string') {
    throw new ProtocolDecodeError(
      'preview:ready requires string `engineVersion`',
    );
  }
  return { kind: 'preview:ready', engineVersion };
}

function decodePreviewLog(raw: Record<string, unknown>): EditorMessage {
  const level = raw.level;
  const message = raw.message;
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
