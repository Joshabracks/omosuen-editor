/**
 * Dockable authoring viewport — engine WebGL host + gizmo overlay.
 *
 * Cold-boots on scene:load; incremental add/remove/move/update via
 * DocumentController Bridge (no JSON.stringify full-reload path).
 */

import type { Bridge } from '../../bridge/protocol-bridge';
import type { EditorCameraState, OmosceneFile } from '../../omoscene';
import { withEditorMetadata } from '../../omoscene';
import type { EditorMessage } from '../../protocol';
import {
  getCellVoxelPaintHandle,
  mountCellVoxelPaint,
} from '../../scene/cell-voxel-paint';
import { createAuthoringSyncBridge } from './authoring-sync';
import {
  canPatchFlushedIntoCurrent,
  flushIsComplete,
  mergeCellMapPackedData,
} from './cell-map-flush';
import { sceneRegionKey } from './entities';
import { loadEngineUmd } from './engine-loader';
import { mountGizmoOverlay, type GizmoOverlayHandle } from './gizmo-overlay';
import {
  createAuthoringEngineSession,
  type AuthoringEngineSession,
} from './session';
import { engineVersionMismatchWarning } from './sanitize';
import {
  camerasEqual,
  editorCameraFromUnknown,
} from './view-camera';

export { sceneRegionKey } from './entities';

export const VIEWPORT_VIEW_ID = 'viewport';

