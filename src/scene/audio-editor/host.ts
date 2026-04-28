/**
 * Audio editor host-side registration (Phase 8.4 A).
 *
 * Registers `omosuen.openAudioEditor`, dispatched by the inspector's
 * "Open Audio Editor" action button on `audio-effect` components.
 * Plus an audio-tracks watcher that pushes `audio:tracks` whenever
 * the scene's set of audio-track components (or their `filePath`s)
 * changes — so the editor's track-selector dropdown stays in sync.
 *
 * Phase B will reuse the URIs in this message for engine-UMD-backed
 * playback decoding; Phase A only renders the dropdown.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { audioTracks } from '../../protocol/index.js';
import type { AudioTrackEntry } from '../../protocol/index.js';
import { registerEditorPanel } from '../../panel/editor-base.js';
import type { DocumentRegistry } from '../../app/document-registry.js';
import type { DocumentController } from '../../app/document-controller.js';
import type { Bridge } from '../../bridge/index.js';
import { collectAudioTracks } from './audio-tracks.js';

export function registerAudioEditor(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const handle = registerEditorPanel(ctx, {
    viewType: 'omosuen.audioEditor',
    titleFor: (componentId) => `Audio Effect — id ${String(componentId)}`,
    webviewEntryPath: 'audio-editor.js',
    wireOutgoing: (bridge, { controller, webviewPanel }) => {
      return wireTrackList(bridge, controller, webviewPanel.webview);
    },
  });

  const cmd = vscode.commands.registerCommand(
    'omosuen.openAudioEditor',
    (componentId: unknown) => {
      if (typeof componentId !== 'number' || !Number.isFinite(componentId)) {
        void vscode.window.showErrorMessage(
          'Omosuen: Open Audio Editor requires a numeric component id.',
        );
        return;
      }
      const controller = registry.activeController.get();
      if (controller === null) {
        void vscode.window.showErrorMessage(
          'Omosuen: open an .omoscene file before launching the audio editor.',
        );
        return;
      }
      handle.openFor(componentId, controller);
    },
  );
  ctx.subscriptions.push(cmd);
}

/**
 * Watch the scene for `audio-track` changes; whenever the set of
 * tracks (or any track's `filePath`) changes, recompute and dispatch
 * an `audio:tracks` message with the webview-resource URIs the
 * browser can use to fetch / decode each file. Stale-resilient: each
 * push reflects the current scene state at the moment it fires.
 */
function wireTrackList(
  bridge: Bridge,
  controller: DocumentController,
  webview: vscode.Webview,
): () => void {
  let lastSerialized = '';
  let disposed = false;

  function buildTrackEntries(): AudioTrackEntry[] {
    const file = controller.editorState.sceneDocument.get();
    if (file === null) return [];
    const tracks = collectAudioTracks(file.scene);
    return tracks.map((t) => ({
      id: t.id,
      name: t.name,
      filePath: t.filePath,
      uri: resolveUri(webview, t.filePath),
    }));
  }

  function check(): void {
    if (disposed) return;
    const entries = buildTrackEntries();
    // Hash-cheap dedupe: serialize and compare — entries are small
    // (a few tracks, each a tiny object), so JSON.stringify is fine.
    const serialized = JSON.stringify(entries);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    bridge.dispatch(audioTracks(entries));
  }

  // Initial push.
  check();

  const unsubscribe = controller.editorState.sceneDocument.subscribe(() => {
    check();
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}

function resolveUri(webview: vscode.Webview, filePath: string): string | null {
  if (filePath === '') return null;
  const absUri = resolveFilePath(filePath);
  if (absUri === null) return null;
  // `webview.asWebviewUri` rewrites the file:// URI into the
  // vscode-webview://... form the iframe can fetch. Without this the
  // browser blocks the request as a cross-origin file access.
  return webview.asWebviewUri(absUri).toString();
}

function resolveFilePath(filePath: string): vscode.Uri | null {
  if (path.isAbsolute(filePath)) return vscode.Uri.file(filePath);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (workspaceRoot === undefined) return null;
  return vscode.Uri.joinPath(workspaceRoot, filePath);
}
