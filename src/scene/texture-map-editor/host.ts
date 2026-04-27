/**
 * Texture-map (Frame) editor host-side registration (Phase 8.3).
 *
 * Registers `omosuen.openFrameEditor`, dispatched by the inspector's
 * "Open Frame Editor" action button. Mirrors the animation-editor
 * pattern, plus an extra responsibility unique to this editor: pushing
 * the source-image bytes into the webview as an `image:loaded` data
 * URI message. Webviews can't read workspace files; the host has to
 * resolve `filePath` against the document's folder, read the bytes,
 * base64-encode, and dispatch.
 *
 * On panel open we read the file once. On every subsequent change to
 * `filePath` (or the active document), we re-read. Stale-response
 * guard: each `image:loaded` echoes its `sourceFilePath`; the webview
 * ignores any whose echo doesn't match its current `filePath`.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { imageLoaded } from '../../protocol/index.js';
import type { SerializedComponent } from '../../omoscene/index.js';
import { registerEditorPanel } from '../../panel/editor-base.js';
import type { DocumentRegistry } from '../../app/document-registry.js';
import type { DocumentController } from '../../app/document-controller.js';
import type { Bridge } from '../../bridge/index.js';

export function registerTextureMapEditor(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const handle = registerEditorPanel(ctx, {
    viewType: 'omosuen.frameEditor',
    titleFor: (componentId) => `Frames — id ${String(componentId)}`,
    webviewEntryPath: 'texture-map-editor.js',
    wireOutgoing: (bridge, { componentId, controller }) => {
      return wireImageLoading(bridge, controller, componentId);
    },
  });

  const cmd = vscode.commands.registerCommand(
    'omosuen.openFrameEditor',
    (componentId: unknown) => {
      if (typeof componentId !== 'number' || !Number.isFinite(componentId)) {
        void vscode.window.showErrorMessage(
          'Omosuen: Open Frame Editor requires a numeric component id.',
        );
        return;
      }
      const controller = registry.activeController.get();
      if (controller === null) {
        void vscode.window.showErrorMessage(
          'Omosuen: open an .omoscene file before launching the Frame Editor.',
        );
        return;
      }
      handle.openFor(componentId, controller);
    },
  );
  ctx.subscriptions.push(cmd);
}

/**
 * Watches the target component's `filePath` for the panel's lifetime
 * and pushes the loaded image bytes to the webview as `image:loaded`.
 * Returns a cleanup that detaches the subscription.
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
    const target = findById(file.scene, componentId);
    if (target === null) return '';
    const v = target['filePath'];
    return typeof v === 'string' ? v : '';
  }

  function loadAndPush(filePath: string): void {
    if (disposed) return;
    if (filePath === '') {
      bridge.dispatch(imageLoaded(null, ''));
      return;
    }
    // Path convention is workspace-root-relative (matches `_old`'s
    // `loadImageAsDataUri` in animation-editor.ts: `path.join(projectRoot,
    // filePath)`). Absolute paths pass through unchanged so
    // user-typed absolute paths still resolve.
    const target = resolveFilePath(filePath);
    if (target === null) {
      bridge.dispatch(imageLoaded(null, filePath));
      return;
    }
    void vscode.workspace.fs.readFile(target).then(
      (bytes) => {
        if (disposed) return;
        // Re-check before pushing — `filePath` may have changed during
        // the async read; we only push if our load is still current.
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
    // Forward-slash → platform separator handled by Uri.joinPath.
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
  // VS Code Node context: `Buffer` is available. Keeping the host's
  // dependency footprint small — the alternative (chunked btoa) is
  // slower and only worth it inside webviews.
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
  // Fallback — browsers sniff the bytes anyway, but a sane default
  // avoids hostile MIME mismatches.
  return 'application/octet-stream';
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue;
    const c = child as SerializedComponent;
    const hit = findById(c, id);
    if (hit !== null) return hit;
  }
  return null;
}
