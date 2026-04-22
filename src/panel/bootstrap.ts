/**
 * Webview-side bootstrap.
 *
 * Every panel's webview entry file calls `bootstrapPanel({...})` once.
 * The bootstrap:
 *   - Builds the typed bridge via `createWebviewBridge` (4.1).
 *   - Wraps the panel's method handlers so they receive the bridge in
 *     their context (lets `:click=fn()` handlers dispatch outgoing
 *     messages via `ctx.bridge.dispatch(...)`).
 *   - Invokes the caller-provided `stateFactory` with the wrapped
 *     methods — the state factory is `(...args) => new State(...args)`
 *     in production, or a stub in tests (this module deliberately does
 *     NOT import State Street; keeps it Node-testable without jsdom).
 *   - Registers `wireIncoming` with `bridge.onMessage` so panels map
 *     incoming messages selectively into `state.data` (Pattern 1 — only
 *     the fields the panel actually renders land in `state.data`).
 *
 * Returned handle exposes the live `state`, the `bridge`, and a
 * `dispose()` that detaches the bridge subscription (State Street's
 * render loop has no disposal hook of its own; it keeps polling via
 * `requestAnimationFrame` until the webview unloads).
 */

import {
  createWebviewBridge,
  defaultWebviewTransport,
} from '../bridge/index.js';
import type { Bridge, WebviewBridgeTransport } from '../bridge/index.js';
import type { EditorMessage } from '../protocol/index.js';

/**
 * Minimum State Street surface `bootstrapPanel` needs. Typed here so
 * the module doesn't import `@state-street/state-street` directly —
 * State Street's constructor touches `document`, which would explode
 * when this module is loaded by Node tests.
 */
export interface StateLike<TData> {
  data: TData;
  forceUpdate(): void;
}

export type PanelComponent = (props: Record<string, unknown>) => string;

export interface PanelMethodContext<TData> {
  readonly state: StateLike<TData>;
  readonly event: Event;
  readonly bridge: Bridge;
  readonly [key: string]: unknown;
}

export type PanelMethod<TData> = (ctx: PanelMethodContext<TData>) => void;

export type StateFactory<TData> = (
  template: string,
  data: TData,
  components: Record<string, PanelComponent>,
  methods: Record<string, (ctx: Record<string, unknown>) => void>,
) => StateLike<TData>;

export type WireIncoming<TData> = (
  msg: EditorMessage,
  state: StateLike<TData>,
  bridge: Bridge,
) => void;

export interface BootstrapPanelOptions<TData> {
  readonly template: string;
  readonly initialData: TData;
  /**
   * Builds the State Street instance. In production: pass
   * `(t, d, c, m) => new State(t, d, c, m)`. In tests: pass a stub
   * returning a `StateLike<TData>` double.
   */
  readonly stateFactory: StateFactory<TData>;
  readonly components?: Record<string, PanelComponent>;
  readonly methods?: Record<string, PanelMethod<TData>>;
  /**
   * Selective mirror from bridge messages into `state.data`. Called on
   * every incoming `EditorMessage`. Panels mutate only the fields they
   * render, keeping `state.data` as a minimal projection of the
   * canonical `Store<T>` (Pattern 1 from Phase 4 design).
   */
  readonly wireIncoming?: WireIncoming<TData>;
  /**
   * Test-only override. In a real webview, omit; the bootstrap calls
   * `defaultWebviewTransport()` which wires `acquireVsCodeApi()` +
   * `window` message events.
   */
  readonly transport?: WebviewBridgeTransport;
}

export interface BootstrappedPanel<TData> {
  readonly state: StateLike<TData>;
  readonly bridge: Bridge;
  readonly dispose: () => void;
}

export function bootstrapPanel<TData>(
  options: BootstrapPanelOptions<TData>,
): BootstrappedPanel<TData> {
  const transport = options.transport ?? defaultWebviewTransport();
  const bridge = createWebviewBridge({ transport });

  const wrappedMethods = wrapPanelMethods(options.methods ?? {}, bridge);
  const state = options.stateFactory(
    options.template,
    options.initialData,
    options.components ?? {},
    wrappedMethods,
  );

  const unsubIncoming = options.wireIncoming
    ? bridge.onMessage((msg) => {
        options.wireIncoming?.(msg, state, bridge);
      })
    : (): void => {};

  return {
    state,
    bridge,
    dispose(): void {
      unsubIncoming();
      bridge.dispose();
    },
  };
}

/**
 * Wraps each `PanelMethod` so the State Street-provided context is
 * spread plus a `bridge` reference. Exported for test coverage —
 * `bootstrapPanel` is otherwise DOM-dependent via the factory.
 */
export function wrapPanelMethods<TData>(
  methods: Record<string, PanelMethod<TData>>,
  bridge: Bridge,
): Record<string, (ctx: Record<string, unknown>) => void> {
  const wrapped: Record<string, (ctx: Record<string, unknown>) => void> = {};
  for (const [name, handler] of Object.entries(methods)) {
    wrapped[name] = (ctx: Record<string, unknown>): void => {
      handler({ ...ctx, bridge } as PanelMethodContext<TData>);
    };
  }
  return wrapped;
}
