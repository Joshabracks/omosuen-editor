/**
 * Tests for the Phase 9.3 WebSocket host bridge.
 *
 * Spins up an ephemeral HTTP server, attaches the bridge, and drives it
 * with a real `ws` client — this catches the real upgrade-handshake +
 * message-framing behaviour, not a mock.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createWebsocketHostBridge } from '../bridge/websocket-host-bridge.js';
import type { EditorMessage } from '../protocol/index.js';
import {
  componentSelect,
  componentUpdate,
  encodeMessage,
  previewLog,
  previewReady,
} from '../protocol/index.js';
import { assertDeepEqual, testAsync } from './harness.js';

interface Harness {
  readonly httpServer: HttpServer;
  readonly port: number;
  dispose(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const httpServer = createServer();
  await new Promise<void>((resolve) =>
    httpServer.listen(0, '127.0.0.1', resolve),
  );
  const port = (httpServer.address() as AddressInfo).port;
  return {
    httpServer,
    port,
    dispose(): Promise<void> {
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function openClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data: Buffer) => resolve(data.toString('utf8')));
    ws.once('error', reject);
  });
}

function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once('close', () => resolve());
    ws.close();
  });
}

export async function runWebsocketHostBridgeTests(): Promise<void> {
  await testAsync('dispatch with zero clients is a silent no-op', async () => {
    const h = await startHarness();
    const bridge = createWebsocketHostBridge({ httpServer: h.httpServer });
    try {
      bridge.dispatch(componentSelect([1, 2]));
      if (bridge.clientCount() !== 0) {
        throw new Error('expected 0 clients');
      }
    } finally {
      bridge.dispose();
      await h.dispose();
    }
  });

  await testAsync(
    'client receives broadcast after upgrade on /editor',
    async () => {
      const h = await startHarness();
      const bridge = createWebsocketHostBridge({ httpServer: h.httpServer });
      try {
        const ws = await openClient(`ws://127.0.0.1:${h.port}/editor`);
        try {
          const msg = componentUpdate(7, 'transform', 'position', [1, 2, 3]);
          bridge.dispatch(msg);
          const raw = await nextMessage(ws);
          assertDeepEqual(JSON.parse(raw), JSON.parse(encodeMessage(msg)));
        } finally {
          await closeClient(ws);
        }
      } finally {
        bridge.dispose();
        await h.dispose();
      }
    },
  );

  await testAsync(
    'client-sent preview:ready is decoded and delivered to listeners',
    async () => {
      const h = await startHarness();
      const bridge = createWebsocketHostBridge({ httpServer: h.httpServer });
      const received: EditorMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));
      try {
        const ws = await openClient(`ws://127.0.0.1:${h.port}/editor`);
        try {
          ws.send(encodeMessage(previewReady('v0.1.30')));
          // Wait for the server to observe the message.
          for (let i = 0; i < 100 && received.length === 0; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          if (received.length !== 1) {
            throw new Error(`expected 1 received, got ${received.length}`);
          }
          const got = received[0];
          assertDeepEqual(got, {
            kind: 'preview:ready',
            engineVersion: 'v0.1.30',
          });
        } finally {
          await closeClient(ws);
        }
      } finally {
        bridge.dispose();
        await h.dispose();
      }
    },
  );

  await testAsync(
    'malformed client payload is routed to onError, not listeners',
    async () => {
      const h = await startHarness();
      const errors: Error[] = [];
      const bridge = createWebsocketHostBridge({
        httpServer: h.httpServer,
        onError: (err) => errors.push(err),
      });
      const received: EditorMessage[] = [];
      bridge.onMessage((msg) => received.push(msg));
      try {
        const ws = await openClient(`ws://127.0.0.1:${h.port}/editor`);
        try {
          ws.send('not valid json');
          for (let i = 0; i < 100 && errors.length === 0; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          if (errors.length !== 1) {
            throw new Error(`expected 1 error, got ${errors.length}`);
          }
          if (received.length !== 0) {
            throw new Error(`listeners received malformed payload`);
          }
        } finally {
          await closeClient(ws);
        }
      } finally {
        bridge.dispose();
        await h.dispose();
      }
    },
  );

  await testAsync(
    'upgrade on a non-matching path is rejected (client errors)',
    async () => {
      const h = await startHarness();
      const bridge = createWebsocketHostBridge({ httpServer: h.httpServer });
      try {
        let rejected = false;
        const ws = new WebSocket(`ws://127.0.0.1:${h.port}/other`);
        await new Promise<void>((resolve) => {
          ws.once('error', () => {
            rejected = true;
            resolve();
          });
          ws.once('open', () => resolve());
        });
        if (!rejected) {
          throw new Error('expected connection to /other to be rejected');
        }
      } finally {
        bridge.dispose();
        await h.dispose();
      }
    },
  );

  await testAsync('dispose closes all client sockets', async () => {
    const h = await startHarness();
    const bridge = createWebsocketHostBridge({ httpServer: h.httpServer });
    const ws = await openClient(`ws://127.0.0.1:${h.port}/editor`);
    try {
      const closed = new Promise<void>((resolve) =>
        ws.once('close', () => resolve()),
      );
      bridge.dispose();
      await closed;
      if (bridge.clientCount() !== 0) {
        throw new Error('client count should be 0 after dispose');
      }
      // Sanity: subsequent dispatch is a no-op, not a crash.
      bridge.dispatch(previewLog('info', 'after dispose'));
    } finally {
      await h.dispose();
    }
  });
}
