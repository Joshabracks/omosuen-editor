/**
 * Tests for the typed webview ↔ host bridge (`src/bridge/`).
 *
 * Strategy: fake both transports (webview-side via a simple
 * `WebviewBridgeTransport` stub; host-side via a fake `vscode.Webview`
 * shape covering only the surface the bridge actually uses). This keeps
 * bridge tests jsdom-free per open-question Q3.
 *
 * Covers: encode-on-send, decode-on-receive, error routing on malformed
 * inputs in both directions, `dispose()` stops delivery, listener
 * snapshotting (3.5.3 invariant carried to the bridge).
 */

import {
  componentSelect,
  componentUpdate,
  encodeMessage,
} from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { createHostBridge, createWebviewBridge } from '../bridge/index.js';
import type { Bridge, BridgeErrorHandler } from '../bridge/index.js';
import type { WebviewBridgeTransport } from '../bridge/index.js';
import { assertDeepEqual, test } from './harness.js';

// --- Host-side fakes --------------------------------------------------------

interface FakeWebview {
  readonly postMessage: (data: unknown) => Promise<boolean>;
  readonly onDidReceiveMessage: (listener: (e: unknown) => void) => {
    dispose(): void;
  };
  readonly __posted: unknown[];
  readonly __deliver: (payload: unknown) => void;
  readonly __listenerCount: () => number;
}

