/**
 * Dockable authoring viewport — engine WebGL host + gizmo overlay (4a/4b).
 *
 * Mounted into a `:preserve` dock host; canvas survives retab/split via
 * DockController.moveTo (same pattern as Monaco).
 */

import type { EditorCameraState, OmosceneFile } from '../../omoscene';
import { withEditorMetadata } from '../../omoscene';
import type { EditorMessage } from '../../protocol';
import { loadEngineUmd } from './engine-loader';
import { mountGizmoOverlay, type GizmoOverlayHandle } from './gizmo-overlay';
import { sceneStructureKey } from './entities';
import {
  createAuthoringEngineSession,
  type AuthoringEngineSession,
} from './session';
import { engineVersionMismatchWarning } from './sanitize';
import {
  camerasEqual,
  editorCameraFromUnknown,
} from './view-camera';

export const VIEWPORT_VIEW_ID = 'viewport';

export interface ViewportDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly getSelection: () => readonly number[];
  readonly subscribeSelection: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  /** Persist editor.camera without treating it as a scene mutation. */
  readonly applyEditorCamera: (camera: EditorCameraState) => void;
  /** Prefer scene file engine; fall back to project pin / default. */
  readonly resolveEngineVersion: () => Promise<string>;
  readonly ensureEngine: (version: string) => Promise<{
    readonly version: string;
    readonly umdUrl: string;
  }>;
  readonly readEngineUmd: (version: string) => Promise<string>;
  /** Optional project manifest engine for mismatch warnings. */
  readonly getProjectEngineVersion?: () => Promise<string | null>;
  readonly onStatus?: (message: string) => void;
  readonly onWarn?: (message: string) => void;
}

