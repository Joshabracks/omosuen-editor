"use strict";
/**
 * CRUD commands for components in the Scene Tree.
 * Add, Delete, Duplicate, and Rename components.
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
exports.ALL_COMPONENT_TYPES = void 0;
exports.registerCrudCommands = registerCrudCommands;
exports.reassignIds = reassignIds;
exports.computeGlobalUniquenessFlags = computeGlobalUniquenessFlags;
exports.createDefaultComponent = createDefaultComponent;
const vscode = __importStar(require("vscode"));
const engine_1 = require("../types/engine");
const component_schemas_1 = require("../schema/component-schemas");
const omoscene_editor_1 = require("../editors/omoscene-editor");
const scene_tree_1 = require("../panels/scene-tree");
// ── Uniqueness ──────────────────────────────────────────────────
const COMPONENT_UNIQUENESS = {
    'nexus': engine_1.ComponentUnique.FALSE,
    'transform': engine_1.ComponentUnique.FALSE,
    'sprite': engine_1.ComponentUnique.FALSE,
    'camera': engine_1.ComponentUnique.LOCAL,
    'viewport': engine_1.ComponentUnique.FALSE,
    'collider': engine_1.ComponentUnique.FALSE,
    'event-collider': engine_1.ComponentUnique.FALSE,
    'light': engine_1.ComponentUnique.FALSE,
    'timer': engine_1.ComponentUnique.FALSE,
    'messenger': engine_1.ComponentUnique.FALSE,
    'input-controller': engine_1.ComponentUnique.FALSE,
    'audio-track': engine_1.ComponentUnique.FALSE,
    'audio-player': engine_1.ComponentUnique.GLOBAL,
    'audio-effect': engine_1.ComponentUnique.FALSE,
    'animation-controller': engine_1.ComponentUnique.FALSE,
    'ui-overlay': engine_1.ComponentUnique.FALSE,
    'data-layer': engine_1.ComponentUnique.FALSE,
    'flag-manager': engine_1.ComponentUnique.GLOBAL,
    'texture-map': engine_1.ComponentUnique.FALSE,
    'atlas-manager': engine_1.ComponentUnique.GLOBAL,
    'cell-map': engine_1.ComponentUnique.FALSE,
};
exports.ALL_COMPONENT_TYPES = [
    'nexus', 'transform', 'sprite', 'camera', 'viewport',
    'collider', 'event-collider', 'light', 'timer', 'messenger',
    'input-controller', 'audio-track', 'audio-player', 'audio-effect',
    'animation-controller', 'ui-overlay', 'data-layer',
    'flag-manager', 'texture-map', 'atlas-manager', 'cell-map',
];
// ── Registration ────────────────────────────────────────────────
function registerCrudCommands(context, sceneTree, inspector, omosceneEditor, treeView) {
    // Register per-type "Add Component" commands (submenu entries)
    for (const type of exports.ALL_COMPONENT_TYPES) {
        context.subscriptions.push(vscode.commands.registerCommand(`omosuen.addComponent.${type}`, (item) => handleAddComponentOfType(type, item, omosceneEditor)));
    }
    context.subscriptions.push(vscode.commands.registerCommand('omosuen.deleteComponent', (item) => handleDeleteComponent(item, omosceneEditor, inspector, treeView)), vscode.commands.registerCommand('omosuen.duplicateComponent', (item) => handleDuplicateComponent(item, omosceneEditor, treeView)), vscode.commands.registerCommand('omosuen.renameComponent', (item) => handleRenameComponent(item, omosceneEditor)));
}
// ── Command Handlers ────────────────────────────────────────────
async function handleAddComponentOfType(type, item, editor) {
    if (!item?.component || item.component.type !== 'nexus') {
        return;
    }
    const parentId = item.component.id;
    if (parentId === undefined) {
        return;
    }
    const scene = editor.getActiveScene();
    if (!scene) {
        return;
    }
    // Runtime check for LOCAL uniqueness (cannot be enforced via when-clauses)
    const uniqueness = COMPONENT_UNIQUENESS[type];
    if (uniqueness === engine_1.ComponentUnique.LOCAL) {
        if (hasComponentOfTypeInNexus(item.component, type)) {
            vscode.window.showWarningMessage(`Cannot add ${type}: this nexus already has a ${type} component.`);
            return;
        }
    }
    // Belt-and-suspenders check for GLOBAL uniqueness (context keys update async)
    if (uniqueness === engine_1.ComponentUnique.GLOBAL) {
        if (hasComponentOfType(scene.scene, type)) {
            vscode.window.showWarningMessage(`Cannot add ${type}: a ${type} already exists in the scene.`);
            return;
        }
    }
    // Prompt for name
    const name = await vscode.window.showInputBox({
        prompt: `Name for new ${type} component`,
        value: type,
        validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
    });
    if (!name) {
        return;
    }
    const id = editor.getNextId();
    const component = createDefaultComponent(type, name, id);
    await editor.addComponent(parentId, component);
}
async function handleDeleteComponent(item, editor, inspector, treeView) {
    // Collect all selected items (multi-select support)
    const selected = treeView.selection.filter((s) => s instanceof scene_tree_1.ComponentTreeItem);
    const items = selected.length > 1 ? selected : (item ? [item] : []);
    if (items.length === 0) {
        return;
    }
    const scene = editor.getActiveScene();
    if (!scene) {
        return;
    }
    // Filter out scene root and items without IDs
    const deletable = items.filter((i) => i.component.id !== undefined && i.component.id !== scene.scene.id);
    if (deletable.length === 0) {
        vscode.window.showWarningMessage('Cannot delete the scene root.');
        return;
    }
    // Confirm
    const message = deletable.length === 1
        ? `Delete "${deletable[0].component.name || deletable[0].component.type}"?${(0, engine_1.isSerializedNexus)(deletable[0].component) ? ' This will also delete all children.' : ''}`
        : `Delete ${deletable.length} components?`;
    const confirm = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete');
    if (confirm !== 'Delete') {
        return;
    }
    // Delete in reverse order to avoid index shifting
    for (const i of deletable.reverse()) {
        await editor.removeComponent(i.component.id);
    }
    inspector.showComponent(null);
}
async function handleDuplicateComponent(item, editor, treeView) {
    // Collect all selected items (multi-select support)
    const selected = treeView.selection.filter((s) => s instanceof scene_tree_1.ComponentTreeItem);
    const items = selected.length > 1 ? selected : (item ? [item] : []);
    if (items.length === 0) {
        return;
    }
    const scene = editor.getActiveScene();
    if (!scene) {
        return;
    }
    for (const i of items) {
        if (i.component.id === undefined) {
            continue;
        }
        if (scene.scene.id === i.component.id) {
            continue;
        }
        const parent = (0, omoscene_editor_1.findParentNexus)(scene.scene, i.component.id);
        if (!parent) {
            continue;
        }
        const clone = JSON.parse(JSON.stringify(i.component));
        clone.name = (clone.name || clone.type) + ' (copy)';
        let nextId = editor.getNextId();
        reassignIds(clone, () => nextId++);
        await editor.addComponent(parent.id, clone);
    }
}
async function handleRenameComponent(item, editor) {
    if (!item?.component) {
        return;
    }
    const componentId = item.component.id;
    if (componentId === undefined) {
        return;
    }
    const newName = await vscode.window.showInputBox({
        prompt: 'New name',
        value: item.component.name || '',
        validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
    });
    if (!newName) {
        return;
    }
    await editor.updateComponentProperty(componentId, 'name', newName);
}
// ── Helpers ─────────────────────────────────────────────────────
function hasComponentOfType(component, type) {
    if (component.type === type) {
        return true;
    }
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            if (hasComponentOfType(child, type)) {
                return true;
            }
        }
    }
    return false;
}
function hasComponentOfTypeInNexus(component, type) {
    if (!(0, engine_1.isSerializedNexus)(component)) {
        return false;
    }
    return component.components.some((c) => c.type === type);
}
function reassignIds(component, nextId) {
    component.id = nextId();
    if ((0, engine_1.isSerializedNexus)(component)) {
        for (const child of component.components) {
            reassignIds(child, nextId);
        }
    }
}
const GLOBAL_UNIQUE_TYPES = exports.ALL_COMPONENT_TYPES.filter((type) => COMPONENT_UNIQUENESS[type] === engine_1.ComponentUnique.GLOBAL);
function computeGlobalUniquenessFlags(scene) {
    const flags = new Map();
    for (const type of GLOBAL_UNIQUE_TYPES) {
        flags.set(type, scene ? hasComponentOfType(scene, type) : false);
    }
    return flags;
}
function createDefaultComponent(type, name, id) {
    const schema = component_schemas_1.COMPONENT_SCHEMAS[type];
    const component = {
        type,
        name,
        id,
    };
    if (type === 'nexus') {
        component.components = [];
        component.unique = 0;
    }
    // Apply defaults from schema
    for (const prop of schema) {
        if (prop.default === undefined) {
            continue;
        }
        if (prop.readOnly) {
            continue;
        }
        const value = resolveDefaultValue(prop);
        if (value !== undefined) {
            component[prop.name] = value;
        }
    }
    return component;
}
function resolveDefaultValue(prop) {
    if (prop.type === 'Vector2D') {
        const d = prop.default;
        return {
            _vectorType: 'Vector2D',
            x: d?.x ?? 0,
            y: d?.y ?? 0,
        };
    }
    if (prop.type === 'Vector3D') {
        const d = prop.default;
        return {
            _vectorType: 'Vector3D',
            x: d?.x ?? 0,
            y: d?.y ?? 0,
            z: d?.z ?? 0,
        };
    }
    if (prop.type === 'Color3') {
        const d = prop.default;
        return {
            _vectorType: 'Vector3D',
            x: d?.x ?? 1,
            y: d?.y ?? 1,
            z: d?.z ?? 1,
        };
    }
    if (prop.type === 'Color4') {
        const d = prop.default;
        return {
            _vectorType: 'Vector4D',
            x: d?.x ?? 1,
            y: d?.y ?? 1,
            z: d?.z ?? 1,
            w: d?.w ?? 1,
        };
    }
    if (prop.type === 'object' && prop.subFields) {
        const obj = {};
        for (const sub of prop.subFields) {
            if (sub.default !== undefined) {
                obj[sub.name] = resolveDefaultValue(sub);
            }
        }
        return obj;
    }
    return prop.default;
}
//# sourceMappingURL=component-crud.js.map