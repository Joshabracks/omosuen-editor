/**
 * Tests for the panel HTML template builder (`src/panel/html.ts`).
 *
 * String-level assertions only — no DOM. The builder is a pure function
 * and its CSP / script-uri / nonce plumbing is load-bearing for VS Code
 * webview security; all of those need to survive future edits.
 */

import { buildPanelHTML, generateNonce } from '../panel/html.js';
import { test } from './harness.js';

// Fake just enough of `vscode.Webview` + `vscode.Uri` to exercise the
// builder without pulling the real `vscode` runtime into Node tests.
function fakeWebview(cspSource: string): import('vscode').Webview {
  return {
    cspSource,
  } as unknown as import('vscode').Webview;
}

function fakeUri(path: string): import('vscode').Uri {
  return {
    toString: () => path,
  } as unknown as import('vscode').Uri;
}

export function runPanelHTMLTests(): void {
  test('buildPanelHTML: includes doctype and lang="en"', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('vscode-webview://source'),
      scriptUri: fakeUri('vscode-webview://host/dist/panel.js'),
      title: 'Test',
      nonce: 'abc123',
    });
    if (!html.startsWith('<!DOCTYPE html>')) {
      throw new Error('expected html to start with doctype');
    }
    if (!html.includes('<html lang="en">')) {
      throw new Error('expected lang="en" on html element');
    }
  });

  test('buildPanelHTML: CSP meta references webview.cspSource', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('vscode-webview://CSPsource-xyz'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
    });
    if (!html.includes('Content-Security-Policy')) {
      throw new Error('missing CSP meta');
    }
    if (!html.includes('vscode-webview://CSPsource-xyz')) {
      throw new Error('CSP meta must embed webview.cspSource');
    }
    if (!html.includes(`default-src 'none'`)) {
      throw new Error('CSP must start from default-src none');
    }
  });

  test('buildPanelHTML: CSP script-src pins to the nonce', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('ws'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'THE_NONCE',
    });
    if (!html.includes(`script-src 'nonce-THE_NONCE'`)) {
      throw new Error('script-src must include the nonce');
    }
  });

  test('buildPanelHTML: script tag uses the scriptUri and nonce', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('ws'),
      scriptUri: fakeUri('vscode-webview://host/dist/panel.js'),
      title: 'T',
      nonce: 'nonce_value',
    });
    if (
      !html.includes(
        '<script type="module" nonce="nonce_value" src="vscode-webview://host/dist/panel.js"></script>',
      )
    ) {
      throw new Error('script tag not assembled correctly');
    }
  });

  test('buildPanelHTML: includes body with theme-var styles', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('ws'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
    });
    if (!html.includes('var(--vscode-editor-background)')) {
      throw new Error('body should inherit --vscode-editor-background');
    }
    if (!html.includes('var(--vscode-editor-foreground)')) {
      throw new Error('body should inherit --vscode-editor-foreground');
    }
    if (!html.includes('var(--vscode-font-family)')) {
      throw new Error('body should inherit --vscode-font-family');
    }
  });

  test('buildPanelHTML: body is empty (State Street mounts here)', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('ws'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
    });
    if (!html.includes('<body></body>')) {
      throw new Error('body must be empty so State Street can mount');
    }
  });

  test('buildPanelHTML: escapes HTML-sensitive characters in title', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('ws'),
      scriptUri: fakeUri('x'),
      title: '<script>alert("x")</script>',
      nonce: 'N',
    });
    if (html.includes('<script>alert')) {
      throw new Error('title must be HTML-escaped');
    }
    if (!html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')) {
      throw new Error('title escape looked wrong');
    }
  });

  test('generateNonce: produces 32-char alphanumeric string', () => {
    const nonce = generateNonce();
    if (nonce.length !== 32) {
      throw new Error(`expected 32 chars, got ${nonce.length}`);
    }
    if (!/^[A-Za-z0-9]+$/.test(nonce)) {
      throw new Error(`nonce must be [A-Za-z0-9]+, got ${nonce}`);
    }
  });

  // --- 6.0 additions: allowWebviewResourceScripts + extraScripts --------

  test('buildPanelHTML: by default, script-src is nonce-only (no cspSource)', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('WS-SOURCE'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
    });
    // nonce present, cspSource should NOT appear in script-src directive.
    const cspMatch = html.match(/script-src [^;"]*/);
    if (cspMatch === null) throw new Error('no script-src directive found');
    const scriptSrc = cspMatch[0];
    if (!scriptSrc.includes(`'nonce-N'`)) {
      throw new Error('script-src should include the nonce');
    }
    if (scriptSrc.includes('WS-SOURCE')) {
      throw new Error('default script-src must not include webview.cspSource');
    }
  });

  test('buildPanelHTML: allowWebviewResourceScripts adds cspSource to script-src', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('WS-SOURCE'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
      allowWebviewResourceScripts: true,
    });
    const cspMatch = html.match(/script-src [^;"]*/);
    if (cspMatch === null) throw new Error('no script-src directive found');
    const scriptSrc = cspMatch[0];
    if (!scriptSrc.includes(`'nonce-N'`) || !scriptSrc.includes('WS-SOURCE')) {
      throw new Error(
        `script-src should include nonce + cspSource, got: ${scriptSrc}`,
      );
    }
  });

  test('buildPanelHTML: allowWebviewResourceScripts also grants blob: for AudioWorklet', () => {
    // The engine UMD's audio-player calls
    // `audioContext.audioWorklet.addModule(blobUrl)` to register a
    // pitch/speed-shifter worklet. CSP gates that call the same as
    // <script src>, so without `blob:` audio playback fails silently.
    const html = buildPanelHTML({
      webview: fakeWebview('WS-SOURCE'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
      allowWebviewResourceScripts: true,
    });
    const cspMatch = html.match(/script-src [^;"]*/);
    if (cspMatch === null) throw new Error('no script-src directive found');
    if (!cspMatch[0].includes('blob:')) {
      throw new Error(`script-src should include blob:, got: ${cspMatch[0]}`);
    }
  });

  test('buildPanelHTML: default script-src does NOT include blob:', () => {
    // The default panel doesn't load an engine UMD or any other
    // script that needs blob:. Keep CSP as tight as possible there.
    const html = buildPanelHTML({
      webview: fakeWebview('WS-SOURCE'),
      scriptUri: fakeUri('x'),
      title: 'T',
      nonce: 'N',
    });
    const cspMatch = html.match(/script-src [^;"]*/);
    if (cspMatch === null) throw new Error('no script-src directive found');
    if (cspMatch[0].includes('blob:')) {
      throw new Error(
        `default script-src should not include blob:, got: ${cspMatch[0]}`,
      );
    }
  });

  test('buildPanelHTML: extraScripts emit defer tags before the main module', () => {
    const html = buildPanelHTML({
      webview: fakeWebview('WS'),
      scriptUri: fakeUri('vscode-webview://host/dist/panel.js'),
      title: 'T',
      nonce: 'N',
      allowWebviewResourceScripts: true,
      extraScripts: [{ src: fakeUri('vscode-webview://host/cache/engine.js') }],
    });
    if (
      !html.includes(
        '<script src="vscode-webview://host/cache/engine.js" defer></script>',
      )
    ) {
      throw new Error('extra script tag missing or malformed');
    }
    const enginePos = html.indexOf('engine.js');
    const panelPos = html.indexOf('panel.js');
    if (enginePos === -1 || panelPos === -1) {
      throw new Error('both script tags should be present');
    }
    if (enginePos > panelPos) {
      throw new Error('extra scripts must appear before the main module');
    }
  });

  test('buildPanelHTML: extraScripts without allowWebviewResourceScripts throws', () => {
    try {
      buildPanelHTML({
        webview: fakeWebview('WS'),
        scriptUri: fakeUri('x'),
        title: 'T',
        nonce: 'N',
        extraScripts: [{ src: fakeUri('engine.js') }],
      });
      throw new Error('expected throw');
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !err.message.includes('allowWebviewResourceScripts')
      ) {
        throw new Error(`unexpected error: ${String(err)}`);
      }
    }
  });

  test('generateNonce: consecutive calls differ', () => {
    const a = generateNonce();
    const b = generateNonce();
    // Collision probability over 32 chars of 62 alphabet is ~62^-32;
    // assert inequality as a sanity check that randomness is wired up.
    if (a === b) {
      throw new Error('two consecutive nonces should not match');
    }
  });
}
