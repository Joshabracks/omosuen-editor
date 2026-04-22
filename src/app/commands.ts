/**
 * VS Code command registrations.
 *
 * Two commands:
 *   - `omosuen.openScene` — file-picker → registry.getOrCreateController(uri)
 *     → load(uri) → setActiveUri(uri)
 *   - `omosuen.saveScene` — active controller's save() (info message if
 *     nothing loaded)
 *
 * Phase 6.2 adds the custom editor for `.omoscene` which becomes the
 * primary open path. These commands remain for now — they offer a
 * no-tab flow if the user just wants to edit metadata via the sidebars.
 */

import * as vscode from 'vscode';
import type { DocumentRegistry } from './document-registry.js';

export function registerCommands(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const openCmd = vscode.commands.registerCommand(
    'omosuen.openScene',
    async () => {
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Open Scene',
        filters: { Omoscene: ['omoscene'] },
      });
      if (!picks || picks.length === 0) return;
      const uri = picks[0];
      if (uri === undefined) return;
      try {
        const controller = registry.getOrCreateController(uri);
        await controller.load(uri);
        registry.setActiveUri(uri);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Omosuen: failed to open scene — ${describeError(err)}`,
        );
      }
    },
  );
  ctx.subscriptions.push(openCmd);

  const saveCmd = vscode.commands.registerCommand(
    'omosuen.saveScene',
    async () => {
      const active = registry.activeController.get();
      if (active === null || active.uri === null) {
        void vscode.window.showInformationMessage(
          'Omosuen: no scene is loaded. Use "Omosuen: Open Scene…" first.',
        );
        return;
      }
      try {
        await active.save();
        void vscode.window.showInformationMessage(
          `Omosuen: saved ${active.uri.fsPath}`,
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Omosuen: save failed — ${describeError(err)}`,
        );
      }
    },
  );
  ctx.subscriptions.push(saveCmd);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
