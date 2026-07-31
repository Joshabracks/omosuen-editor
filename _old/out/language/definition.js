"use strict";
/**
 * DefinitionProvider — go-to-definition for scene names and texture keys.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmosuenDefinitionProvider = void 0;
const vscode = __importStar(require("vscode"));
const context_1 = require("./context");
// ── Provider ────────────────────────────────────────────────────
class OmosuenDefinitionProvider {
    constructor(discovery) {
        this.discovery = discovery;
    }
    provideDefinition(document, position, _token) {
        const ctx = (0, context_1.detectCursorContext)(document, position);
        const literal = (0, context_1.extractStringLiteralRange)(document, position);
        if (!literal) {
            return null;
        }
        if (ctx.kind === 'scene-name') {
            return this.sceneDefinition(literal.value);
        }
        if (ctx.kind === 'texture-key') {
            return this.textureKeyDefinition(literal.value);
        }
        return null;
    }
    // ── Resolvers ─────────────────────────────────────────────────
    sceneDefinition(name) {
        const entries = this.discovery.getSceneNames().filter((e) => e.name === name);
        if (entries.length === 0) {
            return null;
        }
        return entries.map((e) => new vscode.Location(e.uri, new vscode.Position(e.line, 0)));
    }
    textureKeyDefinition(key) {
        const entries = this.discovery.getTextureKeys().filter((e) => e.key === key);
        if (entries.length === 0) {
            return null;
        }
        return entries.map((e) => new vscode.Location(e.uri, new vscode.Position(e.line, 0)));
    }
}
exports.OmosuenDefinitionProvider = OmosuenDefinitionProvider;
//# sourceMappingURL=definition.js.map