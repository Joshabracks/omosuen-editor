/**
 * Serialize an `EditorMessage` to a JSON string suitable for any transport
 * (WebSocket, `postMessage`, clipboard). The inverse lives in `./decode.js`.
 */

import type { EditorMessage } from './types.js';

export function encodeMessage(msg: EditorMessage): string {
  return JSON.stringify(msg);
}
