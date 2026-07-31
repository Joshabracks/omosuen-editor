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

/**
 * Async hook that runs after the webview panel is created but
 * before the HTML is set. Lets the host:
 *   - extend `localResourceRoots` (e.g. add the workspace folder
 *     so the audio editor can fetch source audio files via
 *     `webview.asWebviewUri`, or the engine cache directory so the
 *     UMD `<script src>` resolves).
 *   - return additional `<script>` URIs to inject before the main
 *     panel bundle (the engine UMD is the canonical use case).
 *
 * Both pieces are needed only at the moment of panel creation, so
 * keeping this as an async hook the host owns is simpler than
 * threading additional asynchronous results through `openFor`'s
 * sync callsites.
 */
export type PrepareWebview = (ctx: {
  readonly webview: vscode.Webview;
  readonly componentId: number;
  readonly controller: DocumentController;
}) => Promise<{
  readonly extraScripts?: readonly { readonly src: vscode.Uri }[];
  readonly additionalResourceRoots?: readonly vscode.Uri[];
} | void>;

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
  /**
   * Async preparation hook (engine-UMD loading + extending
   * `localResourceRoots`). When set, panel HTML is set after this
   * resolves; until then the webview displays a brief "loading"
   * placeholder.
   */
  readonly prepareWebview?: PrepareWebview;
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

    if (options.prepareWebview !== undefined) {
      // Async prep path — show a loading placeholder while engine
      // UMD downloads / cache resolves, then set the real HTML.
      webviewPanel.webview.html = loadingPlaceholderHTML();
      finalizePanel(webviewPanel, componentId, controller).catch(
        (err: unknown) => {
          const detail = err instanceof Error ? err.message : String(err);
          webviewPanel.webview.html = errorPlaceholderHTML(detail);
        },
      );
    } else {
      finalizePanelSync(webviewPanel, componentId, controller);
    }
  }

  function finalizePanelSync(
    webviewPanel: vscode.WebviewPanel,
    componentId: number,
    controller: DocumentController,
  ): void {
    setPanelHtml(webviewPanel, componentId, [], false);
    attachPanelLifecycle(webviewPanel, componentId, controller);
  }

  async function finalizePanel(
    webviewPanel: vscode.WebviewPanel,
    componentId: number,
    controller: DocumentController,
  ): Promise<void> {
    const prep =
      (await options.prepareWebview?.({
        webview: webviewPanel.webview,
        componentId,
        controller,
      })) ?? {};
    const additionalRoots = prep.additionalResourceRoots ?? [];
    const extraScripts = prep.extraScripts ?? [];
    if (additionalRoots.length > 0) {
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(ctx.extensionUri, 'dist'),
          ...additionalRoots,
        ],
      };
    }
    setPanelHtml(webviewPanel, componentId, extraScripts, true);
    attachPanelLifecycle(webviewPanel, componentId, controller);
  }

  function setPanelHtml(
    webviewPanel: vscode.WebviewPanel,
    componentId: number,
    extraScripts: readonly { readonly src: vscode.Uri }[],
    extraAllowed: boolean,
  ): void {
    const distRoot = vscode.Uri.joinPath(ctx.extensionUri, 'dist');
    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(distRoot, options.webviewEntryPath),
    );
    webviewPanel.webview.html = buildPanelHTML({
      webview: webviewPanel.webview,
      scriptUri,
      title: options.titleFor(componentId),
      nonce: generateNonce(),
      allowWebviewResourceScripts:
        extraAllowed || (options.allowWebviewResourceScripts ?? false),
      extraScripts,
      bodyAttrs: { 'data-component-id': String(componentId) },
    });
  }

  function attachPanelLifecycle(
    webviewPanel: vscode.WebviewPanel,
    componentId: number,
    controller: DocumentController,
  ): void {
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

  function loadingPlaceholderHTML(): string {
    // Bare-bones HTML; Phase 8.4 audio editor uses this while the
    // engine UMD downloads / cache resolves on first open.
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:system-ui,sans-serif;padding:1em;color:var(--vscode-descriptionForeground);}</style></head><body>Loading editor…</body></html>`;
  }

  function errorPlaceholderHTML(message: string): string {
    const escaped = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:system-ui,sans-serif;padding:1em;color:var(--vscode-errorForeground);}</style></head><body><h3>Editor failed to load</h3><pre>${escaped}</pre></body></html>`;
  }

  function disposeAll(): void {
    for (const record of [...open.values()]) {
      record.panel.dispose();
    }
  }

  ctx.subscriptions.push({ dispose: disposeAll });

  return { openFor, disposeAll };
}
