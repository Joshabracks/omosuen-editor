/**
 * Preview HTTP server (Phase 9.2).
 *
 * Serves the user's built Omosuen project root as static files, plus
 * two synthetic endpoints:
 *   - `GET /`  → `index.html` with the overlay script injected.
 *   - `GET /__omosuen_editor_overlay.js` → the client overlay bundled at
 *     build time via [esbuild.js](../../esbuild.js). If the bundle is
 *     absent (running from source without a build), returns a tiny stub
 *     that logs a warning in the browser so the developer sees why the
 *     overlay isn't active.
 *
 * WebSocket traffic at `/editor` is handled by
 * [websocket-host-bridge](../bridge/websocket-host-bridge.js), which
 * attaches to this server's `upgrade` event.
 *
 * Pure Node stdlib (`http`) — no express, no `mime-types` — keeps the
 * editor's runtime dep tree at `state-street + ws`. The MIME table
 * covers the types a built Omosuen game actually emits.
 */

import { createReadStream, promises as fsp, type ReadStream } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { posix, resolve as pathResolve, sep } from 'node:path';

export interface PreviewServerOptions {
  /** Absolute filesystem path of the user's project root. */
  readonly projectRoot: string;
  /** TCP port the server should bind. */
  readonly port: number;
  /**
   * Absolute path to the overlay bundle (`dist/preview-overlay.js`).
   * If null, the overlay endpoint returns a no-op stub.
   */
  readonly overlayBundlePath: string | null;
  /** Optional hostname; defaults to `127.0.0.1`. */
  readonly host?: string;
  /** Invoked for info + error lines. Plug into a VS Code OutputChannel. */
  readonly log?: (line: string) => void;
}

export interface PreviewServerHandle {
  readonly httpServer: HttpServer;
  readonly port: number;
  readonly url: string;
  dispose(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.omoscene': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
};

const OVERLAY_PATH = '/__omosuen_editor_overlay.js';
const OVERLAY_SCRIPT_TAG = `<script src="${OVERLAY_PATH}"></script>`;
const NOOP_OVERLAY_STUB = `console.warn('[omosuen] preview overlay bundle is missing — live sync unavailable');\n`;

export async function startPreviewServer(
  options: PreviewServerOptions,
): Promise<PreviewServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const log = options.log ?? ((): void => undefined);
  const projectRoot = pathResolve(options.projectRoot);

  const httpServer = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, projectRoot, options.overlayBundlePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[preview-server] request error: ${msg}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`preview-server error: ${msg}`);
    }
  });

  httpServer.on('error', (err: Error) => {
    log(`[preview-server] server error: ${err.message}`);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const boundPort = resolveBoundPort(httpServer, options.port);
  const url = `http://${host}:${boundPort}`;
  log(`[preview-server] listening at ${url}`);

  return {
    httpServer,
    port: boundPort,
    url,
    dispose(): Promise<void> {
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function resolveBoundPort(server: HttpServer, requested: number): number {
  const addr = server.address();
  if (addr !== null && typeof addr === 'object') {
    return (addr as AddressInfo).port;
  }
  return requested;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  overlayBundlePath: string | null,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }

  const urlPath = stripQuery(req.url ?? '/');

  if (urlPath === OVERLAY_PATH) {
    await serveOverlay(res, overlayBundlePath);
    return;
  }

  if (urlPath === '/' || urlPath === '/index.html') {
    await serveIndexHtml(res, projectRoot);
    return;
  }

  await serveStatic(res, projectRoot, urlPath);
}

function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

async function serveOverlay(
  res: ServerResponse,
  overlayBundlePath: string | null,
): Promise<void> {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (overlayBundlePath === null) {
    res.writeHead(200);
    res.end(NOOP_OVERLAY_STUB);
    return;
  }
  try {
    const bytes = await fsp.readFile(overlayBundlePath);
    res.writeHead(200);
    res.end(bytes);
  } catch {
    res.writeHead(200);
    res.end(NOOP_OVERLAY_STUB);
  }
}

async function serveIndexHtml(
  res: ServerResponse,
  projectRoot: string,
): Promise<void> {
  const indexPath = safeJoin(projectRoot, 'index.html');
  if (indexPath === null) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('index.html not found');
    return;
  }
  let html: string;
  try {
    html = await fsp.readFile(indexPath, 'utf8');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('index.html not found');
    return;
  }
  const injected = injectOverlay(html);
  res.writeHead(200, {
    'Content-Type': MIME['.html']!,
    'Cache-Control': 'no-store',
  });
  res.end(injected);
}

export function injectOverlay(html: string): string {
  if (html.includes(OVERLAY_SCRIPT_TAG)) return html;
  const closeBody = html.lastIndexOf('</body>');
  if (closeBody === -1) {
    return `${html}\n${OVERLAY_SCRIPT_TAG}\n`;
  }
  return `${html.slice(0, closeBody)}${OVERLAY_SCRIPT_TAG}\n${html.slice(closeBody)}`;
}

async function serveStatic(
  res: ServerResponse,
  projectRoot: string,
  urlPath: string,
): Promise<void> {
  const filePath = safeJoin(projectRoot, urlPath);
  if (filePath === null) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  if (stat.isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  const stream: ReadStream = createReadStream(filePath);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
}

function extname(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = slash === -1 ? p : p.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot);
}

/**
 * Resolve a URL-path under `root` safely: normalize the URL path and
 * reject anything that escapes the root via `..`. Null return = the
 * path was outside the root.
 */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponentSafe(urlPath);
  if (decoded === null) return null;
  // Force forward slashes through posix normalization so `../` tricks are
  // collapsed, then remap to native separators when joining with `root`.
  const normalized = posix.normalize(decoded).replace(/^\/+/, '');
  if (normalized === '') {
    return pathResolve(root);
  }
  if (normalized.startsWith('..')) return null;
  const nativeRelative = normalized.split('/').join(sep);
  const resolved = pathResolve(root, nativeRelative);
  const rootResolved = pathResolve(root);
  if (!resolved.startsWith(rootResolved + sep) && resolved !== rootResolved) {
    return null;
  }
  return resolved;
}

function decodeURIComponentSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
