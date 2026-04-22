/**
 * Panel HTML template builder.
 *
 * VS Code webviews require:
 *   - a Content-Security-Policy meta anchored to `webview.cspSource`
 *   - the script URI resolved through `webview.asWebviewUri` (can't be a
 *     raw `file://` or bare path)
 *   - explicit nonces on any `<script>` tag the CSP script-src allows
 *
 * The old editor duplicated this per-panel. This module is the single
 * home for the document frame; every panel built on `registerPanel`
 * renders through `buildPanelHTML`.
 *
 * State Street mounts to `<body>`. The body is intentionally empty here —
 * State Street's constructor replaces the body contents with its parsed
 * template.
 */

import type { Webview, Uri } from 'vscode';

export interface BuildPanelHTMLOptions {
  readonly webview: Webview;
  readonly scriptUri: Uri;
  readonly title: string;
  readonly nonce: string;
}

/**
 * Produce the full HTML document for a panel's webview.
 *
 * The output includes:
 *   - doctype + `<html lang="en">` + `<head>`
 *   - a charset + viewport meta
 *   - a strict CSP meta: `default-src 'none'`, script-src pinned to the
 *     provided nonce, style-src + font-src + img-src pinned to
 *     `webview.cspSource` (`'unsafe-inline'` on style-src for VS Code
 *     theme-var interpolation into element styles)
 *   - a `<style>` block passing VS Code theme variables into the body
 *     (background, foreground, font family) so panels inherit the
 *     active theme without per-panel stylesheets
 *   - an empty `<body>` — State Street replaces its content
 *   - a nonce-authorized `<script type="module" src>` pointing at the
 *     panel's bundle
 */
export function buildPanelHTML(options: BuildPanelHTMLOptions): string {
  const { webview, scriptUri, title, nonce } = options;
  const cspSource = webview.cspSource;
  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="UTF-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:; script-src 'nonce-${nonce}';" />`,
    `  <title>${escapeHtml(title)}</title>`,
    `  <style>`,
    `    html, body { margin: 0; padding: 0; height: 100%; }`,
    `    body {`,
    `      background: var(--vscode-editor-background);`,
    `      color: var(--vscode-editor-foreground);`,
    `      font-family: var(--vscode-font-family);`,
    `      font-size: var(--vscode-font-size);`,
    `      font-weight: var(--vscode-font-weight);`,
    `    }`,
    `  </style>`,
    `</head>`,
    `<body></body>`,
    `<script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>`,
    `</html>`,
  ].join('\n');
}

/**
 * Generate a CSP-safe nonce. VS Code docs recommend 32+ chars of
 * `[A-Za-z0-9]`. The caller passes this into `buildPanelHTML` so the
 * `<script>` tag authorized by the CSP matches.
 */
export function generateNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
