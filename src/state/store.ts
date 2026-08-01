/**
 * Minimal observable store (reference-equality gated notifications).
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
      for (const listener of [...listeners]) {
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
