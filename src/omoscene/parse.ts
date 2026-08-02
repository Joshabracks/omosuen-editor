import { OMOSCENE_FORMAT_VERSION } from './types';
import type { EditorMetadata, OmosceneFile, SerializedScene } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Thrown when a `.omoscene` text cannot be parsed or fails validation. */
export class OmosceneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmosceneParseError';
  }
}

/**
 * Parse a `.omoscene` JSON text into a validated `OmosceneFile`.
 * The `scene` region is not introspected beyond checking that its root is
 * a nexus — the engine owns that region's shape.
 */
export function parse(source: string): OmosceneFile {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new OmosceneParseError(`Invalid JSON: ${reason}`);
  }
  return validateOmosceneFile(raw);
}

/**
 * Validate an already-parsed value against the `OmosceneFile` shape.
 * Shared between `parse(text)` and the protocol decoder.
 */
export function validateOmosceneFile(raw: unknown): OmosceneFile {
  if (!isRecord(raw)) {
    throw new OmosceneParseError('Root value must be an object.');
  }

  if (typeof raw.omoscene !== 'number') {
    throw new OmosceneParseError(
      `Missing or invalid \`omoscene\` field (expected number, got ${typeOf(raw.omoscene)}).`,
    );
  }
  if (raw.omoscene !== OMOSCENE_FORMAT_VERSION) {
    throw new OmosceneParseError(
      `Unsupported file format version ${raw.omoscene}. ` +
        `This editor supports version ${OMOSCENE_FORMAT_VERSION}.`,
    );
  }
  if (typeof raw.engine !== 'string') {
    throw new OmosceneParseError(
      'Missing or invalid `engine` field (expected string).',
    );
  }
  if (typeof raw.name !== 'string') {
    throw new OmosceneParseError(
      'Missing or invalid `name` field (expected string).',
    );
  }

  const editor = validateEditor(raw.editor);
  const scene = validateScene(raw.scene);

  return {
    omoscene: raw.omoscene,
    engine: raw.engine,
    name: raw.name,
    editor,
    scene,
  };
}

function validateEditor(raw: unknown): EditorMetadata {
  if (!isRecord(raw)) {
    throw new OmosceneParseError('`editor` field must be an object.');
  }

  const camera = raw.camera;
  if (
    !isRecord(camera) ||
    typeof camera.panX !== 'number' ||
    typeof camera.panY !== 'number' ||
    typeof camera.zoom !== 'number'
  ) {
    throw new OmosceneParseError(
      '`editor.camera` must be an object with numeric panX, panY, zoom.',
    );
  }

  if (
    !Array.isArray(raw.selection) ||
    !raw.selection.every((n) => typeof n === 'number')
  ) {
    throw new OmosceneParseError(
      '`editor.selection` must be an array of numbers.',
    );
  }

  if (!isRecord(raw.treeState)) {
    throw new OmosceneParseError('`editor.treeState` must be an object.');
  }
  for (const [key, value] of Object.entries(raw.treeState)) {
    if (typeof value !== 'boolean') {
      throw new OmosceneParseError(
        `\`editor.treeState[${JSON.stringify(key)}]\` must be a boolean (got ${typeOf(value)}).`,
      );
    }
  }

  if (!isRecord(raw.annotations)) {
    throw new OmosceneParseError('`editor.annotations` must be an object.');
  }
  for (const [key, value] of Object.entries(raw.annotations)) {
    if (!isRecord(value)) {
      throw new OmosceneParseError(
        `\`editor.annotations[${JSON.stringify(key)}]\` must be an object.`,
      );
    }
    if (value.color !== undefined && typeof value.color !== 'string') {
      throw new OmosceneParseError(
        `\`editor.annotations[${JSON.stringify(key)}].color\` must be a string if present (got ${typeOf(value.color)}).`,
      );
    }
    if (value.notes !== undefined && typeof value.notes !== 'string') {
      throw new OmosceneParseError(
        `\`editor.annotations[${JSON.stringify(key)}].notes\` must be a string if present (got ${typeOf(value.notes)}).`,
      );
    }
  }

  if (!isRecord(raw.bookmarks)) {
    throw new OmosceneParseError('`editor.bookmarks` must be an object.');
  }
  for (const [key, value] of Object.entries(raw.bookmarks)) {
    if (typeof value !== 'number') {
      throw new OmosceneParseError(
        `\`editor.bookmarks[${JSON.stringify(key)}]\` must be a number (got ${typeOf(value)}).`,
      );
    }
  }

  return {
    camera: {
      panX: camera.panX,
      panY: camera.panY,
      zoom: camera.zoom,
    },
    selection: raw.selection as number[],
    treeState: raw.treeState as Record<string, boolean>,
    annotations: raw.annotations as Record<
      string,
      { color?: string; notes?: string }
    >,
    bookmarks: raw.bookmarks as Record<string, number>,
  };
}

function validateScene(raw: unknown): SerializedScene {
  if (!isRecord(raw)) {
    throw new OmosceneParseError('`scene` field must be an object.');
  }
  if (raw.type !== 'nexus') {
    throw new OmosceneParseError(
      `\`scene.type\` must be "nexus" (got ${JSON.stringify(raw.type)}).`,
    );
  }
  return raw as SerializedScene;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
