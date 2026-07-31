/**
 * "Omosuen: Export Runtime Scene" command.
 * Extracts the `scene` field from a .omoscene file and saves it as standalone JSON.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { parseOmoscene } from '../types/omoscene';

/**
 * Find the active .omoscene file URI — checks active editor, visible tabs, or prompts user.
 */
async function resolveOmosceneUri(): Promise<vscode.Uri | undefined> {
  // Check active editor
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.fileName.endsWith('.omoscene')) {
    return activeEditor.document.uri;
  }

  // Check visible custom editors
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input &&
        typeof tab.input === 'object' &&
        'uri' in tab.input
      ) {
        const uri = (tab.input as { uri: vscode.Uri }).uri;
        if (uri.fsPath.endsWith('.omoscene')) {
          return uri;
        }
      }
    }
  }

  // Search workspace
  const files = await vscode.workspace.findFiles('**/*.omoscene');
  if (files.length === 0) {
    vscode.window.showErrorMessage('No .omoscene files found in the workspace.');
    return undefined;
  }

  if (files.length === 1) {
    return files[0];
  }

  const picked = await vscode.window.showQuickPick(
    files.map((f) => ({
      label: vscode.workspace.asRelativePath(f, false),
      uri: f,
    })),
    {
      placeHolder: 'Select a scene to export',
      title: 'Choose Scene',
    }
  );

  return picked?.uri;
}

export function registerExportCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.exportRuntimeScene', async () => {
      const sourceUri = await resolveOmosceneUri();
      if (!sourceUri) {return;}

      // Read and parse the .omoscene file
      const content = await vscode.workspace.fs.readFile(sourceUri);
      const text = Buffer.from(content).toString('utf-8');
      const parsed = parseOmoscene(text);
      if (!parsed) {
        vscode.window.showErrorMessage('Failed to parse .omoscene file.');
        return;
      }

      // Prompt for save location
      const defaultName = parsed.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(path.dirname(sourceUri.fsPath), `${defaultName}.json`)
        ),
        filters: { 'JSON Files': ['json'] },
        title: 'Export Runtime Scene',
      });
      if (!saveUri) {return;}

      // Write the scene field only (no editor metadata)
      const runtimeJson = JSON.stringify(parsed.scene, null, 2);
      await vscode.workspace.fs.writeFile(
        saveUri,
        Buffer.from(runtimeJson, 'utf-8')
      );

      vscode.window.showInformationMessage(
        `Runtime scene exported to ${path.basename(saveUri.fsPath)}`
      );
    })
  );
}
