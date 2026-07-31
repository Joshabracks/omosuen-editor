/**
 * Inspector panel — WebviewViewProvider that renders property editors
 * for the currently selected component.
 */
import * as vscode from 'vscode';
import type { SerializedComponent } from '../types/engine';
export declare class InspectorProvider implements vscode.WebviewViewProvider {
    private readonly extensionUri;
    static readonly viewType = "omosuen.inspector";
    private webviewView;
    private currentComponent;
    private sceneRoot;
    private _onPropertyChanged;
    constructor(extensionUri: vscode.Uri);
    /**
     * Update the scene root for validation context (e.g. sprite texture map lookups)
     */
    setScene(scene: SerializedComponent | null): void;
    /**
     * Register a handler for when the user changes a property in the inspector
     */
    onPropertyChanged(handler: (componentId: number, property: string, value: unknown) => void): void;
    /**
     * Show properties for a specific component
     */
    showComponent(component: SerializedComponent | null): void;
    private computeSpriteContext;
    private computeCameraContext;
    private computeAnimationControllerContext;
    private computeCellMapContext;
    private findParentNexus;
    private findTextureMapByKey;
    private collectTextureMapKeys;
    private computeFrameCount;
    private handleBrowseFile;
    private handleNewScript;
    private computeTextureMapContext;
    /**
     * Show a multi-selection summary instead of individual properties
     */
    showMultiSelection(count: number): void;
    resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    private getHtml;
}
