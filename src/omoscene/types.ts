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
 * One node in the engine's serialized component tree.
 *
 * Only the fields common to every serialized component are typed:
 * `type` (always present), optional `id` (engine-assigned during
 * deserialize — absent on pre-deserialize scenes), and optional
 * `components` for container nodes like nexuses. Per-component fields
 * (position, opacity, etc.) are reachable via the index signature as
 * `unknown` — the extension host does not introspect them; per-field
 * typing is handled by the per-component schemas.
 *
 * The editor traverses this structure by `type`, `id`, and `components`
 * only. Anything deeper goes through the engine or the schemas.
 */
export interface SerializedComponent {
  readonly type: string;
  readonly id?: number;
  readonly components?: readonly SerializedComponent[];
  readonly [key: string]: unknown;
}

/**
 * Root of the engine's serialized scene tree — always a nexus.
 * Specialization of `SerializedComponent` constraining `type`.
 * Engine serializers produce it; engine deserializers consume it.
 */
export interface SerializedScene extends SerializedComponent {
  readonly type: 'nexus';
}

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
