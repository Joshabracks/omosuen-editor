/**
 * Selection store: the currently-selected component id, or null if
 * nothing is selected. One canonical instance — panels subscribe instead
 * of holding their own copy.
 */

import { createStore } from './store.js';
import type { Store } from './store.js';

export const selection: Store<number | null> = createStore(
  null as number | null,
);
