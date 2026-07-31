import type { OmosceneFile } from './types.js';

/**
 * Serialize an `OmosceneFile` to canonical JSON text.
 *
 * Canonicalization:
 *   - Top-level fields in a fixed order (omoscene, engine, name, editor, scene).
 *     Nested objects preserve whatever property order they arrive with —
 *     the scene region is engine-owned and its order must not be disturbed.
 *   - 2-space indentation, LF newline at end of file.
 *
 * For a given input object, output is deterministic: same input always yields
 * the same text.
 */
export function stringify(file: OmosceneFile): string {
  const canonical = {
    omoscene: file.omoscene,
    engine: file.engine,
    name: file.name,
    editor: file.editor,
    scene: file.scene,
  };
  return JSON.stringify(canonical, null, 2) + '\n';
}