function fakeWebview(): FakeWebview {
  const posted: unknown[] = [];
  const listeners = new Set<(e: unknown) => void>();
  return {
    postMessage: (data: unknown): Promise<boolean> => {
      posted.push(data);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (listener) => {
      listeners.add(listener);
      return {
        dispose(): void {
          listeners.delete(listener);
        },
      };
    },
    __posted: posted,
    __deliver: (payload: unknown): void => {
      for (const l of [...listeners]) l(payload);
    },
    __listenerCount: (): number => listeners.size,
  };
}

// --- Webview-side fakes -----------------------------------------------------

interface FakeWebviewTransport extends WebviewBridgeTransport {
  readonly __posted: string[];
  readonly __deliver: (payload: unknown) => void;
  readonly __listenerCount: () => number;
}

function fakeWebviewTransport(): FakeWebviewTransport {
  const posted: string[] = [];
  const listeners = new Set<(data: unknown) => void>();
  return {
    postMessage(data: string): void {
      posted.push(data);
    },
    addMessageListener(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    __posted: posted,
    __deliver: (payload: unknown): void => {
      for (const l of [...listeners]) l(payload);
    },
    __listenerCount: (): number => listeners.size,
  };
}

interface CapturedError {
  readonly error: Error;
  readonly raw: string;
}
function captureErrors(): {
  onError: BridgeErrorHandler;
  errors: CapturedError[];
} {
  const errors: CapturedError[] = [];
  return {
    onError: (error, raw) => errors.push({ error, raw }),
    errors,
  };
}

// ---------------------------------------------------------------------------

export function runBridgeTests(): void {
  // --- Host bridge ---------------------------------------------------------

  test('host bridge: dispatch stringifies through encodeMessage', () => {
    const webview = fakeWebview();
    const bridge: Bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
    });
    bridge.dispatch(componentSelect([1, 2, 3]));
    assertDeepEqual(webview.__posted, [
      encodeMessage(componentSelect([1, 2, 3])),
    ]);
    bridge.dispose();
  });

  test('host bridge: receive decodes string payloads to EditorMessage', () => {
    const webview = fakeWebview();
    const received: EditorMessage[] = [];
    const bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
    });
    bridge.onMessage((msg) => received.push(msg));
    webview.__deliver(encodeMessage(componentSelect([42])));
    assertDeepEqual(received, [componentSelect([42])]);
    bridge.dispose();
  });

  test('host bridge: non-string payload routes to onError (no throw)', () => {
    const webview = fakeWebview();
    const { onError, errors } = captureErrors();
    const bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
      onError,
    });
    webview.__deliver({ not: 'a string' });
    if (errors.length !== 1) {
      throw new Error(`expected 1 error, got ${errors.length}`);
    }
    bridge.dispose();
  });

  test('host bridge: malformed JSON routes to onError (no throw)', () => {
    const webview = fakeWebview();
    const { onError, errors } = captureErrors();
    const bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
      onError,
    });
    webview.__deliver('not valid json');
    if (errors.length !== 1) {
      throw new Error(`expected 1 error, got ${errors.length}`);
    }
    bridge.dispose();
  });

  test('host bridge: encoder-reject dispatch routes to onError (no post)', () => {
    const webview = fakeWebview();
    const { onError, errors } = captureErrors();
    const bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
      onError,
    });
    bridge.dispatch(componentUpdate(1, 'transform', 'x', NaN));
    if (errors.length !== 1) {
      throw new Error(`expected 1 error, got ${errors.length}`);
    }
    if (webview.__posted.length !== 0) {
      throw new Error('bad messages must not be posted');
    }
    bridge.dispose();
  });

  test('host bridge: dispose stops delivery + detaches listener', () => {
    const webview = fakeWebview();
    const received: EditorMessage[] = [];
    const bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
    });
    bridge.onMessage((msg) => received.push(msg));
    bridge.dispose();
    webview.__deliver(encodeMessage(componentSelect([1])));
    if (received.length !== 0) {
      throw new Error('listener must not fire after dispose');
    }
    if (webview.__listenerCount() !== 0) {
      throw new Error('webview subscription must be detached after dispose');
    }
  });

  test('host bridge: listener unsub during notify does not skip siblings', () => {
    const webview = fakeWebview();
    const received: EditorMessage[] = [];
    const bridge = createHostBridge({
      webview: webview as unknown as import('vscode').Webview,
    });
    let unsubB = (): void => undefined;
    bridge.onMessage(() => {
      unsubB();
    });
    unsubB = bridge.onMessage((msg) => received.push(msg));
    webview.__deliver(encodeMessage(componentSelect([7])));
    assertDeepEqual(received, [componentSelect([7])]);
    bridge.dispose();
  });

  // --- Webview bridge ------------------------------------------------------

  test('webview bridge: dispatch stringifies through encodeMessage', () => {
    const transport = fakeWebviewTransport();
    const bridge = createWebviewBridge({ transport });
    bridge.dispatch(componentSelect([1, 2, 3]));
    assertDeepEqual(transport.__posted, [
      encodeMessage(componentSelect([1, 2, 3])),
    ]);
    bridge.dispose();
  });

  test('webview bridge: receive decodes string payloads', () => {
    const transport = fakeWebviewTransport();
    const received: EditorMessage[] = [];
    const bridge = createWebviewBridge({ transport });
    bridge.onMessage((msg) => received.push(msg));
    transport.__deliver(encodeMessage(componentSelect([42])));
    assertDeepEqual(received, [componentSelect([42])]);
    bridge.dispose();
  });

  test('webview bridge: malformed JSON routes to onError (no throw)', () => {
    const transport = fakeWebviewTransport();
    const { onError, errors } = captureErrors();
    const bridge = createWebviewBridge({ transport, onError });
    transport.__deliver('still not valid');
    if (errors.length !== 1) {
      throw new Error(`expected 1 error, got ${errors.length}`);
    }
    bridge.dispose();
  });

  test('webview bridge: encoder-reject dispatch routes to onError (no post)', () => {
    const transport = fakeWebviewTransport();
    const { onError, errors } = captureErrors();
    const bridge = createWebviewBridge({ transport, onError });
    bridge.dispatch(
      componentUpdate(1, 'transform', 'position', [0, Infinity, 0]),
    );
    if (errors.length !== 1) {
      throw new Error(`expected 1 error, got ${errors.length}`);
    }
    if (transport.__posted.length !== 0) {
      throw new Error('bad messages must not be posted');
    }
    bridge.dispose();
  });

  test('webview bridge: dispose detaches message listener', () => {
    const transport = fakeWebviewTransport();
    const received: EditorMessage[] = [];
    const bridge = createWebviewBridge({ transport });
    bridge.onMessage((msg) => received.push(msg));
    bridge.dispose();
    transport.__deliver(encodeMessage(componentSelect([1])));
    if (received.length !== 0) {
      throw new Error('listener must not fire after dispose');
    }
    if (transport.__listenerCount() !== 0) {
      throw new Error('transport listener must be detached after dispose');
    }
  });

  // --- Round-trip sanity (both sides wired together) ----------------------

  test('bridge round-trip: dispatched message survives the wire', () => {
    // Simulate the two sides: host posts → webview receives; webview posts →
    // host receives. Uses the fakes as the "wire" in between.
    const webviewFake = fakeWebview();
    const transport = fakeWebviewTransport();

    // Route host → webview: whenever host posts, deliver to webview transport.
    const originalHostPost = webviewFake.postMessage;
    const hostToWire = (data: unknown): Promise<boolean> => {
      const ret = originalHostPost(data);
      transport.__deliver(data);
      return ret;
    };
    (
      webviewFake as { postMessage: (d: unknown) => Promise<boolean> }
    ).postMessage = hostToWire;

    // Route webview → host: whenever webview posts, deliver to host.
    const originalTransportPost = transport.postMessage;
    (transport as { postMessage: (d: string) => void }).postMessage = (
      data: string,
    ): void => {
      originalTransportPost(data);
      webviewFake.__deliver(data);
    };

    const hostBridge = createHostBridge({
      webview: webviewFake as unknown as import('vscode').Webview,
    });
    const webviewBridge = createWebviewBridge({ transport });

    const seenByWebview: EditorMessage[] = [];
    const seenByHost: EditorMessage[] = [];
    webviewBridge.onMessage((msg) => seenByWebview.push(msg));
    hostBridge.onMessage((msg) => seenByHost.push(msg));

    hostBridge.dispatch(componentSelect([5]));
    webviewBridge.dispatch(componentSelect([9]));

    assertDeepEqual(seenByWebview, [componentSelect([5])]);
    assertDeepEqual(seenByHost, [componentSelect([9])]);

    hostBridge.dispose();
    webviewBridge.dispose();
  });
}
