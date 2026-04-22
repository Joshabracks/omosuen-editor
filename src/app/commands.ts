/**
 * VS Code command registrations for Phase 5.
 *
 * Two commands:
 *   - `omosuen.openScene` — file-picker → controller.load(uri)
 *   - `omosuen.saveScene` — controller.save() (info message if nothing loaded)
 *
 * Phase 6 replaces the openScene command with a custom-editor registration
 * (tab-based). `saveScene` likely survives as-is.
 */

import * as vscode from 'vscode';
import type { DocumentController } from './document-controller.js';

export function registerCommands(
  ctx: vscode.ExtensionContext,
  controller: DocumentController,
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
        await controller.load(uri);
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
      if (controller.uri === null) {
        void vscode.window.showInformationMessage(
          'Omosuen: no scene is loaded. Use "Omosuen: Open Scene…" first.',
        );
        return;
      }
      try {
        await controller.save();
        void vscode.window.showInformationMessage(
          `Omosuen: saved ${controller.uri.fsPath}`,
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
