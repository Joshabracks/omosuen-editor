/**
 * CRUD commands for components in the Scene Tree.
 * Add, Delete, Duplicate, and Rename components.
 */

import * as vscode from 'vscode';
import type { COMPONENT_TYPE, SerializedComponent } from '../types/engine';
import { ComponentUnique, isSerializedNexus } from '../types/engine';
import { COMPONENT_SCHEMAS, type PropertySchema } from '../schema/component-schemas';
import type { OmosceneEditorProvider } from '../editors/omoscene-editor';
import { findParentNexus, findComponentById } from '../editors/omoscene-editor';
import type { SceneTreeProvider } from '../panels/scene-tree';
import { ComponentTreeItem } from '../panels/scene-tree';
import type { InspectorProvider } from '../panels/inspector';

// ── Uniqueness ──────────────────────────────────────────────────

const COMPONENT_UNIQUENESS: Record<COMPONENT_TYPE, ComponentUnique> = {
  'nexus': ComponentUnique.FALSE,
  'transform': ComponentUnique.FALSE,
  'sprite': ComponentUnique.FALSE,
  'camera': ComponentUnique.LOCAL,
  'viewport': ComponentUnique.FALSE,
  'collider': ComponentUnique.FALSE,
  'event-collider': ComponentUnique.FALSE,
  'light': ComponentUnique.FALSE,
  'timer': ComponentUnique.FALSE,
  'messenger': ComponentUnique.FALSE,
  'input-controller': ComponentUnique.FALSE,
  'audio-manager': ComponentUnique.GLOBAL,
  'audio-controller': ComponentUnique.FALSE,
  'animation-controller': ComponentUnique.FALSE,
  'ui-overlay': ComponentUnique.FALSE,
  'data-layer': ComponentUnique.FALSE,
  'flag-manager': ComponentUnique.GLOBAL,
  'texture-map': ComponentUnique.FALSE,
  'atlas-manager': ComponentUnique.GLOBAL,
  'cell-map': ComponentUnique.FALSE,
};

export const ALL_COMPONENT_TYPES: COMPONENT_TYPE[] = [
  'nexus', 'transform', 'sprite', 'camera', 'viewport',
  'collider', 'event-collider', 'light', 'timer', 'messenger',
  'input-controller', 'audio-manager', 'audio-controller',
  'animation-controller', 'ui-overlay', 'data-layer',
  'flag-manager', 'texture-map', 'atlas-manager', 'cell-map',
];

// ── Registration ────────────────────────────────────────────────

export function registerCrudCommands(
  context: vscode.ExtensionContext,
  sceneTree: SceneTreeProvider,
  inspector: InspectorProvider,
  omosceneEditor: OmosceneEditorProvider,
  treeView: vscode.TreeView<ComponentTreeItem>
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omosuen.addComponent',
      (item: ComponentTreeItem) => handleAddComponent(item, omosceneEditor)
    ),
    vscode.commands.registerCommand(
      'omosuen.deleteComponent',
      (item: ComponentTreeItem) =>
        handleDeleteComponent(item, omosceneEditor, inspector, treeView)
    ),
    vscode.commands.registerCommand(
      'omosuen.duplicateComponent',
      (item: ComponentTreeItem) =>
        handleDuplicateComponent(item, omosceneEditor, treeView)
    ),
    vscode.commands.registerCommand(
      'omosuen.renameComponent',
      (item: ComponentTreeItem) => handleRenameComponent(item, omosceneEditor)
    )
  );
}

// ── Command Handlers ────────────────────────────────────────────

