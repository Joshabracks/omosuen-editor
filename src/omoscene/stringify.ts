import type { OmosceneFile } from './types';

/**
 * Serialize an `OmosceneFile` to canonical JSON text.
 *
 * Canonicalization:
 *   - Top-level fields in fixed order (omoscene, engine, name, editor, scene).
 *     Nested objects keep arrival order — the scene region is engine-owned.
 *   - 2-space indentation, LF newline at end of file.
 */
export function stringify(file: OmosceneFile): string {
  const canonical = {
    omoscene: file.omoscene,
    engine: file.engine,
    name: file.name,
    editor: file.editor,
    scene: file.scene,
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
