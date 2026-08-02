/**
 * Public API for the `.omoscene` format module (3a).
 *
 * Pure parse/stringify only — Node disk helpers live in `./io` and must not
 * be re-exported here (renderer bundles import this barrel).
 */

export type {
  EditorMetadata,
  OmosceneFile,
  SerializedComponent,
  SerializedScene,
} from './types';
export { OMOSCENE_FORMAT_VERSION } from './types';
export { defaultEditorMetadata } from './defaults';
export { parse, validateOmosceneFile, OmosceneParseError } from './parse';
export { stringify } from './stringify';
export {
  createEmptyOmosceneFile,
  emptySerializedScene,
  opaqueSceneCodec,
  withEditorMetadata,
  withSceneRegion,
  type EngineSceneCodec,
} from './engine-scene';