async function handleAddComponent(
  item: ComponentTreeItem,
  editor: OmosceneEditorProvider
): Promise<void> {
  if (!item?.component || item.component.type !== 'nexus') {return;}
  const parentId = item.component.id;
  if (parentId === undefined) {return;}

  const scene = editor.getActiveScene();
  if (!scene) {return;}

  // Build QuickPick items with uniqueness filtering
  const items: vscode.QuickPickItem[] = ALL_COMPONENT_TYPES.map((type) => {
    const uniqueness = COMPONENT_UNIQUENESS[type];
    let disabled = false;
    let detail = '';

    if (uniqueness === ComponentUnique.GLOBAL) {
      // Check if this type already exists anywhere in the scene
      if (hasComponentOfType(scene.scene, type)) {
        disabled = true;
        detail = '(already exists in scene — GLOBAL unique)';
      }
    } else if (uniqueness === ComponentUnique.LOCAL) {
      // Check if this type already exists under the target nexus
      if (hasComponentOfTypeInNexus(item.component, type)) {
        disabled = true;
        detail = '(already exists under this nexus — LOCAL unique)';
      }
    }

    return {
      label: disabled ? `$(circle-slash) ${type}` : type,
      description: disabled ? detail : '',
      detail: disabled ? undefined : undefined,
      picked: false,
      alwaysShow: true,
      _type: type,
      _disabled: disabled,
    } as vscode.QuickPickItem & { _type: COMPONENT_TYPE; _disabled: boolean };
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select component type to add',
    title: 'Add Component',
  }) as (vscode.QuickPickItem & { _type: COMPONENT_TYPE; _disabled: boolean }) | undefined;

  if (!picked || picked._disabled) {
    if (picked?._disabled) {
      vscode.window.showWarningMessage(
        `Cannot add ${picked._type}: uniqueness constraint violated.`
      );
    }
    return;
  }

  const componentType = picked._type;

  // Prompt for name
  const name = await vscode.window.showInputBox({
    prompt: `Name for new ${componentType} component`,
    value: componentType,
    validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
  });
  if (!name) {return;}

  const id = editor.getNextId();
  const component = createDefaultComponent(componentType, name, id);

  await editor.addComponent(parentId, component);
}

async function handleDeleteComponent(
  item: ComponentTreeItem,
  editor: OmosceneEditorProvider,
  inspector: InspectorProvider,
  treeView: vscode.TreeView<ComponentTreeItem>
): Promise<void> {
  // Collect all selected items (multi-select support)
  const selected = treeView.selection.filter(
    (s): s is ComponentTreeItem => s instanceof ComponentTreeItem
  );
  const items = selected.length > 1 ? selected : (item ? [item] : []);
  if (items.length === 0) {return;}

  const scene = editor.getActiveScene();
  if (!scene) {return;}

  // Filter out scene root and items without IDs
  const deletable = items.filter(
    (i) => i.component.id !== undefined && i.component.id !== scene.scene.id
  );
  if (deletable.length === 0) {
    vscode.window.showWarningMessage('Cannot delete the scene root.');
    return;
  }

  // Confirm
  const message = deletable.length === 1
    ? `Delete "${deletable[0].component.name || deletable[0].component.type}"?${isSerializedNexus(deletable[0].component) ? ' This will also delete all children.' : ''}`
    : `Delete ${deletable.length} components?`;
  const confirm = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Delete'
  );
  if (confirm !== 'Delete') {return;}

  // Delete in reverse order to avoid index shifting
  for (const i of deletable.reverse()) {
    await editor.removeComponent(i.component.id!);
  }
  inspector.showComponent(null);
}

async function handleDuplicateComponent(
  item: ComponentTreeItem,
  editor: OmosceneEditorProvider,
  treeView: vscode.TreeView<ComponentTreeItem>
): Promise<void> {
  // Collect all selected items (multi-select support)
  const selected = treeView.selection.filter(
    (s): s is ComponentTreeItem => s instanceof ComponentTreeItem
  );
  const items = selected.length > 1 ? selected : (item ? [item] : []);
  if (items.length === 0) {return;}

  const scene = editor.getActiveScene();
  if (!scene) {return;}

  for (const i of items) {
    if (i.component.id === undefined) {continue;}
    if (scene.scene.id === i.component.id) {continue;}

    const parent = findParentNexus(scene.scene, i.component.id);
    if (!parent) {continue;}

    const clone = JSON.parse(JSON.stringify(i.component)) as SerializedComponent;
    clone.name = (clone.name || clone.type) + ' (copy)';

    let nextId = editor.getNextId();
    reassignIds(clone, () => nextId++);

    await editor.addComponent(parent.id!, clone);
  }
}

