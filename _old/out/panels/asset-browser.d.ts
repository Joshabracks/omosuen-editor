/**
 * Asset Browser panel — TreeDataProvider showing project files grouped by type.
 * Supports drag-and-drop:
 * - Drag .omocomp files TO the Scene Tree to instantiate them
 * - Drop components FROM the Scene Tree to save as .omocomp files
 */
import * as vscode from 'vscode';
export declare class AssetItem extends vscode.TreeItem {
    readonly fileUri: vscode.Uri | undefined;
    readonly isCategory: boolean;
    readonly categoryIndex: number;
    constructor(label: string, fileUri: vscode.Uri | undefined, isCategory: boolean, categoryIndex: number, collapsibleState: vscode.TreeItemCollapsibleState);
}
export declare class AssetBrowserProvider implements vscode.TreeDataProvider<AssetItem>, vscode.TreeDragAndDropController<AssetItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void | AssetItem | null | undefined>;
    private fileWatcher;
    private refreshTimer;
    readonly dragMimeTypes: string[];
    readonly dropMimeTypes: string[];
    handleDrag(source: readonly AssetItem[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void;
    handleDrop(_target: AssetItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void>;
    initialize(): void;
    refresh(): void;
    dispose(): void;
    getTreeItem(element: AssetItem): vscode.TreeItem;
    getChildren(element?: AssetItem): Promise<AssetItem[]>;
    private onFileEvent;
}
