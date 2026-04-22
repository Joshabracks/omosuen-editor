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
