"use strict";
/**
 * Scene Tree panel — TreeDataProvider showing the nexus hierarchy
 * from the currently active .omoscene document.
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
exports.SceneTreeProvider = exports.ComponentTreeItem = void 0;
exports.setExtensionUri = setExtensionUri;
const vscode = __importStar(require("vscode"));
const engine_1 = require("../types/engine");
// All component types that have custom SVG icons in media/icons/
const ICON_TYPES = new Set([
    'nexus', 'transform', 'sprite', 'camera', 'viewport', 'light',
    'collider', 'event-collider', 'timer', 'input-controller',
    'animation-controller', 'cell-map', 'texture-map', 'atlas-manager',
    'audio-track', 'audio-player', 'audio-effect', 'ui-overlay', 'data-layer',
    'flag-manager', 'messenger',
]);
// Shared extensionUri — set once from extension.ts
let _extensionUri;
function setExtensionUri(uri) {
    _extensionUri = uri;
}
/**
 * Tree item representing a component in the scene hierarchy
 */
class ComponentTreeItem extends vscode.TreeItem {
    constructor(component, parentId, collapsibleState) {
        super(component.name, collapsibleState);
        this.component = component;
        this.parentId = parentId;
        this.description = component.type;
        this.tooltip = `${component.name} (${component.type})${component.id !== undefined ? ` #${component.id}` : ''}`;
        this.contextValue = component.type;
        this.iconPath = ComponentTreeItem.getIconForType(component.type);
        // Store component ID for selection
        if (component.id !== undefined) {
            this.id = `component_${component.id}`;
        }
    }
    static getIconForType(type) {
        if (_extensionUri && ICON_TYPES.has(type)) {
            const iconUri = vscode.Uri.joinPath(_extensionUri, 'media', 'icons', `${type}.svg`);
            return { light: iconUri, dark: iconUri };
        }
        // Fallback to theme icon
        return new vscode.ThemeIcon('symbol-misc');
    }
}
exports.ComponentTreeItem = ComponentTreeItem;
class SceneTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.sceneRoot = null;
        this._onDidSelect = null;
        this._onMoveComponent = null;
        this._onDropOmocompFile = null;
        this._onSceneChanged = null;
        // ── Drag and Drop ──────────────────────────────────────────────
        this.dragMimeTypes = ['application/vnd.omosuen.component'];
        this.dropMimeTypes = [
            'application/vnd.omosuen.component',
            'application/vnd.omosuen.omocomp-file',
        ];
    }
    handleDrag(source, dataTransfer, _token) {
        if (source.length === 0) {
            return;
        }
        const item = source[0];
        // Prevent dragging the scene root
        if (this.sceneRoot && item.component.id === this.sceneRoot.id) {
            return;
        }
        dataTransfer.set('application/vnd.omosuen.component', new vscode.DataTransferItem(JSON.stringify({
            componentId: item.component.id,
            parentId: item.parentId,
            component: item.component,
        })));
    }
    handleDrop(target, dataTransfer, _token) {
        if (!target || !this.sceneRoot) {
            return;
        }
        // Check for .omocomp file drop from Asset Browser
        const omocompRaw = dataTransfer.get('application/vnd.omosuen.omocomp-file');
        if (omocompRaw && this._onDropOmocompFile) {
            // Target must be a nexus
            if (!(0, engine_1.isSerializedNexus)(target.component) || target.component.id === undefined) {
                return;
            }
            const fileData = JSON.parse(omocompRaw.value);
            this._onDropOmocompFile(fileData.uri, target.component.id);
            return;
        }
        // Handle internal reparenting
        if (!this._onMoveComponent) {
            return;
        }
        const raw = dataTransfer.get('application/vnd.omosuen.component');
        if (!raw) {
            return;
        }
        const data = JSON.parse(raw.value);
        // Prevent dropping onto self
        if (data.componentId === target.component.id) {
            return;
        }
        // Determine destination parent and index
        let newParentId;
        let index;
        if ((0, engine_1.isSerializedNexus)(target.component)) {
            // Dropped ON a nexus → becomes last child
            newParentId = target.component.id;
            index = target.component.components.length;
        }
        else {
            // Dropped ON a non-nexus → insert after the target in its parent
            if (target.parentId === undefined) {
                return;
            }
            newParentId = target.parentId;
            // Find target's index within its parent
            const parent = findById(this.sceneRoot, newParentId);
            if (!parent || !(0, engine_1.isSerializedNexus)(parent)) {
                return;
            }
            const targetIdx = parent.components.findIndex((c) => c.id === target.component.id);
            index = targetIdx === -1 ? parent.components.length : targetIdx + 1;
        }
        // Prevent circular drops: can't drop a nexus into its own subtree
        if ((0, engine_1.isSerializedNexus)(findById(this.sceneRoot, data.componentId) ?? {})) {
            if (isDescendantOf(this.sceneRoot, data.componentId, newParentId)) {
                return;
            }
        }
        this._onMoveComponent(data.componentId, newParentId, index);
    }
    // ── Public API ─────────────────────────────────────────────────
    /**
     * Register a move handler (called by drag-drop and move up/down)
     */
    onMoveComponent(handler) {
        this._onMoveComponent = handler;
    }
    /**
     * Register a handler for .omocomp file drops from the Asset Browser
     */
    onDropOmocompFile(handler) {
        this._onDropOmocompFile = handler;
    }
    /**
     * Get the scene root (for extension.ts move up/down commands)
     */
    getSceneRoot() {
        return this.sceneRoot;
    }
    /**
     * Register a handler called whenever the scene data changes
     */
    onSceneChanged(handler) {
        this._onSceneChanged = handler;
    }
    /**
     * Set the scene data to display in the tree
     */
    setScene(scene) {
        this.sceneRoot = scene;
        this._onDidChangeTreeData.fire();
        if (this._onSceneChanged) {
            this._onSceneChanged(scene);
        }
    }
    /**
     * Register a selection handler
     */
    onDidSelectComponent(handler) {
        this._onDidSelect = handler;
    }
    /**
     * Called when a tree item is selected by the user
     */
    selectItem(item) {
        if (this._onDidSelect) {
            this._onDidSelect(item.component);
        }
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            // Root level: return the scene root
            if (!this.sceneRoot) {
                return [];
            }
            const state = (0, engine_1.isSerializedNexus)(this.sceneRoot)
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None;
            return [new ComponentTreeItem(this.sceneRoot, undefined, state)];
        }
        // Children: only nexus components have children
        if (!(0, engine_1.isSerializedNexus)(element.component)) {
            return [];
        }
        const nexus = element.component;
        return nexus.components.map((child) => {
            const state = (0, engine_1.isSerializedNexus)(child)
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            return new ComponentTreeItem(child, nexus.id, state);
        });
    }
}
exports.SceneTreeProvider = SceneTreeProvider;
// ── Tree helpers ─────────────────────────────────────────────────
function findById(root, id) {
    if (root.id === id) {
        return root;
    }
    if ((0, engine_1.isSerializedNexus)(root)) {
        for (const child of root.components) {
            const found = findById(child, id);
            if (found) {
                return found;
            }
        }
    }
    return null;
}
/**
 * Returns true if `descendantId` is a descendant of `ancestorId` in the tree.
 */
function isDescendantOf(root, ancestorId, descendantId) {
    const ancestor = findById(root, ancestorId);
    if (!ancestor) {
        return false;
    }
    return findById(ancestor, descendantId) !== null;
}
//# sourceMappingURL=scene-tree.js.map