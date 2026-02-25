/**
 * Scene Tree panel — TreeDataProvider showing the nexus hierarchy
 * from the currently active .omoscene document.
 */

import * as vscode from 'vscode';
import {
  type SerializedComponent,
  type SerializedNexus,
  isSerializedNexus,
} from '../types/engine';

// All component types that have custom SVG icons in media/icons/
const ICON_TYPES = new Set([
  'nexus', 'transform', 'sprite', 'camera', 'viewport', 'light',
  'collider', 'event-collider', 'timer', 'input-controller',
  'animation-controller', 'cell-map', 'texture-map', 'atlas-manager',
  'audio-manager', 'audio-controller', 'ui-overlay', 'data-layer',
  'flag-manager', 'messenger',
]);

// Shared extensionUri — set once from extension.ts
let _extensionUri: vscode.Uri | undefined;

export function setExtensionUri(uri: vscode.Uri): void {
  _extensionUri = uri;
}

/**
 * Tree item representing a component in the scene hierarchy
 */
export class ComponentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly component: SerializedComponent,
    public readonly parentId: number | undefined,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(component.name, collapsibleState);

    this.description = component.type;
    this.tooltip = `${component.name} (${component.type})${component.id !== undefined ? ` #${component.id}` : ''}`;
    this.contextValue = component.type;
    this.iconPath = ComponentTreeItem.getIconForType(component.type);

    // Store component ID for selection
    if (component.id !== undefined) {
      this.id = `component_${component.id}`;
    }
  }

  private static getIconForType(
    type: string
  ): { light: vscode.Uri; dark: vscode.Uri } | vscode.ThemeIcon {
    if (_extensionUri && ICON_TYPES.has(type)) {
      const iconUri = vscode.Uri.joinPath(
        _extensionUri, 'media', 'icons', `${type}.svg`
      );
      return { light: iconUri, dark: iconUri };
    }
    // Fallback to theme icon
    return new vscode.ThemeIcon('symbol-misc');
  }
}

