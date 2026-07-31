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
import { audioTracks, componentUpdate } from '../../protocol/index.js';
import type {
  AudioTrackEntry,
  EditorMessage,
  JsonValue,
  MessengerSendMessage,
} from '../../protocol/index.js';
import { registerEditorPanel } from '../../panel/editor-base.js';
import type { DocumentRegistry } from '../../app/document-registry.js';
import type { DocumentController } from '../../app/document-controller.js';
import type { Bridge } from '../../bridge/index.js';
import {
  EngineLoaderError,
  engineCacheDirUri,
  resolveEngineUri,
} from '../../app/engine-loader.js';
import { collectAudioTracks } from './audio-tracks.js';

export function registerAudioEditor(
  ctx: vscode.ExtensionContext,
  registry: DocumentRegistry,
): void {
  const handle = registerEditorPanel(ctx, {
    viewType: 'omosuen.audioEditor',
    titleFor: (componentId) => `Audio Effect — id ${String(componentId)}`,
    webviewEntryPath: 'audio-editor.js',
    allowWebviewResourceScripts: true,
    prepareWebview: async ({ webview, controller }) => {
      // Phase B playback uses the engine UMD's `Omosuen.TrackController`
      // for audio decoding + Web Audio graph management. Same pattern
      // the scene-preview custom editor uses (see
      // src/app/scene-editor-provider.ts) — engine cache dir is added
      // to localResourceRoots so the <script src> resolves; workspace
      // folder is added so the audio-track filePath URIs the host
      // pushes via `audio:tracks` are loadable by the webview's fetch.
      const file = controller.editorState.sceneDocument.get();
      const engineTag = file?.engine ?? '';
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const additionalResourceRoots: vscode.Uri[] = [];
      const extraScripts: { src: vscode.Uri }[] = [];
      if (workspaceFolder !== undefined) {
        additionalResourceRoots.push(workspaceFolder.uri);
        additionalResourceRoots.push(engineCacheDirUri(workspaceFolder.uri));
        if (engineTag !== '') {
          try {
            const engine = await resolveEngineUri({
              workspaceFolder: workspaceFolder.uri,
              engineTag,
              webview,
            });
            extraScripts.push({ src: engine.webviewUri });
          } catch (err) {
            // Engine UMD failed to load — Phase A's UI still works,
            // just without playback. Log to the dev console; the
            // webview's transport buttons stay disabled because the
            // `Omosuen` global will be missing.
            const detail =
              err instanceof EngineLoaderError ? err.message : String(err);
            console.warn(
              `[audio-editor] engine UMD unavailable (${detail}); playback disabled`,
            );
          }
        }
      }
      return { additionalResourceRoots, extraScripts };
    },
    wireOutgoing: (bridge, { componentId, controller, webviewPanel }) => {
      const disposeTracks = wireTrackList(
        bridge,
        controller,
        webviewPanel.webview,
      );
      const disposeMessenger = wireMessengerBridge(
        bridge,
        controller,
        componentId,
      );
      return () => {
        disposeTracks();
        disposeMessenger();
      };
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

/**
 * Bridge between the engine messenger inside the audio-editor
 * webview and the canonical omoscene file. Two halves:
 *
 *   1. Outgoing (engine → host): the webview's `audioEditorBridgeOut`
 *      method-listener forwards engine messenger envelopes through
 *      the webview Bridge as `messenger:send`. The host listens
 *      here and translates known patterns to `component:update` on
 *      the active document controller, which fans out to the
 *      inspector + scene tree + preview WS.
 *
 *   2. Incoming (host → engine): when any other panel mutates the
 *      audio-effect we're hosting (most often the inspector
 *      adjusting `volume` or `muted`), the broker re-broadcasts the
 *      `component:update` to every registered panel — including
 *      this audio editor's bridge. We translate it to a
 *      `messenger:send` envelope and dispatch it back into the
 *      webview, where the webview's `applyIncomingMessenger`
 *      handler calls `Messenger.broadcast` so engine listeners (the
 *      ui-overlay's slider syncers) update the DOM.
 */
function wireMessengerBridge(
  bridge: Bridge,
  controller: DocumentController,
  componentId: number,
): () => void {
  // Outgoing: webview emits messenger:send → host applies as
  // component:update on the omoscene file.
  const offIncoming = bridge.onMessage((msg: EditorMessage): void => {
    if (msg.kind !== 'messenger:send') return;
    routeMessengerSend(controller, componentId, msg);
  });

  // Reverse: when the broker fans out a component:update for the
  // audio-effect we host (originating from the inspector or any
  // other panel), forward it as a messenger:send so the engine
  // scene re-syncs its DOM.
  const offReverse = controller.editorState.subscribeMessages(
    (msg: EditorMessage) => {
      if (msg.kind !== 'component:update') return;
      if (msg.id !== componentId) return;
      if (msg.componentType !== 'audio-effect') return;
      bridge.dispatch({
        kind: 'messenger:send',
        pattern: 'audio-effect:incoming',
        data: { field: msg.property, value: msg.value },
      });
    },
  );

  return () => {
    offIncoming();
    offReverse();
  };
}

function routeMessengerSend(
  controller: DocumentController,
  componentId: number,
  msg: MessengerSendMessage,
): void {
  switch (msg.pattern) {
    case 'audio-effect:set': {
      // { field: string; value: JsonValue }
      const data = msg.data as
        | { field?: unknown; value?: unknown }
        | null
        | undefined;
      if (data === null || typeof data !== 'object') return;
      const field = data.field;
      const value = data.value;
      if (typeof field !== 'string' || field === '') return;
      controller.dispatchFromHost(
        componentUpdate(componentId, 'audio-effect', field, value as JsonValue),
      );
      break;
    }
    case 'audio-effect:set-mix': {
      // { mix: number[] } — whole-array write.
      const data = msg.data as { mix?: unknown } | null | undefined;
      if (data === null || typeof data !== 'object') return;
      const mix = data.mix;
      if (!Array.isArray(mix)) return;
      controller.dispatchFromHost(
        componentUpdate(componentId, 'audio-effect', 'mix', mix as JsonValue),
      );
      break;
    }
    // Unknown patterns are dropped — the engine messenger is broader
    // than the editor's persistence surface, so silent ignore is OK.
  }
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