export function mountAuthoringViewport(
  container: HTMLElement,
  deps: ViewportDeps,
): () => void {
  container.classList.add('authoring-viewport');
  container.innerHTML = `
    <div class="viewport-status" role="status"></div>
    <div class="viewport-canvas-host" aria-label="Authoring viewport"></div>
  `;
  const statusEl = container.querySelector('.viewport-status') as HTMLElement;
  const canvasHost = container.querySelector(
    '.viewport-canvas-host',
  ) as HTMLElement;

  let session: AuthoringEngineSession | null = null;
  let overlay: GizmoOverlayHandle | null = null;
  let disposed = false;
  let bootGeneration = 0;
  let lastStructureKey = '';
  let lastLoadedVersion = '';
  let lastScenePropsKey = '';
  let viewCamera: EditorCameraState = editorCameraFromUnknown(
    deps.getDocument()?.editor.camera,
  );
  let suppressCameraPersist = false;

  const setStatus = (
    message: string,
    kind: 'info' | 'warn' | 'error' = 'info',
  ): void => {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
    if (kind === 'warn' || kind === 'error') {
      deps.onWarn?.(message);
    } else {
      deps.onStatus?.(message);
    }
  };

  const syncViewCameraFromDocument = (): void => {
    const file = deps.getDocument();
    if (!file) return;
    const next = editorCameraFromUnknown(file.editor.camera);
    if (!camerasEqual(next, viewCamera)) {
      viewCamera = next;
      session?.applyViewCamera(viewCamera);
      overlay?.refresh();
    }
  };

  const ensureOverlay = (): void => {
    if (overlay || disposed) return;
    overlay = mountGizmoOverlay(canvasHost, {
      getDocument: deps.getDocument,
      getSelection: deps.getSelection,
      onDispatch: deps.onDispatch,
      getViewCamera: () => viewCamera,
      setViewCamera: (cam) => {
        viewCamera = cam;
        session?.applyViewCamera(cam);
      },
      onViewCameraCommit: (cam) => {
        viewCamera = cam;
        session?.applyViewCamera(cam);
        suppressCameraPersist = true;
        deps.applyEditorCamera(cam);
        suppressCameraPersist = false;
      },
    });
  };

  const scenePropsKey = (file: OmosceneFile): string =>
    // Cheap fingerprint of scene JSON values (structure + properties).
    JSON.stringify(file.scene);

  const applyDocument = async (forceBoot: boolean): Promise<void> => {
    const gen = ++bootGeneration;
    const file = deps.getDocument();
    if (!file) {
      setStatus('No scene loaded', 'info');
      overlay?.refresh();
      return;
    }

    if (suppressCameraPersist) {
      syncViewCameraFromDocument();
      return;
    }

    const structureKey = sceneStructureKey(file);
    const propsKey = scenePropsKey(file);
    const structureChanged =
      forceBoot || structureKey !== lastStructureKey || !session;
    const propsChanged = propsKey !== lastScenePropsKey;

    // Editor-metadata-only updates (camera / treeState / selection mirror).
    if (!forceBoot && !structureChanged && !propsChanged && session) {
      syncViewCameraFromDocument();
      ensureOverlay();
      overlay?.refresh();
      return;
    }

    try {
      if (structureChanged || session?.loadedVersion !== lastLoadedVersion) {
        setStatus(`Loading engine ${file.engine}…`, 'info');
        const version = (await deps.resolveEngineVersion()) || file.engine;
        if (disposed || gen !== bootGeneration) return;

        await deps.ensureEngine(version);
        if (disposed || gen !== bootGeneration) return;

        const api = await loadEngineUmd(version, deps.readEngineUmd);
        if (disposed || gen !== bootGeneration) return;

        if (!session || session.loadedVersion !== version) {
          session?.dispose();
          session = createAuthoringEngineSession(api, version, canvasHost);
          overlay?.dispose();
          overlay = null;
        }

        const projectEngine = deps.getProjectEngineVersion
          ? await deps.getProjectEngineVersion()
          : null;
        const mismatch =
          engineVersionMismatchWarning(file.engine, version) ??
          (projectEngine
            ? engineVersionMismatchWarning(file.engine, projectEngine)
            : null);
        if (mismatch) {
          setStatus(mismatch, 'warn');
        }

        viewCamera = editorCameraFromUnknown(file.editor.camera);
        session.loadScene(file.scene, viewCamera);
        lastStructureKey = structureKey;
        lastScenePropsKey = propsKey;
        lastLoadedVersion = version;
        const rect = canvasHost.getBoundingClientRect();
        session.resize(rect.width, rect.height);
        session.applyViewCamera(viewCamera);
        if (!mismatch) {
          setStatus(`Engine ${version}`, 'info');
        }
      } else if (session && propsChanged) {
        viewCamera = editorCameraFromUnknown(file.editor.camera);
        session.loadScene(file.scene, viewCamera);
        lastScenePropsKey = propsKey;
        const rect = canvasHost.getBoundingClientRect();
        session.resize(rect.width, rect.height);
        session.applyViewCamera(viewCamera);
      } else {
        syncViewCameraFromDocument();
      }

      ensureOverlay();
      overlay?.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message, 'error');
    }
  };

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    session?.resize(width, height);
    overlay?.resize();
  });
  observer.observe(canvasHost);

  ensureOverlay();
  void applyDocument(true);
  const unsubDoc = deps.subscribeDocument(() => {
    void applyDocument(false);
  });
  const unsubSel = deps.subscribeSelection(() => {
    overlay?.refresh();
  });

  return () => {
    disposed = true;
    bootGeneration += 1;
    unsubDoc();
    unsubSel();
    observer.disconnect();
    overlay?.dispose();
    overlay = null;
    session?.dispose();
    session = null;
    container.classList.remove('authoring-viewport');
    container.replaceChildren();
  };
}

/** Helper for hosts that persist camera via replaceDocument. */
export function patchEditorCamera(
  file: OmosceneFile,
  camera: EditorCameraState,
): OmosceneFile {
  return withEditorMetadata(file, {
    ...file.editor,
    camera: editorCameraFromUnknown(camera),
  });
}