export class SceneTreeProvider
  implements
    vscode.TreeDataProvider<ComponentTreeItem>,
    vscode.TreeDragAndDropController<ComponentTreeItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<ComponentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sceneRoot: SerializedComponent | null = null;
  private _onDidSelect:
    | ((component: SerializedComponent) => void)
    | null = null;
  private _onMoveComponent:
    | ((componentId: number, newParentId: number, index: number) => void)
    | null = null;
  private _onDropOmocompFile:
    | ((fileUri: string, targetNexusId: number) => void)
    | null = null;

  // ── Drag and Drop ──────────────────────────────────────────────

  readonly dragMimeTypes = ['application/vnd.omosuen.component'];
  readonly dropMimeTypes = [
    'application/vnd.omosuen.component',
    'application/vnd.omosuen.omocomp-file',
  ];

  handleDrag(
    source: readonly ComponentTreeItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    if (source.length === 0) {return;}

    const item = source[0];

    // Prevent dragging the scene root
    if (this.sceneRoot && item.component.id === this.sceneRoot.id) {
      return;
    }

    dataTransfer.set(
      'application/vnd.omosuen.component',
      new vscode.DataTransferItem(
        JSON.stringify({
          componentId: item.component.id,
          parentId: item.parentId,
          component: item.component,
        })
      )
    );
  }

  handleDrop(
    target: ComponentTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    if (!target || !this.sceneRoot) {return;}

    // Check for .omocomp file drop from Asset Browser
    const omocompRaw = dataTransfer.get('application/vnd.omosuen.omocomp-file');
    if (omocompRaw && this._onDropOmocompFile) {
      // Target must be a nexus
      if (!isSerializedNexus(target.component) || target.component.id === undefined) {return;}
      const fileData = JSON.parse(omocompRaw.value as string) as { uri: string };
      this._onDropOmocompFile(fileData.uri, target.component.id);
      return;
    }

    // Handle internal reparenting
    if (!this._onMoveComponent) {return;}

    const raw = dataTransfer.get('application/vnd.omosuen.component');
    if (!raw) {return;}

    const data = JSON.parse(raw.value as string) as {
      componentId: number;
      parentId: number | undefined;
    };

    // Prevent dropping onto self
    if (data.componentId === target.component.id) {return;}

    // Determine destination parent and index
    let newParentId: number;
    let index: number;

    if (isSerializedNexus(target.component)) {
      // Dropped ON a nexus → becomes last child
      newParentId = target.component.id!;
      index = (target.component as SerializedNexus).components.length;
    } else {
      // Dropped ON a non-nexus → insert after the target in its parent
      if (target.parentId === undefined) {return;}
      newParentId = target.parentId;

      // Find target's index within its parent
      const parent = findById(this.sceneRoot, newParentId);
      if (!parent || !isSerializedNexus(parent)) {return;}
      const targetIdx = (parent as SerializedNexus).components.findIndex(
        (c) => c.id === target.component.id
      );
      index = targetIdx === -1 ? (parent as SerializedNexus).components.length : targetIdx + 1;
    }

    // Prevent circular drops: can't drop a nexus into its own subtree
    if (isSerializedNexus(findById(this.sceneRoot, data.componentId) ?? ({} as SerializedComponent))) {
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
  onMoveComponent(
    handler: (componentId: number, newParentId: number, index: number) => void
  ): void {
    this._onMoveComponent = handler;
  }

  /**
   * Register a handler for .omocomp file drops from the Asset Browser
   */
  onDropOmocompFile(
    handler: (fileUri: string, targetNexusId: number) => void
  ): void {
    this._onDropOmocompFile = handler;
  }

  /**
   * Get the scene root (for extension.ts move up/down commands)
   */
  getSceneRoot(): SerializedComponent | null {
    return this.sceneRoot;
  }

  /**
   * Set the scene data to display in the tree
   */
  setScene(scene: SerializedComponent | null): void {
    this.sceneRoot = scene;
    this._onDidChangeTreeData.fire();
  }

  /**
   * Register a selection handler
   */
  onDidSelectComponent(
    handler: (component: SerializedComponent) => void
  ): void {
    this._onDidSelect = handler;
  }

  /**
   * Called when a tree item is selected by the user
   */
  selectItem(item: ComponentTreeItem): void {
    if (this._onDidSelect) {
      this._onDidSelect(item.component);
    }
  }

  getTreeItem(element: ComponentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: ComponentTreeItem
  ): ComponentTreeItem[] {
    if (!element) {
      // Root level: return the scene root
      if (!this.sceneRoot) {
        return [];
      }
      const state = isSerializedNexus(this.sceneRoot)
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
      return [new ComponentTreeItem(this.sceneRoot, undefined, state)];
    }

    // Children: only nexus components have children
    if (!isSerializedNexus(element.component)) {
      return [];
    }

    const nexus = element.component as SerializedNexus;
    return nexus.components.map((child) => {
      const state = isSerializedNexus(child)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
      return new ComponentTreeItem(child, nexus.id, state);
    });
  }
}

// ── Tree helpers ─────────────────────────────────────────────────

function findById(
  root: SerializedComponent,
  id: number
): SerializedComponent | null {
  if (root.id === id) {return root;}
  if (isSerializedNexus(root)) {
    for (const child of (root as SerializedNexus).components) {
      const found = findById(child, id);
      if (found) {return found;}
    }
  }
  return null;
}

/**
 * Returns true if `descendantId` is a descendant of `ancestorId` in the tree.
 */
function isDescendantOf(
  root: SerializedComponent,
  ancestorId: number,
  descendantId: number
): boolean {
  const ancestor = findById(root, ancestorId);
  if (!ancestor) {return false;}
  return findById(ancestor, descendantId) !== null;
}
