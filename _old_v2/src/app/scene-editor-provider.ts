/**
 * Custom editor for `.omoscene` files (Phase 6.2 + 6.5).
 *
 * Registers `omosuen.sceneEditor` as a `CustomTextEditorProvider`. On
 * open we:
 *
 *   1. Parse the document text into an `OmosceneFile`.
 *   2. Get-or-create the `DocumentController` for the URI and seed it
 *      with the loaded file.
 *   3. Async-resolve the engine UMD via 6.3's engine loader (downloads
 *      to `.omosuen_editor/` on cache miss).
 *   4. Build the webview HTML via [buildPanelHTML](../panel/html.ts)
 *      with `allowWebviewResourceScripts: true` and `extraScripts: [engineUri]`
 *      so `window.Omosuen` is defined before the preview bundle runs.
 *   5. Wire the webview's bridge through the controller.
 *   6. Mirror `editorState.sceneDocument` into the `TextDocument` via
 *      `WorkspaceEdit` so VS Code's native save flow persists edits.
 *
 * External edits to the same file in a parallel text editor are NOT
 * synced back to the store — that's a Phase 7+ concern.
 */

import * as vscode from 'vscode';
import { parse, stringify } from '../omoscene/index.js';
import type { OmosceneFile } from '../omoscene/index.js';
import { createHostBridge } from '../bridge/index.js';
import { sceneLoad } from '../protocol/index.js';
import { buildPanelHTML, generateNonce } from '../panel/html.js';
import type { DocumentRegistry } from './document-registry.js';
import {
  EngineLoaderError,
  engineCacheDirUri,
  resolveEngineUri,
} from './engine-loader.js';

const VIEW_TYPE = 'omosuen.sceneEditor';

export function registerSceneEditorProvider(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, webviewPanel) {
      void resolveOmosceneEditor(ctx, registry, document, webviewPanel);
    },
  };

  const registration = vscode.window.registerCustomEditorProvider(
    VIEW_TYPE,
    provider,
    {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    },
  );
  ctx.subscriptions.push(registration);
}

async function resolveOmosceneEditor(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
): Promise<void> {
  // 1. Parse.
  let initialFile: OmosceneFile;
  try {
    initialFile = parse(document.getText());
  } catch (err) {
    panel.webview.html = errorFrame(
      document.uri.fsPath,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  // 2. Controller + initial store population.
  const controller = registry.getOrCreateController(document.uri);
  controller.editorState.dispatch(sceneLoad(initialFile));

  // Workspace folder for engine cache lookup.
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (workspaceFolder === undefined) {
    panel.webview.html = errorFrame(
      document.uri.fsPath,
      'Open a workspace folder containing the .omoscene file so the engine cache (.omosuen_editor/) can be anchored.',
    );
    return;
  }

  // 3. Configure webview options. Include the engine cache dir so
  //    `asWebviewUri` will resolve the UMD's local URI.
  const distRoot = vscode.Uri.joinPath(ctx.extensionUri, 'dist');
  const cacheDir = engineCacheDirUri(workspaceFolder.uri);
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [distRoot, cacheDir],
  };

  // 4. Loading placeholder while the engine resolves (may download).
  panel.webview.html = loadingFrame(panel, document.uri.fsPath);

  // 5. Resolve the engine (cache hit or HTTPS download).
  let engineWebviewUri: vscode.Uri;
  try {
    const engineResult = await resolveEngineUri({
      workspaceFolder: workspaceFolder.uri,
      engineTag: initialFile.engine,
      webview: panel.webview,
    });
    engineWebviewUri = engineResult.webviewUri;
  } catch (err) {
    const message =
      err instanceof EngineLoaderError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    panel.webview.html = errorFrame(document.uri.fsPath, message);
    return;
  }

  // 6. Build the real HTML with engine script + preview bundle.
  const previewScriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(distRoot, 'preview.js'),
  );
  panel.webview.html = buildPanelHTML({
    webview: panel.webview,
    scriptUri: previewScriptUri,
    title: `Preview: ${document.uri.fsPath}`,
    nonce: generateNonce(),
    allowWebviewResourceScripts: true,
    extraScripts: [{ src: engineWebviewUri }],
  });

  // 7. Wire bridge through the controller.
  const bridge = createHostBridge({ webview: panel.webview });
  const unregisterBridge = controller.registerPanel(bridge);

  // 8. Editor-state → TextDocument sync via WorkspaceEdit, so VS Code's
  //    save flow sees a dirty document and persists on Ctrl+S.
  const unsubTextSync = controller.editorState.sceneDocument.subscribe(
    (file) => {
      if (file === null) return;
      const nextText = stringify(file);
      if (document.getText() === nextText) return;
      void applyFullTextReplace(document, nextText);
    },
  );

  // 9. Active-URI tracking — sidebars follow the focused tab.
  if (panel.active) registry.setActiveUri(document.uri);
  const viewStateSub = panel.onDidChangeViewState((e) => {
    if (e.webviewPanel.active) {
      registry.setActiveUri(document.uri);
    }
  });

  // 10. Dispose wiring on tab close.
  panel.onDidDispose(() => {
    unregisterBridge();
    unsubTextSync();
    viewStateSub.dispose();
  });
}

async function applyFullTextReplace(
  document: vscode.TextDocument,
  nextText: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const lastLine = Math.max(0, document.lineCount - 1);
  const lastLineEndCol = document.lineAt(lastLine).range.end.character;
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, lastLineEndCol),
    nextText,
  );
  await vscode.workspace.applyEdit(edit);
}

function loadingFrame(panel: vscode.WebviewPanel, path: string): string {
  const cspSource = panel.webview.cspSource;
  const safePath = escapeHtml(path);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';" />
  <title>Loading ${safePath}</title>
  <style>
    body {
      margin: 0;
      padding: 2em;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
  </style>
</head>
<body>
  <h2 style="margin-top: 0;">Loading scene…</h2>
  <p style="color: var(--vscode-descriptionForeground);">
    <code>${safePath}</code>
  </p>
  <p style="color: var(--vscode-descriptionForeground);">
    Resolving engine UMD (first open may download to
    <code>.omosuen_editor/</code>).
  </p>
</body>
</html>`;
}

function errorFrame(path: string, message: string): string {
  const safePath = escapeHtml(path);
  const safeMsg = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Omoscene parse error</title>
  <style>
    body {
      margin: 0;
      padding: 2em;
      background: var(--vscode-editor-background);
      color: var(--vscode-errorForeground);
      font-family: var(--vscode-font-family);
    }
    pre {
      white-space: pre-wrap;
      background: var(--vscode-textCodeBlock-background);
      padding: 1em;
      border-left: 3px solid var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <h2>Could not open ${safePath}</h2>
  <pre>${safeMsg}</pre>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
