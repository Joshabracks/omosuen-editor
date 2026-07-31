/**
 * Preview-overlay client (Phase 9.3).
 *
 * Served by [src/app/preview-server.ts](../../app/preview-server.ts) at
 * `/__omosuen_editor_overlay.js` and injected into the running game's
 * HTML before `</body>`. Runs in the browser alongside the Omosuen
 * engine — NOT inside a VS Code webview.
 *
 * Responsibilities (minimum viable set for Phase 9.3):
 *   - Open a WebSocket to `/editor`, auto-reconnect every 2s on drop.
 *   - Announce `preview:ready` with the engine's `version` once on first
 *     open.
 *   - Intercept `console.log` / `warn` / `error` and forward every line
 *     as a `preview:log` message (2-second dedup window — matches the
 *     archived overlay behaviour).
 *   - On `component:update` receive, resolve the target component via
 *     `window.Omosuen.getActiveScene().getComponentById(id, true)`, walk
 *     the `property` path (supporting Vector2D/3D/4D reconstruction),
 *     and assign.
 *
 * **Not implemented (deferred)**: click-to-select from the canvas back
 * into the editor's inspector. `_old`'s overlay did its own client-side
 * raycasting across the whole scene tree — the engine doesn't expose a
 * pick-by-screen-coords API, so reviving that is a scene-editor-scope
 * problem (Phase 8 territory), not Phase 9's.
 */

import {
  decodeMessage,
  encodeMessage,
  previewLog,
  previewReady,
  type EditorMessage,
} from '../../protocol/index.js';

interface ActiveScene {
  getComponentById?: (id: number, recursive?: boolean) => unknown;
}

interface OmosuenApi {
  readonly version?: string;
  getActiveScene?: () => ActiveScene | null | undefined;
  pause?: () => void;
  resume?: () => void;
}

declare global {
  interface Window {
    Omosuen?: OmosuenApi;
  }
}

const RECONNECT_DELAY_MS = 2000;
const LOG_DEDUP_WINDOW_MS = 2000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sentReady = false;

function start(): void {
  installConsoleInterceptor();
  connect();
}

function connect(): void {
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/editor`;
  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.addEventListener('open', () => {
    if (!sentReady) {
      sentReady = true;
      const version = window.Omosuen?.version ?? 'unknown';
      sendMessage(previewReady(version));
    }
  });

  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let msg: EditorMessage;
    try {
      msg = decodeMessage(event.data);
    } catch {
      return;
    }
    handleIncoming(msg);
  });

  ws.addEventListener('close', () => {
    socket = null;
    if (reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    }
  });

  ws.addEventListener('error', () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  });
}

function sendMessage(msg: EditorMessage): void {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(encodeMessage(msg));
  } catch {
    // encode failure — drop silently rather than loop-logging
  }
}

function handleIncoming(msg: EditorMessage): void {
  if (msg.kind === 'component:update') {
    applyComponentUpdate(msg.id, msg.property, msg.value);
  }
  // component:select / scene:load / scene:save / preview:* are informational
  // here — the running game doesn't currently render selection highlights.
}

function applyComponentUpdate(
  id: number,
  property: string,
  value: unknown,
): void {
  const api = window.Omosuen;
  if (!api || typeof api.getActiveScene !== 'function') {
    warnMissingApi('getActiveScene');
    return;
  }
  const scene = api.getActiveScene();
  if (!scene || typeof scene.getComponentById !== 'function') {
    warnMissingApi('getActiveScene().getComponentById');
    return;
  }
  const target = scene.getComponentById(id, true);
  if (target === null || target === undefined) return;
  const rebuilt = reconstructValue(value);
  const path = property.split('.');
  if (path.length === 0) return;
  let cursor = target as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const next = cursor[key];
    if (next === null || typeof next !== 'object') return;
    cursor = next as Record<string, unknown>;
  }
  cursor[path[path.length - 1]!] = rebuilt;
}

/**
 * Rebuild Vector2D/3D/4D shapes from their serialized `{_vectorType, x,
 * y, z}` form. Anything else passes through unchanged.
 */
function reconstructValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const vt = obj['_vectorType'];
  if (typeof vt !== 'string') return value;
  const api = window.Omosuen as unknown as Record<string, unknown> | undefined;
  if (!api) return value;
  const ctor = api[vt];
  if (typeof ctor !== 'function') return value;
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key !== '_vectorType') rest[key] = val;
  }
  try {
    return new (ctor as new (...args: unknown[]) => unknown)(
      ...Object.values(rest),
    );
  } catch {
    return value;
  }
}

const missingApiWarned = new Set<string>();
function warnMissingApi(name: string): void {
  if (missingApiWarned.has(name)) return;
  missingApiWarned.add(name);
  sendMessage(
    previewLog(
      'warn',
      `[omosuen-overlay] window.Omosuen.${name} not found — live sync for this event is disabled`,
    ),
  );
}

function installConsoleInterceptor(): void {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const recent = new Map<string, number>();

  function forward(level: 'info' | 'warn' | 'error', args: unknown[]): void {
    const text = args
      .map((a) => (typeof a === 'string' ? a : safeJson(a)))
      .join(' ');
    const now = Date.now();
    const key = `${level}:${text}`;
    const last = recent.get(key);
    if (last !== undefined && now - last < LOG_DEDUP_WINDOW_MS) return;
    recent.set(key, now);
    sendMessage(previewLog(level, text));
  }

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    forward('info', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    forward('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    forward('error', args);
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
