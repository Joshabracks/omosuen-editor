/**
 * Typed transport layer between the extension host and webviews.
 *
 * `Bridge` is the symmetric interface both sides see: dispatch out,
 * subscribe to incoming, dispose. Host-side (`createHostBridge`) and
 * webview-side (`createWebviewBridge`) wrap their respective VS Code
 * transports (`webview.postMessage` / `acquireVsCodeApi`) into this
 * shared shape.
 *
 * Every crossing of the boundary passes through Phase 3's `encodeMessage`
 * / `decodeMessage`, so protocol-layer safety (JsonValue constraint,
 * non-finite-number rejection, discriminant validation) is load-bearing
 * at the transport edge, not at each consumer.
 */

import type { EditorMessage } from '../protocol/index.js';

export interface Bridge {
  /**
   * Send an `EditorMessage` across the boundary. Encodes via
   * `encodeMessage` and posts through the underlying transport. Any
   * encode-time error (e.g. non-finite numbers in `component:update.value`)
   * is routed to the bridge's `onError` handler and the message is not
   * sent.
   */
  readonly dispatch: (msg: EditorMessage) => void;

  /**
   * Register a listener for decoded incoming messages. Returns an
   * unsubscribe function. Decoder errors on incoming payloads are routed
   * to `onError`, not delivered to listeners.
   */
  readonly onMessage: (listener: BridgeListener) => () => void;

  /**
   * Detach the underlying transport subscription and drop all listeners.
   * Idempotent.
   */
  readonly dispose: () => void;
}

export type BridgeListener = (msg: EditorMessage) => void;

/**
 * Handler invoked on any transport-boundary error — malformed JSON on
 * receive, decoder-rejection on receive, encoder-rejection on dispatch.
 * The `raw` argument carries whatever string form was at fault (empty
 * for dispatch errors). Default handler: `console.warn` with the
 * message + a truncated preview of `raw`.
 */
export type BridgeErrorHandler = (error: Error, raw: string) => void;
