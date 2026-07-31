/**
 * DefinitionProvider — go-to-definition for scene names and texture keys.
 */

import * as vscode from 'vscode';
import { detectCursorContext, extractStringLiteralRange } from './context';
import type { WorkspaceDiscovery } from './discovery';

// ── Provider ────────────────────────────────────────────────────

export class OmosuenDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private discovery: WorkspaceDiscovery) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Definition | null {
    const ctx = detectCursorContext(document, position);
    const literal = extractStringLiteralRange(document, position);
    if (!literal) { return null; }

    if (ctx.kind === 'scene-name') {
      return this.sceneDefinition(literal.value);
    }

    if (ctx.kind === 'texture-key') {
      return this.textureKeyDefinition(literal.value);
    }

    return null;
  }

  // ── Resolvers ─────────────────────────────────────────────────

  private sceneDefinition(name: string): vscode.Location[] | null {
    const entries = this.discovery.getSceneNames().filter((e) => e.name === name);
    if (entries.length === 0) { return null; }

    return entries.map(
      (e) => new vscode.Location(e.uri, new vscode.Position(e.line, 0))
    );
  }

  private textureKeyDefinition(key: string): vscode.Location[] | null {
    const entries = this.discovery.getTextureKeys().filter((e) => e.key === key);
    if (entries.length === 0) { return null; }

    return entries.map(
      (e) => new vscode.Location(e.uri, new vscode.Position(e.line, 0))
    );
  }
}
