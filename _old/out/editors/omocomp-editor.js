"use strict";
/**
 * CustomTextEditorProvider for .omocomp files.
 * Manages the document model for reusable component files.
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
exports.OmocompEditorProvider = void 0;
const vscode = __importStar(require("vscode"));
const omocomp_1 = require("../types/omocomp");
const engine_1 = require("../types/engine");
const omoscene_editor_1 = require("./omoscene-editor");
class OmocompEditorProvider {
    constructor(inspector) {
        this.inspector = inspector;
        this.activeDocument = null;
        this.activeParsed = null;
    }
    getActiveOmocomp() {
        return this.activeParsed;
    }
    async resolveCustomTextEditor(document, webviewPanel, _token) {
        this.activeDocument = document;
        this.activeParsed = (0, omocomp_1.parseOmocomp)(document.getText());
        webviewPanel.webview.options = { enableScripts: true };
        this.updateWebview(webviewPanel, this.activeParsed);
        // Show component in Inspector
        if (this.activeParsed) {
            this.inspector.showComponent(this.activeParsed.component);
        }
        // Listen for document changes
        const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.activeParsed = (0, omocomp_1.parseOmocomp)(e.document.getText());
                this.updateWebview(webviewPanel, this.activeParsed);
            }
        });
        webviewPanel.onDidDispose(() => {
            changeSubscription.dispose();
            if (this.activeDocument === document) {
                this.activeDocument = null;
                this.activeParsed = null;
            }
        });
    }
    /**
     * Update a component property within the .omocomp file.
     */
    async updateComponentProperty(componentId, property, value) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        const component = (0, omoscene_editor_1.findComponentById)(updated.component, componentId);
        if (!component) {
            return;
        }
        (0, omoscene_editor_1.setNestedValue)(component, property, value);
        await this.writeDocument(updated);
    }
    /**
     * Add a child component (only valid when root is a nexus).
     */
    async addComponent(parentId, component) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        const parent = (0, omoscene_editor_1.findComponentById)(updated.component, parentId);
        if (!parent || !(0, engine_1.isSerializedNexus)(parent)) {
            return;
        }
        parent.components.push(component);
        await this.writeDocument(updated);
    }
    /**
     * Remove a component by ID.
     */
    async removeComponent(componentId) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        const parent = (0, omoscene_editor_1.findParentNexus)(updated.component, componentId);
        if (!parent) {
            return;
        }
        const idx = parent.components.findIndex((c) => c.id === componentId);
        if (idx === -1) {
            return;
        }
        parent.components.splice(idx, 1);
        await this.writeDocument(updated);
    }
    /**
     * Returns the next available component ID.
     */
    getNextId() {
        if (!this.activeParsed) {
            return 0;
        }
        return (0, omoscene_editor_1.getMaxId)(this.activeParsed.component) + 1;
    }
    async writeDocument(updated) {
        if (!this.activeDocument) {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(this.activeDocument.positionAt(0), this.activeDocument.positionAt(this.activeDocument.getText().length));
        edit.replace(this.activeDocument.uri, fullRange, JSON.stringify(updated, null, 2));
        await vscode.workspace.applyEdit(edit);
    }
    updateWebview(panel, data) {
        if (!data) {
            panel.webview.html = `<!DOCTYPE html>
<html><body style="color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; padding: 20px; background: #0d0a07;">
<h2 style="color: #d4a843;">Invalid .omocomp file</h2>
<p>This file could not be parsed as a valid Omosuen component.</p>
</body></html>`;
            return;
        }
        const isNexus = (0, engine_1.isSerializedNexus)(data.component);
        const componentCount = isNexus ? (0, omoscene_editor_1.countComponents)(data.component) : 1;
        panel.webview.html = `<!DOCTYPE html>
<html><body style="color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; padding: 20px; background: #0d0a07;">
<h2 style="color: #d4a843;">${(0, omoscene_editor_1.escapeHtml)(data.name)}</h2>
<table style="font-size: 13px; border-collapse: collapse;">
  <tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Format</td><td>omocomp v${data.omocomp}</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Engine</td><td>${(0, omoscene_editor_1.escapeHtml)(data.engine)}</td></tr>
  <tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Type</td><td>${(0, omoscene_editor_1.escapeHtml)(data.component.type)}</td></tr>
  ${isNexus ? `<tr><td style="padding: 2px 12px 2px 0; color: #7a7060;">Components</td><td>${componentCount}</td></tr>` : ''}
</table>
<p style="margin-top: 16px; color: #4a3e30; font-size: 12px;">
  Properties are shown in the Inspector panel.
</p>
</body></html>`;
    }
}
exports.OmocompEditorProvider = OmocompEditorProvider;
OmocompEditorProvider.viewType = 'omosuen.omocompEditor';
//# sourceMappingURL=omocomp-editor.js.map