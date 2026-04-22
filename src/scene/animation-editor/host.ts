/**
 * Animation editor host-side registration (Phase 8.2).
 *
 * Registers `omosuen.openAnimationEditor`, the command dispatched by
 * the inspector's "Open Animation Editor" action button. Argument is
 * the target animation-controller's id (passed through `command:invoke`
 * by the inspector; forwarded to `executeCommand` from extension.ts).
 */

import * as vscode from 'vscode';
import { registerEditorPanel } from '../../panel/editor-base.js';
import type { DocumentRegistry } from '../../app/document-registry.js';

export function registerAnimationEditor(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const handle = registerEditorPanel(ctx, {
    viewType: 'omosuen.animationEditor',
    titleFor: (componentId) => `Animations — id ${String(componentId)}`,
    webviewEntryPath: 'animation-editor.js',
  });

  const cmd = vscode.commands.registerCommand(
    'omosuen.openAnimationEditor',
    (componentId: unknown) => {
      if (typeof componentId !== 'number' || !Number.isFinite(componentId)) {
        void vscode.window.showErrorMessage(
          'Omosuen: Open Animation Editor requires a numeric component id.',
        );
        return;
      }
      const controller = registry.activeController.get();
      if (controller === null) {
        void vscode.window.showErrorMessage(
          'Omosuen: open an .omoscene file before launching the animation editor.',
        );
        return;
      }
      handle.openFor(componentId, controller);
    },
  );
  ctx.subscriptions.push(cmd);
}
