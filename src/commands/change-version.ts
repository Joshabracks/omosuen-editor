/**
 * "Omosuen: Change Engine Version" command.
 * Updates the engine dependency in an existing project without
 * requiring a full project re-creation.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { fetchReleases, httpsDownloadFile, runCommand } from './create-project';

export function registerChangeVersionCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('omosuen.changeVersion', async () => {
      // 1. Find workspace root
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      const rootDir = folders[0].uri.fsPath;
      const pkgPath = path.join(rootDir, 'package.json');

      if (!fs.existsSync(pkgPath)) {
        vscode.window.showErrorMessage(
          'No package.json found in workspace root.'
        );
        return;
      }

      // 2. Parse current omosuen dependency tag
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      } catch {
        vscode.window.showErrorMessage('Failed to parse package.json.');
        return;
      }

      const deps = pkg.dependencies as Record<string, string> | undefined;
      const dep = deps?.omosuen;
      if (!dep) {
        vscode.window.showErrorMessage(
          'No omosuen dependency found in package.json. Is this an Omosuen project?'
        );
        return;
      }

      const currentTag = dep.includes('#') ? dep.split('#').pop()! : null;

      // 3. Fetch available releases from GitHub
      let releases;
      try {
        releases = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching Omosuen releases...',
            cancellable: false,
          },
          () => fetchReleases()
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to fetch releases: ${message}`
        );
        return;
      }

      if (releases.length === 0) {
        vscode.window.showErrorMessage(
          'No releases found on the Omosuen repository.'
        );
        return;
      }

      // 4. Show QuickPick with versions (mark current)
      const picked = await vscode.window.showQuickPick(
        releases.map((r) => ({
          label: r.tag,
          description:
            r.tag === currentTag
              ? '(current)'
              : r.label !== r.tag
                ? r.label
                : undefined,
        })),
        {
          placeHolder: `Current: ${currentTag || 'unknown'}`,
          title: 'Omosuen: Change Engine Version',
        }
      );

      if (!picked) {
        return;
      }

      if (picked.label === currentTag) {
        vscode.window.showInformationMessage(
          `Already on ${currentTag}.`
        );
        return;
      }

      const newTag = picked.label;

      // 5-7. Update package.json, npm install, download engine bundle
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Updating engine to ${newTag}...`,
            cancellable: false,
          },
          async (progress) => {
            // Update package.json dependency
            progress.report({ message: 'Updating package.json...' });
            deps!.omosuen = `github:Joshabracks/omosuen#${newTag}`;
            fs.writeFileSync(
              pkgPath,
              JSON.stringify(pkg, null, 2) + '\n'
            );

            // Run npm install
            progress.report({
              message:
                'Installing dependencies (this may take a minute)...',
            });
            await runCommand('npm', ['install'], rootDir);

            // Download engine UMD bundle for editor preview
            progress.report({ message: 'Downloading engine bundle...' });
            const editorDir = path.join(rootDir, '.omosuen_editor');
            fs.mkdirSync(editorDir, { recursive: true });
            const bundleUrl = `https://github.com/Joshabracks/omosuen/releases/download/${newTag}/omosuen.min.js`;
            await httpsDownloadFile(
              bundleUrl,
              path.join(editorDir, 'omosuen.min.js')
            );
          }
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to update engine: ${message}`
        );
        return;
      }

      // 8. Success
      vscode.window.showInformationMessage(
        `Engine updated: ${currentTag || 'unknown'} → ${newTag}`
      );
    })
  );
}
