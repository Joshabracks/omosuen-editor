/**
 * .omoscene file-format types.
 *
 * The file has two top-level siblings:
 *   - `editor`: editor-only metadata (camera state, selection, tree expansion,
 *     annotations, bookmarks). Never touched by the engine.
 *   - `scene`: engine-native serialized component tree. Opaque to the editor's
 *     extension host — the engine (running in a webview) produces and consumes
 *     this region.
 */

/** Current file-format version. Bump when EditorMetadata shape changes. */
export const OMOSCENE_FORMAT_VERSION = 1;

/**
 * Opaque representation of the engine's serialized scene tree.
 * The extension host never inspects this beyond validating that the root
 * component is a nexus. Engine serializers produce it; engine deserializers
 * consume it.
 */
export type SerializedScene = {
  readonly type: 'nexus';
  readonly [key: string]: unknown;
};

/**
 * Editor-only metadata stored alongside the scene region.
 * The engine never reads or writes this.
 */
export interface EditorMetadata {
  /** 2D editor scene-view camera state (pan + zoom on the overlay canvas). */
  camera: {
    panX: number;
    panY: number;
    zoom: number;
  };
  /** IDs of components currently selected in the scene tree / inspector. */
  selection: number[];
  /** Tree-view expansion state, keyed by a stable path or ID string. */
  treeState: Record<string, boolean>;
  /** Per-component developer notes and markers. Key is the stringified ID. */
  annotations: Record<string, { color?: string; notes?: string }>;
  /** Named shortcuts to specific component IDs for fast navigation. */
  bookmarks: Record<string, number>;
}

/** On-disk shape of a `.omoscene` file. */
export interface OmosceneFile {
  /** File-format version (see OMOSCENE_FORMAT_VERSION). */
  omoscene: number;
  /** Engine version this file was last saved under (e.g. "0.1.29"). */
  engine: string;
  /** Human-readable scene name shown in tabs and tree roots. */
  name: string;
  /** Editor-owned region. */
  editor: EditorMetadata;
  /** Engine-owned region, opaque to the extension host. */
  scene: SerializedScene;
}
