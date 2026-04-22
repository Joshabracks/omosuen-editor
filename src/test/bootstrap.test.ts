/**
 * Tests for the webview-side panel bootstrap (`src/panel/bootstrap.ts`).
 *
 * The bootstrap module deliberately does not import State Street, so it
 * loads cleanly in Node. We fake the `stateFactory` to capture its
 * arguments and fake the webview transport to exercise the bridge wiring.
 * DOM-dependent parts (State Street's actual render loop) are manual-tested
 * only, per Q3.
 */

import { bootstrapPanel, wrapPanelMethods } from '../panel/bootstrap.js';
import type {
  PanelMethod,
  StateFactory,
  StateLike,
  WireIncoming,
} from '../panel/bootstrap.js';
import type { WebviewBridgeTransport } from '../bridge/index.js';
import { componentSelect, encodeMessage } from '../protocol/index.js';
import type { EditorMessage } from '../protocol/index.js';
import { assertDeepEqual, test } from './harness.js';

interface FakeTransport extends WebviewBridgeTransport {
  readonly __posted: string[];
  readonly __deliver: (payload: unknown) => void;
}

function fakeTransport(): FakeTransport {
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
  };
}

interface FakeState<TData> extends StateLike<TData> {
  forceUpdateCalls: number;
}

function fakeStateFactory<TData>(): {
  factory: StateFactory<TData>;
  captured: {
    template?: string;
    data?: TData;
    components?: Record<string, unknown>;
    methods?: Record<string, (ctx: Record<string, unknown>) => void>;
    state?: FakeState<TData>;
  };
} {
  const captured: {
    template?: string;
    data?: TData;
    components?: Record<string, unknown>;
    methods?: Record<string, (ctx: Record<string, unknown>) => void>;
    state?: FakeState<TData>;
  } = {};
  const factory: StateFactory<TData> = (
    template,
    data,
    components,
    methods,
  ) => {
    captured.template = template;
    captured.data = data;
    captured.components = components;
    captured.methods = methods;
    const state: FakeState<TData> = {
      data,
      forceUpdateCalls: 0,
      forceUpdate(): void {
        this.forceUpdateCalls += 1;
      },
    };
    captured.state = state;
    return state;
  };
  return { factory, captured };
}

