/**
 * .omoscene file-format types.
 *
 * Two top-level siblings:
 *   - `editor`: editor-only metadata (camera, selection, treeState, …).
 *   - `scene`: engine-native serialized component tree (opaque to host
 *     parsers beyond `type: "nexus"` root).
 */

/** Current file-format version. Bump when EditorMetadata shape changes. */
export const OMOSCENE_FORMAT_VERSION = 1;

/**
 * One node in the engine's serialized component tree.
 * Host code walks `type` / `id` / `components` only; deeper fields stay unknown.
 */
export interface SerializedComponent {
  readonly type: string;
  readonly id?: number;
  readonly components?: readonly SerializedComponent[];
  readonly [key: string]: unknown;
}

/** Root of the engine scene region — always a nexus. */
export interface SerializedScene extends SerializedComponent {
  readonly type: 'nexus';
}

/** Authoring viewport camera — independent of in-scene camera components. */
export interface EditorCameraState {
  panX: number;
  panY: number;
  zoom: number;
  /** Elevation angle in degrees (0..90). */
  axonometricAngle: number;
  /** Yaw around world Y in degrees. */
  yaw: number;
}

/** Editor-only metadata stored alongside the scene region. */
export interface EditorMetadata {
  camera: EditorCameraState;
  selection: number[];
  treeState: Record<string, boolean>;
  annotations: Record<string, { color?: string; notes?: string }>;
  bookmarks: Record<string, number>;
}

/** On-disk shape of a `.omoscene` file. */
export interface OmosceneFile {
  omoscene: number;
  engine: string;
  name: string;
  editor: EditorMetadata;
  scene: SerializedScene;
}
