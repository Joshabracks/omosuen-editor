import type { EditorMetadata } from './types.js';

/**
 * Build a fresh `EditorMetadata` with all fields in their default state.
 * Used when creating new `.omoscene` files or repairing files missing fields.
 */
export function defaultEditorMetadata(): EditorMetadata {
  return {
    camera: { panX: 0, panY: 0, zoom: 1 },
    selection: [],
    treeState: {},
    annotations: {},
    bookmarks: {},
  };
}
