/**
 * HoverProvider — informative tooltips for Omosuen engine API usage.
 */
import * as vscode from 'vscode';
import type { WorkspaceDiscovery } from './discovery';
export declare class OmosuenHoverProvider implements vscode.HoverProvider {
    private discovery;
    constructor(discovery: WorkspaceDiscovery);
    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.Hover | null;
    private componentTypeHover;
    private propertyHover;
    private sceneNameHover;
    private engineFunctionHover;
}