export function runBootstrapTests(): void {
  // --- wrapPanelMethods (pure) -------------------------------------------

  test('wrapPanelMethods: adds bridge into each method context', () => {
    const received: Array<Record<string, unknown>> = [];
    const methods = {
      m1: ((ctx) => received.push(ctx)) as PanelMethod<Record<string, unknown>>,
    };
    const transport = fakeTransport();
    const { factory } = fakeStateFactory<Record<string, unknown>>();
    // We only need the bridge; build one via bootstrapPanel and pull it out.
    const { bridge } = bootstrapPanel({
      template: '<body></body>',
      initialData: {},
      stateFactory: factory,
      transport,
    });

    const wrapped = wrapPanelMethods(methods, bridge);
    wrapped['m1']?.({ state: 'fake-state', event: 'fake-event', extra: 1 });
    if (received.length !== 1) {
      throw new Error(`expected 1 ctx, got ${received.length}`);
    }
    const ctx = received[0];
    if (ctx === undefined) throw new Error('missing ctx');
    if (ctx['bridge'] !== bridge) {
      throw new Error('bridge missing from method ctx');
    }
    if (ctx['state'] !== 'fake-state') {
      throw new Error('state was clobbered by wrapper');
    }
    if (ctx['extra'] !== 1) {
      throw new Error('extra args were dropped by wrapper');
    }
  });

  test('wrapPanelMethods: empty methods produce empty wrapped', () => {
    const transport = fakeTransport();
    const { factory } = fakeStateFactory<Record<string, unknown>>();
    const { bridge } = bootstrapPanel({
      template: '<body></body>',
      initialData: {},
      stateFactory: factory,
      transport,
    });
    const wrapped = wrapPanelMethods({}, bridge);
    if (Object.keys(wrapped).length !== 0) {
      throw new Error('empty methods should produce empty wrapped');
    }
  });

  // --- bootstrapPanel ----------------------------------------------------

  test('bootstrapPanel: stateFactory called with template, data, components, wrapped methods', () => {
    const transport = fakeTransport();
    const { factory, captured } = fakeStateFactory<{ selection: number[] }>();
    const components = { Foo: (): string => '<div>foo</div>' };
    const methods: Record<string, PanelMethod<{ selection: number[] }>> = {
      select: () => {},
    };
    bootstrapPanel({
      template: '<body>template</body>',
      initialData: { selection: [1, 2] },
      stateFactory: factory,
      components,
      methods,
      transport,
    });
    if (captured.template !== '<body>template</body>') {
      throw new Error('template not forwarded');
    }
    assertDeepEqual(captured.data, { selection: [1, 2] });
    if (captured.components !== components) {
      throw new Error('components not forwarded (same reference expected)');
    }
    if (!captured.methods || typeof captured.methods['select'] !== 'function') {
      throw new Error('methods not wrapped through to factory');
    }
  });

  test('bootstrapPanel: wireIncoming fires on every bridge message', () => {
    const transport = fakeTransport();
    const { factory } = fakeStateFactory<{ selection: number[] }>();
    const seen: EditorMessage[] = [];
    const wireIncoming: WireIncoming<{ selection: number[] }> = (
      msg,
      _state,
      _bridge,
    ) => {
      seen.push(msg);
    };
    bootstrapPanel({
      template: '<body></body>',
      initialData: { selection: [] },
      stateFactory: factory,
      wireIncoming,
      transport,
    });
    transport.__deliver(encodeMessage(componentSelect([5])));
    transport.__deliver(encodeMessage(componentSelect([9, 10])));
    assertDeepEqual(seen, [componentSelect([5]), componentSelect([9, 10])]);
  });

  test('bootstrapPanel: wireIncoming mutates state.data and mirror survives', () => {
    // Pattern-1 proof: wireIncoming writes only what it cares about into
    // state.data. This is how panels keep State.data as a minimal
    // projection of the canonical store.
    const transport = fakeTransport();
    const { factory, captured } = fakeStateFactory<{ selection: number[] }>();
    const wireIncoming: WireIncoming<{ selection: number[] }> = (
      msg,
      state,
    ) => {
      if (msg.kind === 'component:select') {
        state.data.selection = [...msg.ids];
      }
    };
    bootstrapPanel({
      template: '<body></body>',
      initialData: { selection: [] },
      stateFactory: factory,
      wireIncoming,
      transport,
    });
    transport.__deliver(encodeMessage(componentSelect([42, 43])));
    if (!captured.state) throw new Error('missing captured state');
    assertDeepEqual(captured.state.data.selection, [42, 43]);
  });

  test('bootstrapPanel: method ctx exposes bridge.dispatch', () => {
    const transport = fakeTransport();
    const { factory } = fakeStateFactory<Record<string, unknown>>();
    const methods: Record<string, PanelMethod<Record<string, unknown>>> = {
      click: ({ bridge }) => {
        bridge.dispatch(componentSelect([99]));
      },
    };
    bootstrapPanel({
      template: '<body></body>',
      initialData: {},
      stateFactory: factory,
      methods,
      transport,
    });
    // Invoke the wrapped method directly (State Street would normally do
    // this on `:click=`); we capture the wrapped methods via fakeStateFactory.
    const { captured } = fakeStateFactory<Record<string, unknown>>();
    // Re-run via a fresh call so we can grab `captured.methods`:
    const { factory: f2, captured: c2 } =
      fakeStateFactory<Record<string, unknown>>();
    const t2 = fakeTransport();
    bootstrapPanel({
      template: '<body></body>',
      initialData: {},
      stateFactory: f2,
      methods,
      transport: t2,
    });
    c2.methods?.['click']?.({ state: {}, event: {} });
    assertDeepEqual(t2.__posted, [encodeMessage(componentSelect([99]))]);
    void captured;
  });

  test('bootstrapPanel: dispose detaches bridge subscription', () => {
    const transport = fakeTransport();
    const { factory } = fakeStateFactory<Record<string, unknown>>();
    const seen: EditorMessage[] = [];
    const { dispose } = bootstrapPanel({
      template: '<body></body>',
      initialData: {},
      stateFactory: factory,
      wireIncoming: (msg) => seen.push(msg),
      transport,
    });
    transport.__deliver(encodeMessage(componentSelect([1])));
    dispose();
    transport.__deliver(encodeMessage(componentSelect([2])));
    assertDeepEqual(seen, [componentSelect([1])]);
  });
}
