"use strict";
/**
 * "Omosuen: Export Runtime Scene" command.
 * Extracts the `scene` field from a .omoscene file and saves it as standalone JSON.
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
exports.registerExportCommand = registerExportCommand;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const omoscene_1 = require("../types/omoscene");
/**
 * Find the active .omoscene file URI — checks active editor, visible tabs, or prompts user.
 */
async function resolveOmosceneUri() {
    // Check active editor
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.fileName.endsWith('.omoscene')) {
        return activeEditor.document.uri;
    }
    // Check visible custom editors
    for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
            if (tab.input &&
                typeof tab.input === 'object' &&
                'uri' in tab.input) {
                const uri = tab.input.uri;
                if (uri.fsPath.endsWith('.omoscene')) {
                    return uri;
                }
            }
        }
    }
    // Search workspace
    const files = await vscode.workspace.findFiles('**/*.omoscene');
    if (files.length === 0) {
        vscode.window.showErrorMessage('No .omoscene files found in the workspace.');
        return undefined;
    }
    if (files.length === 1) {
        return files[0];
    }
    const picked = await vscode.window.showQuickPick(files.map((f) => ({
        label: vscode.workspace.asRelativePath(f, false),
        uri: f,
    })), {
        placeHolder: 'Select a scene to export',
        title: 'Choose Scene',
    });
    return picked?.uri;
}
function registerExportCommand(context) {
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.exportRuntimeScene', async () => {
        const sourceUri = await resolveOmosceneUri();
        if (!sourceUri) {
            return;
        }
        // Read and parse the .omoscene file
        const content = await vscode.workspace.fs.readFile(sourceUri);
        const text = Buffer.from(content).toString('utf-8');
        const parsed = (0, omoscene_1.parseOmoscene)(text);
        if (!parsed) {
            vscode.window.showErrorMessage('Failed to parse .omoscene file.');
            return;
        }
        // Prompt for save location
        const defaultName = parsed.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(sourceUri.fsPath), `${defaultName}.json`)),
            filters: { 'JSON Files': ['json'] },
            title: 'Export Runtime Scene',
        });
        if (!saveUri) {
            return;
        }
        // Write the scene field only (no editor metadata)
        const runtimeJson = JSON.stringify(parsed.scene, null, 2);
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(runtimeJson, 'utf-8'));
        vscode.window.showInformationMessage(`Runtime scene exported to ${path.basename(saveUri.fsPath)}`);
    }));
}
//# sourceMappingURL=scene-export.js.map