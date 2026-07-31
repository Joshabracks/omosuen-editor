/**
 * CompletionItemProvider — contextual code completions for the Omosuen engine API.
 */
import * as vscode from 'vscode';
import type { WorkspaceDiscovery } from './discovery';
export declare class OmosuenCompletionProvider implements vscode.CompletionItemProvider {
    private discovery;
    constructor(discovery: WorkspaceDiscovery);
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, _context: vscode.CompletionContext): vscode.CompletionItem[] | null;
    private componentTypeCompletions;
    private optionsKeyCompletions;
    private optionsValueCompletions;
    private sceneNameCompletions;
    private textureKeyCompletions;
}
