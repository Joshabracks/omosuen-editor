/**
 * Scene Tree panel — TreeDataProvider showing the nexus hierarchy
 * from the currently active .omoscene document.
 */
import * as vscode from 'vscode';
import { type SerializedComponent } from '../types/engine';
export declare function setExtensionUri(uri: vscode.Uri): void;
/**
 * Tree item representing a component in the scene hierarchy
 */
export declare class ComponentTreeItem extends vscode.TreeItem {
    readonly component: SerializedComponent;
    readonly parentId: number | undefined;
    constructor(component: SerializedComponent, parentId: number | undefined, collapsibleState: vscode.TreeItemCollapsibleState);
    private static getIconForType;
}
export declare class SceneTreeProvider implements vscode.TreeDataProvider<ComponentTreeItem>, vscode.TreeDragAndDropController<ComponentTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void | ComponentTreeItem | null | undefined>;
    private sceneRoot;
    private _onDidSelect;
    private _onMoveComponent;
    private _onDropOmocompFile;
    private _onSceneChanged;
    readonly dragMimeTypes: string[];
    readonly dropMimeTypes: string[];
    handleDrag(source: readonly ComponentTreeItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void;
    handleDrop(target: ComponentTreeItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void;
    /**
     * Register a move handler (called by drag-drop and move up/down)
     */
    onMoveComponent(handler: (componentId: number, newParentId: number, index: number) => void): void;
    /**
     * Register a handler for .omocomp file drops from the Asset Browser
     */
    onDropOmocompFile(handler: (fileUri: string, targetNexusId: number) => void): void;
    /**
     * Get the scene root (for extension.ts move up/down commands)
     */
    getSceneRoot(): SerializedComponent | null;
    /**
     * Register a handler called whenever the scene data changes
     */
    onSceneChanged(handler: (scene: SerializedComponent | null) => void): void;
    /**
     * Set the scene data to display in the tree
     */
    setScene(scene: SerializedComponent | null): void;
    /**
     * Register a selection handler
     */
    onDidSelectComponent(handler: (component: SerializedComponent) => void): void;
    /**
     * Called when a tree item is selected by the user
     */
    selectItem(item: ComponentTreeItem): void;
    getTreeItem(element: ComponentTreeItem): vscode.TreeItem;
    getChildren(element?: ComponentTreeItem): ComponentTreeItem[];
}
