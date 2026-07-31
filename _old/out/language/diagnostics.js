"use strict";
/**
 * DiagnosticCollection — reports problems in .omoscene/.omocomp and .ts/.js files.
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
exports.registerDiagnostics = registerDiagnostics;
const vscode = __importStar(require("vscode"));
const omoscene_1 = require("../types/omoscene");
const omocomp_1 = require("../types/omocomp");
const engine_1 = require("../types/engine");
const component_crud_1 = require("../commands/component-crud");
// ── Uniqueness map (mirrors component-crud.ts) ──────────────────
const COMPONENT_UNIQUENESS = {
    'camera': engine_1.ComponentUnique.LOCAL,
    'audio-player': engine_1.ComponentUnique.GLOBAL,
    'flag-manager': engine_1.ComponentUnique.GLOBAL,
    'atlas-manager': engine_1.ComponentUnique.GLOBAL,
};
const COMPONENT_TYPE_SET = new Set(component_crud_1.ALL_COMPONENT_TYPES);
// ── Registration ────────────────────────────────────────────────
function registerDiagnostics(context, _discovery) {
    const collection = vscode.languages.createDiagnosticCollection('omosuen');
    // Debounce timer for code files
    let codeTimer;
    const updateDiagnostics = (document) => {
        const fileName = document.fileName;
        if (fileName.endsWith('.omoscene')) {
            diagOmoscene(document, collection);
        }
        else if (fileName.endsWith('.omocomp')) {
            diagOmocomp(document, collection);
        }
        else if (fileName.endsWith('.ts') || fileName.endsWith('.js')) {
            // Debounce code diagnostics
            if (codeTimer) {
                clearTimeout(codeTimer);
            }
            codeTimer = setTimeout(() => diagCode(document, collection), 500);
        }
    };
    // Run on open and change
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(updateDiagnostics), vscode.workspace.onDidChangeTextDocument((e) => updateDiagnostics(e.document)), vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)));
    // Run on all currently open documents
    for (const doc of vscode.workspace.textDocuments) {
        updateDiagnostics(doc);
    }
    return collection;
}
// ── .omoscene diagnostics ───────────────────────────────────────
function diagOmoscene(document, collection) {
    const text = document.getText();
    const parsed = (0, omoscene_1.parseOmoscene)(text);
    if (!parsed) {
        collection.delete(document.uri);
        return;
    }
    const diagnostics = [];
    checkGlobalUniqueness(parsed.scene, text, document, diagnostics);
    checkLocalUniqueness(parsed.scene, text, document, diagnostics);
    checkViewportRef(parsed.scene, text, document, diagnostics);
    collection.set(document.uri, diagnostics);
}
// ── .omocomp diagnostics ───────────────────────────────────────
function diagOmocomp(document, collection) {
    const text = document.getText();
    const parsed = (0, omocomp_1.parseOmocomp)(text);
    if (!parsed) {
        collection.delete(document.uri);
        return;
    }
    const diagnostics = [];
    // Only check uniqueness if the component is a nexus with children
    if ((0, engine_1.isSerializedNexus)(parsed.component)) {
        checkGlobalUniqueness(parsed.component, text, document, diagnostics);
        checkLocalUniqueness(parsed.component, text, document, diagnostics);
    }
    collection.set(document.uri, diagnostics);
}
// ── Code file diagnostics ───────────────────────────────────────
function diagCode(document, collection) {
    const text = document.getText();
    const diagnostics = [];
    // Check component types in newComponent() calls
    const ncRegex = /\bnewComponent\s*\(\s*(['"])([^'"]+)\1/g;
    let m;
    while ((m = ncRegex.exec(text)) !== null) {
        if (!COMPONENT_TYPE_SET.has(m[2])) {
            const pos = document.positionAt(m.index + m[0].indexOf(m[2]));
            const range = new vscode.Range(pos, pos.translate(0, m[2].length));
            diagnostics.push(new vscode.Diagnostic(range, `Unknown component type '${m[2]}'.`, vscode.DiagnosticSeverity.Error));
        }
    }
    // Check component types in nexus methods
    const methodRegex = /\.(?:getComponentByType|getComponentsByType|getComponentByTypeAndName)\s*\(\s*(['"])([^'"]+)\1/g;
    while ((m = methodRegex.exec(text)) !== null) {
        if (!COMPONENT_TYPE_SET.has(m[2])) {
            const pos = document.positionAt(m.index + m[0].indexOf(m[2]));
            const range = new vscode.Range(pos, pos.translate(0, m[2].length));
            diagnostics.push(new vscode.Diagnostic(range, `Unknown component type '${m[2]}'.`, vscode.DiagnosticSeverity.Error));
        }
    }
    collection.set(document.uri, diagnostics);
}
// ── Scene checks ────────────────────────────────────────────────
function checkGlobalUniqueness(root, text, document, diagnostics) {
    const seen = new Map();
    walkComponents(root, (component) => {
        const uniqueness = COMPONENT_UNIQUENESS[component.type];
        if (uniqueness !== engine_1.ComponentUnique.GLOBAL) {
            return;
        }
        if (seen.has(component.type)) {
            // Duplicate — report at the position of this component
            const range = findComponentRange(component, text, document);
            diagnostics.push(new vscode.Diagnostic(range, `Duplicate global component: only one '${component.type}' is allowed per scene.`, vscode.DiagnosticSeverity.Error));
        }
        else {
            seen.set(component.type, component);
        }
    });
}
function checkLocalUniqueness(root, text, document, diagnostics) {
    walkComponents(root, (component) => {
        if (!(0, engine_1.isSerializedNexus)(component)) {
            return;
        }
        const localSeen = new Map();
        for (const child of component.components) {
            const uniqueness = COMPONENT_UNIQUENESS[child.type];
            if (uniqueness !== engine_1.ComponentUnique.LOCAL) {
                continue;
            }
            if (localSeen.has(child.type)) {
                const range = findComponentRange(child, text, document);
                diagnostics.push(new vscode.Diagnostic(range, `Duplicate local component: only one '${child.type}' is allowed per nexus.`, vscode.DiagnosticSeverity.Error));
            }
            else {
                localSeen.set(child.type, true);
            }
        }
    });
}
function checkViewportRef(root, text, document, diagnostics) {
    // Collect all viewport names
    const viewportNames = new Set();
    walkComponents(root, (component) => {
        if (component.type === 'viewport' && component.name) {
            viewportNames.add(component.name);
        }
    });
    // Check camera viewportRef values
    walkComponents(root, (component) => {
        if (component.type !== 'camera') {
            return;
        }
        const ref = component.viewportRef;
        if (!ref) {
            return;
        }
        if (!viewportNames.has(ref)) {
            const range = findComponentRange(component, text, document);
            diagnostics.push(new vscode.Diagnostic(range, `viewportRef '${ref}' does not match any viewport component name in this scene.`, vscode.DiagnosticSeverity.Warning));
        }
    });
}
// ── Helpers ─────────────────────────────────────────────────────
function walkComponents(component, visitor) {
    visitor(component);
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            walkComponents(child, visitor);
        }
    }
}
function findComponentRange(component, text, document) {
    // Try to find the component by its ID in the JSON
    if (component.id !== undefined) {
        const idPattern = `"id": ${component.id}`;
        const idx = text.indexOf(idPattern);
        if (idx >= 0) {
            const pos = document.positionAt(idx);
            return new vscode.Range(pos, pos.translate(0, idPattern.length));
        }
    }
    // Fallback: search for the name
    if (component.name) {
        const namePattern = `"name": "${component.name}"`;
        const idx = text.indexOf(namePattern);
        if (idx >= 0) {
            const pos = document.positionAt(idx);
            return new vscode.Range(pos, pos.translate(0, namePattern.length));
        }
    }
    // Last resort: first line
    return new vscode.Range(0, 0, 0, 0);
}
//# sourceMappingURL=diagnostics.js.map