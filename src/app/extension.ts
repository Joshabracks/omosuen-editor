import * as vscode from 'vscode';
import { readOmoscene, writeOmoscene } from '../omoscene/fs.js';
import { registerPanel } from '../panel/base.js';
import { registerCommands } from './commands.js';
import { createDocumentController } from './document-controller.js';

export function activate(context: vscode.ExtensionContext): void {
  // Phase 0 sanity command — still useful for confirming activation.
  const hello = vscode.commands.registerCommand('omosuen.hello', () => {
    void vscode.window.showInformationMessage(
      'Omosuen editor extension is alive.',
    );
  });
  context.subscriptions.push(hello);

  // One document controller for the extension. Phase 5 supports one open
  // scene at a time; Phase 6's custom editor will change this to per-tab.
  const controller = createDocumentController({
    readFile: (uri) => readOmoscene(uri),
    writeFile: (uri, file) => writeOmoscene(uri, file),
  });
  context.subscriptions.push({ dispose: () => controller.dispose() });

  registerCommands(context, controller);

  // Phase 5 sidebar views. Scene Tree + Inspector both route through the
  // document-controller broker so a click in one reaches the other.
  const sceneTree = registerPanel(context, {
    id: 'omosuen.sceneTree',
    title: 'Scene',
    kind: 'view',
    webviewEntryPath: 'scene-tree.js',
    wireOutgoing: (bridge) => controller.registerPanel(bridge),
  });
  context.subscriptions.push({ dispose: () => sceneTree.dispose() });

  const inspector = registerPanel(context, {
    id: 'omosuen.inspector',
    title: 'Inspector',
    kind: 'view',
    webviewEntryPath: 'inspector.js',
    wireOutgoing: (bridge) => controller.registerPanel(bridge),
  });
  context.subscriptions.push({ dispose: () => inspector.dispose() });
}

export function deactivate(): void {
  // no-op
}
