/**
 * Minimal observable store primitive.
 *
 * `createStore(initial)` returns a value holder with three operations:
 *   - `get()`        → current value
 *   - `set(next)`    → replace value (function updater supported) and
 *                      synchronously notify subscribers if the reference
 *                      changed
 *   - `subscribe(fn)` → register a listener, returns an unsubscribe function
 *
 * Notification is synchronous and reference-equality-gated — setting to the
 * same value is a no-op. Subscribers receive the new value and the previous
 * value so they can diff.
 *
 * This is deliberately hand-rolled rather than pulling in State Street (the
 * webview UI framework chosen in Q1). State Street wraps the same subscribe /
 * update-loop pattern; Phase 4 will wire its integration, at which point
 * this primitive can either stay as the substrate or be replaced with State
 * Street's store primitives. The protocol and dispatch layers above are
 * unchanged either way.
 */

export type Updater<T> = T | ((previous: T) => T);
export type Listener<T> = (next: T, previous: T) => void;
export type Unsubscribe = () => void;

export interface Store<T> {
  get(): T;
  set(next: Updater<T>): void;
  subscribe(listener: Listener<T>): Unsubscribe;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get(): T {
      return value;
    },
    set(next: Updater<T>): void {
      const nextValue =
        typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      if (nextValue === value) return;
      const previous = value;
      value = nextValue;
      for (const listener of listeners) {
        listener(nextValue, previous);
      }
    },
    subscribe(listener: Listener<T>): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
