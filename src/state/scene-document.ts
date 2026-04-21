/**
 * Scene-document store: the single source of truth for the currently-open
 * `.omoscene` file. Null means no document is open.
 *
 * Requirement 6.1 ("Single source of truth") is enforced by giving this
 * store exactly one module-scope instance. Panels do not copy the document
 * into their own state; they subscribe.
 */

import type { OmosceneFile } from '../omoscene/index.js';
import { createStore } from './store.js';
import type { Store } from './store.js';

export const sceneDocument: Store<OmosceneFile | null> = createStore(
  null as OmosceneFile | null,
);
