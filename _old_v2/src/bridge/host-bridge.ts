/**
 * Extension-host side of the typed bridge. Wraps a `vscode.Webview`
 * transport so both dispatch and receive pass through Phase 3's codec.
 *
 * Intentionally ignorant of panel lifecycle — the caller owns the
 * webview and its lifetime. Calling `dispose()` on this bridge detaches
 * its subscription and drops its listeners; it does not dispose the
 * webview itself.
 */

import type { Webview } from 'vscode';
import type { EditorMessage } from '../protocol/index.js';
import {
  ProtocolDecodeError,
  ProtocolEncodeError,
  decodeMessage,
  encodeMessage,
} from '../protocol/index.js';
import type { Bridge, BridgeErrorHandler, BridgeListener } from './types.js';

export interface HostBridgeOptions {
  readonly webview: Webview;
  readonly onError?: BridgeErrorHandler;
}

export function createHostBridge(options: HostBridgeOptions): Bridge {
  const onError = options.onError ?? defaultOnError;
  const listeners = new Set<BridgeListener>();

  const subscription = options.webview.onDidReceiveMessage((raw: unknown) => {
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
    // Snapshot before iterating — same reason as store/dispatch (3.5.3):
    // a listener that unsubscribes others mid-notify must not disturb
    // delivery to the listeners that existed at receive time.
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
      void options.webview.postMessage(encoded);
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
      subscription.dispose();
      listeners.clear();
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
