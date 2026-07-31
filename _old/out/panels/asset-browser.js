"use strict";
/**
 * Asset Browser panel — TreeDataProvider showing project files grouped by type.
 * Supports drag-and-drop:
 * - Drag .omocomp files TO the Scene Tree to instantiate them
 * - Drop components FROM the Scene Tree to save as .omocomp files
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
exports.AssetBrowserProvider = exports.AssetItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const omocomp_1 = require("../types/omocomp");
const ASSET_CATEGORIES = [
    {
        label: 'Components',
        extensions: ['.omocomp'],
        icon: new vscode.ThemeIcon('symbol-namespace'),
        glob: '**/*.omocomp',
    },
    {
        label: 'Scenes',
        extensions: ['.omoscene'],
        icon: new vscode.ThemeIcon('file-code'),
        glob: '**/*.omoscene',
    },
    {
        label: 'Textures',
        extensions: ['.png', '.jpg', '.jpeg'],
        icon: new vscode.ThemeIcon('file-media'),
        glob: '**/*.{png,jpg,jpeg}',
    },
    {
        label: 'Scripts',
        extensions: ['.ts', '.js'],
        icon: new vscode.ThemeIcon('file-code'),
        glob: '**/*.{ts,js}',
    },
    {
        label: 'Shaders',
        extensions: ['.vert', '.frag', '.glsl'],
        icon: new vscode.ThemeIcon('symbol-color'),
        glob: '**/*.{vert,frag,glsl}',
    },
    {
        label: 'Audio',
        extensions: ['.mp3', '.wav', '.ogg'],
        icon: new vscode.ThemeIcon('unmute'),
        glob: '**/*.{mp3,wav,ogg}',
    },
];
// All known extensions for filtering file watcher events
const ALL_ASSET_EXTENSIONS = new Set(ASSET_CATEGORIES.flatMap((c) => c.extensions));
// ── Tree Items ──────────────────────────────────────────────────
class AssetItem extends vscode.TreeItem {
    constructor(label, fileUri, isCategory, categoryIndex, collapsibleState) {
        super(label, collapsibleState);
        this.fileUri = fileUri;
        this.isCategory = isCategory;
        this.categoryIndex = categoryIndex;
        if (isCategory) {
            this.iconPath = ASSET_CATEGORIES[categoryIndex].icon;
            this.contextValue = 'assetCategory';
        }
        else if (fileUri) {
            const ext = path.extname(fileUri.fsPath).toLowerCase();
            if (ext === '.omocomp') {
                this.contextValue = 'omocomp';
            }
            else if (ext === '.omoscene') {
                this.contextValue = 'omoscene';
            }
            else {
                this.contextValue = 'asset';
            }
            this.resourceUri = fileUri;
            this.tooltip = vscode.workspace.asRelativePath(fileUri);
            this.command = {
                command: 'omosuen.openAsset',
                title: 'Open',
                arguments: [fileUri],
            };
        }
    }
}
exports.AssetItem = AssetItem;
// ── Provider ────────────────────────────────────────────────────
class AssetBrowserProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.fileWatcher = null;
        this.refreshTimer = null;
        // ── Drag and Drop ──────────────────────────────────────────
        this.dragMimeTypes = ['application/vnd.omosuen.omocomp-file'];
        this.dropMimeTypes = ['application/vnd.omosuen.component'];
    }
    handleDrag(source, dataTransfer, _token) {
        if (source.length === 0) {
            return;
        }
        const item = source[0];
        // Only allow dragging .omocomp files
        if (!item.fileUri || item.isCategory || item.contextValue !== 'omocomp') {
            return;
        }
        dataTransfer.set('application/vnd.omosuen.omocomp-file', new vscode.DataTransferItem(JSON.stringify({ uri: item.fileUri.toString() })));
    }
    async handleDrop(_target, dataTransfer, _token) {
        // Accept component drops from Scene Tree
        const raw = dataTransfer.get('application/vnd.omosuen.component');
        if (!raw) {
            return;
        }
        const data = JSON.parse(raw.value);
        if (!data.component) {
            return;
        }
        // Prompt for component name
        const name = await vscode.window.showInputBox({
            prompt: 'Component name',
            value: data.component.name || data.component.type,
            validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
        });
        if (!name) {
            return;
        }
        // Prompt for filename
        const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        const filename = await vscode.window.showInputBox({
            prompt: 'File name (without extension)',
            value: slug,
            validateInput: (v) => (v.trim() ? null : 'Filename cannot be empty'),
        });
        if (!filename) {
            return;
        }
        // Determine save directory
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, `${filename}.omocomp`)),
            filters: { 'Omosuen Component': ['omocomp'] },
            title: 'Save Component As',
        });
        if (!saveUri) {
            return;
        }
        // Create the .omocomp file
        const omocomp = (0, omocomp_1.createOmocomp)(name, data.component);
        const content = JSON.stringify(omocomp, null, 2);
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));
        vscode.window.showInformationMessage(`Component "${name}" saved as ${path.basename(saveUri.fsPath)}`);
    }
    // ── Public API ─────────────────────────────────────────────
    initialize() {
        if (this.fileWatcher) {
            return;
        }
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        this.fileWatcher.onDidCreate((uri) => this.onFileEvent(uri));
        this.fileWatcher.onDidDelete((uri) => this.onFileEvent(uri));
        this.fileWatcher.onDidChange((uri) => this.onFileEvent(uri));
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    dispose() {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    // ── TreeDataProvider ───────────────────────────────────────
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }
        if (!element) {
            // Root level: return categories that have at least one file
            const items = [];
            for (let i = 0; i < ASSET_CATEGORIES.length; i++) {
                const cat = ASSET_CATEGORIES[i];
                const files = await vscode.workspace.findFiles(cat.glob, '**/node_modules/**', 1 // limit=1, just check existence
                );
                if (files.length > 0) {
                    items.push(new AssetItem(cat.label, undefined, true, i, vscode.TreeItemCollapsibleState.Collapsed));
                }
            }
            return items;
        }
        if (element.isCategory) {
            // Category level: return files matching this category
            const cat = ASSET_CATEGORIES[element.categoryIndex];
            const files = await vscode.workspace.findFiles(cat.glob, '**/node_modules/**');
            return files
                .sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath)))
                .map((uri) => new AssetItem(path.basename(uri.fsPath), uri, false, element.categoryIndex, vscode.TreeItemCollapsibleState.None));
        }
        return [];
    }
    // ── Private ────────────────────────────────────────────────
    onFileEvent(uri) {
        const ext = path.extname(uri.fsPath).toLowerCase();
        if (!ALL_ASSET_EXTENSIONS.has(ext)) {
            return;
        }
        // Debounce refresh
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.refresh();
        }, 300);
    }
}
exports.AssetBrowserProvider = AssetBrowserProvider;
//# sourceMappingURL=asset-browser.js.map