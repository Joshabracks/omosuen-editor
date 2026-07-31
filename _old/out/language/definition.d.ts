/**
 * DefinitionProvider — go-to-definition for scene names and texture keys.
 */
import * as vscode from 'vscode';
import type { WorkspaceDiscovery } from './discovery';
export declare class OmosuenDefinitionProvider implements vscode.DefinitionProvider {
    private discovery;
    constructor(discovery: WorkspaceDiscovery);
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.Definition | null;
    private sceneDefinition;
    private textureKeyDefinition;
}
