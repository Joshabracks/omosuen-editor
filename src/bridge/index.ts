/**
 * Public API for the typed webview ↔ extension-host bridge.
 *
 * Consumers import from here; never from the submodules. Both
 * `createHostBridge` and `createWebviewBridge` return the same `Bridge`
 * shape so cross-boundary code can be written symmetrically.
 */

export type { Bridge, BridgeErrorHandler, BridgeListener } from './types.js';
export { createHostBridge } from './host-bridge.js';
export type { HostBridgeOptions } from './host-bridge.js';
export {
  createWebviewBridge,
  defaultWebviewTransport,
} from './webview-bridge.js';
export type {
  WebviewBridgeOptions,
  WebviewBridgeTransport,
} from './webview-bridge.js';
