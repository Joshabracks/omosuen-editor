"use strict";
/**
 * CustomTextEditorProvider for .omoscene files.
 * Manages the document model and wires up the scene tree,
 * inspector, and preview sync.
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
exports.OmosceneEditorProvider = void 0;
exports.findComponentById = findComponentById;
exports.setNestedValue = setNestedValue;
exports.findParentNexus = findParentNexus;
exports.getMaxId = getMaxId;
exports.countComponents = countComponents;
exports.escapeHtml = escapeHtml;
exports.extractEntities = extractEntities;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const omoscene_1 = require("../types/omoscene");
const engine_1 = require("../types/engine");
const preview_1 = require("../commands/preview");
const create_project_1 = require("../commands/create-project");
// ── Engine Bundle Resolution ────────────────────────────────────
function getProjectRoot() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }
    return workspaceFolders[0].uri.fsPath;
}
function resolveEnginePath() {
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
        return null;
    }
    const bundlePath = path.join(projectRoot, '.omosuen_editor', 'omosuen.min.js');
    if (fs.existsSync(bundlePath)) {
        return bundlePath;
    }
    return null;
}
function resolveFilePath(filePath) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    const projectRoot = getProjectRoot();
    if (!projectRoot) {
        return null;
    }
    return path.join(projectRoot, filePath);
}
function loadImageAsDataUri(filePath) {
    const absPath = resolveFilePath(filePath);
    if (!absPath || !fs.existsSync(absPath)) {
        return null;
    }
    const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    };
    const ext = path.extname(absPath).toLowerCase();
    const mime = mimeMap[ext] || 'image/png';
    return `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}
class OmosceneEditorProvider {
    constructor(sceneTree, inspector) {
        this.sceneTree = sceneTree;
        this.inspector = inspector;
        this.activeDocument = null;
        this.activeParsed = null;
        this.activePanel = null;
        this._inAudioEditor = false;
    }
    /**
     * Get the currently parsed scene data
     */
    getActiveScene() {
        return this.activeParsed;
    }
    async resolveCustomTextEditor(document, webviewPanel, _token) {
        this.activeDocument = document;
        this.activePanel = webviewPanel;
        // Parse the document
        this.activeParsed = (0, omoscene_1.parseOmoscene)(document.getText());
        // Update scene tree and inspector context
        if (this.activeParsed) {
            this.sceneTree.setScene(this.activeParsed.scene);
            this.inspector.setScene(this.activeParsed.scene);
        }
        // Resolve engine bundle path — download on demand if missing
        let enginePath = resolveEnginePath();
        if (!enginePath && this.activeParsed) {
            const projectRoot = getProjectRoot();
            if (projectRoot && this.activeParsed.engine) {
                const editorDir = path.join(projectRoot, '.omosuen_editor');
                fs.mkdirSync(editorDir, { recursive: true });
                const destPath = path.join(editorDir, 'omosuen.min.js');
                const bundleUrl = `https://github.com/Joshabracks/omosuen/releases/download/${this.activeParsed.engine}/omosuen.min.js`;
                try {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading engine bundle...' }, () => (0, create_project_1.httpsDownloadFile)(bundleUrl, destPath));
                    enginePath = destPath;
                }
                catch {
                    // Engine not available — fall back to gizmo-only mode
                }
            }
        }
        // Set up webview with engine support
        const engineDir = enginePath ? path.dirname(enginePath) : null;
        const projectRoot = getProjectRoot();
        const localResourceRoots = [];
        if (engineDir) {
            localResourceRoots.push(vscode.Uri.file(engineDir));
        }
        if (projectRoot) {
            localResourceRoots.push(vscode.Uri.file(projectRoot));
        }
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: localResourceRoots.length > 0 ? localResourceRoots : undefined,
        };
        const engineUri = enginePath
            ? webviewPanel.webview.asWebviewUri(vscode.Uri.file(enginePath)).toString()
            : null;
        webviewPanel.webview.html = getEditorWebviewHtml(webviewPanel.webview, engineUri);
        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'ready') {
                this.postSceneData(webviewPanel, this.activeParsed);
            }
            else if (msg.type === 'mapChanged' && msg.cellMapId !== undefined && msg.packedData) {
                this.updateComponentProperty(msg.cellMapId, 'packedData', msg.packedData);
            }
            else if (msg.type === 'transformChanged' && msg.transformId !== undefined && msg.position) {
                this.updateComponentProperty(msg.transformId, 'position', msg.position);
            }
            else if (msg.type === 'cameraPropertyChanged' && msg.cameraId !== undefined && msg.property) {
                this.updateComponentProperty(msg.cameraId, msg.property, msg.value);
            }
            else if (msg.type === 'audioEffectChanged' && msg.effectId !== undefined && msg.property) {
                this.updateComponentProperty(msg.effectId, msg.property, msg.value);
                // Also update the inspector if it's showing this component
                if (this.activeParsed) {
                    const comp = findComponentById(this.activeParsed.scene, msg.effectId);
                    if (comp) {
                        this.inspector.showComponent(comp);
                    }
                }
            }
        });
        // Listen for document changes — post updated data without resetting HTML
        const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                this.activeParsed = (0, omoscene_1.parseOmoscene)(e.document.getText());
                if (this.activeParsed) {
                    this.sceneTree.setScene(this.activeParsed.scene);
                    this.inspector.setScene(this.activeParsed.scene);
                }
                this.postSceneData(webviewPanel, this.activeParsed);
            }
        });
        webviewPanel.onDidDispose(() => {
            changeSubscription.dispose();
            if (this.activeDocument === document) {
                this.activeDocument = null;
                this.activeParsed = null;
                this.activePanel = null;
                this.sceneTree.setScene(null);
                this.inspector.setScene(null);
                this.inspector.showComponent(null);
            }
        });
    }
    /**
     * Add a component as a child of the given parent nexus.
     */
    async addComponent(parentId, component) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        const parent = findComponentById(updated.scene, parentId);
        if (!parent || !(0, engine_1.isSerializedNexus)(parent)) {
            return;
        }
        parent.components.push(component);
        await this.writeDocument(updated);
        const server = (0, preview_1.getDevServer)();
        if (server?.isRunning) {
            server.broadcast('component:add', { parentId, component });
        }
    }
    /**
     * Remove a component by ID from the scene.
     */
    async removeComponent(componentId) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        const parent = findParentNexus(updated.scene, componentId);
        if (!parent) {
            return;
        }
        const idx = parent.components.findIndex((c) => c.id === componentId);
        if (idx === -1) {
            return;
        }
        parent.components.splice(idx, 1);
        await this.writeDocument(updated);
        const server = (0, preview_1.getDevServer)();
        if (server?.isRunning) {
            server.broadcast('component:remove', { componentId });
        }
    }
    /**
     * Returns the next available component ID (max existing + 1).
     */
    getNextId() {
        if (!this.activeParsed) {
            return 0;
        }
        return getMaxId(this.activeParsed.scene) + 1;
    }
    /**
     * Move a component to a new parent at a specific index.
     */
    async moveComponent(componentId, newParentId, index) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        // Find and remove from old parent
        const oldParent = findParentNexus(updated.scene, componentId);
        if (!oldParent) {
            return;
        }
        const oldIdx = oldParent.components.findIndex((c) => c.id === componentId);
        if (oldIdx === -1) {
            return;
        }
        const [component] = oldParent.components.splice(oldIdx, 1);
        // Find new parent
        const newParent = findComponentById(updated.scene, newParentId);
        if (!newParent || !(0, engine_1.isSerializedNexus)(newParent)) {
            return;
        }
        // Adjust index when moving within the same parent
        let insertIdx = index;
        if (oldParent.id === newParent.id && oldIdx < index) {
            insertIdx--;
        }
        // Clamp to valid range
        insertIdx = Math.max(0, Math.min(insertIdx, newParent.components.length));
        newParent.components.splice(insertIdx, 0, component);
        await this.writeDocument(updated);
        const server = (0, preview_1.getDevServer)();
        if (server?.isRunning) {
            server.broadcast('component:move', {
                componentId,
                oldParentId: oldParent.id,
                newParentId,
                index: insertIdx,
            });
        }
    }
    /**
     * Write an updated OmosceneFile back to the active document.
     */
    async writeDocument(updated) {
        if (!this.activeDocument) {
            return;
        }
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(this.activeDocument.positionAt(0), this.activeDocument.positionAt(this.activeDocument.getText().length));
        edit.replace(this.activeDocument.uri, fullRange, JSON.stringify(updated, null, 2));
        await vscode.workspace.applyEdit(edit);
    }
    /**
     * Update a component property in the document
     */
    async updateComponentProperty(componentId, property, value) {
        if (!this.activeDocument || !this.activeParsed) {
            return;
        }
        // Deep clone and modify
        const updated = JSON.parse(JSON.stringify(this.activeParsed));
        const component = findComponentById(updated.scene, componentId);
        if (!component) {
            return;
        }
        // Handle dotted paths (e.g., "textureMapKeys.albedo")
        setNestedValue(component, property, value);
        await this.writeDocument(updated);
        // Send update to preview if running
        const server = (0, preview_1.getDevServer)();
        if (server?.isRunning) {
            server.broadcast('component:update', {
                componentId,
                property,
                value,
            });
        }
        // Forward to audio editor if this is the active effect component
        if (this._inAudioEditor && componentId === this._audioEffectId) {
            this.forwardAudioEditorUpdate(property, value);
        }
    }
    /**
     * Update camera state in the editor metadata (persisted to .omoscene on save)
     */
    updateCameraState(panX, panY, zoom) {
        if (!this.activeParsed) {
            return;
        }
        this.activeParsed.editor.camera = { panX, panY, zoom };
    }
    /**
     * Get the current camera state from editor metadata
     */
    getCameraState() {
        if (!this.activeParsed) {
            return null;
        }
        return this.activeParsed.editor.camera;
    }
    /**
     * Notify the editor canvas webview of the currently selected entity
     */
    selectEntity(entityId, componentType) {
        if (this.activePanel) {
            this.activePanel.webview.postMessage({
                type: 'selection:changed',
                selectedId: entityId,
                componentType: componentType,
            });
        }
    }
    /**
     * Enable or disable cell-map editing mode in the webview
     */
    setCellEditMode(enabled) {
        if (this.activePanel) {
            this.activePanel.webview.postMessage({
                type: 'cellmap:editMode',
                enabled,
            });
        }
    }
    /**
     * Switch the editor webview to the audio editor scene
     */
    enterAudioEditor(effectComponent) {
        if (!this.activePanel || !this.activeParsed) {
            return;
        }
        if (this._inAudioEditor && this._audioEffectId === effectComponent.id) {
            return;
        }
        this._inAudioEditor = true;
        this._audioEffectId = effectComponent.id;
        const tracks = this.collectAudioTrackUris();
        this.activePanel.webview.postMessage({
            type: 'audioEditor:enter',
            effectData: effectComponent,
            effectId: effectComponent.id,
            tracks,
        });
    }
    /**
     * Switch back from audio editor to the normal editor scene
     */
    exitAudioEditor() {
        if (!this._inAudioEditor) {
            return;
        }
        this._inAudioEditor = false;
        this._audioEffectId = undefined;
        if (this.activePanel) {
            this.activePanel.webview.postMessage({
                type: 'audioEditor:exit',
            });
        }
    }
    /**
     * Forward a property update to the audio editor overlay if active
     */
    forwardAudioEditorUpdate(property, value) {
        if (!this._inAudioEditor || !this.activePanel) {
            return;
        }
        this.activePanel.webview.postMessage({
            type: 'audioEditor:propertyUpdate',
            property,
            value,
        });
    }
    /**
     * Collect audio-track file URIs from the scene (follows collectTextureMapUris pattern)
     */
    collectAudioTrackUris() {
        if (!this.activeParsed || !this.activePanel) {
            return [];
        }
        const result = [];
        this.walkForAudioTracks(this.activeParsed.scene, result);
        return result;
    }
    walkForAudioTracks(component, out) {
        if (component.type === 'audio-track') {
            const at = component;
            const filePath = at.filePath || '';
            let fileUri = '';
            if (filePath && this.activePanel) {
                const absPath = resolveFilePath(filePath);
                if (absPath && fs.existsSync(absPath)) {
                    fileUri = this.activePanel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
                }
            }
            out.push({
                name: component.name || 'Untitled',
                fileUri,
                trackId: component.id ?? 0,
            });
        }
        if ((0, engine_1.isSerializedNexus)(component)) {
            for (const child of component.components) {
                this.walkForAudioTracks(child, out);
            }
        }
    }
    postSceneData(panel, data) {
        if (!data) {
            panel.webview.postMessage({
                type: 'scene:data', entities: [], textures: [], colliders: [],
                lights: [], cellMap: null, textureMapUris: [], name: '',
            });
            return;
        }
        const entities = extractEntities(data.scene);
        const colliders = extractColliders(data.scene);
        const lights = extractLights(data.scene);
        const cellMap = extractCellMap(data.scene, panel);
        // Texture map URIs for engine loading (webview-accessible URIs)
        const textureMapUris = collectTextureMapUris(data.scene, panel);
        // Base64-encoded texture images (kept for fallback / palette colors)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let textures = [];
        if (workspaceFolders && workspaceFolders.length > 0) {
            const rawMaps = extractTextureMaps(data.scene);
            textures = loadTextureImages(rawMaps, workspaceFolders[0].uri.fsPath);
        }
        panel.webview.postMessage({
            type: 'scene:data',
            entities,
            textures,
            colliders,
            lights,
            cellMap,
            textureMapUris,
            name: data.name,
        });
    }
}
exports.OmosceneEditorProvider = OmosceneEditorProvider;
OmosceneEditorProvider.viewType = 'omosuen.omosceneEditor';
// ── Helpers ─────────────────────────────────────────────────────
function findComponentById(component, id) {
    if (component.id === id) {
        return component;
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            const found = findComponentById(child, id);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
function findComponentByName(root, name) {
    if (root.name === name) {
        return root;
    }
    if ((0, engine_1.isSerializedNexus)(root)) {
        for (const child of root.components) {
            const found = findComponentByName(child, name);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (typeof current[parts[i]] !== 'object' ||
            current[parts[i]] === null) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}
function findParentNexus(root, childId) {
    if (!(0, engine_1.isSerializedNexus)(root)) {
        return null;
    }
    for (const child of root.components) {
        if (child.id === childId) {
            return root;
        }
        if ((0, engine_1.isSerializedNexus)(child)) {
            const found = findParentNexus(child, childId);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
function getMaxId(component) {
    let max = component.id ?? -1;
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            const childMax = getMaxId(child);
            if (childMax > max) {
                max = childMax;
            }
        }
    }
    return max;
}
function countComponents(component) {
    let count = 1;
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            count += countComponents(child);
        }
    }
    return count;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function extractEntities(scene) {
    const entities = [];
    walkScene(scene, entities, scene);
    return entities;
}
function walkScene(component, out, sceneRoot) {
    if (!(0, engine_1.isSerializedNexus)(component)) {
        return;
    }
    // Look for transform, sprite, and camera siblings in this nexus
    const transform = component.components.find((c) => c.type === 'transform');
    const sprite = component.components.find((c) => c.type === 'sprite');
    const camera = component.components.find((c) => c.type === 'camera');
    const animCtrl = component.components.find((c) => c.type === 'animation-controller');
    // Only create an entity if there's a transform, sprite, or camera
    if (transform || sprite || camera) {
        const t = transform;
        const s = sprite;
        const pos = t?.position;
        const rot = t?.rotation;
        const scl = t?.scale;
        const entity = {
            name: component.name,
            id: component.id ?? -1,
            transformId: transform?.id,
            position: pos ? { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 } : { x: 0, y: 0, z: 0 },
            rotation: rot ? { x: rot.x || 0, y: rot.y || 0, z: rot.z || 0 } : { x: 0, y: 0, z: 0 },
            scale: scl ? { x: scl.x ?? 1, y: scl.y ?? 1, z: scl.z ?? 1 } : { x: 1, y: 1, z: 1 },
        };
        if (s) {
            const tmKeys = s.textureMapKeys;
            const frame = s.frame;
            const anchor = s.anchor;
            const tint = s.tint;
            const silCol = s.silhouetteColor;
            entity.sprite = {
                albedoKey: tmKeys?.albedo || '',
                frameIndex: frame?.albedo ?? 0,
                anchor: { x: anchor?.x || 0, y: anchor?.y || 0 },
                tint: { x: tint?.x ?? 1, y: tint?.y ?? 1, z: tint?.z ?? 1, w: tint?.w ?? 1 },
                opacity: s.opacity ?? 1,
                showSilhouette: s.showSilhouette ?? false,
                silhouetteColor: { x: silCol?.x ?? 0.2, y: silCol?.y ?? 0.4, z: silCol?.z ?? 0.8, w: silCol?.w ?? 0.5 },
            };
        }
        if (animCtrl) {
            const ac = animCtrl;
            const rawAnims = ac.animations ?? [];
            const animations = rawAnims.map((a) => ({
                name: a.name ?? '',
                frames: Array.isArray(a.frames) ? a.frames : [],
                frameRate: a.frameRate ?? 12,
                loop: a.loop ?? true,
                onComplete: a.onComplete ?? undefined,
            }));
            const state = ac.state ?? 'stopped';
            entity.animationController = {
                id: animCtrl.id ?? -1,
                animations,
                currentAnimation: ac.currentAnimation ?? null,
                state,
                speed: ac.speed ?? 1.0,
                channels: Array.isArray(ac.channels)
                    ? ac.channels
                    : ['albedo'],
            };
        }
        if (camera) {
            const cam = camera;
            const cameraZoom = cam.zoom ?? 1.0;
            const viewportRef = cam.viewportRef || '';
            let vpWidth = 800;
            let vpHeight = 600;
            if (viewportRef) {
                const vp = findComponentByName(sceneRoot, viewportRef);
                if (vp && vp.type === 'viewport') {
                    const vpData = vp;
                    vpWidth = vpData.width ?? 800;
                    vpHeight = vpData.height ?? 600;
                }
            }
            entity.camera = {
                id: camera.id ?? -1,
                name: cam.name ?? 'Camera',
                zoom: cameraZoom,
                pixelScale: cam.pixelScale ?? 2,
                axonometricAngle: cam.axonometricAngle ?? 30,
                viewportWidth: vpWidth,
                viewportHeight: vpHeight,
            };
        }
        out.push(entity);
    }
    // Recurse into child nexuses
    for (const child of component.components) {
        walkScene(child, out, sceneRoot);
    }
}
function extractTextureMaps(scene) {
    const maps = [];
    walkForTextureMaps(scene, maps);
    return maps;
}
function walkForTextureMaps(component, out) {
    if (component.type === 'texture-map') {
        const tm = component;
        const key = tm.textureMapKey || '';
        const filePath = tm.filePath || '';
        if (key && filePath) {
            const imageType = tm.imageType || null;
            out.push({ key, filePath, imageType });
        }
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            walkForTextureMaps(child, out);
        }
    }
}
function loadTextureImages(maps, workspaceRoot) {
    const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
    };
    const result = [];
    const seen = new Set();
    for (const tm of maps) {
        if (seen.has(tm.key)) {
            continue;
        }
        seen.add(tm.key);
        const absPath = path.isAbsolute(tm.filePath)
            ? tm.filePath
            : path.join(workspaceRoot, tm.filePath);
        if (!fs.existsSync(absPath)) {
            continue;
        }
        const ext = path.extname(absPath).toLowerCase();
        const mime = mimeMap[ext] || 'image/png';
        const base64 = fs.readFileSync(absPath).toString('base64');
        result.push({
            textureMapKey: tm.key,
            imageData: `data:${mime};base64,${base64}`,
            imageType: tm.imageType,
        });
    }
    return result;
}
// ── Collider Extraction ──────────────────────────────────────────
function extractColliders(scene) {
    const colliders = [];
    walkForColliders(scene, colliders);
    return colliders;
}
function walkForColliders(component, out) {
    if (!(0, engine_1.isSerializedNexus)(component)) {
        return;
    }
    const transform = component.components.find((c) => c.type === 'transform');
    const collider = component.components.find((c) => c.type === 'collider' || c.type === 'event-collider');
    if (collider) {
        const t = transform;
        const c = collider;
        const pos = t?.position;
        const sz = c.size;
        const off = c.offset;
        out.push({
            entityName: component.name,
            entityId: component.id ?? -1,
            position: pos ? { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 } : { x: 0, y: 0, z: 0 },
            shape: c.shape || 'box',
            size: sz ? { x: sz.x ?? 0.5, y: sz.y ?? 0.5, z: sz.z ?? 0.5 } : { x: 0.5, y: 0.5, z: 0.5 },
            radius: c.radius ?? 0.5,
            offset: off ? { x: off.x || 0, y: off.y || 0, z: off.z || 0 } : { x: 0, y: 0, z: 0 },
            colliderType: c.type === 'event-collider' ? 'event-collider' : 'collider',
        });
    }
    for (const child of component.components) {
        walkForColliders(child, out);
    }
}
// ── Light Extraction ─────────────────────────────────────────────
function extractLights(scene) {
    const lights = [];
    walkForLights(scene, lights);
    return lights;
}
function walkForLights(component, out) {
    if (!(0, engine_1.isSerializedNexus)(component)) {
        return;
    }
    const transform = component.components.find((c) => c.type === 'transform');
    for (const child of component.components) {
        if (child.type === 'light') {
            const t = transform;
            const l = child;
            const pos = t?.position;
            const col = l.color;
            const dir = l.direction;
            out.push({
                entityName: component.name,
                entityId: component.id ?? -1,
                position: pos ? { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 } : { x: 0, y: 0, z: 0 },
                lightType: l.lightType || 'ambient',
                color: col ? { x: col.x ?? 1, y: col.y ?? 1, z: col.z ?? 1 } : { x: 1, y: 1, z: 1 },
                brightness: l.brightness ?? 1,
                radius: l.radius ?? 100,
                hardness: l.hardness ?? 0,
                direction: dir ? { x: dir.x || 0, y: dir.y ?? -1, z: dir.z || 0 } : { x: 0, y: -1, z: 0 },
            });
        }
    }
    for (const child of component.components) {
        walkForLights(child, out);
    }
}
// ── Cell-Map Extraction ──────────────────────────────────────────
function extractCellMap(scene, panel) {
    const cm = findCellMap(scene);
    if (!cm) {
        return null;
    }
    const comp = cm;
    const materials = comp.materials || [];
    const packedData = comp.packedData || [];
    const cellSize = comp.cellSize || { x: 1, y: 1, z: 1 };
    const mapSize = comp.mapSize || { x: 1, y: 1, z: 1 };
    // Load material albedo images as data URIs for palette color sampling
    const materialImageDataUris = [];
    for (const mat of materials) {
        if (mat.albedoTextureKey) {
            const tm = findTextureMapByKey(scene, mat.albedoTextureKey);
            if (tm) {
                const filePath = tm.filePath || '';
                materialImageDataUris.push(filePath ? loadImageAsDataUri(filePath) : null);
            }
            else {
                materialImageDataUris.push(null);
            }
        }
        else {
            materialImageDataUris.push(null);
        }
    }
    return {
        componentName: cm.name,
        componentId: cm.id ?? -1,
        materials,
        materialImageDataUris,
        packedData,
        cellSize,
        mapSize,
        smoothing: comp.smoothing ?? 0,
        normalSmoothing: comp.normalSmoothing ?? 0,
    };
}
function findCellMap(component) {
    if (component.type === 'cell-map') {
        return component;
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            const found = findCellMap(child);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
function findTextureMapByKey(component, key) {
    if (component.type === 'texture-map') {
        const tm = component;
        if (tm.textureMapKey === key) {
            return tm;
        }
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            const found = findTextureMapByKey(child, key);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
// ── Texture Map URI Collection (for engine loading) ──────────────
function collectTextureMapUris(scene, panel) {
    const result = [];
    walkForTextureMapUris(scene, panel, result);
    return result;
}
function walkForTextureMapUris(component, panel, out) {
    if (component.type === 'texture-map') {
        const tm = component;
        const key = tm.textureMapKey || '';
        if (key) {
            const filePath = tm.filePath || '';
            let fileUri = '';
            if (filePath) {
                const absPath = resolveFilePath(filePath);
                if (absPath && fs.existsSync(absPath)) {
                    fileUri = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
                }
            }
            const imageType = tm.imageType || null;
            out.push({ key, fileUri, imageType });
        }
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            walkForTextureMapUris(child, panel, out);
        }
    }
}
// ── Editor Webview HTML ─────────────────────────────────────────
function getEditorWebviewHtml(webview, engineUri) {
    const nonce = getNonce();
    const engineScript = engineUri
        ? `<script src="${engineUri}"></script>`
        : '';
    const cspSrc = engineUri ? ` ${webview.cspSource}` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'${cspSrc} blob:; worker-src blob:; connect-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #0d0a07; color: #c8bfb0; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
  #gizmo-canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; }
  #info { position: absolute; top: 8px; right: 8px; color: rgba(200,191,176,0.5); font: 11px 'IBM Plex Mono', monospace; pointer-events: none; z-index: 20; }
  #init-status { position: absolute; top: 8px; left: 8px; color: #d4a843; font: 11px 'IBM Plex Mono', monospace; pointer-events: none; z-index: 20; }

  /* Cell-map editing overlay */
  .control-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: none; align-items: center; gap: 10px;
    padding: 6px 10px; background: rgba(21,17,12,0.92); border-bottom: 1px solid #2e2518;
  }
  .control-bar.visible { display: flex; }
  .control-bar label { font-size: 12px; color: #7a7060; }
  .control-bar button {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 2px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 13px;
    cursor: pointer; min-width: 24px;
  }
  .control-bar button:hover { background: #271f14; border-color: #d4a843; }
  .control-bar .height-val { color: #d4a843; font-weight: bold; min-width: 24px; text-align: center; }
  .control-bar .info { color: #7a7060; margin-left: auto; font-size: 11px; }

  .palette {
    position: fixed; left: 0; top: 34px; bottom: 0; z-index: 100;
    width: 72px; background: rgba(21,17,12,0.92);
    border-right: 1px solid #2e2518; overflow-y: auto;
    display: none; flex-direction: column; align-items: center;
    padding: 6px 0; gap: 4px;
  }
  .palette.visible { display: flex; }
  .palette-item {
    width: 56px; height: 56px; border: 2px solid #2e2518; border-radius: 3px;
    cursor: pointer; position: relative; background: #0d0a07;
    display: flex; align-items: center; justify-content: center;
  }
  .palette-item:hover { border-color: #7a7060; }
  .palette-item.selected { border-color: #d4a843; }
  .palette-item canvas { image-rendering: pixelated; }
  .palette-item .pal-idx {
    position: absolute; bottom: 1px; right: 3px;
    font-size: 9px; color: rgba(200,191,176,0.6);
  }

  /* Camera toolbar */
  .camera-toolbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: flex; align-items: center; gap: 8px;
    padding: 5px 10px; background: rgba(21,17,12,0.92);
    border-bottom: 1px solid #2e2518; font-size: 12px;
  }
  .camera-toolbar select {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518;
    border-radius: 3px; padding: 3px 6px; font-family: inherit; font-size: 12px;
    cursor: pointer; min-width: 140px;
  }
  .camera-toolbar select option.editor-cam { color: #d4a843; }
  .camera-toolbar label { color: #7a7060; font-size: 11px; }
  .camera-toolbar input[type="number"] {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518;
    border-radius: 3px; padding: 2px 4px; font-family: inherit; font-size: 12px;
    width: 52px;
  }
  .camera-toolbar input[type="number"]:focus { border-color: #d4a843; outline: none; }
  .camera-toolbar .pos-input { width: 56px; }
  .camera-toolbar .toolbar-sep {
    width: 1px; height: 16px; background: #2e2518; margin: 0 4px;
  }
  .camera-toolbar .lock-btn {
    background: #1e1810; border: 1px solid #2e2518; border-radius: 3px;
    color: #c8bfb0; cursor: pointer; padding: 3px 5px; display: flex;
    align-items: center;
  }
  .camera-toolbar .lock-btn:hover { border-color: #d4a843; }
  .camera-toolbar .lock-btn.unlocked { color: #d4a843; }
  .toolbar-fields { display: flex; align-items: center; gap: 6px; }

  /* Audio editor overlay */
  .audio-editor {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 200;
    display: none; flex-direction: column; gap: 12px;
    padding: 16px 20px; background: #0d0a07; overflow-y: auto;
    font-family: 'IBM Plex Mono', monospace;
  }
  .audio-editor.visible { display: flex; }
  .audio-editor h2 { color: #d4a843; font-size: 14px; font-weight: 600; margin: 0; }
  .audio-editor .ae-section {
    background: rgba(30,24,16,0.8); border: 1px solid #2e2518; border-radius: 4px;
    padding: 10px 12px;
  }
  .audio-editor .ae-section-title { color: #7a7060; font-size: 11px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
  .audio-editor .ae-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .audio-editor .ae-row:last-child { margin-bottom: 0; }
  .audio-editor .ae-label { color: #7a7060; font-size: 12px; min-width: 60px; }
  .audio-editor .ae-value { color: #d4a843; font-size: 12px; min-width: 50px; text-align: right; }
  .audio-editor select {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 4px 8px; font-family: inherit; font-size: 12px; cursor: pointer;
  }
  .audio-editor select:focus { border-color: #d4a843; outline: none; }
  .audio-editor button {
    background: #1e1810; color: #c8bfb0; border: 1px solid #2e2518; border-radius: 3px;
    padding: 4px 12px; font-family: inherit; font-size: 12px; cursor: pointer;
  }
  .audio-editor button:hover { background: #271f14; border-color: #d4a843; }
  .audio-editor button.active { background: #271f14; border-color: #d4a843; color: #d4a843; }
  .audio-editor input[type="range"] {
    flex: 1; accent-color: #d4a843; height: 4px; cursor: pointer;
  }
  .audio-editor .ae-transport { display: flex; align-items: center; gap: 8px; }
  .audio-editor .ae-status { color: #d4a843; font-size: 12px; margin-left: 8px; }
  .audio-editor .ae-timer { display: flex; align-items: center; gap: 8px; }
  .audio-editor .ae-timer span { font-size: 11px; color: #7a7060; min-width: 36px; }
  .audio-editor .ae-eq-wrap { display: flex; align-items: flex-end; height: 100px; }
  .audio-editor .ae-eq-band {
    display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0 10px;
  }
  .audio-editor .ae-eq-band input[type="range"] {
    writing-mode: vertical-lr; direction: rtl; width: 24px; height: 80px;
    -webkit-appearance: slider-vertical; flex: none;
  }
  .audio-editor .ae-eq-band span { font-size: 9px; color: #7a7060; }
  .audio-editor .ae-spatial-wrap { display: flex; align-items: center; gap: 16px; }
  .audio-editor .hex-svg { cursor: crosshair; }
  .audio-editor .hex-outline { fill: none; stroke: #2e2518; stroke-width: 1.5; }
  .audio-editor .hex-dot { fill: #d4a843; cursor: grab; }
  .audio-editor .hex-label { fill: #7a7060; font-size: 10px; }
  .audio-editor .ae-spatial-readout { color: #7a7060; font-size: 11px; }
  .audio-editor .ae-spatial-readout span { color: #c8bfb0; }
</style>
</head>
<body>
<canvas id="gizmo-canvas"></canvas>
<div id="info">Editor Preview</div>
<div id="init-status"></div>

<!-- Cell-map editing overlay (hidden by default) -->
<div class="control-bar" id="control-bar">
  <label>Brush Height:</label>
  <button id="height-down">-</button>
  <span class="height-val" id="height-val">0</span>
  <button id="height-up">+</button>
  <span class="info" id="cursor-info"></span>
</div>
<div class="palette" id="palette"></div>

<!-- Camera toolbar -->
<div class="camera-toolbar" id="camera-toolbar">
  <select id="camera-select">
    <option value="editor" class="editor-cam">Editor Camera</option>
  </select>
  <div class="toolbar-fields" id="editor-cam-fields">
    <label>Pixel Scale</label>
    <input type="number" id="ed-pixel-scale" min="1" max="8" step="1" value="2">
    <label>Angle</label>
    <input type="number" id="ed-axo-angle" min="0" max="90" step="1" value="30">
  </div>
  <div class="toolbar-fields" id="scene-cam-fields" style="display:none">
    <button id="camera-lock" class="lock-btn" title="Unlock pan and zoom">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path id="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </button>
    <label>Zoom</label>
    <input type="number" id="sc-zoom" min="0.1" max="10" step="0.1">
    <label>Pixel Scale</label>
    <input type="number" id="sc-pixel-scale" min="1" max="8" step="1">
    <label>Angle</label>
    <input type="number" id="sc-axo-angle" min="0" max="90" step="1">
    <span class="toolbar-sep"></span>
    <label>Pos</label>
    <input type="number" id="sc-pos-x" step="0.5" class="pos-input" placeholder="X">
    <input type="number" id="sc-pos-y" step="0.5" class="pos-input" placeholder="Y">
    <input type="number" id="sc-pos-z" step="0.5" class="pos-input" placeholder="Z">
  </div>
</div>

<!-- Audio editor overlay (hidden by default) -->
<div class="audio-editor" id="audio-editor">
  <h2>Audio Effect Editor</h2>

  <div class="ae-section">
    <div class="ae-transport">
      <select id="ae-track-select"><option value="">No tracks</option></select>
      <button id="ae-play">&#9654; PLAY</button>
      <button id="ae-pause">&#9208; PAUSE</button>
      <button id="ae-stop">&#9209; STOP</button>
      <span class="ae-status" id="ae-status">STOPPED</span>
    </div>
    <div class="ae-timer">
      <span id="ae-time">00:00</span>
      <input type="range" id="ae-seek" min="0" max="1000" value="0">
      <span id="ae-length">00:00</span>
    </div>
  </div>

  <div class="ae-section">
    <div class="ae-section-title">LEVELS</div>
    <div class="ae-row">
      <span class="ae-label">Volume</span>
      <input type="range" id="ae-volume" min="0" max="100" value="100">
      <span class="ae-value" id="ae-volume-val">1.00</span>
    </div>
    <div class="ae-section-title" style="margin-top:8px">EQ</div>
    <div class="ae-eq-wrap" id="ae-eq-wrap"></div>
  </div>

  <div class="ae-section">
    <div class="ae-section-title">PANNING</div>
    <div class="ae-row">
      <button id="ae-stereo" class="active">STEREO</button>
      <button id="ae-surround">SURROUND</button>
    </div>
    <div id="ae-stereo-panel">
      <div class="ae-row">
        <span class="ae-label">Pan</span>
        <input type="range" id="ae-pan" min="-100" max="100" value="0">
        <span class="ae-value" id="ae-pan-val">0.00</span>
      </div>
    </div>
    <div id="ae-surround-panel" style="display:none">
      <div class="ae-spatial-wrap">
        <svg id="ae-hex-svg" class="hex-svg" viewBox="0 0 200 200" width="160" height="160">
          <polygon id="ae-hex-poly" class="hex-outline"/>
          <circle id="ae-hex-dot" cx="100" cy="100" r="7" class="hex-dot"/>
        </svg>
        <div class="ae-spatial-readout">
          <div>X: <span id="ae-spatial-x">0.00</span></div>
          <div>Y: <span id="ae-spatial-y">0.00</span></div>
          <div>Z: <span id="ae-spatial-z">0.00</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="ae-section">
    <div class="ae-section-title">EFFECTS</div>
    <div class="ae-row">
      <span class="ae-label">Pitch</span>
      <input type="range" id="ae-pitch" min="-240" max="240" value="0">
      <span class="ae-value" id="ae-pitch-val">0.0 st</span>
    </div>
    <div class="ae-row">
      <span class="ae-label">Speed</span>
      <input type="range" id="ae-speed" min="10" max="400" value="100">
      <span class="ae-value" id="ae-speed-val">1.00x</span>
    </div>
    <div class="ae-row">
      <span class="ae-label">Reverb</span>
      <input type="range" id="ae-reverb" min="0" max="100" value="0">
      <span class="ae-value" id="ae-reverb-val">0.00</span>
    </div>
    <div class="ae-row">
      <span class="ae-label">Trans. Buf</span>
      <input type="range" id="ae-transition" min="0" max="5000" value="0" step="25">
      <span class="ae-value" id="ae-transition-val">0 ms</span>
    </div>
  </div>
</div>

${engineScript}
<script nonce="${nonce}">
(function() {
  'use strict';

  var vscode = acquireVsCodeApi();
  var hasEngine = typeof Omosuen !== 'undefined';

  // ── Constants ──────────────────────────────────────────────
  var GIZMO_LEN = 40;
  var GIZMO_HIT_DIST = 10;
  var AXIS_COLORS = { x: '#c45a4a', y: '#6abc5a', z: '#4a8ac4' };
  var AXIS_HOVER_COLORS = { x: '#e07060', y: '#80d870', z: '#6aa0e0' };

  function getAngleValues() {
    var angle = (camera && camera.axonometricAngle !== undefined) ? camera.axonometricAngle : 30;
    angle = Math.max(0, Math.min(90, angle));
    var rad = angle * Math.PI / 180;
    return { cos: 0.8660254, sin: Math.sin(rad), hs: Math.cos(rad) * 1.1547005 };
  }

  function getAxisDirs(av) {
    return {
      x: { x: av.cos, y: av.sin },
      y: { x: 0, y: -av.hs },
      z: { x: -av.cos, y: av.sin },
    };
  }

  // ── DOM refs ────────────────────────────────────────────────
  var gizmoCanvas = document.getElementById('gizmo-canvas');
  var ctx = gizmoCanvas.getContext('2d');
  var infoEl = document.getElementById('info');
  var initStatus = document.getElementById('init-status');
  var controlBar = document.getElementById('control-bar');
  var paletteEl = document.getElementById('palette');
  var heightVal = document.getElementById('height-val');
  var heightDown = document.getElementById('height-down');
  var heightUp = document.getElementById('height-up');
  var cursorInfoEl = document.getElementById('cursor-info');
  var cameraSelect = document.getElementById('camera-select');
  var editorCamFields = document.getElementById('editor-cam-fields');
  var sceneCamFields = document.getElementById('scene-cam-fields');

  // ── State ──────────────────────────────────────────────────
  var entities = [];
  var colliders = [];
  var lights = [];
  var cellMapData = null;
  var textureMapUris = [];
  var sceneName = '';
  var selectedEntityId = -1;
  var engineReady = false;

  // Engine component references
  var viewport = null;
  var camera = null;
  var cameraTransform = null;
  var cellMap = null;
  var inputController = null;
  var engineScene = null;

  // Sprite engine components: entityId → { nexus, transform, sprite }
  var engineEntities = {};
  // Light engine components: index → { nexus?, light }
  var engineLights = [];

  // Cell-map editing mode
  var cellEditMode = false;
  var brushHeight = 0;
  var selectedMaterial = 0;
  var materialImages = [];   // Loaded Image objects per material index
  var editorTextures = [];   // msg.textures (EditorTextureMap[]) for imageType lookups
  var brushTarget = null;
  var suppressNextUpdate = false;

  // Gizmo interaction
  var hoveredAxis = null;
  var draggingAxis = null;
  var dragStartMouse = null;
  var dragStartPosition = null;
  var dragEntityId = null;

  // Audio editor state
  var audioEditorActive = false;
  var audioEditorScene = null;
  var audioTrackController = null;
  var audioPlayer = null;
  var audioEffect = null;
  var audioTracks = []; // { name, fileUri, engineTrack }
  var audioEffectId = null;
  var audioTimerInterval = null;
  var audioIsSeeking = false;
  var audioIsSurround = false;
  var AE_EQ_BANDS = 10;
  var AE_HEX_RADIUS = 70;
  var AE_HEX_CX = 100;
  var AE_HEX_CY = 100;

  // Camera toolbar state
  var viewingSceneCamera = false;
  var sceneCameraEntity = null;
  var sceneCameraRef = null;
  var sceneCameraTransformRef = null;
  var cameraLocked = true;
  var savedEditorZoom = 0.5;
  var savedEditorPos = { x: 0, y: 0, z: 0 };
  var savedEditorPixelScale = 2;
  var savedEditorAngle = 30;

  // ── Camera Toolbar ──────────────────────────────────────────
  function populateCameraDropdown() {
    var currentVal = cameraSelect.value;
    while (cameraSelect.options.length > 1) cameraSelect.remove(1);
    for (var i = 0; i < entities.length; i++) {
      if (!entities[i].camera) continue;
      var opt = document.createElement('option');
      opt.value = '' + entities[i].id;
      opt.textContent = entities[i].name;
      cameraSelect.add(opt);
    }
    cameraSelect.value = currentVal;
    if (cameraSelect.selectedIndex === -1) {
      cameraSelect.value = 'editor';
      if (viewingSceneCamera) switchToEditorCamera();
    }
  }

  function switchToEditorCamera() {
    viewingSceneCamera = false;
    sceneCameraEntity = null;
    sceneCameraRef = null;
    sceneCameraTransformRef = null;
    cameraLocked = true;
    if (camera) {
      camera.zoom = savedEditorZoom;
      camera.pixelScale = savedEditorPixelScale;
      camera.axonometricAngle = savedEditorAngle;
    }
    if (cameraTransform) {
      cameraTransform.position = new Omosuen.Vector3D(
        savedEditorPos.x, savedEditorPos.y, savedEditorPos.z
      );
    }
    editorCamFields.style.display = 'flex';
    sceneCamFields.style.display = 'none';
  }

  function switchToSceneCamera(entityId) {
    if (!camera || !cameraTransform) return;
    // Save editor camera state
    savedEditorZoom = camera.zoom;
    savedEditorPos = {
      x: cameraTransform.position.x,
      y: cameraTransform.position.y,
      z: cameraTransform.position.z,
    };
    savedEditorPixelScale = camera.pixelScale;
    savedEditorAngle = camera.axonometricAngle;

    var entity = null;
    for (var i = 0; i < entities.length; i++) {
      if (entities[i].id === entityId && entities[i].camera) {
        entity = entities[i]; break;
      }
    }
    if (!entity) return;

    viewingSceneCamera = true;
    sceneCameraEntity = entity;
    cameraLocked = true;
    sceneCameraRef = null;
    sceneCameraTransformRef = null;

    // Find live engine components
    var activeScene = Omosuen.getActiveScene();
    if (activeScene) {
      sceneCameraRef = activeScene.getComponentByName(entity.camera.name, true);
      if (sceneCameraRef && sceneCameraRef.parent) {
        sceneCameraTransformRef = sceneCameraRef.parent.getComponentByType('transform', false);
      }
    }

    syncSceneCameraToEditor();
    editorCamFields.style.display = 'none';
    sceneCamFields.style.display = 'flex';
    updateSceneCameraFields();
    updateLockButton();
  }

  function syncSceneCameraToEditor() {
    if (!sceneCameraEntity || !camera || !cameraTransform) return;
    camera.zoom = sceneCameraEntity.camera.zoom;
    camera.pixelScale = sceneCameraEntity.camera.pixelScale;
    camera.axonometricAngle = sceneCameraEntity.camera.axonometricAngle;
    cameraTransform.position = new Omosuen.Vector3D(
      sceneCameraEntity.position.x,
      sceneCameraEntity.position.y,
      sceneCameraEntity.position.z
    );
  }

  function updateSceneCameraFields() {
    if (!sceneCameraEntity) return;
    document.getElementById('sc-zoom').value = sceneCameraEntity.camera.zoom;
    document.getElementById('sc-pixel-scale').value = sceneCameraEntity.camera.pixelScale;
    document.getElementById('sc-axo-angle').value = sceneCameraEntity.camera.axonometricAngle;
    document.getElementById('sc-pos-x').value = sceneCameraEntity.position.x;
    document.getElementById('sc-pos-y').value = sceneCameraEntity.position.y;
    document.getElementById('sc-pos-z').value = sceneCameraEntity.position.z;
  }

  function updateLockButton() {
    var btn = document.getElementById('camera-lock');
    var shackle = document.getElementById('lock-shackle');
    if (cameraLocked) {
      btn.classList.remove('unlocked');
      btn.title = 'Unlock pan and zoom';
      shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
    } else {
      btn.classList.add('unlocked');
      btn.title = 'Lock pan and zoom';
      shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0');
    }
  }

  function postCameraPropertyChange(property, value) {
    if (!sceneCameraEntity) return;
    vscode.postMessage({
      type: 'cameraPropertyChanged',
      cameraId: sceneCameraEntity.camera.id,
      property: property,
      value: value,
    });
  }

  // ── Projection (matches engine zoom² pipeline) ──────────────
  function worldToScreen(wx, wy, wz) {
    if (!engineReady || !camera || !cameraTransform || !viewport) {
      // Fallback: simple isometric (no engine)
      return { x: gizmoCanvas.width / 2, y: gizmoCanvas.height / 2 };
    }
    var av = getAngleValues();
    // Project camera 3D world position to 2D isometric space (matches engine)
    var rawX = cameraTransform.position.x;
    var rawY = cameraTransform.position.y;
    var rawZ = cameraTransform.position.z;
    var camX = av.cos * rawX - av.cos * rawZ;
    var camZ = av.sin * rawX - av.hs * rawY + av.sin * rawZ;
    var zoom = camera.zoom;
    var pixelScale = camera.pixelScale;

    if (pixelScale > 1) {
      var snapSize = pixelScale / zoom;
      camX = Math.floor(camX / snapSize) * snapSize;
      camZ = Math.floor(camZ / snapSize) * snapSize;
    }

    var vpW = viewport.width;
    var vpH = viewport.height;
    var zoomSq = zoom * zoom;

    var isoX = av.cos * wx - av.cos * wz;
    var isoY = av.sin * wx - av.hs * wy + av.sin * wz;
    return {
      x: (isoX - camX) * zoomSq + vpW / 2,
      y: (isoY - camZ) * zoomSq + vpH / 2,
    };
  }

  function screenToWorld(sx, sy, planeY) {
    if (!camera || !cameraTransform || !viewport) return { x: 0, y: 0, z: 0 };
    var av = getAngleValues();
    // Project camera 3D world position to 2D isometric space (matches engine)
    var rawX = cameraTransform.position.x;
    var rawY = cameraTransform.position.y;
    var rawZ = cameraTransform.position.z;
    var camX = av.cos * rawX - av.cos * rawZ;
    var camZ = av.sin * rawX - av.hs * rawY + av.sin * rawZ;
    var zoom = camera.zoom;
    var pixelScale = camera.pixelScale;
    if (pixelScale > 1) {
      var snapSize = pixelScale / zoom;
      camX = Math.floor(camX / snapSize) * snapSize;
      camZ = Math.floor(camZ / snapSize) * snapSize;
    }
    var vpW = viewport.width;
    var vpH = viewport.height;
    var zoomSq = zoom * zoom;
    var isoX = (sx - vpW / 2) / zoomSq + camX;
    var isoY = (sy - vpH / 2) / zoomSq + camZ;
    if (av.sin < 0.01) {
      // Near top-down: isoY encodes -hs*wy, cannot solve for wx+wz from isoY
      var v = isoX / av.cos;
      return { x: v / 2, y: planeY, z: -v / 2 };
    }
    var adjustedIsoY = isoY + av.hs * planeY;
    var u = adjustedIsoY / av.sin;
    var v = isoX / av.cos;
    return { x: (u + v) / 2, y: planeY, z: (u - v) / 2 };
  }

  // ── Gizmo Drawing ──────────────────────────────────────────

  function drawGrid() {
    if (!engineReady) return;
    var gridCells, gridCellW, gridCellZ;
    if (cellMapData) {
      gridCells = Math.max(cellMapData.mapSize.x, cellMapData.mapSize.z);
      gridCellW = cellMapData.cellSize.x;
      gridCellZ = cellMapData.cellSize.z;
    } else {
      gridCells = 16;
      gridCellW = 1;
      gridCellZ = 1;
    }
    var mx = cellMapData ? cellMapData.mapSize.x : gridCells;
    var mz = cellMapData ? cellMapData.mapSize.z : gridCells;

    for (var i = 0; i <= mx; i++) {
      var wx = i * gridCellW;
      var a = worldToScreen(wx, 0, 0);
      var b = worldToScreen(wx, 0, mz * gridCellZ);
      ctx.strokeStyle = (i === 0) ? 'rgba(212,168,67,0.15)' : 'rgba(212,168,67,0.04)';
      ctx.lineWidth = (i === 0) ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (var j = 0; j <= mz; j++) {
      var wz = j * gridCellZ;
      var c = worldToScreen(0, 0, wz);
      var d = worldToScreen(mx * gridCellW, 0, wz);
      ctx.strokeStyle = (j === 0) ? 'rgba(212,168,67,0.15)' : 'rgba(212,168,67,0.04)';
      ctx.lineWidth = (j === 0) ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
  }

  function drawOrigin() {
    var o = worldToScreen(0, 0, 0);
    var len = 60;
    var ad = getAxisDirs(getAngleValues());
    ctx.strokeStyle = AXIS_COLORS.x; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + ad.x.x * len, o.y + ad.x.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.x; ctx.font = "bold 11px 'IBM Plex Mono', monospace";
    ctx.fillText('X', o.x + ad.x.x * (len + 6), o.y + ad.x.y * (len + 6));

    ctx.strokeStyle = AXIS_COLORS.y; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y + ad.y.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.y;
    ctx.fillText('Y', o.x + 4, o.y + ad.y.y * (len + 4));

    ctx.strokeStyle = AXIS_COLORS.z; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + ad.z.x * len, o.y + ad.z.y * len); ctx.stroke();
    ctx.fillStyle = AXIS_COLORS.z;
    ctx.fillText('Z', o.x + ad.z.x * (len + 6), o.y + ad.z.y * (len + 6));

    ctx.fillStyle = '#d4a843';
    ctx.beginPath(); ctx.arc(o.x, o.y, 3, 0, Math.PI * 2); ctx.fill();
  }

  function hitTestEntityGizmo(mx, my, cx, cy) {
    var ad = getAxisDirs(getAngleValues());
    var axes = ['x', 'y', 'z'];
    for (var i = 0; i < 3; i++) {
      var axis = axes[i];
      var dir = ad[axis];
      var adx = dir.x * GIZMO_LEN * 0.7, ady = dir.y * GIZMO_LEN * 0.7;
      var dx = mx - cx, dy = my - cy;
      var dot = dx * adx + dy * ady;
      var lenSq = adx * adx + ady * ady;
      var t = Math.max(0.1, Math.min(1, dot / lenSq));
      var closestX = cx + t * adx, closestY = cy + t * ady;
      var distSq = (mx - closestX) * (mx - closestX) + (my - closestY) * (my - closestY);
      if (distSq < GIZMO_HIT_DIST * GIZMO_HIT_DIST) return axis;
    }
    return null;
  }

  function drawEntityGizmo(e) {
    var p = worldToScreen(e.position.x, e.position.y, e.position.z);
    var len = GIZMO_LEN;
    var ad = getAxisDirs(getAngleValues());
    var isSelected = (e.id === selectedEntityId);
    var isGizmoTarget = isSelected || e.id === dragEntityId;
    var baseLw = isSelected ? 2.5 : 1.5;
    var alpha = isSelected ? 1.0 : 0.7;

    ctx.globalAlpha = alpha;

    // X axis
    var xHover = isGizmoTarget && (hoveredAxis === 'x' || draggingAxis === 'x');
    ctx.strokeStyle = xHover ? AXIS_HOVER_COLORS.x : AXIS_COLORS.x;
    ctx.lineWidth = xHover ? baseLw + 1.5 : baseLw;
    ctx.beginPath();
    ctx.moveTo(p.x - ad.x.x * len * 0.3, p.y - ad.x.y * len * 0.3);
    ctx.lineTo(p.x + ad.x.x * len * 0.7, p.y + ad.x.y * len * 0.7);
    ctx.stroke();

    // Y axis
    var yHover = isGizmoTarget && (hoveredAxis === 'y' || draggingAxis === 'y');
    ctx.strokeStyle = yHover ? AXIS_HOVER_COLORS.y : AXIS_COLORS.y;
    ctx.lineWidth = yHover ? baseLw + 1.5 : baseLw;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - ad.y.y * len * 0.3);
    ctx.lineTo(p.x, p.y + ad.y.y * len * 0.7);
    ctx.stroke();

    // Z axis
    var zHover = isGizmoTarget && (hoveredAxis === 'z' || draggingAxis === 'z');
    ctx.strokeStyle = zHover ? AXIS_HOVER_COLORS.z : AXIS_COLORS.z;
    ctx.lineWidth = zHover ? baseLw + 1.5 : baseLw;
    ctx.beginPath();
    ctx.moveTo(p.x - ad.z.x * len * 0.3, p.y - ad.z.y * len * 0.3);
    ctx.lineTo(p.x + ad.z.x * len * 0.7, p.y + ad.z.y * len * 0.7);
    ctx.stroke();

    ctx.globalAlpha = 1;

    ctx.fillStyle = isSelected ? '#d4a843' : '#c8bfb0';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();

    // Label
    var label = e.name;
    ctx.font = "10px 'IBM Plex Mono', monospace";
    var m = ctx.measureText(label);
    ctx.fillStyle = 'rgba(13, 10, 7, 0.85)';
    ctx.fillRect(p.x - m.width / 2 - 3, p.y - len * 0.7 - 18, m.width + 6, 14);
    ctx.fillStyle = isSelected ? '#d4a843' : '#c8bfb0';
    ctx.fillText(label, p.x - m.width / 2, p.y - len * 0.7 - 7);
  }

  function drawIsoBox(cx, cy, cz, hx, hy, hz, color, lineWidth) {
    var corners = [
      worldToScreen(cx-hx, cy-hy, cz-hz), worldToScreen(cx+hx, cy-hy, cz-hz),
      worldToScreen(cx+hx, cy+hy, cz-hz), worldToScreen(cx-hx, cy+hy, cz-hz),
      worldToScreen(cx-hx, cy-hy, cz+hz), worldToScreen(cx+hx, cy-hy, cz+hz),
      worldToScreen(cx+hx, cy+hy, cz+hz), worldToScreen(cx-hx, cy+hy, cz+hz),
    ];
    var edges = [[1,2],[2,3],[4,5],[5,6],[6,7],[7,4],[1,5],[2,6],[3,7]];
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var a = corners[edges[i][0]], b = corners[edges[i][1]];
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  function drawColliderGizmo(c) {
    var isSelected = (c.entityId === selectedEntityId);
    var isEvent = c.colliderType === 'event-collider';
    var color = isEvent
      ? (isSelected ? 'rgba(180,220,80,0.9)' : 'rgba(180,220,80,0.4)')
      : (isSelected ? 'rgba(80,220,220,0.9)' : 'rgba(80,220,220,0.4)');
    var lw = isSelected ? 2 : 1;
    var cx = c.position.x + c.offset.x;
    var cy = c.position.y + c.offset.y;
    var cz = c.position.z + c.offset.z;

    if (c.shape === 'sphere') {
      var p = worldToScreen(cx, cy, cz);
      var r = c.radius;
      var edge = worldToScreen(cx + r, cy, cz);
      var screenR = Math.abs(edge.x - p.x);
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(p.x, p.y, screenR, 0, Math.PI * 2); ctx.stroke();
    } else {
      drawIsoBox(cx, cy, cz, c.size.x, c.size.y, c.size.z, color, lw);
    }
  }

  function drawLightGizmo(l) {
    var p = worldToScreen(l.position.x, l.position.y, l.position.z);
    var r = Math.round(l.color.x * 255);
    var g = Math.round(l.color.y * 255);
    var b = Math.round(l.color.z * 255);
    var colorStr = 'rgba(' + r + ',' + g + ',' + b + ',0.8)';

    if (l.lightType === 'ambient') return;

    if (l.lightType === 'directional') {
      // Arrow showing direction at top-left corner area
      var ox = 50, oy = 50;
      var dx = l.direction.x, dy = -l.direction.y, dz = l.direction.z;
      var mag = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
      ctx.strokeStyle = colorStr; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ox, oy);
      ctx.lineTo(ox + (dx/mag) * 30, oy + (dy/mag) * 30); ctx.stroke();
      ctx.fillStyle = colorStr;
      ctx.beginPath(); ctx.arc(ox + (dx/mag) * 30, oy + (dy/mag) * 30, 3, 0, Math.PI * 2); ctx.fill();
      return;
    }

    // Point / spot light
    ctx.fillStyle = colorStr;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();

    // Radius indicator
    if (l.radius > 0 && l.radius < 10000) {
      var edge = worldToScreen(l.position.x + l.radius, l.position.y, l.position.z);
      var screenR = Math.abs(edge.x - p.x);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.2)';
      ctx.beginPath(); ctx.arc(p.x, p.y, screenR, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

  }


  function drawCellHighlight() {
    if (!cellMapData || !engineReady || !cellEditMode || !brushTarget) return;
    var cs = cellMapData.cellSize;
    var bcx = (brushTarget.x + 0.5) * cs.x;
    var bcy = (brushTarget.y + 0.5) * cs.y;
    var bcz = (brushTarget.z + 0.5) * cs.z;
    var isFilled = false;
    if (cellMap) {
      var cd = cellMap.getCellData(new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z));
      isFilled = cd && cd.shapeIndex !== 0;
    }
    if (isFilled) {
      drawIsoBox(bcx, bcy, bcz, cs.x / 2, cs.y / 2, cs.z / 2, 'rgba(80,220,220,0.6)', 2);
    } else {
      ctx.setLineDash([4, 4]);
      drawIsoBox(bcx, bcy, bcz, cs.x / 2, cs.y / 2, cs.z / 2, 'rgba(80,220,220,1.0)', 1);
      ctx.setLineDash([]);
    }
  }

  // ── Gizmo Render ──────────────────────────────────────────
  function renderGizmos() {
    gizmoCanvas.width = gizmoCanvas.clientWidth;
    gizmoCanvas.height = gizmoCanvas.clientHeight;
    ctx.clearRect(0, 0, gizmoCanvas.width, gizmoCanvas.height);

    if (!engineReady) return;

    drawGrid();
    drawOrigin();

    // Collider wireframes
    for (var ci = 0; ci < colliders.length; ci++) {
      drawColliderGizmo(colliders[ci]);
    }

    // Light indicators
    for (var li = 0; li < lights.length; li++) {
      drawLightGizmo(lights[li]);
    }

    // Entity axis gizmos + labels
    for (var j = 0; j < entities.length; j++) {
      drawEntityGizmo(entities[j]);
    }

    // Cell highlight
    drawCellHighlight();

    requestAnimationFrame(renderGizmos);
  }

  // ── Engine Scene Creation ──────────────────────────────────
  async function createEditorScene(data) {
    if (!hasEngine) return;
    initStatus.textContent = 'Initializing engine...';
    Omosuen.init();

    var scene = await Omosuen.newComponent('nexus', { name: 'Editor Scene' });
    engineScene = scene;

    // Atlas manager
    var atlasManager = await Omosuen.newComponent('atlas-manager', {
      name: 'EditorAtlas', config: { atlasSize: 4096, maxAtlases: 16, padding: 1 },
    }, scene);

    // Texture maps
    initStatus.textContent = 'Loading textures...';
    var tmUris = data.textureMapUris || [];
    var tmPromises = [];
    for (var i = 0; i < tmUris.length; i++) {
      var tm = tmUris[i];
      if (!tm.fileUri) continue;
      // Convert serialized imageType to engine format
      var engineImageType = undefined;
      if (tm.imageType) {
        if (tm.imageType.mode === 'grid') {
          engineImageType = {
            cellSize: new Omosuen.Vector2D(tm.imageType.cellWidth, tm.imageType.cellHeight),
            gridSize: new Omosuen.Vector2D(tm.imageType.cols, tm.imageType.rows),
            cellCount: tm.imageType.cellCount,
          };
        } else if (tm.imageType.mode === 'framemap' && Array.isArray(tm.imageType.frames)) {
          engineImageType = tm.imageType.frames.map(function(f) {
            return new Omosuen.Vector4D(f.x, f.y, f.w, f.h);
          });
        }
      }
      tmPromises.push(Omosuen.newComponent('texture-map', {
        textureMapKey: tm.key, name: tm.key,
        filePath: tm.fileUri, imageType: engineImageType,
        atlasManager: atlasManager,
      }, scene));
    }
    await Promise.all(tmPromises);

    // Viewport
    initStatus.textContent = 'Creating viewport...';
    viewport = await Omosuen.newComponent('viewport', {
      name: 'EditorViewport', width: window.innerWidth, height: window.innerHeight,
      backgroundColor: new Omosuen.Vector4D(0.05, 0.04, 0.03, 1.0),
    }, scene);

    // Camera
    var camNexus = await Omosuen.newComponent('nexus', { name: 'EditorCamNexus' }, scene);
    cameraTransform = await Omosuen.newComponent('transform', {
      name: 'EditorCamTransform', position: new Omosuen.Vector3D(0, 0, 0),
    }, camNexus);
    camera = await Omosuen.newComponent('camera', {
      name: 'EditorCamera', viewportRef: 'EditorViewport',
      zoom: 0.5, axonometricAngle: 30, pixelScale: 2,
    }, camNexus);

    // Cell map (if present)
    if (data.cellMap) {
      initStatus.textContent = 'Building cell map...';
      var cmd = data.cellMap;
      var ms = new Omosuen.Vector3D(cmd.mapSize.x, cmd.mapSize.y, cmd.mapSize.z);
      var materialMap = new Omosuen.Array3D(ms, 0);
      var shapeMap = new Omosuen.Array3D(ms, 0);
      for (var idx = 0; idx < cmd.packedData.length; idx++) {
        var cell = Omosuen.unpackCell(cmd.packedData[idx]);
        materialMap.indexSet(idx, cell.materialIndex);
        shapeMap.indexSet(idx, cell.shapeIndex);
      }
      cellMap = await Omosuen.newComponent('cell-map', {
        name: cmd.componentName, materials: cmd.materials,
        materialMap: materialMap, shapeMap: shapeMap,
        cellSize: new Omosuen.Vector3D(cmd.cellSize.x, cmd.cellSize.y, cmd.cellSize.z),
        mapSize: ms, smoothing: cmd.smoothing || 0, normalSmoothing: cmd.normalSmoothing || 0,
      }, scene);

      // Center camera on cell map
      var mapWorldW = cmd.mapSize.x * cmd.cellSize.x;
      var mapWorldD = cmd.mapSize.z * cmd.cellSize.z;
      cameraTransform.position = new Omosuen.Vector3D(-mapWorldW / 2, 0, -mapWorldD / 2);
    }

    // Lights
    initStatus.textContent = 'Creating lights...';
    engineLights = [];
    var scLights = data.lights || [];
    for (var li = 0; li < scLights.length; li++) {
      var sl = scLights[li];
      var lightOpts = {
        name: sl.entityName + '_light', lightType: sl.lightType,
        color: new Omosuen.Vector3D(sl.color.x, sl.color.y, sl.color.z),
        brightness: sl.brightness,
      };
      if (sl.lightType === 'directional') {
        lightOpts.direction = new Omosuen.Vector3D(sl.direction.x, sl.direction.y, sl.direction.z);
      }
      if (sl.lightType === 'point' || sl.lightType === 'spot') {
        lightOpts.radius = sl.radius;
        lightOpts.hardness = sl.hardness;
        var lNexus = await Omosuen.newComponent('nexus', { name: sl.entityName + '_lightNexus' }, scene);
        var lTransform = await Omosuen.newComponent('transform', {
          name: sl.entityName + '_lightTransform',
          position: new Omosuen.Vector3D(sl.position.x, sl.position.y, sl.position.z),
        }, lNexus);
        var engineLight = await Omosuen.newComponent('light', lightOpts, lNexus);
        engineLights.push({ nexus: lNexus, light: engineLight, transform: lTransform });
      } else {
        var engineLight2 = await Omosuen.newComponent('light', lightOpts, scene);
        engineLights.push({ light: engineLight2 });
      }
    }

    // Sprite entities
    initStatus.textContent = 'Creating sprites...';
    engineEntities = {};
    var scEntities = data.entities || [];
    for (var ei = 0; ei < scEntities.length; ei++) {
      var se = scEntities[ei];
      if (!se.sprite || !se.sprite.albedoKey) continue;
      var eNexus = await Omosuen.newComponent('nexus', { name: se.name + '_editorNexus' }, scene);
      var eTransform = await Omosuen.newComponent('transform', {
        name: se.name + '_editorTransform',
        position: new Omosuen.Vector3D(se.position.x, se.position.y, se.position.z),
        rotation: new Omosuen.Vector3D(se.rotation.x, se.rotation.y, se.rotation.z),
        scale: new Omosuen.Vector3D(se.scale.x, se.scale.y, se.scale.z),
      }, eNexus);
      var spriteOpts = {
        name: se.name + '_editorSprite',
        textureMapKeys: { albedo: se.sprite.albedoKey, normal: '', emission: '', material: '' },
        frame: { albedo: se.sprite.frameIndex, normal: 0, emission: 0, material: 0 },
        anchor: new Omosuen.Vector2D(se.sprite.anchor.x, se.sprite.anchor.y),
        tint: new Omosuen.Vector4D(se.sprite.tint.x, se.sprite.tint.y, se.sprite.tint.z, se.sprite.tint.w),
        opacity: se.sprite.opacity,
      };
      var eSprite = await Omosuen.newComponent('sprite', spriteOpts, eNexus);

      var eAC = null;
      var acPrev = null;
      if (se.animationController && se.animationController.animations.length > 0) {
        var acData = se.animationController;
        eAC = await Omosuen.newComponent('animation-controller', {
          name: se.name + '_editorAnimCtrl',
          animations: acData.animations.map(function(a) {
            return {
              name: a.name, frames: a.frames.slice(),
              frameRate: a.frameRate, loop: a.loop, onComplete: a.onComplete,
            };
          }),
          channels: acData.channels.slice(),
          speed: acData.speed,
        }, eNexus);

        if (acData.currentAnimation) {
          eAC.play(acData.currentAnimation);
          if (acData.state === 'paused') eAC.pause();
          else if (acData.state === 'stopped') eAC.stop();
        }

        acPrev = {
          currentAnimation: acData.currentAnimation,
          state: acData.state,
          speed: acData.speed,
        };
      }

      engineEntities[se.id] = {
        nexus: eNexus, transform: eTransform, sprite: eSprite,
        animationController: eAC, acPrev: acPrev,
      };
    }

    // Input controller
    initStatus.textContent = 'Setting up controls...';
    inputController = await Omosuen.newComponent('input-controller', {
      name: 'EditorInput', preventDefault: false,
    }, scene);

    // Camera pan/zoom bindings
    var isPanning = false, lastMouseX = 0, lastMouseY = 0;
    var PAN_SENSITIVITY = 1.0, ZOOM_ACCEL = 0.003, ZOOM_ENTROPY = 10.75;
    var zoomVelocity = 0, scrollActive = false;

    inputController.onAction('middleMouseDown', function(event) {
      if (viewingSceneCamera && cameraLocked) return;
      isPanning = true; lastMouseX = event.clientX; lastMouseY = event.clientY;
    });
    inputController.onAction('middleMouseUp', function() { isPanning = false; });
    inputController.onAction('mouseMove', function(event) {
      if (!isPanning) return;
      var dx = event.clientX - lastMouseX, dy = event.clientY - lastMouseY;
      lastMouseX = event.clientX; lastMouseY = event.clientY;
      var zoomSq = camera.zoom * camera.zoom;
      camera.pan(dx * -PAN_SENSITIVITY / zoomSq, dy * -PAN_SENSITIVITY / zoomSq);
      if (viewingSceneCamera && sceneCameraEntity) {
        if (sceneCameraTransformRef) {
          sceneCameraTransformRef.position = new Omosuen.Vector3D(
            cameraTransform.position.x, cameraTransform.position.y, cameraTransform.position.z
          );
        }
        sceneCameraEntity.position.x = cameraTransform.position.x;
        sceneCameraEntity.position.y = cameraTransform.position.y;
        sceneCameraEntity.position.z = cameraTransform.position.z;
        updateSceneCameraFields();
      }
    });
    inputController.onAction('mouseWheel', function(event, deltaY) {
      if (viewingSceneCamera && cameraLocked) return;
      zoomVelocity += -deltaY * ZOOM_ACCEL;
      scrollActive = true;
      camera.setZoomTarget(event.clientX - viewport.offsetX, event.clientY - viewport.offsetY);
    });

    inputController.bindAction({ eventType: 'mousedown', button: 1, action: 'middleMouseDown' });
    inputController.bindAction({ eventType: 'mouseup', button: 1, action: 'middleMouseUp' });
    inputController.bindAction({ eventType: 'mousemove', action: 'mouseMove' });
    inputController.bindAction({ eventType: 'wheel', action: 'mouseWheel' });

    var lastFrameTime = performance.now();
    function zoomLoop() {
      var now = performance.now();
      var dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      if (zoomVelocity !== 0) {
        var newZoom = Math.max(0.1, Math.min(3.0, camera.zoom + zoomVelocity * dt));
        camera.setZoom(newZoom);
        if (viewingSceneCamera && sceneCameraEntity && sceneCameraRef) {
          sceneCameraRef.zoom = camera.zoom;
          sceneCameraEntity.camera.zoom = camera.zoom;
          updateSceneCameraFields();
        }
        if (!scrollActive) {
          var decay = Math.sign(zoomVelocity) * ZOOM_ENTROPY * Math.abs(zoomVelocity) * dt;
          zoomVelocity -= decay;
          if (Math.abs(zoomVelocity) < 0.0001) { zoomVelocity = 0; camera.resetZoomTarget(); }
        }
      }
      scrollActive = false;
      requestAnimationFrame(zoomLoop);
    }
    requestAnimationFrame(zoomLoop);

    // If no lights were in the scene, add default editor lighting
    if (scLights.length === 0) {
      await Omosuen.newComponent('light', {
        name: 'EditorAmbient', lightType: 'ambient',
        color: new Omosuen.Vector3D(1.0, 0.95, 0.8), brightness: 0.4,
      }, scene);
      var dlNexus = await Omosuen.newComponent('nexus', { name: 'EditorDirNexus' }, scene);
      await Omosuen.newComponent('light', {
        name: 'EditorDir', lightType: 'directional',
        color: new Omosuen.Vector3D(0.7, 0.85, 1.0), brightness: 0.6,
        direction: new Omosuen.Vector3D(0.5, -0.7, 0.3),
      }, dlNexus);
    }

    // Register and start
    initStatus.textContent = 'Starting engine...';
    Omosuen.registerScene('editor', scene);
    await Omosuen.switchScene('editor');
    Omosuen.start(60);

    // Poll for init completion
    var pollId = setInterval(function() {
      var qLen = Omosuen.getInitQueueLength();
      if (qLen === -1) {
        var activeScene = Omosuen.getActiveScene();
        if (activeScene) {
          clearInterval(pollId);
          engineReady = true;
          initStatus.textContent = '';
          // Start gizmo render loop
          requestAnimationFrame(renderGizmos);
        }
      } else {
        var qSize = Omosuen.getInitQueueSize();
        initStatus.textContent = 'Initializing ' + (qLen - qSize) + '/' + qLen + '...';
      }
    }, 100);
  }

  // ── Engine Scene Updates (live patching) ────────────────────
  function updateEngineScene(data) {
    // Cell-map updates
    if (cellMap && data.cellMap) {
      var cmd = data.cellMap;

      // Detect mapSize change — requires full scene recreation
      if (cellMapData && (
        cmd.mapSize.x !== cellMapData.mapSize.x ||
        cmd.mapSize.y !== cellMapData.mapSize.y ||
        cmd.mapSize.z !== cellMapData.mapSize.z
      )) {
        engineReady = false;
        cellMap = null;
        cellMapData = cmd;
        createEditorScene(data).catch(function(err) {
          initStatus.textContent = 'Error: ' + err.message;
          console.error('[Editor] Scene recreation failed:', err);
        });
        return;
      }

      // Patch live-updatable properties
      cellMap.smoothing = cmd.smoothing || 0;
      cellMap.normalSmoothing = cmd.normalSmoothing || 0;
      cellMap.cellSize = new Omosuen.Vector3D(cmd.cellSize.x, cmd.cellSize.y, cmd.cellSize.z);

      // Update packed data → materialMap + shapeMap
      for (var idx = 0; idx < cmd.packedData.length; idx++) {
        var cell = Omosuen.unpackCell(cmd.packedData[idx]);
        cellMap.materialMap.indexSet(idx, cell.materialIndex);
        cellMap.shapeMap.indexSet(idx, cell.shapeIndex);
      }

      // Mark ALL chunks dirty so rebuildDirtyChunks() regenerates meshes
      for (var ci = 0; ci < cellMap.chunks.length; ci++) {
        cellMap.chunks[ci].dirty = true;
      }

      // Update webview cellMapData to reflect latest inspector state
      cellMapData = cmd;
    }

    // Entity transform updates
    var scEntities = data.entities || [];
    for (var ei = 0; ei < scEntities.length; ei++) {
      var se = scEntities[ei];
      var eng = engineEntities[se.id];
      if (eng && eng.transform) {
        eng.transform.position = new Omosuen.Vector3D(se.position.x, se.position.y, se.position.z);
        eng.transform.rotation = new Omosuen.Vector3D(se.rotation.x, se.rotation.y, se.rotation.z);
        eng.transform.scale = new Omosuen.Vector3D(se.scale.x, se.scale.y, se.scale.z);
      }
      if (eng && eng.sprite && se.sprite) {
        eng.sprite.opacity = se.sprite.opacity;
        eng.sprite.tint = new Omosuen.Vector4D(se.sprite.tint.x, se.sprite.tint.y, se.sprite.tint.z, se.sprite.tint.w);
      }
      if (eng && eng.animationController && se.animationController) {
        var eAC2 = eng.animationController;
        var prev = eng.acPrev || { currentAnimation: null, state: 'stopped', speed: 1 };
        var next = se.animationController;

        if (next.speed !== prev.speed) eAC2.setSpeed(next.speed);

        var animChanged = next.currentAnimation !== prev.currentAnimation;
        var stateChanged = next.state !== prev.state;

        if (animChanged || stateChanged) {
          if (!next.currentAnimation) {
            eAC2.stop();
            eAC2.currentAnimation = null;
          } else if (animChanged) {
            eAC2.play(next.currentAnimation, true);
            if (next.state === 'paused') eAC2.pause();
            else if (next.state === 'stopped') eAC2.stop();
          } else {
            if (next.state === 'playing') eAC2.play(next.currentAnimation);
            else if (next.state === 'paused') eAC2.pause();
            else eAC2.stop();
          }
        }

        eng.acPrev = {
          currentAnimation: next.currentAnimation,
          state: next.state,
          speed: next.speed,
        };
      }
    }

    // Light updates — mutate existing Vector3D properties in-place
    // to avoid Proxy set overhead (get returns the live object, mutate directly)
    var scLights = data.lights || [];
    for (var li = 0; li < scLights.length && li < engineLights.length; li++) {
      var sl = scLights[li];
      var el = engineLights[li];
      if (!el || !el.light) continue;
      var lc = el.light.color;
      lc.x = sl.color.x; lc.y = sl.color.y; lc.z = sl.color.z;
      el.light.brightness = sl.brightness;
      if (sl.lightType === 'point' || sl.lightType === 'spot') {
        el.light.radius = sl.radius;
        el.light.hardness = sl.hardness;
        if (el.transform) {
          var lp = el.transform.position;
          lp.x = sl.position.x; lp.y = sl.position.y; lp.z = sl.position.z;
        }
      }
      if (sl.lightType === 'directional') {
        var ld = el.light.direction;
        ld.x = sl.direction.x; ld.y = sl.direction.y; ld.z = sl.direction.z;
      }
    }
  }

  // ── Cell-Map Editing ───────────────────────────────────────
  function buildPalette() {
    if (!cellMapData) return;
    paletteEl.innerHTML = '';
    for (var i = 0; i < cellMapData.materials.length; i++) {
      var item = document.createElement('div');
      item.className = 'palette-item' + (i === selectedMaterial ? ' selected' : '');
      var tc = document.createElement('canvas');
      tc.width = 48; tc.height = 48;
      drawPaletteSwatch(tc.getContext('2d'), 48, 48, i);
      item.appendChild(tc);
      var idx = document.createElement('span');
      idx.className = 'pal-idx'; idx.textContent = String(i);
      item.appendChild(idx);
      item.addEventListener('click', (function(index) {
        return function() { selectedMaterial = index; buildPalette(); };
      })(i));
      paletteEl.appendChild(item);
    }
  }

  function drawPaletteSwatch(tctx, w, h, matIdx) {
    var img = matIdx < materialImages.length ? materialImages[matIdx] : null;
    if (!img) {
      tctx.fillStyle = '#555';
      tctx.fillRect(0, 0, w, h);
      tctx.fillStyle = '#888';
      tctx.font = "10px 'IBM Plex Mono', monospace";
      tctx.textAlign = 'center';
      tctx.fillText(String(matIdx), w / 2, h / 2 + 3);
      return;
    }

    var mat = cellMapData.materials[matIdx];
    var frameRect = null;
    if (mat && mat.albedoTextureKey) {
      for (var ti = 0; ti < editorTextures.length; ti++) {
        if (editorTextures[ti].textureMapKey === mat.albedoTextureKey && editorTextures[ti].imageType) {
          var it = editorTextures[ti].imageType;
          if (it.mode === 'grid') {
            var frame = mat.albedoFrame || 0;
            var col = frame % it.cols;
            var row = Math.floor(frame / it.cols);
            frameRect = { x: col * it.cellWidth, y: row * it.cellHeight, w: it.cellWidth, h: it.cellHeight };
          } else if (it.mode === 'framemap' && Array.isArray(it.frames)) {
            var fi = mat.albedoFrame || 0;
            if (fi < it.frames.length) {
              frameRect = it.frames[fi];
            }
          }
          break;
        }
      }
    }

    if (frameRect) {
      tctx.drawImage(img, frameRect.x, frameRect.y, frameRect.w, frameRect.h, 0, 0, w, h);
    } else {
      tctx.drawImage(img, 0, 0, w, h);
    }
  }

  function updateBrushTarget(sx, sy) {
    if (!cellMap || !cellMapData || !engineReady) return;
    var canvasEl = viewport.canvas;
    var rect = canvasEl.getBoundingClientRect();
    var mx = sx - rect.left, my = sy - rect.top;
    brushTarget = null;
    var cs = cellMapData.cellSize;
    var ms = cellMapData.mapSize;
    var world = screenToWorld(mx, my, brushHeight * cs.y);
    var cx = Math.floor(world.x / cs.x), cz = Math.floor(world.z / cs.z);
    if (cx >= 0 && cx < ms.x && cz >= 0 && cz < ms.z) {
      brushTarget = { x: cx, y: brushHeight, z: cz };
    }
  }

  function placeCell() {
    if (!brushTarget || !cellMap || !engineReady) return;
    cellMap.setCellData(new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z),
      { materialIndex: selectedMaterial, shapeIndex: 1, emissionIntensity: 0, visible: true });
    emitMapChange();
  }

  function removeCell() {
    if (!brushTarget || !cellMap || !engineReady) return;
    cellMap.setCellData(new Omosuen.Vector3D(brushTarget.x, brushTarget.y, brushTarget.z),
      { materialIndex: 0, shapeIndex: 0, emissionIntensity: 0, visible: true });
    emitMapChange();
  }

  function emitMapChange() {
    if (!cellMap || !cellMapData) return;
    suppressNextUpdate = true;
    var flat = [];
    cellMap.packedData.forEach(function(val) { flat.push(val); });
    vscode.postMessage({ type: 'mapChanged', packedData: flat, cellMapId: cellMapData.componentId });
  }

  function toggleCellEditMode() {
    if (!cellMapData) return;
    cellEditMode = !cellEditMode;
    controlBar.className = 'control-bar' + (cellEditMode ? ' visible' : '');
    paletteEl.className = 'palette' + (cellEditMode ? ' visible' : '');
  }

  // ── Helper: get current zoom² ─────────────────────────────
  function getZoomSq() {
    if (!camera) return 1;
    return camera.zoom * camera.zoom;
  }

  // ── Mouse Handlers ──────────────────────────────────────────
  gizmoCanvas.addEventListener('mousedown', function(e) {
    if (!engineReady) return;
    if (e.target.closest('.control-bar') || e.target.closest('.palette')) return;

    // Cell edit mode takes priority
    if (cellEditMode) {
      if (e.button === 0) { e.preventDefault(); placeCell(); }
      else if (e.button === 2) { e.preventDefault(); removeCell(); }
      return;
    }

    // Gizmo drag start — only for selected entity, left button
    if (e.button === 0 && selectedEntityId >= 0) {
      var rect = gizmoCanvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for (var i = 0; i < entities.length; i++) {
        var ent = entities[i];
        if (ent.id !== selectedEntityId) continue;
        var sp = worldToScreen(ent.position.x, ent.position.y, ent.position.z);
        var hit = hitTestEntityGizmo(mx, my, sp.x, sp.y);
        if (hit) {
          e.preventDefault();
          draggingAxis = hit;
          dragStartMouse = { x: mx, y: my };
          dragStartPosition = { x: ent.position.x, y: ent.position.y, z: ent.position.z };
          dragEntityId = ent.id;
          gizmoCanvas.style.cursor = 'grabbing';
        }
        break;
      }
    }
  });

  gizmoCanvas.addEventListener('mousemove', function(e) {
    if (!engineReady) return;

    // Cell edit mode brush tracking
    if (cellEditMode && cellMapData && cellMap) {
      updateBrushTarget(e.clientX, e.clientY);
      if (cursorInfoEl) {
        cursorInfoEl.textContent = brushTarget
          ? 'Cell: ' + brushTarget.x + ',' + brushTarget.y + ',' + brushTarget.z + ' | Mat: ' + selectedMaterial
          : '';
      }
      return;
    }

    var rect = gizmoCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;

    // Active drag — update position
    if (draggingAxis && dragStartMouse && dragStartPosition && dragEntityId !== null) {
      var dx = mx - dragStartMouse.x, dy = my - dragStartMouse.y;
      var dir = getAxisDirs(getAngleValues())[draggingAxis];
      var projected = dx * dir.x + dy * dir.y;
      var worldDelta = projected / getZoomSq();

      // Find and update the entity position
      for (var i = 0; i < entities.length; i++) {
        if (entities[i].id !== dragEntityId) continue;
        entities[i].position.x = dragStartPosition.x + (draggingAxis === 'x' ? worldDelta : 0);
        entities[i].position.y = dragStartPosition.y + (draggingAxis === 'y' ? worldDelta : 0);
        entities[i].position.z = dragStartPosition.z + (draggingAxis === 'z' ? worldDelta : 0);

        // Live engine feedback — mutate transform position in-place
        var ee = engineEntities[dragEntityId];
        if (ee && ee.transform) {
          var tp = ee.transform.position;
          tp.x = entities[i].position.x;
          tp.y = entities[i].position.y;
          tp.z = entities[i].position.z;
        }
        break;
      }
      return;
    }

    // Hover detection — only for selected entity
    if (selectedEntityId >= 0 && !cellEditMode) {
      for (var i = 0; i < entities.length; i++) {
        var ent = entities[i];
        if (ent.id !== selectedEntityId) continue;
        var sp = worldToScreen(ent.position.x, ent.position.y, ent.position.z);
        var hit = hitTestEntityGizmo(mx, my, sp.x, sp.y);
        if (hit !== hoveredAxis) {
          hoveredAxis = hit;
          gizmoCanvas.style.cursor = hit ? 'pointer' : 'default';
        }
        break;
      }
    }
  });

  gizmoCanvas.addEventListener('mouseup', function(e) {
    if (draggingAxis && dragEntityId !== null) {
      // Find the entity to get final position + transformId
      for (var i = 0; i < entities.length; i++) {
        if (entities[i].id !== dragEntityId) continue;
        var ent = entities[i];
        if (ent.transformId !== undefined) {
          suppressNextUpdate = true;
          vscode.postMessage({
            type: 'transformChanged',
            transformId: ent.transformId,
            position: { _vectorType: 'Vector3D', x: ent.position.x, y: ent.position.y, z: ent.position.z },
          });
        }
        break;
      }
      draggingAxis = null;
      dragStartMouse = null;
      dragStartPosition = null;
      dragEntityId = null;
      gizmoCanvas.style.cursor = hoveredAxis ? 'pointer' : 'default';
    }
  });

  gizmoCanvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  // Keyboard: T to toggle cell edit mode, q/+/ArrowUp and a/-/ArrowDown for brush height
  document.addEventListener('keydown', function(e) {
    if (e.key === 't' || e.key === 'T') { toggleCellEditMode(); return; }
    if (!cellMapData) return;
    if (e.key === 'ArrowUp' || e.key === 'q' || e.key === 'Q' || e.key === '+') {
      e.preventDefault();
      brushHeight = Math.min(cellMapData.mapSize.y - 1, brushHeight + 1);
      heightVal.textContent = String(brushHeight);
    } else if (e.key === 'ArrowDown' || e.key === 'a' || e.key === 'A' || e.key === '-') {
      e.preventDefault();
      brushHeight = Math.max(0, brushHeight - 1);
      heightVal.textContent = String(brushHeight);
    }
  });

  heightDown.addEventListener('click', function() {
    if (!cellMapData) return;
    brushHeight = Math.max(0, brushHeight - 1); heightVal.textContent = String(brushHeight);
  });
  heightUp.addEventListener('click', function() {
    if (!cellMapData) return;
    brushHeight = Math.min(cellMapData.mapSize.y - 1, brushHeight + 1); heightVal.textContent = String(brushHeight);
  });

  // ── Resize ────────────────────────────────────────────────
  window.addEventListener('resize', function() {
    if (viewport && camera) { viewport.resize(window.innerWidth, window.innerHeight); }
  });

  // ── Message Handler ───────────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'scene:data') {
      entities = msg.entities || [];
      colliders = msg.colliders || [];
      lights = msg.lights || [];
      cellMapData = msg.cellMap || null;
      textureMapUris = msg.textureMapUris || [];
      sceneName = msg.name || '';

      infoEl.textContent = sceneName
        ? sceneName + ' \\u2014 ' + entities.length + ' entities'
        : 'Editor Preview';

      populateCameraDropdown();

      if (!engineReady && hasEngine) {
        // First load — create engine scene
        createEditorScene(msg).catch(function(err) {
          initStatus.textContent = 'Error: ' + err.message;
          console.error('[Editor] Scene creation failed:', err);
        });

        // Load material texture swatches
        editorTextures = msg.textures || [];
        if (cellMapData) {
          materialImages = [];
          for (var i = 0; i < cellMapData.materials.length; i++) {
            var dataUri = (cellMapData.materialImageDataUris && cellMapData.materialImageDataUris[i]) || null;
            if (dataUri) {
              (function(index, uri) {
                var img = new Image();
                img.onload = function() {
                  materialImages[index] = img;
                  buildPalette();
                };
                img.src = uri;
              })(i, dataUri);
            }
          }
          buildPalette();
        }
      } else if (engineReady) {
        // Subsequent update — patch engine components
        if (suppressNextUpdate) {
          suppressNextUpdate = false;
        } else {
          updateEngineScene(msg);
        }
      }
    }
    if (msg.type === 'selection:changed') {
      selectedEntityId = msg.selectedId !== undefined ? msg.selectedId : -1;
      var ct = msg.componentType;
      var showCameraBar = !ct || ct === 'nexus' || ct === 'viewport' || ct === 'camera';
      document.getElementById('camera-toolbar').style.display = showCameraBar ? 'flex' : 'none';
    }
    if (msg.type === 'cellmap:editMode') {
      if (msg.enabled && cellMapData && !cellEditMode) {
        toggleCellEditMode();
      } else if (!msg.enabled && cellEditMode) {
        toggleCellEditMode();
      }
    }
    if (msg.type === 'audioEditor:enter') {
      enterAudioEditorScene(msg.effectData, msg.effectId, msg.tracks || []);
    }
    if (msg.type === 'audioEditor:exit') {
      exitAudioEditorScene();
    }
    if (msg.type === 'audioEditor:propertyUpdate' && audioEditorActive) {
      updateAudioEditorSlider(msg.property, msg.value);
    }
  });

  // ── Camera Toolbar Events ────────────────────────────────────
  cameraSelect.addEventListener('change', function() {
    if (this.value === 'editor') {
      switchToEditorCamera();
    } else {
      switchToSceneCamera(parseInt(this.value, 10));
    }
  });

  document.getElementById('camera-lock').addEventListener('click', function() {
    cameraLocked = !cameraLocked;
    updateLockButton();
  });

  document.getElementById('ed-pixel-scale').addEventListener('change', function() {
    if (!camera) return;
    var val = parseFloat(this.value);
    camera.pixelScale = (isNaN(val) || val < 1) ? 2 : val;
    savedEditorPixelScale = camera.pixelScale;
  });
  document.getElementById('ed-axo-angle').addEventListener('change', function() {
    if (!camera) return;
    var val = parseFloat(this.value);
    camera.axonometricAngle = isNaN(val) ? 30 : val;
    savedEditorAngle = camera.axonometricAngle;
  });

  document.getElementById('sc-zoom').addEventListener('change', function() {
    if (!sceneCameraEntity || !camera) return;
    var val = parseFloat(this.value);
    if (isNaN(val) || val <= 0) val = 1;
    sceneCameraEntity.camera.zoom = val;
    camera.zoom = val;
    if (sceneCameraRef) sceneCameraRef.zoom = val;
    postCameraPropertyChange('zoom', val);
  });
  document.getElementById('sc-pixel-scale').addEventListener('change', function() {
    if (!sceneCameraEntity || !camera) return;
    var val = parseFloat(this.value);
    if (isNaN(val) || val < 1) val = 2;
    sceneCameraEntity.camera.pixelScale = val;
    camera.pixelScale = val;
    if (sceneCameraRef) sceneCameraRef.pixelScale = val;
    postCameraPropertyChange('pixelScale', val);
  });
  document.getElementById('sc-axo-angle').addEventListener('change', function() {
    if (!sceneCameraEntity || !camera) return;
    var val = parseFloat(this.value);
    if (isNaN(val)) val = 30;
    sceneCameraEntity.camera.axonometricAngle = val;
    camera.axonometricAngle = val;
    if (sceneCameraRef) sceneCameraRef.axonometricAngle = val;
    postCameraPropertyChange('axonometricAngle', val);
  });

  function handlePositionFieldChange() {
    if (!sceneCameraEntity || !cameraTransform) return;
    var px = parseFloat(document.getElementById('sc-pos-x').value) || 0;
    var py = parseFloat(document.getElementById('sc-pos-y').value) || 0;
    var pz = parseFloat(document.getElementById('sc-pos-z').value) || 0;
    sceneCameraEntity.position.x = px;
    sceneCameraEntity.position.y = py;
    sceneCameraEntity.position.z = pz;
    cameraTransform.position = new Omosuen.Vector3D(px, py, pz);
    if (sceneCameraTransformRef) {
      sceneCameraTransformRef.position = new Omosuen.Vector3D(px, py, pz);
    }
    if (sceneCameraEntity.transformId !== undefined) {
      vscode.postMessage({
        type: 'transformChanged',
        transformId: sceneCameraEntity.transformId,
        position: { _vectorType: 'Vector3D', x: px, y: py, z: pz },
      });
    }
  }
  document.getElementById('sc-pos-x').addEventListener('change', handlePositionFieldChange);
  document.getElementById('sc-pos-y').addEventListener('change', handlePositionFieldChange);
  document.getElementById('sc-pos-z').addEventListener('change', handlePositionFieldChange);

  // ── Audio Editor ────────────────────────────────────────────
  var aeOverlay = document.getElementById('audio-editor');
  var aeTrackSelect = document.getElementById('ae-track-select');
  var aeStatusEl = document.getElementById('ae-status');
  var aeTimeEl = document.getElementById('ae-time');
  var aeLengthEl = document.getElementById('ae-length');
  var aeSeekSlider = document.getElementById('ae-seek');
  var aeEqWrap = document.getElementById('ae-eq-wrap');

  function aeFormatTime(ms) {
    var totalSec = Math.floor(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  // Hexagon helpers
  function aeHexVertex(index) {
    var angle = (Math.PI / 2) + (index * Math.PI / 3);
    return {
      x: AE_HEX_CX + AE_HEX_RADIUS * Math.cos(angle),
      y: AE_HEX_CY - AE_HEX_RADIUS * Math.sin(angle)
    };
  }

  function aeHexPoints() {
    return Array.from({ length: 6 }, function(_, i) {
      var v = aeHexVertex(i);
      return v.x + ',' + v.y;
    }).join(' ');
  }

  function aePointInHexagon(px, py) {
    var verts = Array.from({ length: 6 }, function(_, i) { return aeHexVertex(i); });
    var inside = false;
    for (var i = 0, j = 5; i < 6; j = i++) {
      var xi = verts[i].x, yi = verts[i].y;
      var xj = verts[j].x, yj = verts[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function aeClampToHexagon(px, py) {
    if (aePointInHexagon(px, py)) return { x: px, y: py };
    var verts = Array.from({ length: 6 }, function(_, i) { return aeHexVertex(i); });
    var bestX = AE_HEX_CX, bestY = AE_HEX_CY, bestDist = Infinity;
    for (var i = 0; i < 6; i++) {
      var a = verts[i], b = verts[(i + 1) % 6];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
      var cx = a.x + t * dx, cy = a.y + t * dy;
      var d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
      if (d < bestDist) { bestDist = d; bestX = cx; bestY = cy; }
    }
    return { x: bestX, y: bestY };
  }

  // Build EQ bands
  function aeBuildEqBands(mixValues) {
    aeEqWrap.innerHTML = '';
    for (var i = 0; i < AE_EQ_BANDS; i++) {
      var band = document.createElement('div');
      band.className = 'ae-eq-band';
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-100';
      slider.max = '100';
      slider.value = String(Math.round((mixValues[i] || 0) * 100));
      slider.dataset.bandIndex = String(i);
      slider.addEventListener('input', function(e) {
        var idx = parseInt(e.target.dataset.bandIndex, 10);
        var val = parseInt(e.target.value, 10) / 100;
        if (audioTrackController) {
          audioTrackController.setMixBand(idx, val);
        }
        aeNotifyChange('mix.' + idx, val);
      });
      var label = document.createElement('span');
      label.textContent = String(i + 1);
      band.appendChild(slider);
      band.appendChild(label);
      aeEqWrap.appendChild(band);
    }
  }

  // Set hex polygon points
  function aeInitHex() {
    var poly = document.getElementById('ae-hex-poly');
    if (poly) poly.setAttribute('points', aeHexPoints());
    // Add hex labels
    var svg = document.getElementById('ae-hex-svg');
    if (!svg) return;
    var labels = ['FC', 'FR', 'RR', 'RC', 'RL', 'FL'];
    for (var i = 0; i < 6; i++) {
      var v = aeHexVertex(i);
      var offsetX = (i === 0 || i === 3) ? 0 : (i < 3 ? 12 : -12);
      var offsetY = i === 0 ? -10 : (i === 3 ? 15 : 0);
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(v.x + offsetX));
      text.setAttribute('y', String(v.y + offsetY));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('class', 'hex-label');
      text.textContent = labels[i];
      svg.appendChild(text);
    }
  }

  function aeNotifyChange(property, value) {
    vscode.postMessage({
      type: 'audioEffectChanged',
      effectId: audioEffectId,
      property: property,
      value: value,
    });
  }

  function aeUpdateTransportStatus(status) {
    if (aeStatusEl) aeStatusEl.textContent = status;
  }

  async function enterAudioEditorScene(effectData, effectId, tracks) {
    if (!hasEngine || audioEditorActive) return;
    audioEditorActive = true;
    audioEffectId = effectId;

    // Show overlay, hide other UI
    aeOverlay.classList.add('visible');
    document.getElementById('camera-toolbar').style.display = 'none';
    if (cellEditMode) toggleCellEditMode();
    gizmoCanvas.style.display = 'none';

    // Create audio editor scene
    var scene = await Omosuen.newComponent('nexus', { name: 'AudioEditorScene' });
    audioEditorScene = scene;

    // Audio player (GLOBAL unique)
    audioPlayer = await Omosuen.newComponent('audio-player', {
      name: 'EditorAudioPlayer',
      masterVolume: 1.0,
      muted: false,
    }, scene);

    // Audio effect
    audioEffect = await Omosuen.newComponent('audio-effect', {
      name: effectData.name || 'EditorEffect',
      pitchShift: effectData.pitchShift || 0,
      speedShift: effectData.speedShift || 1.0,
      reverb: effectData.reverb || 0,
      mix: effectData.mix ? effectData.mix.slice() : [],
      volume: effectData.volume !== undefined ? effectData.volume : 1.0,
      pan: effectData.pan || 0,
      spatial: !!effectData.spatial,
      spatialX: effectData.spatialX || 0,
      spatialY: effectData.spatialY || 0,
      spatialZ: effectData.spatialZ || 0,
      transitionBuffer: effectData.transitionBuffer ?? 150,
    }, scene);

    // Audio tracks
    audioTracks = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var engineTrack = await Omosuen.newComponent('audio-track', {
        name: t.name,
        filePath: t.fileUri,
      }, scene);
      audioTracks.push({ name: t.name, fileUri: t.fileUri, engineTrack: engineTrack });
    }

    // Register and switch scene
    Omosuen.registerScene('audio-editor', scene);
    await Omosuen.switchScene('audio-editor');

    // Populate track dropdown
    aeTrackSelect.innerHTML = '';
    if (audioTracks.length === 0) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No tracks available';
      aeTrackSelect.appendChild(opt);
    } else {
      for (var j = 0; j < audioTracks.length; j++) {
        var opt2 = document.createElement('option');
        opt2.value = String(j);
        opt2.textContent = audioTracks[j].name;
        aeTrackSelect.appendChild(opt2);
      }
    }

    // Wait for audio-player init (AudioContext creation) before creating TrackController
    var aeInitPoll = setInterval(function() {
      var qLen = Omosuen.getInitQueueLength();
      if (qLen === -1) {
        clearInterval(aeInitPoll);
        aeCreateTrackController();
      }
    }, 100);

    // Set up sliders from effect data
    aeSetSliders(effectData);

    // Build EQ
    var mix = effectData.mix || [];
    while (mix.length < AE_EQ_BANDS) mix.push(0);
    aeBuildEqBands(mix);

    // Init hex
    aeInitHex();
    aeUpdateHexDot(effectData.spatialX || 0, effectData.spatialZ || 0);

    // Set mode
    audioIsSurround = !!effectData.spatial;
    aeUpdateModeUI();

    // Start position timer
    aeUpdateTransportStatus('STOPPED');
    audioTimerInterval = setInterval(function() {
      if (!audioTrackController || audioIsSeeking) return;
      var pos = audioTrackController.trackPosition();
      var len = audioTrackController.trackLength();
      if (aeTimeEl) aeTimeEl.textContent = aeFormatTime(pos);
      if (len > 0 && aeSeekSlider) {
        aeSeekSlider.value = String(Math.round(pos / len * 1000));
      }
    }, 200);
  }

  function aeCreateTrackController() {
    audioTrackController = null;
    var idx = parseInt(aeTrackSelect.value, 10);
    if (isNaN(idx) || idx < 0 || idx >= audioTracks.length) return;
    var track = audioTracks[idx];
    audioTrackController = new Omosuen.TrackController(
      audioPlayer, track.engineTrack, audioEffect, true
    );
    // Update length display
    setTimeout(function() {
      if (audioTrackController) {
        var len = audioTrackController.trackLength();
        if (aeLengthEl) aeLengthEl.textContent = aeFormatTime(len);
      }
    }, 500);
  }

  function exitAudioEditorScene() {
    if (!audioEditorActive) return;
    audioEditorActive = false;

    // Stop playback
    if (audioTrackController) {
      try { audioTrackController.stop(); } catch(e) {}
      audioTrackController = null;
    }

    // Clear timer
    if (audioTimerInterval) {
      clearInterval(audioTimerInterval);
      audioTimerInterval = null;
    }

    // Switch back to editor scene
    if (hasEngine && engineReady) {
      Omosuen.unregisterScene('audio-editor');
      Omosuen.switchScene('editor').catch(function() {});
    }

    // Clean up
    audioPlayer = null;
    audioEffect = null;
    audioTracks = [];
    audioEditorScene = null;
    audioEffectId = null;

    // Hide overlay, restore UI
    aeOverlay.classList.remove('visible');
    gizmoCanvas.style.display = '';
    document.getElementById('camera-toolbar').style.display = 'flex';
    aeUpdateTransportStatus('STOPPED');
    if (aeTimeEl) aeTimeEl.textContent = '00:00';
    if (aeLengthEl) aeLengthEl.textContent = '00:00';
    if (aeSeekSlider) aeSeekSlider.value = '0';
  }

  function aeSetSliders(data) {
    var pitch = document.getElementById('ae-pitch');
    var speed = document.getElementById('ae-speed');
    var reverb = document.getElementById('ae-reverb');
    var volume = document.getElementById('ae-volume');
    var pan = document.getElementById('ae-pan');
    var transition = document.getElementById('ae-transition');

    if (pitch) { pitch.value = String(Math.round((data.pitchShift || 0) * 10)); }
    if (speed) { speed.value = String(Math.round((data.speedShift || 1) * 100)); }
    if (reverb) { reverb.value = String(Math.round((data.reverb || 0) * 100)); }
    if (volume) { volume.value = String(Math.round((data.volume !== undefined ? data.volume : 1) * 100)); }
    if (pan) { pan.value = String(Math.round((data.pan || 0) * 100)); }
    if (transition) { transition.value = String(data.transitionBuffer ?? 150); }

    aeUpdateSliderDisplays(data);
  }

  function aeUpdateSliderDisplays(data) {
    var pitchVal = document.getElementById('ae-pitch-val');
    var speedVal = document.getElementById('ae-speed-val');
    var reverbVal = document.getElementById('ae-reverb-val');
    var volumeVal = document.getElementById('ae-volume-val');
    var panVal = document.getElementById('ae-pan-val');
    var transitionVal = document.getElementById('ae-transition-val');

    if (pitchVal) pitchVal.textContent = (data.pitchShift || 0).toFixed(1) + ' st';
    if (speedVal) speedVal.textContent = (data.speedShift || 1).toFixed(2) + 'x';
    if (reverbVal) reverbVal.textContent = (data.reverb || 0).toFixed(2);
    if (volumeVal) volumeVal.textContent = (data.volume !== undefined ? data.volume : 1).toFixed(2);
    if (panVal) panVal.textContent = (data.pan || 0).toFixed(2);
    if (transitionVal) transitionVal.textContent = (data.transitionBuffer ?? 150) + ' ms';

    // Spatial readout
    var sx = document.getElementById('ae-spatial-x');
    var sy = document.getElementById('ae-spatial-y');
    var sz = document.getElementById('ae-spatial-z');
    if (sx) sx.textContent = (data.spatialX || 0).toFixed(2);
    if (sy) sy.textContent = (data.spatialY || 0).toFixed(2);
    if (sz) sz.textContent = (data.spatialZ || 0).toFixed(2);
  }

  function updateAudioEditorSlider(property, value) {
    // Called when inspector changes a property — update slider to match
    var data = {};
    data[property] = value;
    switch (property) {
      case 'pitchShift':
        var pitch = document.getElementById('ae-pitch');
        if (pitch) pitch.value = String(Math.round(value * 10));
        if (audioTrackController) audioTrackController.pitchShift = value;
        break;
      case 'speedShift':
        var speed = document.getElementById('ae-speed');
        if (speed) speed.value = String(Math.round(value * 100));
        if (audioTrackController) audioTrackController.speedShift = value;
        break;
      case 'reverb':
        var rev = document.getElementById('ae-reverb');
        if (rev) rev.value = String(Math.round(value * 100));
        if (audioTrackController) audioTrackController.reverb = value;
        break;
      case 'volume':
        var vol = document.getElementById('ae-volume');
        if (vol) vol.value = String(Math.round(value * 100));
        if (audioTrackController) audioTrackController.volume = value;
        break;
      case 'pan':
        var panSlider = document.getElementById('ae-pan');
        if (panSlider) panSlider.value = String(Math.round(value * 100));
        if (audioTrackController) audioTrackController.pan = value;
        break;
      case 'spatial':
        audioIsSurround = !!value;
        aeUpdateModeUI();
        if (audioTrackController) audioTrackController.spatial = !!value;
        break;
      case 'transitionBuffer':
        var tb = document.getElementById('ae-transition');
        if (tb) tb.value = String(value);
        break;
    }
    aeUpdateSliderDisplays(data);
  }

  function aeUpdateHexDot(sx, sz) {
    var dot = document.getElementById('ae-hex-dot');
    if (!dot) return;
    dot.setAttribute('cx', String(AE_HEX_CX + sx * AE_HEX_RADIUS));
    dot.setAttribute('cy', String(AE_HEX_CY - sz * AE_HEX_RADIUS));
  }

  function aeUpdateModeUI() {
    var stereoBtn = document.getElementById('ae-stereo');
    var surroundBtn = document.getElementById('ae-surround');
    var stereoPanel = document.getElementById('ae-stereo-panel');
    var surroundPanel = document.getElementById('ae-surround-panel');
    if (audioIsSurround) {
      if (stereoBtn) stereoBtn.classList.remove('active');
      if (surroundBtn) surroundBtn.classList.add('active');
      if (stereoPanel) stereoPanel.style.display = 'none';
      if (surroundPanel) surroundPanel.style.display = '';
    } else {
      if (stereoBtn) stereoBtn.classList.add('active');
      if (surroundBtn) surroundBtn.classList.remove('active');
      if (stereoPanel) stereoPanel.style.display = '';
      if (surroundPanel) surroundPanel.style.display = 'none';
    }
  }

  // ── Audio Editor Event Wiring ──────────────────────────────────
  document.getElementById('ae-play').addEventListener('click', function() {
    if (!audioTrackController) return;
    audioTrackController.play();
    aeUpdateTransportStatus('PLAYING');
  });

  document.getElementById('ae-pause').addEventListener('click', function() {
    if (!audioTrackController) return;
    audioTrackController.pause();
    aeUpdateTransportStatus('PAUSED');
  });

  document.getElementById('ae-stop').addEventListener('click', function() {
    if (!audioTrackController) return;
    audioTrackController.stop();
    aeUpdateTransportStatus('STOPPED');
  });

  aeTrackSelect.addEventListener('change', function() {
    if (audioTrackController) {
      try { audioTrackController.stop(); } catch(e) {}
    }
    aeCreateTrackController();
    aeUpdateTransportStatus('STOPPED');
  });

  aeSeekSlider.addEventListener('mousedown', function() { audioIsSeeking = true; });
  aeSeekSlider.addEventListener('mouseup', function() {
    audioIsSeeking = false;
    if (!audioTrackController) return;
    var ratio = parseInt(aeSeekSlider.value, 10) / 1000;
    var len = audioTrackController.trackLength();
    audioTrackController.setTrackPosition(ratio * len);
  });

  document.getElementById('ae-pitch').addEventListener('input', function() {
    var val = parseInt(this.value, 10) / 10;
    if (audioTrackController) audioTrackController.pitchShift = val;
    document.getElementById('ae-pitch-val').textContent = val.toFixed(1) + ' st';
    aeNotifyChange('pitchShift', val);
  });

  document.getElementById('ae-speed').addEventListener('input', function() {
    var val = parseInt(this.value, 10) / 100;
    if (audioTrackController) audioTrackController.speedShift = val;
    document.getElementById('ae-speed-val').textContent = val.toFixed(2) + 'x';
    aeNotifyChange('speedShift', val);
  });

  document.getElementById('ae-reverb').addEventListener('input', function() {
    var val = parseInt(this.value, 10) / 100;
    if (audioTrackController) audioTrackController.reverb = val;
    document.getElementById('ae-reverb-val').textContent = val.toFixed(2);
    aeNotifyChange('reverb', val);
  });

  document.getElementById('ae-volume').addEventListener('input', function() {
    var val = parseInt(this.value, 10) / 100;
    if (audioTrackController) audioTrackController.volume = val;
    document.getElementById('ae-volume-val').textContent = val.toFixed(2);
    aeNotifyChange('volume', val);
  });

  document.getElementById('ae-pan').addEventListener('input', function() {
    var val = parseInt(this.value, 10) / 100;
    if (audioTrackController) audioTrackController.pan = val;
    document.getElementById('ae-pan-val').textContent = val.toFixed(2);
    aeNotifyChange('pan', val);
  });

  document.getElementById('ae-transition').addEventListener('input', function() {
    var val = parseInt(this.value, 10);
    document.getElementById('ae-transition-val').textContent = val + ' ms';
    aeNotifyChange('transitionBuffer', val);
  });

  document.getElementById('ae-stereo').addEventListener('click', function() {
    audioIsSurround = false;
    aeUpdateModeUI();
    if (audioTrackController) audioTrackController.spatial = false;
    aeNotifyChange('spatial', false);
  });

  document.getElementById('ae-surround').addEventListener('click', function() {
    audioIsSurround = true;
    aeUpdateModeUI();
    if (audioTrackController) audioTrackController.spatial = true;
    aeNotifyChange('spatial', true);
  });

  // Hex spatial drag
  (function() {
    var hexSvg = document.getElementById('ae-hex-svg');
    var hexDot = document.getElementById('ae-hex-dot');
    var dragging = false;

    function getHexPos(e) {
      var rect = hexSvg.getBoundingClientRect();
      var scaleX = 200 / rect.width;
      var scaleY = 200 / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    function updateSpatial(e) {
      var pos = getHexPos(e);
      var clamped = aeClampToHexagon(pos.x, pos.y);
      var sx = (clamped.x - AE_HEX_CX) / AE_HEX_RADIUS;
      var sz = -(clamped.y - AE_HEX_CY) / AE_HEX_RADIUS;
      sx = Math.max(-1, Math.min(1, sx));
      sz = Math.max(-1, Math.min(1, sz));

      hexDot.setAttribute('cx', String(clamped.x));
      hexDot.setAttribute('cy', String(clamped.y));

      if (audioTrackController) {
        audioTrackController.setSpatialPosition(sx, 0, sz);
      }

      var sxEl = document.getElementById('ae-spatial-x');
      var szEl = document.getElementById('ae-spatial-z');
      if (sxEl) sxEl.textContent = sx.toFixed(2);
      if (szEl) szEl.textContent = sz.toFixed(2);

      aeNotifyChange('spatialX', sx);
      aeNotifyChange('spatialZ', sz);
    }

    if (hexSvg) {
      hexSvg.addEventListener('mousedown', function(e) {
        dragging = true;
        updateSpatial(e);
      });
      document.addEventListener('mousemove', function(e) {
        if (dragging) updateSpatial(e);
      });
      document.addEventListener('mouseup', function() {
        dragging = false;
      });
    }
  })();

  // Signal ready
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=omoscene-editor.js.map