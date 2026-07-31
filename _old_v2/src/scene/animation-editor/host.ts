/**
 * Animation editor host-side registration (Phase 8.2 + overhaul).
 *
 * Registers `omosuen.openAnimationEditor`, the command dispatched by
 * the inspector's "Open Animation Editor" action button. Argument is
 * the target animation-controller's id.
 *
 * Plus an image-loading watcher (overhaul addition): the editor needs
 * to render real frame thumbnails drawn from the sibling sprite's
 * texture-map. Webviews can't read workspace files, so the host
 * resolves the chain (animation-controller → parent nexus → sprite →
 * albedo `textureMapKey` → matching texture-map → `filePath`), reads
 * the bytes, base64-encodes, and dispatches `image:loaded` whenever
 * the resolved path changes. Mirrors the texture-map editor's
 * watcher exactly — the `image:loaded` protocol message is shared.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { imageLoaded } from '../../protocol/index.js';
import { registerEditorPanel } from '../../panel/editor-base.js';
import type { DocumentRegistry } from '../../app/document-registry.js';
import type { DocumentController } from '../../app/document-controller.js';
import type { Bridge } from '../../bridge/index.js';
import { resolveTextureContext } from './texture-context.js';

export function registerAnimationEditor(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const handle = registerEditorPanel(ctx, {
    viewType: 'omosuen.animationEditor',
    titleFor: (componentId) => `Animations — id ${String(componentId)}`,
    webviewEntryPath: 'animation-editor.js',
    wireOutgoing: (bridge, { componentId, controller }) => {
      return wireImageLoading(bridge, controller, componentId);
    },
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

/**
 * Watches the animation-controller's resolved sibling-sprite/
 * texture-map chain for the panel's lifetime and pushes the loaded
 * image bytes to the webview as `image:loaded`. Returns a cleanup
 * that detaches the subscription.
 */
function wireImageLoading(
  bridge: Bridge,
  controller: DocumentController,
  componentId: number,
): () => void {
  let lastFilePath: string | null = null;
  let disposed = false;

  function currentFilePath(): string {
    const file = controller.editorState.sceneDocument.get();
    if (file === null) return '';
    const ctx = resolveTextureContext(file.scene, componentId);
    return ctx === null ? '' : ctx.filePath;
  }

  function loadAndPush(filePath: string): void {
    if (disposed) return;
    if (filePath === '') {
      bridge.dispatch(imageLoaded(null, ''));
      return;
    }
    const target = resolveFilePath(filePath);
    if (target === null) {
      bridge.dispatch(imageLoaded(null, filePath));
      return;
    }
    void vscode.workspace.fs.readFile(target).then(
      (bytes) => {
        if (disposed) return;
        // Re-check before pushing — the sibling-sprite or
        // texture-map's `filePath` may have changed during the async
        // read; only push if our load is still current.
        if (currentFilePath() !== filePath) return;
        const dataUri = bytesToDataUri(bytes, filePath);
        bridge.dispatch(imageLoaded(dataUri, filePath));
      },
      () => {
        if (disposed) return;
        if (currentFilePath() !== filePath) return;
        bridge.dispatch(imageLoaded(null, filePath));
      },
    );
  }

  function resolveFilePath(filePath: string): vscode.Uri | null {
    if (path.isAbsolute(filePath)) return vscode.Uri.file(filePath);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceRoot === undefined) return null;
    return vscode.Uri.joinPath(workspaceRoot, filePath);
  }

  function check(): void {
    const fp = currentFilePath();
    if (fp === lastFilePath) return;
    lastFilePath = fp;
    loadAndPush(fp);
  }

  // Initial load.
  check();

  const unsubscribe = controller.editorState.sceneDocument.subscribe(() => {
    check();
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}

function bytesToDataUri(bytes: Uint8Array, filePath: string): string {
  const mime = mimeFor(filePath);
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${base64}`;
}

function mimeFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'application/octet-stream';
}
