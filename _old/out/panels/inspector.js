"use strict";
/**
 * Inspector panel — WebviewViewProvider that renders property editors
 * for the currently selected component.
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
exports.InspectorProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const engine_1 = require("../types/engine");
const component_schemas_1 = require("../schema/component-schemas");
class InspectorProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.currentComponent = null;
        this.sceneRoot = null;
        this._onPropertyChanged = null;
    }
    /**
     * Update the scene root for validation context (e.g. sprite texture map lookups)
     */
    setScene(scene) {
        this.sceneRoot = scene;
    }
    /**
     * Register a handler for when the user changes a property in the inspector
     */
    onPropertyChanged(handler) {
        this._onPropertyChanged = handler;
    }
    /**
     * Show properties for a specific component
     */
    showComponent(component) {
        this.currentComponent = component;
        if (this.webviewView) {
            const msg = {
                command: 'showComponent',
                component,
                schema: component
                    ? (0, component_schemas_1.getSchemaForType)(component.type)
                    : [],
            };
            // Compute sprite validation context
            if (component && component.type === 'sprite' && this.sceneRoot) {
                msg.spriteContext = this.computeSpriteContext(component);
            }
            // Compute camera validation context
            if (component && component.type === 'camera' && this.sceneRoot) {
                msg.cameraContext = this.computeCameraContext(component);
            }
            // Compute animation-controller validation context
            if (component && component.type === 'animation-controller' && this.sceneRoot) {
                msg.animationControllerContext = this.computeAnimationControllerContext(component);
            }
            // Compute cell-map info context
            if (component && component.type === 'cell-map') {
                msg.cellMapContext = this.computeCellMapContext(component);
            }
            // Compute texture-map file existence context (async)
            if (component && component.type === 'texture-map') {
                this.computeTextureMapContext(component).then((ctx) => {
                    msg.textureMapContext = ctx;
                    this.webviewView.webview.postMessage(msg);
                });
                return;
            }
            this.webviewView.webview.postMessage(msg);
        }
    }
    computeSpriteContext(sprite) {
        const comp = sprite;
        const tmKeys = comp.textureMapKeys || {};
        const channels = ['albedo', 'normal', 'material', 'emission'];
        // Find parent nexus containing this sprite
        let hasSiblingTransform = false;
        if (this.sceneRoot && sprite.id !== undefined) {
            const parent = this.findParentNexus(this.sceneRoot, sprite.id);
            if (parent && (0, engine_1.isSerializedNexus)(parent)) {
                hasSiblingTransform = parent.components.some((c) => c.type === 'transform');
            }
        }
        // Validate each texture map key
        const keyValidation = {};
        for (const channel of channels) {
            const key = tmKeys[channel] || '';
            if (!key) {
                keyValidation[channel] = { exists: false, frameCount: 0 };
                continue;
            }
            // Search scene for matching texture-map component
            const tm = this.sceneRoot ? this.findTextureMapByKey(this.sceneRoot, key) : null;
            if (tm) {
                keyValidation[channel] = { exists: true, frameCount: this.computeFrameCount(tm) };
            }
            else {
                keyValidation[channel] = { exists: false, frameCount: 0 };
            }
        }
        // Collect all available texture-map keys in the scene
        const availableKeys = [];
        if (this.sceneRoot) {
            this.collectTextureMapKeys(this.sceneRoot, availableKeys);
        }
        return { hasSiblingTransform, keyValidation, availableKeys };
    }
    computeCameraContext(camera) {
        let hasSiblingTransform = false;
        if (this.sceneRoot && camera.id !== undefined) {
            const parent = this.findParentNexus(this.sceneRoot, camera.id);
            if (parent && (0, engine_1.isSerializedNexus)(parent)) {
                hasSiblingTransform = parent.components.some((c) => c.type === 'transform');
            }
        }
        return { hasSiblingTransform };
    }
    computeAnimationControllerContext(ac) {
        let hasSiblingSprite = false;
        if (this.sceneRoot && ac.id !== undefined) {
            const parent = this.findParentNexus(this.sceneRoot, ac.id);
            if (parent && (0, engine_1.isSerializedNexus)(parent)) {
                hasSiblingSprite = parent.components.some((c) => c.type === 'sprite');
            }
        }
        const comp = ac;
        const anims = comp.animations ?? [];
        const availableAnimations = anims
            .map((a) => (typeof a?.name === 'string' ? a.name : ''))
            .filter((n) => n.length > 0);
        return { hasSiblingSprite, availableAnimations };
    }
    computeCellMapContext(cm) {
        const comp = cm;
        const materials = comp.materials || [];
        const mapSize = comp.mapSize;
        const dims = mapSize
            ? `${mapSize.x || 0}\u00d7${mapSize.y || 0}\u00d7${mapSize.z || 0}`
            : '0\u00d70\u00d70';
        return { materialCount: materials.length, mapDimensions: dims };
    }
    findParentNexus(root, childId) {
        if (!(0, engine_1.isSerializedNexus)(root)) {
            return null;
        }
        for (const child of root.components) {
            if (child.id === childId) {
                return root;
            }
            if ((0, engine_1.isSerializedNexus)(child)) {
                const found = this.findParentNexus(child, childId);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }
    findTextureMapByKey(component, key) {
        if (component.type === 'texture-map') {
            const tm = component;
            if (tm.textureMapKey === key) {
                return tm;
            }
        }
        if ((0, engine_1.isSerializedNexus)(component)) {
            for (const child of component.components) {
                const found = this.findTextureMapByKey(child, key);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }
    collectTextureMapKeys(component, out) {
        if (component.type === 'texture-map') {
            const key = component.textureMapKey;
            if (key && !out.includes(key)) {
                out.push(key);
            }
        }
        if ((0, engine_1.isSerializedNexus)(component)) {
            for (const child of component.components) {
                this.collectTextureMapKeys(child, out);
            }
        }
    }
    computeFrameCount(tm) {
        const imageType = tm.imageType;
        if (!imageType) {
            return 1;
        }
        if (imageType.mode === 'grid') {
            return imageType.cellCount ?? ((imageType.cols || 1) * (imageType.rows || 1));
        }
        if (imageType.mode === 'framemap' && Array.isArray(imageType.frames)) {
            return imageType.frames.length;
        }
        return 1;
    }
    async handleBrowseFile(property, acceptedTypes) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const filters = {};
        if (acceptedTypes.length > 0) {
            filters['Accepted Files'] = acceptedTypes;
        }
        filters['All Files'] = ['*'];
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters,
            defaultUri: vscode.Uri.file(workspaceRoot),
        });
        if (!result || result.length === 0) {
            return;
        }
        const selectedPath = result[0].fsPath;
        const relativePath = path.relative(workspaceRoot, selectedPath).replace(/\\/g, '/');
        // Send the selected path back to the webview
        if (this.webviewView) {
            this.webviewView.webview.postMessage({
                command: 'fileSelected',
                property,
                value: relativePath,
            });
        }
        // Also trigger property change to update the document
        if (this._onPropertyChanged && this.currentComponent?.id !== undefined) {
            this._onPropertyChanged(this.currentComponent.id, property, relativePath);
        }
    }
    async handleNewScript(property) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        if (!this.currentComponent) {
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        // Derive filename from the component name
        const compName = this.currentComponent.name || 'Untitled';
        const sanitized = compName
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join('');
        const fileName = `${sanitized}.omo.ts`;
        const scriptsDir = path.join(workspaceRoot, 'src', 'scripts');
        const filePath = path.join(scriptsDir, fileName);
        const fileUri = vscode.Uri.file(filePath);
        try {
            // Check if file already exists
            await vscode.workspace.fs.stat(fileUri);
            // File exists — just open it
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
        }
        catch {
            // File does not exist — create it with template
            const template = `import type { nexus } from "omosuen";

export async function init(n: nexus) {

}

export async function update(n: nexus, deltaTime: number) {

}
`;
            // Ensure src/scripts directory exists
            const scriptsDirUri = vscode.Uri.file(scriptsDir);
            await vscode.workspace.fs.createDirectory(scriptsDirUri);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(template, 'utf-8'));
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
        }
        // Set the script property on the component
        const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
        if (this.webviewView) {
            this.webviewView.webview.postMessage({
                command: 'fileSelected',
                property,
                value: relativePath,
            });
        }
        if (this._onPropertyChanged && this.currentComponent?.id !== undefined) {
            this._onPropertyChanged(this.currentComponent.id, property, relativePath);
        }
    }
    async computeTextureMapContext(component) {
        const comp = component;
        const filePath = comp.filePath || '';
        if (!filePath) {
            return { fileExists: true }; // empty path is not a warning
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return { fileExists: false };
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const absPath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(workspaceRoot, filePath);
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
            return { fileExists: true };
        }
        catch {
            return { fileExists: false };
        }
    }
    /**
     * Show a multi-selection summary instead of individual properties
     */
    showMultiSelection(count) {
        this.currentComponent = null;
        if (this.webviewView) {
            this.webviewView.webview.postMessage({
                command: 'showMultiSelection',
                count,
            });
        }
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage((message) => {
            if (message.command === 'propertyChanged' &&
                this._onPropertyChanged &&
                this.currentComponent?.id !== undefined) {
                this._onPropertyChanged(this.currentComponent.id, message.property, message.value);
            }
            else if (message.command === 'executeCommand' && message.vsCommand) {
                vscode.commands.executeCommand(message.vsCommand, this.currentComponent);
            }
            else if (message.command === 'browseFile') {
                this.handleBrowseFile(message.property, message.acceptedTypes || []);
            }
            else if (message.command === 'newScript') {
                this.handleNewScript(message.property);
            }
        });
        // If we already have a component queued, show it
        if (this.currentComponent) {
            this.showComponent(this.currentComponent);
        }
    }
    getHtml(webview) {
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector', 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'inspector', 'main.js'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${stylesUri}">
  <title>Inspector</title>
</head>
<body>
  <div id="inspector-root">
    <div id="empty-state">
      <p>Select a component in the Scene Tree to inspect its properties.</p>
    </div>
    <div id="component-header" style="display:none;">
      <span id="component-icon"></span>
      <span id="component-name"></span>
      <span id="component-type"></span>
    </div>
    <div id="properties-container"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
exports.InspectorProvider = InspectorProvider;
InspectorProvider.viewType = 'omosuen.inspector';
//# sourceMappingURL=inspector.js.map