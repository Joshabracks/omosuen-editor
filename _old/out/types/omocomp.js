"use strict";
/**
 * .omocomp file format types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOmocomp = createOmocomp;
exports.parseOmocomp = parseOmocomp;
/**
 * Creates a default .omocomp file wrapping a given component
 */
function createOmocomp(name, component, engineVersion) {
    return {
        omocomp: 1,
        engine: engineVersion ?? '0.1.0',
        name,
        component: JSON.parse(JSON.stringify(component)),
        editor: {
            annotations: {},
            tags: [],
        },
    };
}
/**
 * Parses a text string as an OmocompFile, returning null on failure
 */
function parseOmocomp(text) {
    try {
        const data = JSON.parse(text);
        if (typeof data.omocomp !== 'number' || !data.component) {
            return null;
        }
        return data;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=omocomp.js.map