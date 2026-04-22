/**
 * Per-tab document registry.
 *
 * Phase 5 used one singleton `DocumentController`; Phase 6 opens multiple
 * `.omoscene` tabs at once, so we hold one controller per file URI. The
 * registry is responsible for:
 *
 *   - `getOrCreateController(uri)` — lookup-or-instantiate the controller
 *     for a URI. Callers (custom editor provider in 6.2, Phase 5's
 *     open-scene command in its transitional state) use this instead of
 *     constructing controllers directly.
 *
 *   - `activeController` — a `Store<DocumentController | null>` tracking
 *     the currently-focused tab's controller. Sidebars subscribe to this
 *     and swap their bridge registration when the store changes.
 *
 *   - `setActiveUri(uri | null)` — external signal (from the custom
 *     editor's `onDidChangeViewState` hooks and command-based open paths)
 *     for which file is currently focused.
 *
 *   - `disposeController(uri)` — remove + dispose when a tab closes.
 *
 * Controller instances are keyed on `uri.toString()` so different URI
 * representations (different fsPath capitalization on Windows, trailing
 * slashes, etc.) don't accidentally create duplicates for the same file.
 */

import type { Uri } from 'vscode';
import type { Bridge } from '../bridge/index.js';
import type { DocumentController } from './document-controller.js';
import { createDocumentController } from './document-controller.js';
import type { DocumentControllerDependencies } from './document-controller.js';
import { createStore } from '../state/index.js';
import type { Store } from '../state/index.js';

export interface DocumentRegistry {
  /**
   * Read-only view of the active controller. `null` when no `.omoscene`
   * tab is focused.
   */
  readonly activeController: Store<DocumentController | null>;
  /**
   * Return the existing controller for `uri`, or instantiate one if
   * absent. Newly created controllers use the registry's shared deps
   * (read/write injected once at registry creation).
   */
  getOrCreateController(uri: Uri): DocumentController;
  /**
   * Mark the given URI's controller active (or clear if `null`).
   * Safe to call with a URI that has no controller yet — in that case
   * `activeController` is left unchanged so callers can drive selection
   * before the controller exists.
   */
  setActiveUri(uri: Uri | null): void;
  /** Look up a controller by URI without creating one. */
  getController(uri: Uri): DocumentController | null;
  /**
   * Dispose the controller for `uri`. Clears `activeController` if it
   * pointed at the disposed one.
   */
  disposeController(uri: Uri): void;
  /** Tear down every controller. Typically called on extension deactivate. */
  dispose(): void;
}

export function createDocumentRegistry(
  deps: DocumentControllerDependencies,
): DocumentRegistry {
  const controllers = new Map<string, DocumentController>();
  const activeController = createStore<DocumentController | null>(null);

  function getController(uri: Uri): DocumentController | null {
    return controllers.get(uri.toString()) ?? null;
  }

  function getOrCreateController(uri: Uri): DocumentController {
    const key = uri.toString();
    const existing = controllers.get(key);
    if (existing !== undefined) return existing;
    const created = createDocumentController(deps);
    controllers.set(key, created);
    return created;
  }

  function setActiveUri(uri: Uri | null): void {
    if (uri === null) {
      activeController.set(null);
      return;
    }
    const controller = controllers.get(uri.toString());
    if (controller === undefined) return;
    activeController.set(controller);
  }

  function disposeController(uri: Uri): void {
    const key = uri.toString();
    const controller = controllers.get(key);
    if (controller === undefined) return;
    controller.dispose();
    controllers.delete(key);
    if (activeController.get() === controller) {
      activeController.set(null);
    }
  }

  function dispose(): void {
    for (const controller of [...controllers.values()]) {
      controller.dispose();
    }
    controllers.clear();
    activeController.set(null);
  }

  return {
    activeController,
    getOrCreateController,
    setActiveUri,
    getController,
    disposeController,
    dispose,
  };
}

/**
 * Wire a sidebar panel's bridge to follow the registry's active
 * controller: whenever active changes, the bridge is unregistered from
 * the old controller and registered with the new one. Returns a single
 * cleanup function the panel calls on its own disposal.
 *
 * Sidebars (Scene Tree, Inspector) use this from `registerPanel`'s
 * `wireOutgoing` hook to stay bound to whichever `.omoscene` tab is
 * focused. The existing `DocumentController.registerPanel` hydration
 * fires `scene:load` through the bridge on each rebind, so the sidebar
 * auto-populates when the active tab changes.
 */
export function followActiveController(
  bridge: Bridge,
  registry: DocumentRegistry,
): () => void {
  let currentUnregister: (() => void) | null = null;

  const rebind = (controller: DocumentController | null): void => {
    if (currentUnregister !== null) {
      currentUnregister();
      currentUnregister = null;
    }
    if (controller !== null) {
      currentUnregister = controller.registerPanel(bridge);
    }
  };

  rebind(registry.activeController.get());
  const unsubActive = registry.activeController.subscribe((next) =>
    rebind(next),
  );

  return () => {
    rebind(null);
    unsubActive();
  };
}
