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

  private static getIconForType(type: string): vscode.ThemeIcon {
    switch (type) {
      case 'nexus':
        return new vscode.ThemeIcon('symbol-namespace');
      case 'transform':
        return new vscode.ThemeIcon('move');
      case 'sprite':
        return new vscode.ThemeIcon('file-media');
      case 'camera':
        return new vscode.ThemeIcon('device-camera');
      case 'viewport':
        return new vscode.ThemeIcon('screen-normal');
      case 'light':
        return new vscode.ThemeIcon('lightbulb');
      case 'collider':
        return new vscode.ThemeIcon('shield');
      case 'event-collider':
        return new vscode.ThemeIcon('zap');
      case 'timer':
        return new vscode.ThemeIcon('watch');
      case 'input-controller':
        return new vscode.ThemeIcon('game');
      case 'animation-controller':
        return new vscode.ThemeIcon('play-circle');
      case 'cell-map':
        return new vscode.ThemeIcon('symbol-array');
      case 'texture-map':
        return new vscode.ThemeIcon('file-binary');
      case 'atlas-manager':
        return new vscode.ThemeIcon('layers');
      case 'audio-manager':
        return new vscode.ThemeIcon('unmute');
      case 'audio-controller':
        return new vscode.ThemeIcon('music');
      case 'ui-overlay':
        return new vscode.ThemeIcon('browser');
      case 'data-layer':
        return new vscode.ThemeIcon('database');
      case 'flag-manager':
        return new vscode.ThemeIcon('flag');
      case 'messenger':
        return new vscode.ThemeIcon('mail');
      default:
        return new vscode.ThemeIcon('symbol-misc');
    }
  }
}

export class SceneTreeProvider
  implements vscode.TreeDataProvider<ComponentTreeItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<ComponentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sceneRoot: SerializedComponent | null = null;
  private _onDidSelect:
    | ((component: SerializedComponent) => void)
    | null = null;

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
