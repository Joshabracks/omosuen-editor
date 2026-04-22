/**
 * Tests for the Phase 9.2 preview HTTP server.
 *
 * Each test spins up a real server against a tmpdir project root,
 * makes actual HTTP requests via `node:http`, and asserts the
 * response. No mocks — the MIME table, static-file behaviour, and
 * overlay injection are all integration-level surface.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  injectOverlay,
  startPreviewServer,
  type PreviewServerHandle,
} from '../app/preview-server.js';
import { test, testAsync } from './harness.js';

interface HttpResult {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

function fetch(url: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function setupProject(): Promise<{
  readonly root: string;
  readonly parent: string;
  cleanup(): Promise<void>;
}> {
  const parent = await mkdtemp(join(tmpdir(), 'omosuen-preview-'));
  const root = join(parent, 'project');
  await rm(root, { recursive: true, force: true });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'index.html'),
    `<!DOCTYPE html><html><body><canvas id="app"></canvas><script src="./dist/bundle.js"></script></body></html>`,
  );
  await writeFile(join(root, 'bundle.js'), '/* bundled game */\n');
  await writeFile(
    join(root, 'scene.omoscene'),
    JSON.stringify({ omoscene: 1 }),
  );
  // A sibling file *outside* the project root. If a URL traversal escapes,
  // we'd be able to read this — which is exactly what safeJoin prevents.
  await writeFile(join(parent, 'secret.env'), 'SHOULD_NOT_ESCAPE=1');
  return {
    root,
    parent,
    cleanup(): Promise<void> {
      return rm(parent, { recursive: true, force: true });
    },
  };
}

async function withServer<T>(
  projectRoot: string,
  overlayBundlePath: string | null,
  fn: (handle: PreviewServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await startPreviewServer({
    projectRoot,
    port: 0,
    overlayBundlePath,
  });
  try {
    return await fn(handle);
  } finally {
    await handle.dispose();
  }
}

export async function runPreviewServerTests(): Promise<void> {
  // --- injectOverlay (pure) ----------------------------------------------

  test('injectOverlay: inserts overlay script before </body>', () => {
    const html = '<html><body><canvas></canvas></body></html>';
    const out = injectOverlay(html);
    if (!out.includes('/__omosuen_editor_overlay.js')) {
      throw new Error('overlay path not present');
    }
    const overlayPos = out.indexOf('__omosuen_editor_overlay');
    const bodyClose = out.indexOf('</body>');
    if (overlayPos === -1 || bodyClose === -1 || overlayPos > bodyClose) {
      throw new Error('overlay should precede </body>');
    }
  });

  test('injectOverlay: appends to end if no </body> tag', () => {
    const html = '<html><body><canvas></canvas></html>';
    const out = injectOverlay(html);
    if (!out.includes('__omosuen_editor_overlay.js')) {
      throw new Error('overlay not added');
    }
  });

  test('injectOverlay: idempotent (does not double-inject)', () => {
    const html =
      '<html><body><canvas></canvas><script src="/__omosuen_editor_overlay.js"></script></body></html>';
    const out = injectOverlay(html);
    const matches = out.match(/__omosuen_editor_overlay/g) ?? [];
    if (matches.length !== 1) {
      throw new Error(`expected 1 script tag, got ${matches.length}`);
    }
  });

  // --- HTTP serving ------------------------------------------------------

  await testAsync(
    'GET / returns index.html with overlay injected',
    async () => {
      const { root, cleanup } = await setupProject();
      try {
        await withServer(root, null, async (h) => {
          const res = await fetch(`${h.url}/`);
          if (res.status !== 200) throw new Error(`status ${res.status}`);
          if (!res.contentType.startsWith('text/html')) {
            throw new Error(`bad content-type: ${res.contentType}`);
          }
          if (!res.body.includes('<canvas id="app">')) {
            throw new Error('index body missing');
          }
          if (!res.body.includes('/__omosuen_editor_overlay.js')) {
            throw new Error('overlay not injected');
          }
        });
      } finally {
        await cleanup();
      }
    },
  );

  await testAsync(
    'GET /bundle.js serves static JS with correct MIME',
    async () => {
      const { root, cleanup } = await setupProject();
      try {
        await withServer(root, null, async (h) => {
          const res = await fetch(`${h.url}/bundle.js`);
          if (res.status !== 200) throw new Error(`status ${res.status}`);
          if (!res.contentType.startsWith('application/javascript')) {
            throw new Error(`bad content-type: ${res.contentType}`);
          }
          if (!res.body.includes('bundled game')) {
            throw new Error('unexpected body');
          }
        });
      } finally {
        await cleanup();
      }
    },
  );

  await testAsync(
    'GET /scene.omoscene serves with JSON content type',
    async () => {
      const { root, cleanup } = await setupProject();
      try {
        await withServer(root, null, async (h) => {
          const res = await fetch(`${h.url}/scene.omoscene`);
          if (res.status !== 200) throw new Error(`status ${res.status}`);
          if (!res.contentType.startsWith('application/json')) {
            throw new Error(`bad content-type: ${res.contentType}`);
          }
        });
      } finally {
        await cleanup();
      }
    },
  );

  await testAsync('GET of a missing file returns 404', async () => {
    const { root, cleanup } = await setupProject();
    try {
      await withServer(root, null, async (h) => {
        const res = await fetch(`${h.url}/does-not-exist.js`);
        if (res.status !== 404) {
          throw new Error(`expected 404, got ${res.status}`);
        }
      });
    } finally {
      await cleanup();
    }
  });

  await testAsync(
    'GET with encoded path traversal cannot escape the project root',
    async () => {
      const { root, cleanup } = await setupProject();
      try {
        await withServer(root, null, async (h) => {
          // Node's URL class client-normalizes `../` before the request goes
          // out — so the only real server-side traversal vector is
          // percent-encoded. safeJoin must reject it.
          const encoded = await fetch(`${h.url}/%2e%2e/secret.env`);
          if (
            encoded.status === 200 &&
            encoded.body.includes('SHOULD_NOT_ESCAPE')
          ) {
            throw new Error('traversal succeeded via encoded ../');
          }
          // Sanity: an in-root file still works.
          const legit = await fetch(`${h.url}/bundle.js`);
          if (legit.status !== 200) {
            throw new Error('legitimate file should still be served');
          }
        });
      } finally {
        await cleanup();
      }
    },
  );

  await testAsync(
    'GET /__omosuen_editor_overlay.js returns stub when bundle is absent',
    async () => {
      const { root, cleanup } = await setupProject();
      try {
        await withServer(root, null, async (h) => {
          const res = await fetch(`${h.url}/__omosuen_editor_overlay.js`);
          if (res.status !== 200) throw new Error(`status ${res.status}`);
          if (!res.contentType.startsWith('application/javascript')) {
            throw new Error(`bad content-type: ${res.contentType}`);
          }
          if (!res.body.includes('preview overlay bundle is missing')) {
            throw new Error('expected stub message');
          }
        });
      } finally {
        await cleanup();
      }
    },
  );

  await testAsync('dispose frees the port', async () => {
    const { root, cleanup } = await setupProject();
    try {
      const h = await startPreviewServer({
        projectRoot: root,
        port: 0,
        overlayBundlePath: null,
      });
      const port = h.port;
      await h.dispose();
      // Second listen on the same port should succeed after dispose.
      const h2 = await startPreviewServer({
        projectRoot: root,
        port,
        overlayBundlePath: null,
      });
      await h2.dispose();
    } finally {
      await cleanup();
    }
  });
}