export interface ViewportDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly getSelection: () => readonly number[];
  readonly subscribeSelection: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  /** Persist editor.camera without treating it as a scene mutation. */
  readonly applyEditorCamera: (camera: EditorCameraState) => void;
  /**
   * Register the authoring sync Bridge with DocumentController so
   * incremental protocol messages reach the live engine graph.
   */
  readonly registerPanel: (bridge: Bridge) => () => void;
  /** Mark document dirty without mutating scene JSON (live voxel paint). */
  readonly markVoxelDirty: () => void;
  /** Register pre-save flush of live cell-maps into the document. */
  readonly setBeforeSave: (
    hook: ((file: OmosceneFile) => Promise<OmosceneFile>) | null,
  ) => void;
  /**
   * Patch sceneDocument without scene:load (flush on unload / cold boot).
   */
  readonly patchDocumentSilent: (
    file: OmosceneFile,
    options?: { readonly dirty?: boolean },
  ) => void;
  /** Prefer scene file engine; fall back to project pin / default. */
  readonly resolveEngineVersion: () => Promise<string>;
  readonly ensureEngine: (version: string) => Promise<{
    readonly version: string;
    readonly umdUrl: string;
  }>;
  readonly readEngineUmd: (version: string) => Promise<string>;
  /** Resolve workspace-relative images for texture-maps in the authoring scene. */
  readonly readImageDataUrl?: (
    relativePath: string,
  ) => Promise<string | null>;
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
  let disposePaint: (() => void) | null = null;
  let unsubPaint: (() => void) | null = null;
  let disposed = false;
  let bootGeneration = 0;
  let lastSceneRegionKey = '';
  let lastLoadedVersion = '';
  /** Scene file last loaded into the live session (flush target). */
  let lastBootFile: OmosceneFile | null = null;
  /** True after live paint until a successful flush. */
  let voxelDirty = false;
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

  const syncViewCameraFromEngine = (): void => {
    const live = session?.readLiveViewCamera();
    if (!live || camerasEqual(live, viewCamera)) return;
    viewCamera = live;
    suppressCameraPersist = true;
    deps.applyEditorCamera(live);
    suppressCameraPersist = false;
    overlay?.refresh();
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

  /**
   * True only when `patches` covers every live cell-map the session knows
   * about. Partial capture (e.g. one map's packedData wasn't introspectable)
   * must not clear voxelDirty — the un-captured voxels would otherwise be
   * silently lost with no retry.
   */
  const flushFullyCaptured = (
    patches: ReadonlyMap<number, number[]>,
  ): boolean => {
    const expectedIds = session?.getLiveCellMapIds() ?? [];
    const { complete, missing } = flushIsComplete(expectedIds, patches);
    if (!complete) {
      console.warn(
        `[voxel-flush] captured ${patches.size}/${expectedIds.length} live cell-map(s); ` +
          `missing ids [${missing.join(', ')}] — keeping voxelDirty for retry`,
      );
    }
    return complete;
  };

  /**
   * Flush live cell-maps into `target` only. Never assume getDocument()
   * matches the live session (document may already be swapped).
   */
  const flushLiveInto = async (
    target: OmosceneFile,
  ): Promise<OmosceneFile> => {
    if (!session || !voxelDirty) return target;
    const patches = await session.flushLiveCellMaps();
    if (flushFullyCaptured(patches)) voxelDirty = false;
    if (patches.size === 0) return target;
    return mergeCellMapPackedData(target, patches);
  };

  const flushLiveIntoSync = (target: OmosceneFile): OmosceneFile => {
    if (!session || !voxelDirty) return target;
    const patches = session.flushLiveCellMapsSync();
    if (flushFullyCaptured(patches)) voxelDirty = false;
    if (patches.size === 0) return target;
    return mergeCellMapPackedData(target, patches);
  };

  const ensurePaint = (): void => {
    if (disposePaint || disposed) return;
    disposePaint = mountCellVoxelPaint(container, {
      getDocument: deps.getDocument,
      subscribeDocument: deps.subscribeDocument,
      getSelection: deps.getSelection,
      subscribeSelection: deps.subscribeSelection,
      onDispatch: deps.onDispatch,
      applyLiveCell: (id, coord, cell) =>
        session?.applyCellPaint(id, coord, cell) ?? false,
      markVoxelDirty: () => {
        voxelDirty = true;
        deps.markVoxelDirty();
      },
    });
    unsubPaint =
      getCellVoxelPaintHandle()?.subscribe(() => {
        overlay?.updatePointerPolicy();
        overlay?.refresh();
      }) ?? null;
  };

  const coldBoot = async (file: OmosceneFile): Promise<void> => {
    const gen = ++bootGeneration;
    try {
      // Computed once and reused below — sceneRegionKey walks + stringifies
      // the whole scene tree, so don't pay for it twice per boot.
      const incomingRegionKey = sceneRegionKey(file);
      const sameRegionAsLast =
        lastSceneRegionKey !== '' && incomingRegionKey === lastSceneRegionKey;

      // Persist live voxels into the *previous* boot file before rebuild.
      // Never merge into an already-swapped incoming document by colliding ids.
      if (session && lastBootFile && voxelDirty) {
        const flushed = await flushLiveInto(lastBootFile);
        lastBootFile = flushed;
        if (
          sameRegionAsLast &&
          canPatchFlushedIntoCurrent(
            deps.getDocument(),
            flushed,
            sceneRegionKey,
          )
        ) {
          const current = deps.getDocument()!;
          if (flushed !== current) {
            deps.patchDocumentSilent(flushed, { dirty: true });
          }
        }
        if (disposed || gen !== bootGeneration) return;
      }

      setStatus(`Loading engine ${file.engine}…`, 'info');
      const version = (await deps.resolveEngineVersion()) || file.engine;
      if (disposed || gen !== bootGeneration) return;

      await deps.ensureEngine(version);
      if (disposed || gen !== bootGeneration) return;

      const api = await loadEngineUmd(version, deps.readEngineUmd);
      if (disposed || gen !== bootGeneration) return;

      if (!session || session.loadedVersion !== version) {
        session?.dispose();
        session = createAuthoringEngineSession(api, version, canvasHost, {
          readImageDataUrl: deps.readImageDataUrl,
          onCameraMoved: () => {
            syncViewCameraFromEngine();
          },
        });
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

      const current = deps.getDocument();
      // Same-region rebuild may use flushed document; region change always uses incoming file.
      const currentRegionKey =
        sameRegionAsLast && current ? sceneRegionKey(current) : null;
      const useCurrentAsBootFile =
        sameRegionAsLast && current && currentRegionKey === lastSceneRegionKey;
      const bootFile = useCurrentAsBootFile ? current : file;
      const bootFileRegionKey = useCurrentAsBootFile
        ? currentRegionKey!
        : incomingRegionKey;
      viewCamera = editorCameraFromUnknown(bootFile.editor.camera);
      await session.loadScene(bootFile.scene, viewCamera);
      if (disposed || gen !== bootGeneration) return;

      lastBootFile = bootFile;
      lastSceneRegionKey = bootFileRegionKey;
      lastLoadedVersion = version;
      const rect = canvasHost.getBoundingClientRect();
      session.resize(rect.width, rect.height);
      session.applyViewCamera(viewCamera);
      ensureOverlay();
      ensurePaint();
      overlay?.updatePointerPolicy();
      overlay?.refresh();
      if (!mismatch) {
        setStatus(`Engine ${version}`, 'info');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message, 'error');
    }
  };

  const syncBridge = createAuthoringSyncBridge({
    get api() {
      if (!session) throw new Error('No authoring session');
      return session.api;
    },
    getHandles: () => session?.getHandles() ?? null,
    getDocument: deps.getDocument,
    onSelect: () => {
      overlay?.updatePointerPolicy();
      overlay?.refresh();
    },
    onDesync: (reason) => {
      console.warn(`[authoring-sync] ${reason}`);
      const file = deps.getDocument();
      if (file) void coldBoot(file);
    },
  });

  const safeBridge: Bridge = {
    dispatch(msg) {
      if (msg.kind === 'scene:load') {
        if (
          session &&
          sceneRegionKey(msg.file) === lastSceneRegionKey &&
          session.loadedVersion === lastLoadedVersion
        ) {
          syncViewCameraFromDocument();
          overlay?.refresh();
          return;
        }
        void coldBoot(msg.file);
        return;
      }
      if (!session) return;
      syncBridge.dispatch(msg);
      overlay?.updatePointerPolicy();
      overlay?.refresh();
    },
    onMessage: (listener) => syncBridge.onMessage(listener),
    dispose: () => syncBridge.dispose(),
  };

  const unregisterPanel = deps.registerPanel(safeBridge);

  deps.setBeforeSave(async (file) => {
    if (!session || !voxelDirty) return file;
    const next = await flushLiveInto(file);
    lastBootFile = next;
    return next;
  });

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    session?.resize(width, height);
    overlay?.resize();
  });
  observer.observe(canvasHost);

  ensureOverlay();
  ensurePaint();

  // Light document subscribe: camera metadata + overlay refresh only (no reload).
  const unsubDoc = deps.subscribeDocument(() => {
    if (disposed || suppressCameraPersist) return;
    syncViewCameraFromDocument();
    overlay?.updatePointerPolicy();
    overlay?.refresh();
  });
  const unsubSel = deps.subscribeSelection(() => {
    overlay?.updatePointerPolicy();
    overlay?.refresh();
  });

  return () => {
    disposed = true;
    bootGeneration += 1;
    deps.setBeforeSave(null);
    // Sync dump into the last booted file — never into a swapped document.
    if (session && lastBootFile && voxelDirty) {
      const flushed = flushLiveIntoSync(lastBootFile);
      lastBootFile = flushed;
      if (
        canPatchFlushedIntoCurrent(
          deps.getDocument(),
          flushed,
          sceneRegionKey,
        ) &&
        flushed !== deps.getDocument()
      ) {
        deps.patchDocumentSilent(flushed, { dirty: true });
      }
    }
    unregisterPanel();
    safeBridge.dispose();
    unsubDoc();
    unsubSel();
    unsubPaint?.();
    observer.disconnect();
    disposePaint?.();
    disposePaint = null;
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
