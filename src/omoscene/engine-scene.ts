/**
 * Engine ↔ disk scene-region contract (E5).
 *
 * The host never hand-parses component fields. Live serialize/deserialize
 * happens in the authoring viewport once the engine is loaded (4a). Until
 * then, on-disk `scene` JSON is treated as already engine-serialized and
 * passes through opaquely.
 */

import { defaultEditorMetadata } from './defaults';
import { OMOSCENE_FORMAT_VERSION } from './types';
import type { OmosceneFile, SerializedScene } from './types';

/**
 * Codec bound to a live engine instance in the authoring webview/host.
 * Implementations call engine APIs only — no per-component field parsers.
 */
export interface EngineSceneCodec {
  /** Live engine tree → on-disk `scene` region. */
  serializeFromEngine(): SerializedScene | Promise<SerializedScene>;
  /** On-disk `scene` region → engine deserialize. */
  deserializeIntoEngine(scene: SerializedScene): void | Promise<void>;
}

/** Identity codec for tests and pre-viewport persistence round-trips. */
export const opaqueSceneCodec: EngineSceneCodec = {
  serializeFromEngine() {
    throw new Error(
      'opaqueSceneCodec cannot serialize from a live engine — wire an EngineSceneCodec in the authoring viewport (4a).',
    );
  },
  deserializeIntoEngine(_scene) {
    // No live engine yet — disk region is already the deserialize input.
  },
};

/** Empty nexus root suitable for new scenes (engine-shaped, opaque fields OK). */
export function emptySerializedScene(name = 'Root'): SerializedScene {
  return {
    type: 'nexus',
    name,
    id: 0,
    unique: 0,
    components: [],
  };
}

/** Build a valid empty `.omoscene` document. */
export function createEmptyOmosceneFile(options: {
  readonly name: string;
  readonly engine: string;
  readonly scene?: SerializedScene;
}): OmosceneFile {
  return {
    omoscene: OMOSCENE_FORMAT_VERSION,
    engine: options.engine,
    name: options.name,
    editor: defaultEditorMetadata(),
    scene: options.scene ?? emptySerializedScene(),
  };
}

/** Replace only the engine-owned scene region (editor metadata preserved). */
export function withSceneRegion(
  file: OmosceneFile,
  scene: SerializedScene,
): OmosceneFile {
  return { ...file, scene };
}

/** Replace editor metadata (e.g. after camera / treeState edits). */
export function withEditorMetadata(
  file: OmosceneFile,
  editor: OmosceneFile['editor'],
): OmosceneFile {
  return { ...file, editor };
}
