"use strict";
/**
 * WebSocket communication protocol between VS Code extension and browser preview.
 * Protocol version: omosuen-editor/v1
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTOCOL_VERSION = void 0;
exports.createMessage = createMessage;
exports.isEditorMessage = isEditorMessage;
exports.PROTOCOL_VERSION = 'omosuen-editor/v1';
/**
 * Creates a new EditorMessage with a unique ID
 */
let messageCounter = 0;
function createMessage(type, payload) {
    return {
        protocol: exports.PROTOCOL_VERSION,
        id: `msg_${Date.now()}_${messageCounter++}`,
        type,
        payload,
    };
}
/**
 * Type guard: is this a valid EditorMessage?
 */
function isEditorMessage(data) {
    if (typeof data !== 'object' || data === null) {
        return false;
    }
    const msg = data;
    return (msg.protocol === exports.PROTOCOL_VERSION &&
        typeof msg.id === 'string' &&
        typeof msg.type === 'string');
}
//# sourceMappingURL=protocol.js.map