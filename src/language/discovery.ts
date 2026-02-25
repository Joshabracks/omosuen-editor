/**
 * Workspace scanning — discovers scene names and texture keys
 * across .omoscene, .omocomp, and .ts/.js files.
 */

import * as vscode from 'vscode';
import { parseOmoscene } from '../types/omoscene';
import { parseOmocomp } from '../types/omocomp';
import { isSerializedNexus, type SerializedComponent } from '../types/engine';

// ── Types ───────────────────────────────────────────────────────

export interface SceneNameEntry {
  name: string;
  uri: vscode.Uri;
  line: number;
  source: 'omoscene' | 'code';
}

export interface TextureKeyEntry {
  key: string;
  uri: vscode.Uri;
  line: number;
  source: 'omoscene' | 'omocomp' | 'code';
}

// ── Discovery ───────────────────────────────────────────────────

export class WorkspaceDiscovery implements vscode.Disposable {
  private sceneNames = new Map<string, SceneNameEntry[]>();
  private textureKeys = new Map<string, TextureKeyEntry[]>();
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor() {
    // Watch for file changes
    const omosceneWatcher = vscode.workspace.createFileSystemWatcher('**/*.omoscene');
    omosceneWatcher.onDidChange((uri) => this.scanOmosceneFile(uri));
    omosceneWatcher.onDidCreate((uri) => this.scanOmosceneFile(uri));
    omosceneWatcher.onDidDelete((uri) => this.removeEntriesForUri(uri));
    this.watchers.push(omosceneWatcher);

    const omocompWatcher = vscode.workspace.createFileSystemWatcher('**/*.omocomp');
    omocompWatcher.onDidChange((uri) => this.scanOmocompFile(uri));
    omocompWatcher.onDidCreate((uri) => this.scanOmocompFile(uri));
    omocompWatcher.onDidDelete((uri) => this.removeEntriesForUri(uri));
    this.watchers.push(omocompWatcher);

    const codeWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js}');
    codeWatcher.onDidChange((uri) => this.scanCodeFile(uri));
    codeWatcher.onDidCreate((uri) => this.scanCodeFile(uri));
    codeWatcher.onDidDelete((uri) => this.removeEntriesForUri(uri));
    this.watchers.push(codeWatcher);
  }

  // ── Public API ──────────────────────────────────────────────

  async scanAllFiles(): Promise<void> {
    const exclude = '**/node_modules/**';

    const omosceneFiles = await vscode.workspace.findFiles('**/*.omoscene', exclude);
    const omocompFiles = await vscode.workspace.findFiles('**/*.omocomp', exclude);
    const codeFiles = await vscode.workspace.findFiles('**/*.{ts,js}', exclude);

    await Promise.all([
      ...omosceneFiles.map((uri) => this.scanOmosceneFile(uri)),
      ...omocompFiles.map((uri) => this.scanOmocompFile(uri)),
      ...codeFiles.map((uri) => this.scanCodeFile(uri)),
    ]);
  }

  getSceneNames(): SceneNameEntry[] {
    const result: SceneNameEntry[] = [];
    for (const entries of this.sceneNames.values()) {
      result.push(...entries);
    }
    return result;
  }

  getTextureKeys(): TextureKeyEntry[] {
    const result: TextureKeyEntry[] = [];
    for (const entries of this.textureKeys.values()) {
      result.push(...entries);
    }
    return result;
  }

  dispose(): void {
    for (const w of this.watchers) { w.dispose(); }
  }

  // ── Scanners ────────────────────────────────────────────────

  private async scanOmosceneFile(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    this.removeByKey(key);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(content).toString('utf-8');
      const parsed = parseOmoscene(text);
      if (!parsed) { return; }

      // Scene name
      this.addSceneName({
        name: parsed.name,
        uri,
        line: 0,
        source: 'omoscene',
      });

      // Texture keys from component tree
      this.walkComponentsForTextureKeys(parsed.scene, uri, text, 'omoscene');
    } catch {
      // File read error — skip
    }
  }

  private async scanOmocompFile(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    this.removeByKey(key);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(content).toString('utf-8');
      const parsed = parseOmocomp(text);
      if (!parsed) { return; }

      this.walkComponentsForTextureKeys(parsed.component, uri, text, 'omocomp');
    } catch {
      // File read error — skip
    }
  }

  private async scanCodeFile(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    this.removeByKey(key);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(content).toString('utf-8');
      const lines = text.split('\n');

      const sceneRegex = /\b(?:registerScene|registerSceneModule|registerSceneSerialized)\s*\(\s*['"]([^'"]+)['"]/g;
      const texKeyRegex = /\btextureMapKey\s*:\s*['"]([^'"]+)['"]/g;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        let m;
        sceneRegex.lastIndex = 0;
        while ((m = sceneRegex.exec(line)) !== null) {
          this.addSceneName({ name: m[1], uri, line: i, source: 'code' });
        }

        texKeyRegex.lastIndex = 0;
        while ((m = texKeyRegex.exec(line)) !== null) {
          this.addTextureKey({ key: m[1], uri, line: i, source: 'code' });
        }
      }
    } catch {
      // File read error — skip
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private walkComponentsForTextureKeys(
    component: SerializedComponent,
    uri: vscode.Uri,
    text: string,
    source: 'omoscene' | 'omocomp'
  ): void {
    if (component.type === 'texture-map') {
      const key = component.textureMapKey as string | undefined;
      if (key) {
        // Approximate line by searching for the key in the text
        const idx = text.indexOf(`"textureMapKey"`);
        const line = idx >= 0 ? text.slice(0, idx).split('\n').length - 1 : 0;
        this.addTextureKey({ key, uri, line, source });
      }
    }

    if (isSerializedNexus(component)) {
      for (const child of component.components) {
        this.walkComponentsForTextureKeys(child, uri, text, source);
      }
    }
  }

  private addSceneName(entry: SceneNameEntry): void {
    const key = entry.uri.toString();
    const list = this.sceneNames.get(key) ?? [];
    list.push(entry);
    this.sceneNames.set(key, list);
  }

  private addTextureKey(entry: TextureKeyEntry): void {
    const key = entry.uri.toString();
    const list = this.textureKeys.get(key) ?? [];
    list.push(entry);
    this.textureKeys.set(key, list);
  }

  private removeByKey(key: string): void {
    this.sceneNames.delete(key);
    this.textureKeys.delete(key);
  }

  private removeEntriesForUri(uri: vscode.Uri): void {
    this.removeByKey(uri.toString());
  }
}
