import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const hello = vscode.commands.registerCommand('omosuen.hello', () => {
    vscode.window.showInformationMessage('Omosuen editor extension is alive.');
  });
  context.subscriptions.push(hello);
}

export function deactivate(): void {
  // no-op
}
