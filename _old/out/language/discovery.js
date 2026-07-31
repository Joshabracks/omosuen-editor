"use strict";
/**
 * Workspace scanning — discovers scene names and texture keys
 * across .omoscene, .omocomp, and .ts/.js files.
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
exports.WorkspaceDiscovery = void 0;
const vscode = __importStar(require("vscode"));
const omoscene_1 = require("../types/omoscene");
const omocomp_1 = require("../types/omocomp");
const engine_1 = require("../types/engine");
// ── Discovery ───────────────────────────────────────────────────
class WorkspaceDiscovery {
    constructor() {
        this.sceneNames = new Map();
        this.textureKeys = new Map();
        this.watchers = [];
        // Watch for file changes
        const omosceneWatcher = vscode.workspace.createFileSystemWatcher('**/*.omoscene');
        omosceneWatcher.onDidChange((uri) => this.scanOmosceneFile(uri));
        omosceneWatcher.onDidCreate((uri) => this.scanOmosceneFile(uri));
        omosceneWatcher.onDidDelete((uri) => this.removeEntriesForUri(uri));
        this.watchers.push(omosceneWatcher);
        const omocompWatcher = vscode.workspace.createFileSystemWatcher('**/*.omocomp');
        omocompWatcher.onDidChange((uri) => this.scanOmocompFile(uri));
        omocompWatcher.onDidCreate((uri) => this.scanOmocompFile(uri));
        omocompWatcher.onDidDelete((uri) => this.removeEntriesForUri(uri));
        this.watchers.push(omocompWatcher);
        const codeWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js}');
        codeWatcher.onDidChange((uri) => this.scanCodeFile(uri));
        codeWatcher.onDidCreate((uri) => this.scanCodeFile(uri));
        codeWatcher.onDidDelete((uri) => this.removeEntriesForUri(uri));
        this.watchers.push(codeWatcher);
    }
    // ── Public API ──────────────────────────────────────────────
    async scanAllFiles() {
        const exclude = '**/node_modules/**';
        const omosceneFiles = await vscode.workspace.findFiles('**/*.omoscene', exclude);
        const omocompFiles = await vscode.workspace.findFiles('**/*.omocomp', exclude);
        const codeFiles = await vscode.workspace.findFiles('**/*.{ts,js}', exclude);
        await Promise.all([
            ...omosceneFiles.map((uri) => this.scanOmosceneFile(uri)),
            ...omocompFiles.map((uri) => this.scanOmocompFile(uri)),
            ...codeFiles.map((uri) => this.scanCodeFile(uri)),
        ]);
    }
    getSceneNames() {
        const result = [];
        for (const entries of this.sceneNames.values()) {
            result.push(...entries);
        }
        return result;
    }
    getTextureKeys() {
        const result = [];
        for (const entries of this.textureKeys.values()) {
            result.push(...entries);
        }
        return result;
    }
    dispose() {
        for (const w of this.watchers) {
            w.dispose();
        }
    }
    // ── Scanners ────────────────────────────────────────────────
    async scanOmosceneFile(uri) {
        const key = uri.toString();
        this.removeByKey(key);
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf-8');
            const parsed = (0, omoscene_1.parseOmoscene)(text);
            if (!parsed) {
                return;
            }
            // Scene name
            this.addSceneName({
                name: parsed.name,
                uri,
                line: 0,
                source: 'omoscene',
            });
            // Texture keys from component tree
            this.walkComponentsForTextureKeys(parsed.scene, uri, text, 'omoscene');
        }
        catch {
            // File read error — skip
        }
    }
    async scanOmocompFile(uri) {
        const key = uri.toString();
        this.removeByKey(key);
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf-8');
            const parsed = (0, omocomp_1.parseOmocomp)(text);
            if (!parsed) {
                return;
            }
            this.walkComponentsForTextureKeys(parsed.component, uri, text, 'omocomp');
        }
        catch {
            // File read error — skip
        }
    }
    async scanCodeFile(uri) {
        const key = uri.toString();
        this.removeByKey(key);
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf-8');
            const lines = text.split('\n');
            const sceneRegex = /\b(?:registerScene|registerSceneModule|registerSceneSerialized)\s*\(\s*['"]([^'"]+)['"]/g;
            const texKeyRegex = /\btextureMapKey\s*:\s*['"]([^'"]+)['"]/g;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let m;
                sceneRegex.lastIndex = 0;
                while ((m = sceneRegex.exec(line)) !== null) {
                    this.addSceneName({ name: m[1], uri, line: i, source: 'code' });
                }
                texKeyRegex.lastIndex = 0;
                while ((m = texKeyRegex.exec(line)) !== null) {
                    this.addTextureKey({ key: m[1], uri, line: i, source: 'code' });
                }
            }
        }
        catch {
            // File read error — skip
        }
    }
    // ── Helpers ─────────────────────────────────────────────────
    walkComponentsForTextureKeys(component, uri, text, source) {
        if (component.type === 'texture-map') {
            const key = component.textureMapKey;
            if (key) {
                // Approximate line by searching for the key in the text
                const idx = text.indexOf(`"textureMapKey"`);
                const line = idx >= 0 ? text.slice(0, idx).split('\n').length - 1 : 0;
                this.addTextureKey({ key, uri, line, source });
            }
        }
        if ((0, engine_1.isSerializedNexus)(component)) {
            for (const child of component.components) {
                this.walkComponentsForTextureKeys(child, uri, text, source);
            }
        }
    }
    addSceneName(entry) {
        const key = entry.uri.toString();
        const list = this.sceneNames.get(key) ?? [];
        list.push(entry);
        this.sceneNames.set(key, list);
    }
    addTextureKey(entry) {
        const key = entry.uri.toString();
        const list = this.textureKeys.get(key) ?? [];
        list.push(entry);
        this.textureKeys.set(key, list);
    }
    removeByKey(key) {
        this.sceneNames.delete(key);
        this.textureKeys.delete(key);
    }
    removeEntriesForUri(uri) {
        this.removeByKey(uri.toString());
    }
}
exports.WorkspaceDiscovery = WorkspaceDiscovery;
//# sourceMappingURL=discovery.js.map