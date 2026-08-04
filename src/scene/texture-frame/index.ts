/**
 * Dockable texture-frame tool — edit texture-map `imageType` (5a).
 */

import type { OmosceneFile } from '../../omoscene';
import { componentUpdate, type EditorMessage } from '../../protocol';
import type { JsonValue } from '../../protocol';
import { findComponentById } from '../mutation';
import {
  HANDLE_CURSOR,
  fitImageToView,
  frameAt,
  handleAt,
  handlePositions,
  imageToScreen,
  rectFromPoints,
  screenToImage,
  zoomToward,
  type Camera,
} from './geom';
import {
  addFrame,
  deleteFrame,
  deriveFrameRects,
  parseImageType,
  resizeFrame,
  serializeImageType,
  setGridConfig,
  setMode,
  type EditorState,
  type HandleId,
  type Mode,
} from './reducer';

export const TEXTURE_FRAME_VIEW_ID = 'tool-texture-frame';

export interface TextureFrameDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  readonly readImageDataUrl: (relativePath: string) => Promise<string | null>;
}

export interface TextureFrameHandle {
  readonly open: (componentId: number) => void;
  readonly componentId: () => number | null;
}

let handle: TextureFrameHandle | null = null;

export function getTextureFrameHandle(): TextureFrameHandle | null {
  return handle;
}

