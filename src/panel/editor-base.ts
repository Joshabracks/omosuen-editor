/**
 * Editor-panel factory (Phase 8.1).
 *
 * Sibling of [registerPanel](./base.ts) for the other VS Code webview
 * flavour: imperatively-created `WebviewPanel`s that open in a new
 * editor tab rather than a sidebar view. Used by Phase 8's specialized
 * editors (animation, texture-map, cell-map-materials, cell-map).
 *
 * Convention — **one handle per editor type, one panel per component
 * id.** Opening the animation editor twice for the same component
 * re-reveals the existing panel instead of creating a duplicate
 * (mirrors `_old`'s `activePanel` singleton pattern). Opening for two
 * different animation-controllers opens two panels.
 *
 * Every editor panel bridges through the standard host bridge and
 * registers itself with the active `DocumentController`'s broker, so
 * `component:update` messages emitted from the editor automatically
 * reach the inspector, any other editor panels, and the preview WS
 * bridge — no orchestration in the editor host.
 */

import * as vscode from 'vscode';
import type { Bridge } from '../bridge/index.js';
import { createHostBridge } from '../bridge/index.js';
import type { DocumentController } from '../app/document-controller.js';
import { buildPanelHTML, generateNonce } from './html.js';

export interface EditorPanelWireContext {
  readonly componentId: number;
  readonly controller: DocumentController;
  readonly webviewPanel: vscode.WebviewPanel;
}

/**
 * Hook invoked once per resolved editor panel. Sets up outgoing wires
 * from host state to the webview (e.g. passing the initial selection
 * via `component:select`, hydrating on `scene:load`). Returns a cleanup
 * fired on panel disposal.
 */
export type EditorPanelWireOutgoing = (
  bridge: Bridge,
  context: EditorPanelWireContext,
) => () => void;

export interface RegisterEditorPanelOptions {
  /**
   * View-type id. Must match a `contributes.customEditors[*].viewType`
   * entry in `package.json` — OR be unused by any custom editor, since
   * we open via `createWebviewPanel`, not a custom-editor provider.
   * Convention: `omosuen.<editorName>Editor`.
   */
  readonly viewType: string;
  /** Callback producing the tab title for the given component id. */
  readonly titleFor: (componentId: number) => string;
  /**
   * Path under `dist/` to the bundled webview JS for this editor
   * (e.g. `'animation-editor.js'`).
   */
  readonly webviewEntryPath: string;
  /** Optional outgoing-wire hook; invoked once per panel open. */
  readonly wireOutgoing?: EditorPanelWireOutgoing;
  /**
   * When true, the CSP allows webview-resource scripts in addition to
   * the main bundle — matches the custom-editor preview pattern for
   * editors that need to load the engine UMD. Default false.
   */
  readonly allowWebviewResourceScripts?: boolean;
}

export interface EditorPanelHandle {
  /**
   * Open (or reveal the existing) panel for the given component id,
   * scoped to the passed document controller.
   */
  readonly openFor: (
    componentId: number,
    controller: DocumentController,
  ) => void;
  /** Close every open instance of this editor type. */
  readonly disposeAll: () => void;
}

interface OpenRecord {
  readonly panel: vscode.WebviewPanel;
  readonly bridge: Bridge;
  readonly disposeWire: () => void;
  readonly unregisterFromController: () => void;
}

export function registerEditorPanel(
  ctx: vscode.ExtensionContext,
  options: RegisterEditorPanelOptions,
): EditorPanelHandle {
  const open = new Map<number, OpenRecord>();

  function openFor(componentId: number, controller: DocumentController): void {
    const existing = open.get(componentId);
    if (existing !== undefined) {
      existing.panel.reveal(undefined, false);
      return;
    }

    const webviewPanel = vscode.window.createWebviewPanel(
      options.viewType,
      options.titleFor(componentId),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'dist')],
      },
    );

    const distRoot = vscode.Uri.joinPath(ctx.extensionUri, 'dist');
    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(distRoot, options.webviewEntryPath),
    );
    webviewPanel.webview.html = buildPanelHTML({
      webview: webviewPanel.webview,
      scriptUri,
      title: options.titleFor(componentId),
      nonce: generateNonce(),
      allowWebviewResourceScripts: options.allowWebviewResourceScripts ?? false,
      bodyAttrs: { 'data-component-id': String(componentId) },
    });

    const bridge = createHostBridge({ webview: webviewPanel.webview });
    const unregisterFromController = controller.registerPanel(bridge);
    const disposeWire =
      options.wireOutgoing?.(bridge, {
        componentId,
        controller,
        webviewPanel,
      }) ?? ((): void => undefined);

    const record: OpenRecord = {
      panel: webviewPanel,
      bridge,
      disposeWire,
      unregisterFromController,
    };
    open.set(componentId, record);

    webviewPanel.onDidDispose(() => {
      disposeWire();
      unregisterFromController();
      bridge.dispose();
      open.delete(componentId);
    });
  }

  function disposeAll(): void {
    for (const record of [...open.values()]) {
      record.panel.dispose();
    }
  }

  ctx.subscriptions.push({ dispose: disposeAll });

  return { openFor, disposeAll };
}
