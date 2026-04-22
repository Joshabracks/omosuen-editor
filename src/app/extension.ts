import * as vscode from 'vscode';
import { registerPanel } from '../panel/base.js';

export function activate(context: vscode.ExtensionContext): void {
  const hello = vscode.commands.registerCommand('omosuen.hello', () => {
    vscode.window.showInformationMessage('Omosuen editor extension is alive.');
  });
  context.subscriptions.push(hello);

  // Phase 4.5 sample panel — Selection Info.
  //
  // `wireOutgoing` echoes every incoming message back to the same
  // webview. This is scaffolding: Phase 5 replaces the echo with real
  // routing (a central hub forwards messages to every registered panel).
  // The panel's code doesn't know or care whether the echo or the real
  // router is wired up — the bridge looks the same from the webview
  // side either way.
  const selectionInfo = registerPanel(context, {
    id: 'omosuen.selectionInfo',
    title: 'Selection Info',
    kind: 'view',
    webviewEntryPath: 'selection-info.js',
    wireOutgoing: (bridge) =>
      bridge.onMessage((msg) => {
        bridge.dispatch(msg);
      }),
  });
  context.subscriptions.push({ dispose: () => selectionInfo.dispose() });
}

export function deactivate(): void {
  // no-op
}
