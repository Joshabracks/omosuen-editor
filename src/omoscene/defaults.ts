import type { EditorCameraState, EditorMetadata } from './types';

export const DEFAULT_EDITOR_CAMERA: EditorCameraState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  axonometricAngle: 30,
  yaw: 0,
};

/** Fresh editor metadata with all fields at defaults. */
export function defaultEditorMetadata(): EditorMetadata {
  return {
    camera: { ...DEFAULT_EDITOR_CAMERA },
    selection: [],
    treeState: {},
    annotations: {},
    bookmarks: {},
  };
}