export function mountTextureFrameTool(
  container: HTMLElement,
  deps: TextureFrameDeps,
): () => void {
  container.classList.add('texture-frame-tool');
  container.innerHTML = `
    <div class="tf-toolbar" role="toolbar">
      <div class="tf-modes">
        <button type="button" data-mode="single">Single</button>
        <button type="button" data-mode="grid">Grid</button>
        <button type="button" data-mode="framemap">FrameMap</button>
      </div>
      <div class="tf-grid-fields" hidden>
        <label>W <input data-grid="cellWidth" type="number" min="1" step="1" /></label>
        <label>H <input data-grid="cellHeight" type="number" min="1" step="1" /></label>
        <label>Cols <input data-grid="cols" type="number" min="1" step="1" /></label>
        <label>Rows <input data-grid="rows" type="number" min="1" step="1" /></label>
        <label>Count <input data-grid="cellCount" type="number" min="0" step="1" /></label>
      </div>
      <span class="tf-status" role="status"></span>
    </div>
    <div class="tf-canvas-host">
      <canvas class="tf-canvas" aria-label="Texture frames"></canvas>
    </div>
  `;

  const statusEl = container.querySelector('.tf-status') as HTMLElement;
  const gridFields = container.querySelector('.tf-grid-fields') as HTMLElement;
  const canvas = container.querySelector('.tf-canvas') as HTMLCanvasElement;
  const canvasHost = container.querySelector('.tf-canvas-host') as HTMLElement;
  const ctx = canvas.getContext('2d');

  let componentId: number | null = null;
  let state: EditorState = parseImageType(null);
  let cam: Camera = { x: 0, y: 0, zoom: 1 };
  let image: HTMLImageElement | null = null;
  let imagePath = '';
  let selected = -1;
  let disposed = false;
  let raf = 0;
  let applyingLocal = false;
  let drag: {
    kind: 'pan' | 'move' | 'resize' | 'create';
    startScreen: { x: number; y: number };
    startImage: { x: number; y: number };
    startCam?: Camera;
    startRect?: { x: number; y: number; w: number; h: number };
    handle?: HandleId;
    index?: number;
  } | null = null;

  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const commit = (next: EditorState): void => {
    state = next;
    if (componentId === null) {
      syncChrome();
      schedule();
      return;
    }
    applyingLocal = true;
    deps.onDispatch(
      componentUpdate(
        componentId,
        'texture-map',
        'imageType',
        serializeImageType(state) as JsonValue,
      ),
    );
    applyingLocal = false;
    syncChrome();
    schedule();
  };

  const syncChrome = (): void => {
    for (const btn of container.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
    }
    gridFields.hidden = state.mode !== 'grid';
    if (state.mode === 'grid') {
      setInput('cellWidth', state.grid.cellWidth);
      setInput('cellHeight', state.grid.cellHeight);
      setInput('cols', state.grid.cols);
      setInput('rows', state.grid.rows);
      setInput('cellCount', state.grid.cellCount ?? 0);
    }
  };

  const setInput = (key: string, value: number): void => {
    const el = container.querySelector<HTMLInputElement>(`[data-grid="${key}"]`);
    if (el && document.activeElement !== el) el.value = String(value);
  };

  const loadFromDocument = (): void => {
    if (applyingLocal) return;
    const file = deps.getDocument();
    if (!file || componentId === null) {
      setStatus('Open a texture-map via inspector action');
      return;
    }
    const comp = findComponentById(file.scene, componentId);
    if (!comp || comp.type !== 'texture-map') {
      setStatus(`No texture-map #${componentId}`);
      return;
    }
    state = parseImageType(comp.imageType);
    const nextPath = typeof comp.filePath === 'string' ? comp.filePath : '';
    const key =
      typeof comp.textureMapKey === 'string' && comp.textureMapKey
        ? comp.textureMapKey
        : `id ${componentId}`;
    setStatus(key);
    syncChrome();
    if (nextPath !== imagePath) {
      imagePath = nextPath;
      void loadImage(nextPath);
    } else {
      schedule();
    }
  };

  const loadImage = async (relativePath: string): Promise<void> => {
    if (!relativePath) {
      image = null;
      schedule();
      return;
    }
    try {
      const dataUrl = await deps.readImageDataUrl(relativePath);
      if (disposed || relativePath !== imagePath) return;
      if (!dataUrl) {
        image = null;
        setStatus(`Missing image: ${relativePath}`);
        schedule();
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (disposed || relativePath !== imagePath) return;
        image = img;
        const rect = canvasHost.getBoundingClientRect();
        cam = fitImageToView(
          { width: img.naturalWidth, height: img.naturalHeight },
          { width: Math.max(1, rect.width), height: Math.max(1, rect.height) },
        );
        schedule();
      };
      img.onerror = () => {
        if (disposed || relativePath !== imagePath) return;
        image = null;
        setStatus(`Failed to decode: ${relativePath}`);
        schedule();
      };
      img.src = dataUrl;
    } catch (err) {
      if (disposed) return;
      image = null;
      setStatus(err instanceof Error ? err.message : 'Image load failed');
      schedule();
    }
  };

  const draw = (): void => {
    if (!ctx) return;
    const rect = canvasHost.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (
      canvas.width !== Math.floor(w * dpr) ||
      canvas.height !== Math.floor(h * dpr)
    ) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1c22';
    ctx.fillRect(0, 0, w, h);

    if (!image) {
      ctx.fillStyle = '#888';
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(
        'No image loaded — set filePath on the texture-map',
        16,
        24,
      );
      return;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      cam.x,
      cam.y,
      image.naturalWidth * cam.zoom,
      image.naturalHeight * cam.zoom,
    );

    const dims = { width: image.naturalWidth, height: image.naturalHeight };
    const rects = deriveFrameRects(state, dims);
    for (let i = 0; i < rects.length; i += 1) {
      const f = rects[i]!;
      const tl = imageToScreen({ x: f.x, y: f.y }, cam);
      const br = imageToScreen({ x: f.x + f.w, y: f.y + f.h }, cam);
      const active = state.mode === 'framemap' && i === selected;
      const outline = active ? '#5ad' : 'rgba(255,220,80,0.75)';
      const badgeBg = active
        ? 'rgba(85,170,221,0.5)'
        : 'rgba(255,220,80,0.5)';
      ctx.strokeStyle = outline;
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      drawFrameIndexBadge(ctx, i, br.x, tl.y, badgeBg);
      if (active) {
        const handles = handlePositions(f, cam);
        ctx.fillStyle = '#5ad';
        for (const p of Object.values(handles)) {
          ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
        }
      }
    }
  };

  const schedule = (): void => {
    if (raf || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  };

  const pointer = (event: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  const onPointerDown = (event: PointerEvent): void => {
    const p = pointer(event);
    if (event.button === 1) {
      drag = {
        kind: 'pan',
        startScreen: p,
        startImage: screenToImage(p, cam),
        startCam: { ...cam },
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || !image) return;

    if (state.mode === 'framemap') {
      if (selected >= 0 && selected < state.frames.length) {
        const hit = handleAt(p, state.frames[selected]!, cam);
        if (hit) {
          drag = {
            kind: 'resize',
            startScreen: p,
            startImage: screenToImage(p, cam),
            startRect: { ...state.frames[selected]! },
            handle: hit,
            index: selected,
          };
          canvas.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }
      }
      const imgPt = screenToImage(p, cam);
      const hitFrame = frameAt(imgPt, state.frames);
      if (hitFrame !== null) {
        selected = hitFrame;
        drag = {
          kind: 'move',
          startScreen: p,
          startImage: imgPt,
          startRect: { ...state.frames[hitFrame]! },
          index: hitFrame,
        };
        schedule();
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      selected = -1;
      drag = {
        kind: 'create',
        startScreen: p,
        startImage: imgPt,
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      schedule();
      return;
    }

    drag = {
      kind: 'pan',
      startScreen: p,
      startImage: screenToImage(p, cam),
      startCam: { ...cam },
    };
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const p = pointer(event);
    if (!drag) {
      if (state.mode === 'framemap' && selected >= 0 && state.frames[selected]) {
        const hit = handleAt(p, state.frames[selected]!, cam);
        canvas.style.cursor = hit ? HANDLE_CURSOR[hit] : 'default';
      }
      return;
    }
    if (drag.kind === 'pan' && drag.startCam) {
      cam = {
        ...drag.startCam,
        x: drag.startCam.x + (p.x - drag.startScreen.x),
        y: drag.startCam.y + (p.y - drag.startScreen.y),
      };
      schedule();
      return;
    }
    const imgPt = screenToImage(p, cam);
    if (drag.kind === 'move' && drag.startRect && drag.index !== undefined) {
      const dx = imgPt.x - drag.startImage.x;
      const dy = imgPt.y - drag.startImage.y;
      state = {
        ...state,
        frames: state.frames.map((f, i) =>
          i === drag!.index
            ? {
                x: Math.max(0, Math.round(drag!.startRect!.x + dx)),
                y: Math.max(0, Math.round(drag!.startRect!.y + dy)),
                w: drag!.startRect!.w,
                h: drag!.startRect!.h,
              }
            : f,
        ),
      };
      schedule();
      return;
    }
    if (
      drag.kind === 'resize' &&
      drag.startRect &&
      drag.handle &&
      drag.index !== undefined
    ) {
      const dx = imgPt.x - drag.startImage.x;
      const dy = imgPt.y - drag.startImage.y;
      const base: EditorState = {
        ...state,
        frames: state.frames.map((f, i) =>
          i === drag!.index ? drag!.startRect! : f,
        ),
      };
      state = resizeFrame(base, drag.index, drag.handle, dx, dy);
      schedule();
      return;
    }
    if (drag.kind === 'create') {
      schedule();
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag) return;
    const p = pointer(event);
    const imgPt = screenToImage(p, cam);
    const finished = drag;
    drag = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (finished.kind === 'pan') return;
    if (finished.kind === 'move' || finished.kind === 'resize') {
      commit(state);
      return;
    }
    if (finished.kind === 'create') {
      const rect = rectFromPoints(finished.startImage, imgPt);
      if (rect.w >= 1 && rect.h >= 1) {
        const next = addFrame(state, rect);
        selected = next.frames.length - 1;
        commit(next);
      } else {
        schedule();
      }
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    cam = zoomToward(
      cam,
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      event.deltaY,
    );
    schedule();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      state.mode === 'framemap' &&
      selected >= 0
    ) {
      event.preventDefault();
      const next = deleteFrame(state, selected);
      selected = -1;
      commit(next);
    }
  };

  container.querySelector('.tf-modes')!.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-mode]',
    );
    if (!btn?.dataset.mode) return;
    commit(setMode(state, btn.dataset.mode as Mode));
  });

  gridFields.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.grid;
    if (!key) return;
    const value = Number(input.value);
    if (key === 'cellCount' && value <= 0) {
      commit(setGridConfig(state, { cellCount: undefined }));
      return;
    }
    commit(setGridConfig(state, { [key]: value }));
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('keydown', onKeyDown);
  container.tabIndex = 0;

  const observer = new ResizeObserver(() => schedule());
  observer.observe(canvasHost);

  const unsub = deps.subscribeDocument(() => {
    if (componentId !== null) loadFromDocument();
  });

  handle = {
    open(id) {
      componentId = id;
      selected = -1;
      loadFromDocument();
      container.focus();
    },
    componentId: () => componentId,
  };

  setStatus('Open a texture-map via inspector action');
  schedule();

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    unsub();
    observer.disconnect();
    handle = null;
    container.classList.remove('texture-frame-tool');
    container.replaceChildren();
  };
}

/** Index label anchored to the top-right of a frame outline. */
function drawFrameIndexBadge(
  ctx: CanvasRenderingContext2D,
  index: number,
  right: number,
  top: number,
  background: string,
): void {
  const label = String(index);
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padX = 3;
  const padY = 1;
  const metrics = ctx.measureText(label);
  const tw = Math.ceil(metrics.width);
  const th = 10;
  const bw = tw + padX * 2;
  const bh = th + padY * 2;
  const bx = right - bw;
  const by = top;
  ctx.fillStyle = background;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#000';
  ctx.fillText(label, bx + padX, by + padY);
}
