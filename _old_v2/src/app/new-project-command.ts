/**
 * "Omosuen: New Project…" command (Phase 10.3).
 *
 * Flow:
 *   1. Prompt for project display name (showInputBox).
 *   2. Prompt for parent directory (showOpenDialog).
 *   3. Prompt for engine version from live GitHub releases
 *      ([pickEngineVersion](./version-picker.ts)).
 *   4. Build scaffold content via
 *      [buildProjectTemplate](./project-template.ts).
 *   5. Write files via [writeProjectFiles](./project-writer.ts).
 *   6. Offer to open the new folder as a workspace.
 *
 * Each prompt accepts cancellation — cancel at any step aborts the
 * command silently. Errors surface through `showErrorMessage`.
 */

import * as vscode from 'vscode';
import {
  buildProjectTemplate,
  slugify,
  type TemplateInputs,
} from './project-template.js';
import { writeProjectFiles } from './project-writer.js';
import { pickEngineVersion } from './version-picker.js';

export function registerNewProjectCommand(ctx: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand('omosuen.newProject', () =>
    runNewProjectFlow(),
  );
  ctx.subscriptions.push(cmd);
}

async function runNewProjectFlow(): Promise<void> {
  const projectName = await vscode.window.showInputBox({
    title: 'New Omosuen Project',
    prompt: 'Project name',
    placeHolder: 'My Game',
    validateInput: (value) => {
      if (value.trim() === '') return 'Project name cannot be empty.';
      return null;
    },
  });
  if (projectName === undefined) return;

  const parentPicks = await vscode.window.showOpenDialog({
    title: 'Select parent directory',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create project here',
  });
  if (!parentPicks || parentPicks.length === 0) return;
  const parentDir = parentPicks[0];
  if (parentDir === undefined) return;

  const engineTag = await pickEngineVersion();
  if (engineTag === null) return;

  const slug = slugify(projectName);
  const projectUri = vscode.Uri.joinPath(parentDir, slug);

  if (await uriExists(projectUri)) {
    void vscode.window.showErrorMessage(
      `Omosuen: a folder named "${slug}" already exists under ${parentDir.fsPath}. Choose a different name or parent.`,
    );
    return;
  }

  const templateInputs: TemplateInputs = { projectName, engineTag };
  const files = buildProjectTemplate(templateInputs);

  try {
    await writeProjectFiles({ rootUri: projectUri, files });
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Omosuen: failed to scaffold project — ${describeError(err)}`,
    );
    return;
  }

  const openChoice = await vscode.window.showInformationMessage(
    `Omosuen: created ${slug} at ${projectUri.fsPath}`,
    { modal: false },
    'Open Folder',
    'Open in New Window',
  );
  if (openChoice === 'Open Folder') {
    await vscode.commands.executeCommand('vscode.openFolder', projectUri);
  } else if (openChoice === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', projectUri, {
      forceNewWindow: true,
    });
  }
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
