/**
 * Public API for the `.omoscene` format module.
 *
 * Note: the VS Code `workspace.fs` adapter lives in `./fs.js` and is NOT
 * re-exported here. The extension host imports it explicitly; pure consumers
 * (tests, logic code that doesn't touch the filesystem) use only the
 * exports below and avoid pulling the `vscode` module into Node.
 */
export type { EditorMetadata, OmosceneFile, SerializedScene } from './types.js';
export { OMOSCENE_FORMAT_VERSION } from './types.js';
export { defaultEditorMetadata } from './defaults.js';
export { parse, OmosceneParseError } from './parse.js';
export { stringify } from './stringify.js';
