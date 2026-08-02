import type { EditorMetadata } from './types';

/** Fresh editor metadata with all fields at defaults. */
export function defaultEditorMetadata(): EditorMetadata {
  return {
    camera: { panX: 0, panY: 0, zoom: 1 },
    selection: [],
    treeState: {},
    annotations: {},
    bookmarks: {},
  };
}
