import * as vscode from 'vscode';
import { readOmoscene, writeOmoscene } from '../omoscene/fs.js';
import { registerPanel } from '../panel/base.js';
import { registerCommands } from './commands.js';
import {
  createDocumentRegistry,
  followActiveController,
} from './document-registry.js';
import { registerSceneEditorProvider } from './scene-editor-provider.js';

export function activate(context: vscode.ExtensionContext): void {
  // Phase 0 sanity command — still useful for confirming activation.
  const hello = vscode.commands.registerCommand('omosuen.hello', () => {
    void vscode.window.showInformationMessage(
      'Omosuen editor extension is alive.',
    );
  });
  context.subscriptions.push(hello);

  // Phase 6.1: per-tab document registry. Each `.omoscene` URI gets its
  // own controller; sidebars follow whichever is active.
  const registry = createDocumentRegistry({
    readFile: (uri) => readOmoscene(uri),
    writeFile: (uri, file) => writeOmoscene(uri, file),
  });
  context.subscriptions.push({ dispose: () => registry.dispose() });

  registerCommands(context, registry);
  registerSceneEditorProvider(context, registry);

  // Sidebars (Scene Tree + Inspector) — `followActiveController` rebinds
  // their bridge when the active tab changes and hydrates them with the
  // new document via the existing `registerPanel` scene:load emission.
  const sceneTree = registerPanel(context, {
    id: 'omosuen.sceneTree',
    title: 'Scene',
    kind: 'view',
    webviewEntryPath: 'scene-tree.js',
    wireOutgoing: (bridge) => followActiveController(bridge, registry),
  });
  context.subscriptions.push({ dispose: () => sceneTree.dispose() });

  const inspector = registerPanel(context, {
    id: 'omosuen.inspector',
    title: 'Inspector',
    kind: 'view',
    webviewEntryPath: 'inspector.js',
    wireOutgoing: (bridge) => followActiveController(bridge, registry),
  });
  context.subscriptions.push({ dispose: () => inspector.dispose() });
}

export function deactivate(): void {
  // no-op
}
