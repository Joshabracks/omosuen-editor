/**
 * Multi-document registry — one DocumentController per URI (E5).
 */

import type { Bridge } from '../bridge/protocol-bridge';
import { createStore, type Store } from '../state';
import {
  createDocumentController,
  type DocumentController,
  type DocumentControllerDependencies,
  type DocumentUri,
} from './document-controller';

export interface DocumentRegistry {
  readonly activeController: Store<DocumentController | null>;
  onControllerCreated(
    listener: (controller: DocumentController) => void,
  ): () => void;
  getOrCreateController(uri: DocumentUri): DocumentController;
  setActiveUri(uri: DocumentUri | null): void;
  getController(uri: DocumentUri): DocumentController | null;
  disposeController(uri: DocumentUri): void;
  dispose(): void;
}

export function createDocumentRegistry(
  deps: DocumentControllerDependencies,
): DocumentRegistry {
  const controllers = new Map<string, DocumentController>();
  const activeController = createStore<DocumentController | null>(null);
  const creationListeners = new Set<(controller: DocumentController) => void>();

  function normalizeKey(uri: DocumentUri): string {
    return uri;
  }

  function getController(uri: DocumentUri): DocumentController | null {
    return controllers.get(normalizeKey(uri)) ?? null;
  }

  function getOrCreateController(uri: DocumentUri): DocumentController {
    const key = normalizeKey(uri);
    const existing = controllers.get(key);
    if (existing !== undefined) return existing;
    const created = createDocumentController(deps);
    controllers.set(key, created);
    for (const listener of [...creationListeners]) listener(created);
    return created;
  }

  function onControllerCreated(
    listener: (controller: DocumentController) => void,
  ): () => void {
    creationListeners.add(listener);
    return () => {
      creationListeners.delete(listener);
    };
  }

  function setActiveUri(uri: DocumentUri | null): void {
    if (uri === null) {
      activeController.set(null);
      return;
    }
    const controller = controllers.get(normalizeKey(uri));
    if (controller === undefined) return;
    activeController.set(controller);
  }

  function disposeController(uri: DocumentUri): void {
    const key = normalizeKey(uri);
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
    onControllerCreated,
    getOrCreateController,
    setActiveUri,
    getController,
    disposeController,
    dispose,
  };
}

/**
 * Keep a panel bridge bound to whichever controller is active.
 * Re-registration hydrates via `scene:load` when a document is loaded.
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