async function handleRenameComponent(
  item: ComponentTreeItem,
  editor: OmosceneEditorProvider
): Promise<void> {
  if (!item?.component) {return;}
  const componentId = item.component.id;
  if (componentId === undefined) {return;}

  const newName = await vscode.window.showInputBox({
    prompt: 'New name',
    value: item.component.name || '',
    validateInput: (v) => (v.trim() ? null : 'Name cannot be empty'),
  });
  if (!newName) {return;}

  await editor.updateComponentProperty(componentId, 'name', newName);
}

// ── Helpers ─────────────────────────────────────────────────────

function hasComponentOfType(
  component: SerializedComponent,
  type: COMPONENT_TYPE
): boolean {
  if (component.type === type) {return true;}
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      if (hasComponentOfType(child, type)) {return true;}
    }
  }
  return false;
}

function hasComponentOfTypeInNexus(
  component: SerializedComponent,
  type: COMPONENT_TYPE
): boolean {
  if (!isSerializedNexus(component)) {return false;}
  return component.components.some((c) => c.type === type);
}

export function reassignIds(
  component: SerializedComponent,
  nextId: () => number
): void {
  component.id = nextId();
  if (isSerializedNexus(component)) {
    for (const child of component.components) {
      reassignIds(child, nextId);
    }
  }
}

export function createDefaultComponent(
  type: COMPONENT_TYPE,
  name: string,
  id: number
): SerializedComponent {
  const schema = COMPONENT_SCHEMAS[type];
  const component: SerializedComponent = {
    type,
    name,
    id,
  };

  if (type === 'nexus') {
    (component as Record<string, unknown>).components = [];
    (component as Record<string, unknown>).unique = 0;
  }

  // Apply defaults from schema
  for (const prop of schema) {
    if (prop.default === undefined) {continue;}
    if (prop.readOnly) {continue;}

    const value = resolveDefaultValue(prop);
    if (value !== undefined) {
      (component as Record<string, unknown>)[prop.name] = value;
    }
  }

  return component;
}

function resolveDefaultValue(prop: PropertySchema): unknown {
  if (prop.type === 'Vector2D') {
    const d = prop.default as Record<string, number> | undefined;
    return {
      _vectorType: 'Vector2D',
      x: d?.x ?? 0,
      y: d?.y ?? 0,
    };
  }
  if (prop.type === 'Vector3D') {
    const d = prop.default as Record<string, number> | undefined;
    return {
      _vectorType: 'Vector3D',
      x: d?.x ?? 0,
      y: d?.y ?? 0,
      z: d?.z ?? 0,
    };
  }
  if (prop.type === 'Color3') {
    const d = prop.default as Record<string, number> | undefined;
    return {
      _vectorType: 'Vector3D',
      x: d?.x ?? 1,
      y: d?.y ?? 1,
      z: d?.z ?? 1,
    };
  }
  if (prop.type === 'Color4') {
    const d = prop.default as Record<string, number> | undefined;
    return {
      _vectorType: 'Vector4D',
      x: d?.x ?? 1,
      y: d?.y ?? 1,
      z: d?.z ?? 1,
      w: d?.w ?? 1,
    };
  }
  if (prop.type === 'object' && prop.subFields) {
    const obj: Record<string, unknown> = {};
    for (const sub of prop.subFields) {
      if (sub.default !== undefined) {
        obj[sub.name] = resolveDefaultValue(sub);
      }
    }
    return obj;
  }
  return prop.default;
}
