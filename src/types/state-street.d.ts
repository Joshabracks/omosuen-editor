/**
 * Ambient declarations for `@state-street/state-street` v1.1.2.
 *
 * The upstream package ships compiled JS but no `.d.ts`. Its source
 * types most fields as `any`; we narrow the public surface we actually
 * use, so consumers get typed `data` and typed method contexts.
 *
 * Source of truth for the narrowing is `node_modules/state-street/src/`.
 * If State Street ships updated types, delete this file.
 */

declare module 'state-street' {
  /** Options bag for the `State` constructor. */
  export interface StateOptions {
    /**
     * Default `true`. When `true`, the DOM re-renders automatically
     * whenever `state.data` mutates (polled via `requestAnimationFrame`
     * and a `JSON.stringify` diff). When `false`, call `forceUpdate()`
     * manually.
     */
    readonly renderLoop?: boolean;
    /** Default `60`. Caps the render-loop frequency. */
    readonly targetFPS?: number;
  }

  /**
   * A State Street component — a function that takes props (attributes
   * from the template tag) and returns an HTML string to splice in.
   */
  export type StateComponent = (props: Record<string, unknown>) => string;

  /**
   * A State Street method handler. Invoked by `:click=methodName(arg=value)`
   * bindings in the template. Called with a merged context object: the
   * live `state` instance, the DOM `event`, plus any args named in the
   * template binding. The editor's panel bootstrap adds a `bridge` field
   * so methods can dispatch outgoing messages.
   */
  export type StateMethod<TData = Record<string, unknown>> = (
    context: { state: State<TData>; event: Event } & Record<string, unknown>,
  ) => void;

  /**
   * State Street's reactive-UI class. `new State(template, data, ...)`
   * parses the template, mounts it into `document.body`, and starts the
   * render loop.
   *
   * `TData` is the editor-side convenience — State Street itself types
   * `data` as `any` internally. By declaring it generic here we get
   * typed access at call sites without modifying the upstream package.
   */
  export class State<TData = Record<string, unknown>> {
    data: TData;
    readonly renderLoop: boolean;

    constructor(
      template: string,
      data?: TData,
      components?: Record<string, StateComponent>,
      methods?: Record<string, StateMethod<TData>>,
      options?: StateOptions,
    );

    /**
     * Compares the current `data` snapshot against the previous one via
     * `JSON.stringify` equality. Used internally by the render loop;
     * consumers rarely call it directly.
     */
    sameState(): boolean;

    /** Internal — advances the render loop's next-update timestamp. */
    setNextUpdate(): void;

    /**
     * Internal render-loop tick. When `renderLoop === true` this is
     * invoked by `requestAnimationFrame`; when `renderLoop === false`
     * consumers must call it (or `forceUpdate`) themselves.
     */
    update(): void;

    /** Synchronously re-render the DOM, ignoring the render loop. */
    forceUpdate(): void;
  }
}
