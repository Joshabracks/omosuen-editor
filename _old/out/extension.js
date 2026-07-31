"use strict";
/**
 * Omosuen Editor — VS Code Extension Entry Point
 *
 * Registers all providers, commands, and panels for the editor.
 * Phase 1 MVP: Scene Tree, Inspector, .omoscene editor, preview server, console.
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const scene_tree_1 = require("./panels/scene-tree");
const inspector_1 = require("./panels/inspector");
const console_1 = require("./panels/console");
const asset_browser_1 = require("./panels/asset-browser");
const omoscene_editor_1 = require("./editors/omoscene-editor");
const omocomp_editor_1 = require("./editors/omocomp-editor");
const engine_1 = require("./types/engine");
const preview_1 = require("./commands/preview");
const create_project_1 = require("./commands/create-project");
const change_version_1 = require("./commands/change-version");
const component_crud_1 = require("./commands/component-crud");
const scene_export_1 = require("./commands/scene-export");
const build_1 = require("./tasks/build");
const texture_map_editor_1 = require("./editors/texture-map-editor");
const animation_editor_1 = require("./editors/animation-editor");
const cellmap_materials_editor_1 = require("./editors/cellmap-materials-editor");
const omoscene_1 = require("./types/omoscene");
const omocomp_1 = require("./types/omocomp");
const completion_1 = require("./language/completion");
const hover_1 = require("./language/hover");
const definition_1 = require("./language/definition");
const discovery_1 = require("./language/discovery");
const diagnostics_1 = require("./language/diagnostics");
function activate(context) {
    // ── Console ─────────────────────────────────────────────────────
    const omoConsole = new console_1.OmosuenConsole();
    context.subscriptions.push({ dispose: () => omoConsole.dispose() });
    omoConsole.info('Omosuen Editor activating...');
    // ── Icons ─────────────────────────────────────────────────────────
    (0, scene_tree_1.setExtensionUri)(context.extensionUri);
    // ── Scene Tree ──────────────────────────────────────────────────
    const sceneTree = new scene_tree_1.SceneTreeProvider();
    const treeView = vscode.window.createTreeView('omosuen.sceneTree', {
        treeDataProvider: sceneTree,
        showCollapseAll: true,
        dragAndDropController: sceneTree,
        canSelectMany: true,
    });
    context.subscriptions.push(treeView);
    // ── Context keys for global uniqueness ─────────────────────────
    sceneTree.onSceneChanged((scene) => {
        const flags = (0, component_crud_1.computeGlobalUniquenessFlags)(scene);
        for (const [type, exists] of flags) {
            vscode.commands.executeCommand('setContext', `omosuen.exists.${type}`, exists);
        }
    });
    // ── Inspector ───────────────────────────────────────────────────
    const inspector = new inspector_1.InspectorProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(inspector_1.InspectorProvider.viewType, inspector, { webviewOptions: { retainContextWhenHidden: true } }));
    // ── .omoscene Editor ────────────────────────────────────────────
    const omosceneEditor = new omoscene_editor_1.OmosceneEditorProvider(sceneTree, inspector);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(omoscene_editor_1.OmosceneEditorProvider.viewType, omosceneEditor, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
    }));
    // ── .omocomp Editor ────────────────────────────────────────────
    const omocompEditor = new omocomp_editor_1.OmocompEditorProvider(inspector);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(omocomp_editor_1.OmocompEditorProvider.viewType, omocompEditor, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
    }));
    // ── Asset Browser ─────────────────────────────────────────────
    const assetBrowser = new asset_browser_1.AssetBrowserProvider();
    const assetTreeView = vscode.window.createTreeView('omosuen.assetBrowser', {
        treeDataProvider: assetBrowser,
        showCollapseAll: true,
        dragAndDropController: assetBrowser,
    });
    context.subscriptions.push(assetTreeView);
    context.subscriptions.push({ dispose: () => assetBrowser.dispose() });
    // Initialize file watcher
    assetBrowser.initialize();
    // ── Wire up selection sync ──────────────────────────────────────
    // Tree -> Inspector + Preview
    sceneTree.onDidSelectComponent((component) => {
        inspector.showComponent(component);
        // Forward selection to editor canvas for camera rect highlighting
        if (component.id !== undefined) {
            let entityId = component.id;
            if (component.type !== 'nexus') {
                const scene = omosceneEditor.getActiveScene();
                if (scene) {
                    const parent = (0, omoscene_editor_1.findParentNexus)(scene.scene, component.id);
                    if (parent && parent.id !== undefined) {
                        entityId = parent.id;
                    }
                }
            }
            omosceneEditor.selectEntity(entityId, component.type);
        }
        // Auto-activate cell-map editing when a cell-map component is selected
        omosceneEditor.setCellEditMode(component.type === 'cell-map');
        // Auto-activate audio editor when an audio-effect component is selected
        if (component.type === 'audio-effect') {
            omosceneEditor.enterAudioEditor(component);
        }
        else {
            omosceneEditor.exitAudioEditor();
        }
        // Notify preview of selection
        const server = (0, preview_1.getDevServer)();
        if (server?.isRunning && component.id !== undefined) {
            server.broadcast('component:select', {
                componentId: component.id,
            });
        }
    });
    // Tree item click handler (supports multi-select)
    treeView.onDidChangeSelection((e) => {
        const items = e.selection.filter((s) => s instanceof scene_tree_1.ComponentTreeItem);
        if (items.length === 1) {
            sceneTree.selectItem(items[0]);
        }
        else if (items.length > 1) {
            inspector.showMultiSelection(items.length);
        }
        else {
            // Deselected — reset webview selection so camera toolbar reappears
            omosceneEditor.selectEntity(-1);
        }
    });
    // Inspector -> Document + Preview
    inspector.onPropertyChanged((componentId, property, value) => {
        omosceneEditor.updateComponentProperty(componentId, property, value);
        // Cell-map property updates now flow through the editor viewport automatically
    });
    // ── Preview message handler ─────────────────────────────────────
    function handlePreviewMessage(msg) {
        switch (msg.type) {
            case 'preview:ready': {
                const payload = msg.payload;
                omoConsole.info(`Preview connected — engine v${payload.engineVersion}, contract v${payload.contractVersion}`);
                // Restore saved camera state
                const camState = omosceneEditor.getCameraState();
                if (camState) {
                    const server = (0, preview_1.getDevServer)();
                    if (server?.isRunning) {
                        server.broadcast('editor:setCameraState', camState);
                    }
                }
                break;
            }
            case 'component:selected': {
                const payload = msg.payload;
                // Find the component in the current scene and select it
                const scene = omosceneEditor.getActiveScene();
                if (scene) {
                    const component = (0, omoscene_editor_1.findComponentById)(scene.scene, payload.componentId);
                    if (component) {
                        inspector.showComponent(component);
                    }
                }
                break;
            }
            case 'preview:fps':
                // Could display in status bar in the future
                break;
            case 'preview:pauseState': {
                const pausePayload = msg.payload;
                vscode.commands.executeCommand('setContext', 'omosuen.previewPaused', pausePayload.paused);
                break;
            }
            case 'component:changed': {
                const changedPayload = msg.payload;
                omosceneEditor.updateComponentProperty(changedPayload.componentId, changedPayload.property, changedPayload.value);
                break;
            }
            case 'editor:cameraState': {
                const camPayload = msg.payload;
                omosceneEditor.updateCameraState(camPayload.panX, camPayload.panY, camPayload.zoom);
                break;
            }
            case 'preview:error': {
                const errPayload = msg.payload;
                omoConsole.error(`Preview error: ${errPayload.message ?? 'Unknown error'}`);
                break;
            }
            // preview:log is handled in preview.ts before reaching here
        }
    }
    // ── Preview commands ────────────────────────────────────────────
    (0, preview_1.registerPreviewCommands)(context, omoConsole, handlePreviewMessage);
    // ── Create Project command ────────────────────────────────────
    (0, create_project_1.registerCreateProjectCommand)(context);
    // ── Change Engine Version command ──────────────────────────────
    (0, change_version_1.registerChangeVersionCommand)(context);
    // ── CRUD commands (add / delete / duplicate / rename) ─────────
    (0, component_crud_1.registerCrudCommands)(context, sceneTree, inspector, omosceneEditor, treeView);
    // ── Drag-drop reparenting ────────────────────────────────────
    sceneTree.onMoveComponent((componentId, newParentId, index) => {
        omosceneEditor.moveComponent(componentId, newParentId, index);
    });
    // ── Move Up / Move Down commands ─────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.moveComponentUp', (item) => {
        if (item.parentId === undefined) {
            return;
        }
        const root = sceneTree.getSceneRoot();
        if (!root) {
            return;
        }
        const parent = (0, omoscene_editor_1.findComponentById)(root, item.parentId);
        if (!parent || !(0, engine_1.isSerializedNexus)(parent)) {
            return;
        }
        const siblings = parent.components;
        const idx = siblings.findIndex((c) => c.id === item.component.id);
        if (idx <= 0) {
            return;
        }
        omosceneEditor.moveComponent(item.component.id, item.parentId, idx - 1);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.moveComponentDown', (item) => {
        if (item.parentId === undefined) {
            return;
        }
        const root = sceneTree.getSceneRoot();
        if (!root) {
            return;
        }
        const parent = (0, omoscene_editor_1.findComponentById)(root, item.parentId);
        if (!parent || !(0, engine_1.isSerializedNexus)(parent)) {
            return;
        }
        const siblings = parent.components;
        const idx = siblings.findIndex((c) => c.id === item.component.id);
        if (idx === -1 || idx >= siblings.length - 1) {
            return;
        }
        omosceneEditor.moveComponent(item.component.id, item.parentId, idx + 1);
    }));
    // ── Asset Browser: .omocomp drop into Scene Tree ──────────────
    sceneTree.onDropOmocompFile(async (fileUri, targetNexusId) => {
        const uri = vscode.Uri.parse(fileUri);
        const content = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(content).toString('utf-8');
        const omocomp = (0, omocomp_1.parseOmocomp)(text);
        if (!omocomp) {
            vscode.window.showErrorMessage('Failed to parse .omocomp file.');
            return;
        }
        // Deep clone and reassign IDs to prevent conflicts
        const component = JSON.parse(JSON.stringify(omocomp.component));
        let nextId = omosceneEditor.getNextId();
        (0, component_crud_1.reassignIds)(component, () => nextId++);
        await omosceneEditor.addComponent(targetNexusId, component);
    });
    // ── Asset Browser commands ────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.openAsset', (uri) => {
        const fsPath = uri.fsPath;
        if (fsPath.endsWith('.omoscene')) {
            vscode.commands.executeCommand('vscode.openWith', uri, omoscene_editor_1.OmosceneEditorProvider.viewType);
        }
        else if (fsPath.endsWith('.omocomp')) {
            vscode.commands.executeCommand('vscode.openWith', uri, omocomp_editor_1.OmocompEditorProvider.viewType);
        }
        else {
            vscode.commands.executeCommand('vscode.open', uri);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.newOmocomp', async () => {
        const picked = await vscode.window.showQuickPick(component_crud_1.ALL_COMPONENT_TYPES.map((type) => ({ label: type })), {
            placeHolder: 'Select component type',
            title: 'New Component File',
        });
        if (!picked) {
            return;
        }
        const name = await vscode.window.showInputBox({
            prompt: `Name for new ${picked.label} component`,
            value: picked.label,
            validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
        });
        if (!name) {
            return;
        }
        const component = (0, component_crud_1.createDefaultComponent)(picked.label, name, 0);
        const omocomp = (0, omocomp_1.createOmocomp)(name, component);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${workspaceFolders[0].uri.fsPath}/${slug}.omocomp`),
            filters: { 'Omosuen Component': ['omocomp'] },
            title: 'Save Component File',
        });
        if (!saveUri) {
            return;
        }
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(JSON.stringify(omocomp, null, 2), 'utf-8'));
        vscode.commands.executeCommand('vscode.openWith', saveUri, omocomp_editor_1.OmocompEditorProvider.viewType);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.refreshAssetBrowser', () => {
        assetBrowser.refresh();
    }));
    // ── Frame Editor command ───────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.openFrameEditor', (component) => {
        if (!component) {
            vscode.window.showWarningMessage('Select a texture-map component first.');
            return;
        }
        (0, texture_map_editor_1.openFrameEditor)(context, component, omosceneEditor, inspector);
    }));
    // ── Animation Editor command ─────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.openAnimationEditor', (component) => {
        if (!component) {
            vscode.window.showWarningMessage('Select an animation-controller component first.');
            return;
        }
        (0, animation_editor_1.openAnimationEditor)(context, component, omosceneEditor, inspector);
    }));
    // ── Audio Editor command ──────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.openAudioEditor', (component) => {
        if (!component) {
            vscode.window.showWarningMessage('Select an audio-effect component first.');
            return;
        }
        omosceneEditor.enterAudioEditor(component);
    }));
    // ── Cell-Map Materials Editor command ─────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.openCellMapMaterials', (component) => {
        if (!component) {
            vscode.window.showWarningMessage('Select a cell-map component first.');
            return;
        }
        (0, cellmap_materials_editor_1.openCellMapMaterialsEditor)(context, component, omosceneEditor, inspector);
    }));
    // ── Search Scene Tree command ────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.searchSceneTree', async () => {
        const root = sceneTree.getSceneRoot();
        if (!root) {
            vscode.window.showInformationMessage('No scene loaded.');
            return;
        }
        const items = flattenTree(root, []);
        const picked = await vscode.window.showQuickPick(items.map((item) => ({
            label: item.name,
            description: item.type,
            detail: item.path,
            _component: item.component,
        })), {
            placeHolder: 'Search components by name or type',
            title: 'Search Scene Tree',
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked) {
            return;
        }
        inspector.showComponent(picked._component);
    }));
    // ── Export Runtime Scene command ──────────────────────────────
    (0, scene_export_1.registerExportCommand)(context);
    // ── Build tasks ────────────────────────────────────────────────
    (0, build_1.registerBuildTasks)(context);
    // ── Language Intelligence ─────────────────────────────────────
    const tsJsSelector = [
        { language: 'typescript', scheme: 'file' },
        { language: 'javascript', scheme: 'file' },
    ];
    const discovery = new discovery_1.WorkspaceDiscovery();
    context.subscriptions.push(discovery);
    discovery.scanAllFiles();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(tsJsSelector, new completion_1.OmosuenCompletionProvider(discovery), "'", '"', '{', ',', ':'), vscode.languages.registerHoverProvider(tsJsSelector, new hover_1.OmosuenHoverProvider(discovery)), vscode.languages.registerDefinitionProvider(tsJsSelector, new definition_1.OmosuenDefinitionProvider(discovery)), (0, diagnostics_1.registerDiagnostics)(context, discovery));
    // ── Refresh command ─────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.refreshSceneTree', () => {
        // Re-read the active .omoscene document
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName.endsWith('.omoscene')) {
            const parsed = (0, omoscene_1.parseOmoscene)(editor.document.getText());
            if (parsed) {
                sceneTree.setScene(parsed.scene);
            }
        }
    }));
    // ── Auto-load scene from active .omoscene file ──────────────────
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.fileName.endsWith('.omoscene')) {
            const parsed = (0, omoscene_1.parseOmoscene)(editor.document.getText());
            if (parsed) {
                sceneTree.setScene(parsed.scene);
            }
        }
    }));
    // Check if there's already an active .omoscene file
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.fileName.endsWith('.omoscene')) {
        const parsed = (0, omoscene_1.parseOmoscene)(activeEditor.document.getText());
        if (parsed) {
            sceneTree.setScene(parsed.scene);
        }
    }
    omoConsole.info('Omosuen Editor activated');
}
function flattenTree(node, ancestors) {
    const path = [...ancestors, node.name].join(' > ');
    const result = [{
            name: node.name,
            type: node.type,
            path,
            component: node,
        }];
    if ((0, engine_1.isSerializedNexus)(node)) {
        for (const child of node.components) {
            result.push(...flattenTree(child, [...ancestors, node.name]));
        }
    }
    return result;
}
function deactivate() {
    // Dev server cleanup happens via preview command dispose
    const server = (0, preview_1.getDevServer)();
    if (server?.isRunning) {
        server.stop();
    }
}
//# sourceMappingURL=extension.js.map