"use strict";
/**
 * Engine type contract — mirrors omosuen 0.1.0 public API surface.
 * These types must stay in sync with the engine's actual types.
 * Source: https://github.com/Joshabracks/omosuen/tree/0.1.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComponentUnique = void 0;
exports.isSerializedNexus = isSerializedNexus;
var ComponentUnique;
(function (ComponentUnique) {
    ComponentUnique[ComponentUnique["FALSE"] = 0] = "FALSE";
    ComponentUnique[ComponentUnique["LOCAL"] = 1] = "LOCAL";
    ComponentUnique[ComponentUnique["GLOBAL"] = 2] = "GLOBAL";
    ComponentUnique[ComponentUnique["NAME"] = 3] = "NAME";
})(ComponentUnique || (exports.ComponentUnique = ComponentUnique = {}));
/**
 * Type guard: is this component a nexus with children?
 */
function isSerializedNexus(component) {
    return (component.type === 'nexus' &&
        Array.isArray(component.components));
}
//# sourceMappingURL=engine.js.map