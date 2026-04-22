/**
 * Webview side of the typed bridge. Same `Bridge` shape as the host
 * bridge; wraps a generic `WebviewBridgeTransport` so the webview can
 * be tested in Node without jsdom.
 *
 * For real use inside a VS Code webview, `defaultWebviewTransport()`
 * returns the transport wired to `acquireVsCodeApi()` + `window` message
 * events. Production bootstraps pass that to `createWebviewBridge`; tests
 * pass a fake.
 */

import type { EditorMessage } from '../protocol/index.js';
import {
  ProtocolDecodeError,
  ProtocolEncodeError,
  decodeMessage,
  encodeMessage,
} from '../protocol/index.js';
import type { Bridge, BridgeErrorHandler, BridgeListener } from './types.js';

/**
 * The two transport operations a webview bridge needs. Abstracted out of
 * the native `window` / `acquireVsCodeApi` surface so bridge construction
 * is testable without a DOM.
 */
export interface WebviewBridgeTransport {
  postMessage(data: string): void;
  addMessageListener(listener: (data: unknown) => void): () => void;
}

export interface WebviewBridgeOptions {
  readonly transport: WebviewBridgeTransport;
  readonly onError?: BridgeErrorHandler;
}

export function createWebviewBridge(options: WebviewBridgeOptions): Bridge {
  const onError = options.onError ?? defaultOnError;
  const listeners = new Set<BridgeListener>();

  const unsubscribe = options.transport.addMessageListener((raw: unknown) => {
    if (typeof raw !== 'string') {
      onError(
        new Error(`bridge expected a string payload, got ${typeof raw}`),
        safePreview(raw),
      );
      return;
    }
    let msg: EditorMessage;
    try {
      msg = decodeMessage(raw);
    } catch (err) {
      if (err instanceof ProtocolDecodeError) {
        onError(err, raw);
        return;
      }
      throw err;
    }
    for (const listener of [...listeners]) listener(msg);
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
      options.transport.postMessage(encoded);
    },
    onMessage(listener: BridgeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      listeners.clear();
    },
  };
}

/**
 * Build the production `WebviewBridgeTransport` wired to the real VS
 * Code webview globals. Only safe to call inside a webview context —
 * `acquireVsCodeApi` is injected by VS Code and `window` is the
 * webview's own message target.
 *
 * Not used by tests; tests construct the bridge with a fake transport
 * directly.
 */
export function defaultWebviewTransport(): WebviewBridgeTransport {
  const vsCode = (
    globalThis as unknown as {
      acquireVsCodeApi: () => { postMessage(data: unknown): void };
    }
  ).acquireVsCodeApi();
  return {
    postMessage(data: string): void {
      vsCode.postMessage(data);
    },
    addMessageListener(listener: (data: unknown) => void): () => void {
      const handler = (event: MessageEvent<unknown>): void => {
        listener(event.data);
      };
      window.addEventListener('message', handler);
      return () => {
        window.removeEventListener('message', handler);
      };
    },
  };
}

function defaultOnError(error: Error, raw: string): void {
  const preview = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
  console.warn(
    `[bridge] ${error.message}${preview ? ` (raw: ${preview})` : ''}`,
  );
}

function safePreview(value: unknown): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return typeof s === 'string' ? s : String(value);
  } catch {
    return String(value);
  }
}
