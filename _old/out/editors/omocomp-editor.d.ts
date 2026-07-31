/**
 * CustomTextEditorProvider for .omocomp files.
 * Manages the document model for reusable component files.
 */
import * as vscode from 'vscode';
import { type OmocompFile } from '../types/omocomp';
import { type SerializedComponent } from '../types/engine';
import { InspectorProvider } from '../panels/inspector';
export declare class OmocompEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly inspector;
    static readonly viewType = "omosuen.omocompEditor";
    private activeDocument;
    private activeParsed;
    constructor(inspector: InspectorProvider);
    getActiveOmocomp(): OmocompFile | null;
    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void>;
    /**
     * Update a component property within the .omocomp file.
     */
    updateComponentProperty(componentId: number, property: string, value: unknown): Promise<void>;
    /**
     * Add a child component (only valid when root is a nexus).
     */
    addComponent(parentId: number, component: SerializedComponent): Promise<void>;
    /**
     * Remove a component by ID.
     */
    removeComponent(componentId: number): Promise<void>;
    /**
     * Returns the next available component ID.
     */
    getNextId(): number;
    private writeDocument;
    private updateWebview;
}
