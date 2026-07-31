/**
 * WebSocket-transport host bridge (Phase 9.3).
 *
 * Wraps a `ws.WebSocketServer` into the same `Bridge` contract used by
 * the webview-postMessage transport. That means the document-controller
 * broker treats a running preview-game instance identically to any
 * other panel: incoming `component:select` / `component:update` flows
 * into host state and fan-outs to other panels; outgoing `component:
 * update` (inspector edits) reaches the running game live.
 *
 * Attach mode: the bridge does NOT bind a port itself. It attaches to
 * an already-created `http.Server` via `ws`'s `noServer: true` option —
 * the preview HTTP server ([src/app/preview-server.ts](./preview-server.js))
 * hands off `upgrade` events at the `/editor` path. One HTTP port is
 * thus shared by static files + WS (same as the archived editor's
 * `_old/src/bridge/server.ts`).
 *
 * Broadcast semantics: `dispatch(msg)` sends to every connected client
 * socket. With zero clients it is a silent no-op, mirroring `_old`.
 * The first real client is typically the browser tab opened by the
 * `omosuen.previewScene` command.
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { EditorMessage } from '../protocol/index.js';
import {
  ProtocolDecodeError,
  ProtocolEncodeError,
  decodeMessage,
  encodeMessage,
} from '../protocol/index.js';
import type { Bridge, BridgeErrorHandler, BridgeListener } from './types.js';

export interface WebsocketHostBridgeOptions {
  readonly httpServer: HttpServer;
  /** URL path the browser connects to. Defaults to `/editor`. */
  readonly path?: string;
  readonly onError?: BridgeErrorHandler;
}

export interface WebsocketHostBridge extends Bridge {
  /** Number of currently-connected preview clients. */
  readonly clientCount: () => number;
}

export function createWebsocketHostBridge(
  options: WebsocketHostBridgeOptions,
): WebsocketHostBridge {
  const path = options.path ?? '/editor';
  const onError = options.onError ?? defaultOnError;
  const listeners = new Set<BridgeListener>();
  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void {
    const url = request.url ?? '/';
    // `url` from Node is path + query — match only the path portion.
    const pathOnly = url.split('?', 1)[0] ?? '/';
    if (pathOnly !== path) {
      // Not ours; let any other upgrade handler have a turn, or reject.
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }

  options.httpServer.on('upgrade', handleUpgrade);

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);

    ws.on('message', (raw: Buffer) => {
      const text = raw.toString('utf8');
      let msg: EditorMessage;
      try {
        msg = decodeMessage(text);
      } catch (err) {
        if (err instanceof ProtocolDecodeError) {
          onError(err, text);
          return;
        }
        throw err;
      }
      // Snapshot before iterating — a listener that unsubscribes others
      // mid-notify must not disturb delivery to peers that existed at
      // receive time (same guarantee as host-bridge.ts).
      for (const listener of [...listeners]) listener(msg);
    });

    ws.on('error', (err: Error) => {
      onError(err, '');
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  let disposed = false;

  return {
    dispatch(msg: EditorMessage): void {
      if (disposed) return;
      let encoded: string;
      try {
        encoded = encodeMessage(msg);
      } catch (err) {
        if (err instanceof ProtocolEncodeError) {
          onError(err, '');
          return;
        }
        throw err;
      }
      for (const ws of [...clients]) {
        if (ws.readyState === ws.OPEN) {
          ws.send(encoded);
        }
      }
    },
    onMessage(listener: BridgeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clientCount(): number {
      return clients.size;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      options.httpServer.off('upgrade', handleUpgrade);
      for (const ws of [...clients]) {
        try {
          ws.close();
        } catch {
          // Ignore close-time errors — we're tearing down anyway.
        }
      }
      clients.clear();
      listeners.clear();
      wss.close();
    },
  };
}

function defaultOnError(error: Error, raw: string): void {
  const preview = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
  console.warn(
    `[ws-bridge] ${error.message}${preview ? ` (raw: ${preview})` : ''}`,
  );
}
