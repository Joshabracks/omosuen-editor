import * as vscode from 'vscode';

class PlaceholderTreeProvider implements vscode.TreeDataProvider<string> {
  getTreeItem(element: string): vscode.TreeItem {
    return new vscode.TreeItem(element);
  }

  getChildren(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const hello = vscode.commands.registerCommand('omosuen.hello', () => {
    vscode.window.showInformationMessage('Omosuen editor extension is alive.');
  });
  context.subscriptions.push(hello);

  const placeholder = vscode.window.registerTreeDataProvider(
    'omosuen.placeholder',
    new PlaceholderTreeProvider(),
  );
  context.subscriptions.push(placeholder);
}

export function deactivate(): void {
  // no-op
}
