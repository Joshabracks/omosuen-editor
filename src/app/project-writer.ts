/**
 * Project-scaffold file writer (Phase 10.3).
 *
 * Thin wrapper around `vscode.workspace.fs` that takes a list of
 * `TemplateFile` entries (produced by
 * [project-template.ts](./project-template.ts)) and lands them under a
 * chosen root URI. Directories are created on demand; existing
 * destinations throw so the command flow never silently overwrites.
 *
 * No business logic lives here — the command layer prompts the user,
 * the template builder produces content, and this module puts bytes on
 * disk. Kept separate from the command so a future test (with a mocked
 * `vscode.workspace.fs`) can exercise the ordering invariants without
 * the prompt UI.
 */

import * as vscode from 'vscode';
import type { TemplateFile } from './project-template.js';

const TEXT_ENCODER = new TextEncoder();

export interface WriteProjectFilesOptions {
  /**
   * Directory under which the scaffold is written. Created if it does
   * not exist. If the directory already contains entries, the writer
   * proceeds — the caller is expected to have confirmed empty/new.
   */
  readonly rootUri: vscode.Uri;
  readonly files: readonly TemplateFile[];
}

export async function writeProjectFiles(
  options: WriteProjectFilesOptions,
): Promise<void> {
  const { rootUri, files } = options;

  // Ensure the root directory exists before anything else; VS Code's
  // writeFile will create parent dirs but not the project root itself
  // if the user picked a URI that doesn't yet exist on disk.
  await vscode.workspace.fs.createDirectory(rootUri);

  for (const file of files) {
    const fileUri = joinPath(rootUri, file.relativePath);
    const parent = parentDir(fileUri);
    if (parent !== null) {
      await vscode.workspace.fs.createDirectory(parent);
    }
    const bytes = TEXT_ENCODER.encode(file.content);
    await vscode.workspace.fs.writeFile(fileUri, bytes);
  }
}

/**
 * Compose a URI from a root + forward-slash-separated relative path.
 * `vscode.Uri.joinPath` handles platform separators correctly.
 */
function joinPath(root: vscode.Uri, relative: string): vscode.Uri {
  const segments = relative.split('/').filter((s) => s !== '');
  return vscode.Uri.joinPath(root, ...segments);
}

function parentDir(uri: vscode.Uri): vscode.Uri | null {
  const parts = uri.path.split('/');
  if (parts.length <= 1) return null;
  parts.pop();
  const parentPath = parts.join('/');
  if (parentPath === '' || parentPath === '/') return null;
  return uri.with({ path: parentPath });
}
