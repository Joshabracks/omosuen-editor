"use strict";
/**
 * .omoscene file format types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultOmoscene = createDefaultOmoscene;
exports.parseOmoscene = parseOmoscene;
/**
 * Creates a default empty .omoscene file
 */
function createDefaultOmoscene(name) {
    return {
        omoscene: 1,
        engine: '0.1.0',
        name,
        scene: {
            type: 'nexus',
            name: `${name}Root`,
            id: 0,
            unique: 0,
            components: [],
        },
        editor: {
            camera: { panX: 0, panY: 0, zoom: 1.0 },
            selection: [],
            treeState: {},
            annotations: {},
            bookmarks: [],
        },
    };
}
/**
 * Parses a text string as an OmosceneFile, returning null on failure
 */
function parseOmoscene(text) {
    try {
        const data = JSON.parse(text);
        if (typeof data.omoscene !== 'number' || !data.scene) {
            return null;
        }
        return data;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=omoscene.js.map