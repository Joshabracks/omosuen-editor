/**
 * DiagnosticCollection — reports problems in .omoscene/.omocomp and .ts/.js files.
 */
import * as vscode from 'vscode';
import type { WorkspaceDiscovery } from './discovery';
export declare function registerDiagnostics(context: vscode.ExtensionContext, _discovery: WorkspaceDiscovery): vscode.DiagnosticCollection;
