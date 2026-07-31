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
 *
 * Phase 6.0 extended this with `allowWebviewResourceScripts` +
 * `extraScripts` so the scene-preview custom editor can load the engine
 * UMD alongside the panel bundle (engine URI arrives via
 * `webview.asWebviewUri`, so CSP must grant `${webview.cspSource}` in
 * `script-src`). Sidebars keep the tighter nonce-only default.
 */

import type { Webview, Uri } from 'vscode';

export interface BuildPanelHTMLOptions {
  readonly webview: Webview;
  readonly scriptUri: Uri;
  readonly title: string;
  readonly nonce: string;
  /**
   * When true, CSP `script-src` allows webview-resource URIs in addition
   * to the nonced panel bundle. Required if `extraScripts` is non-empty
   * (those scripts load via `webview.asWebviewUri`). Default false —
   * pure panels that only run their own bundle should leave it off.
   */
  readonly allowWebviewResourceScripts?: boolean;
  /**
   * Additional scripts injected *before* the main panel bundle. Each
   * entry's `src` is a webview-resolved URI (caller runs
   * `webview.asWebviewUri` before passing). Scripts are marked `defer`
   * so they run after DOM parse, in source order, and before the
   * `type="module"` main script — the panel bundle can rely on any
   * globals these set (e.g. `window.Omosuen`).
   *
   * Using this requires `allowWebviewResourceScripts: true`.
   */
  readonly extraScripts?: readonly { readonly src: Uri }[];
  /**
   * Optional attributes rendered on the `<body>` element. Used by the
   * Phase 8 editor-panel factory to bake the target component id into
   * the HTML as a `data-component-id` attribute, so the panel bundle
   * reads its focus target synchronously on boot without a round-trip
   * message. Keys must be `[a-z][a-z0-9-]*`; values are HTML-escaped.
   */
  readonly bodyAttrs?: Record<string, string>;
}

/**
 * Produce the full HTML document for a panel's webview.
 */
export function buildPanelHTML(options: BuildPanelHTMLOptions): string {
  const {
    webview,
    scriptUri,
    title,
    nonce,
    allowWebviewResourceScripts = false,
    extraScripts = [],
    bodyAttrs = {},
  } = options;

  if (extraScripts.length > 0 && !allowWebviewResourceScripts) {
    throw new Error(
      'buildPanelHTML: extraScripts requires allowWebviewResourceScripts: true',
    );
  }

  const bodyAttrString = Object.entries(bodyAttrs)
    .map(([k, v]) => {
      if (!/^[a-z][a-z0-9-]*$/.test(k)) {
        throw new Error(
          `buildPanelHTML: invalid bodyAttrs key "${k}" (must match [a-z][a-z0-9-]*)`,
        );
      }
      return ` ${k}="${escapeHtml(v)}"`;
    })
    .join('');

  const cspSource = webview.cspSource;
  // `blob:` is included in script-src whenever extra resource scripts
  // are allowed because the engine UMD's audio-player uses
  // `URL.createObjectURL(new Blob([workletSource]))` +
  // `audioContext.audioWorklet.addModule(blobUrl)` to register the
  // pitch/speed-shifter worklet. CSP gates `addModule` the same as
  // `<script src>`, so without `blob:` audio playback fails silently
  // with a CSP violation. Webview blob URLs are origin-bound to
  // `vscode-webview://...` so the relaxation doesn't widen the
  // attack surface meaningfully.
  const scriptSrc = allowWebviewResourceScripts
    ? `'nonce-${nonce}' ${cspSource} blob:`
    : `'nonce-${nonce}'`;

  const extraScriptTags = extraScripts
    .map((s) => `<script src="${s.src.toString()}" defer></script>`)
    .join('\n');

  const lines = [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="UTF-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
    `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:; script-src ${scriptSrc};" />`,
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
    `<body${bodyAttrString}></body>`,
  ];
  if (extraScriptTags !== '') lines.push(extraScriptTags);
  lines.push(
    `<script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>`,
    `</html>`,
  );
  return lines.join('\n');
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
