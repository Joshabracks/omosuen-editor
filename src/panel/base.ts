/**
 * Extension-host panel factory.
 *
 * One `registerPanel(ctx, options)` call per panel. The factory owns the
 * focus-or-open lifecycle, the HTML template (4.2), the bridge (4.1),
 * and forwards a hook where callers subscribe their stores to the bridge
 * so state changes flow out to the webview.
 *
 * Panels never hand-roll this lifecycle — they supply options, they get
 * a disposable handle back.
 *
 * This module imports `vscode` at runtime, which is only available when
 * loaded by the VS Code extension host. It is NOT exercised by the
 * `tsx`-based test suite; Phase 4.5's sample panel + manual test prove
 * the wiring. Pure helpers (HTML template, bridge) have their own unit
 * tests in 4.1 / 4.2.
 */

import * as vscode from 'vscode';
import type { Bridge } from '../bridge/index.js';
import { createHostBridge } from '../bridge/index.js';
import { buildPanelHTML, generateNonce } from './html.js';

/**
 * A panel's `wireOutgoing` hook — called once per webview resolution.
 * Callers wire store subscribers that dispatch messages via the bridge
 * when relevant state changes. The returned `dispose` fires when the
 * webview is closed (view hidden, tab closed, or extension deactivated).
 */
export type PanelWireOutgoing = (
  bridge: Bridge,
  context: PanelWireContext,
) => () => void;

export interface PanelWireContext {
  readonly webviewView: vscode.WebviewView;
}

export interface RegisterPanelOptions {
  /**
   * The view id, matching a contribution in `package.json` under
   * `contributes.views`.
   */
  readonly id: string;
  /** Title shown on the view's header. */
  readonly title: string;
  /**
   * Phase 4 only supports sidebar views. Custom editors (`'editor'`
   * kind) arrive in Phase 6 for `.omoscene` files.
   */
  readonly kind: 'view';
  /**
   * Path under `dist/` to the bundled webview JS (e.g.
   * `'selection-info.js'`). Resolved at resolve-time via
   * `webview.asWebviewUri`.
   */
  readonly webviewEntryPath: string;
  /**
   * Optional outgoing-wire hook. Called once per resolve (i.e. whenever
   * the view becomes visible after having been hidden, VS Code may
   * re-resolve it). Return a cleanup function detached on disposal.
   */
  readonly wireOutgoing?: PanelWireOutgoing;
}

export interface PanelHandle {
  readonly id: string;
  /**
   * Bring the view into focus. For sidebar views this is the VS Code
   * convention `{viewId}.focus` command.
   */
  readonly reveal: () => PromiseLike<unknown>;
  /** Unregister the view provider. */
  readonly dispose: () => void;
}

export function registerPanel(
  ctx: vscode.ExtensionContext,
  options: RegisterPanelOptions,
): PanelHandle {
  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(view) {
      resolveView(view, ctx, options);
    },
  };

  const registration = vscode.window.registerWebviewViewProvider(
    options.id,
    provider,
  );
  ctx.subscriptions.push(registration);

  return {
    id: options.id,
    reveal(): PromiseLike<unknown> {
      return vscode.commands.executeCommand(`${options.id}.focus`);
    },
    dispose(): void {
      registration.dispose();
    },
  };
}

/**
 * Per-resolve setup. Each time VS Code shows the view (or re-shows it
 * after being hidden), this function runs: it configures the webview
 * options, sets the HTML, spins up a fresh bridge, and runs the
 * caller's outgoing-wire hook. Everything is attached to
 * `view.onDidDispose` so tab-close tears the whole thing down cleanly.
 */
function resolveView(
  view: vscode.WebviewView,
  ctx: vscode.ExtensionContext,
  options: RegisterPanelOptions,
): void {
  const distRoot = vscode.Uri.joinPath(ctx.extensionUri, 'dist');
  const mediaRoot = vscode.Uri.joinPath(ctx.extensionUri, 'media');

  view.webview.options = {
    enableScripts: true,
    // `mediaRoot` grants webview-resolved access to the packaged icon
    // set under `media/icons/components/*.svg`. Panels that need them
    // (scene tree) read the resolved base URI from the body
    // `data-icons-base` attribute; panels that don't just ignore it.
    localResourceRoots: [distRoot, mediaRoot],
  };

  const scriptUri = view.webview.asWebviewUri(
    vscode.Uri.joinPath(distRoot, options.webviewEntryPath),
  );
  const iconsBase = view.webview
    .asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'icons', 'components'))
    .toString();
  view.webview.html = buildPanelHTML({
    webview: view.webview,
    scriptUri,
    title: options.title,
    nonce: generateNonce(),
    bodyAttrs: { 'data-icons-base': iconsBase },
  });

  const bridge = createHostBridge({ webview: view.webview });
  const disposeOutgoing =
    options.wireOutgoing?.(bridge, { webviewView: view }) ??
    ((): void => undefined);

  view.onDidDispose(() => {
    disposeOutgoing();
    bridge.dispose();
  });
}
