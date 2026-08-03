/**
 * Dockable animation-timeline tool — edit animations on controller / map (5b).
 */

import type { OmosceneFile } from '../../omoscene';
import { componentUpdate, type EditorMessage, type JsonValue } from '../../protocol';
import { findComponentById } from '../mutation';
import {
  addAnimation,
  appendFrame,
  insertFrame,
  moveFrame,
  parseAnimations,
  removeAnimation,
  removeFrameAt,
  renameAnimation,
  serializeAnimations,
  setFrameRate,
  setLoop,
  setOnComplete,
  type AnimationEntry,
} from './reducer';
import {
  resolveTextureContext,
  type TextureContext,
} from './texture-context';

export const ANIMATION_TIMELINE_VIEW_ID = 'tool-animation-timeline';

const TARGET_TYPES = new Set(['animation-controller', 'animation-map']);

export interface AnimationTimelineDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  readonly readImageDataUrl: (relativePath: string) => Promise<string | null>;
}

export interface AnimationTimelineHandle {
  readonly open: (componentId: number) => void;
  readonly componentId: () => number | null;
}

let handle: AnimationTimelineHandle | null = null;

export function getAnimationTimelineHandle(): AnimationTimelineHandle | null {
  return handle;
}

export function mountAnimationTimelineTool(
  container: HTMLElement,
  deps: AnimationTimelineDeps,
): () => void {
  container.classList.add('animation-timeline-tool');
  container.innerHTML = `
    <div class="ae-control" role="toolbar">
      <label>Name <input class="ae-name" type="text" disabled /></label>
      <label>FPS <input class="ae-fps" type="number" min="1" step="1" disabled /></label>
      <label class="ae-loop-label"><input class="ae-loop" type="checkbox" disabled /> Loop</label>
      <label>onComplete <input class="ae-oncomplete" type="text" disabled /></label>
      <span class="ae-info" role="status"></span>
      <div class="ae-play-controls">
        <button type="button" data-play="play" title="Play" disabled>▶</button>
        <button type="button" data-play="pause" title="Pause" disabled>❚❚</button>
        <button type="button" data-play="stop" title="Stop" disabled>■</button>
        <button type="button" data-play="prev" title="Previous frame" disabled>◀</button>
        <button type="button" data-play="next" title="Next frame" disabled>▶</button>
      </div>
    </div>
    <div class="ae-body">
      <aside class="ae-list">
        <h4>Animations</h4>
        <div class="ae-list-row">
          <input class="ae-new-name" type="text" placeholder="New animation" />
          <button type="button" class="ae-add">+</button>
        </div>
        <div class="ae-list-items"></div>
      </aside>
      <div class="ae-preview">
        <canvas class="ae-preview-canvas" aria-label="Animation preview"></canvas>
        <div class="ae-preview-placeholder">Open an animation-controller or animation-map</div>
      </div>
      <aside class="ae-palette">
        <h4>Frames</h4>
        <div class="ae-palette-grid"></div>
      </aside>
      <div class="ae-timeline"></div>
    </div>
  `;

  const nameInput = container.querySelector('.ae-name') as HTMLInputElement;
  const fpsInput = container.querySelector('.ae-fps') as HTMLInputElement;
  const loopInput = container.querySelector('.ae-loop') as HTMLInputElement;
  const onCompleteInput = container.querySelector(
    '.ae-oncomplete',
  ) as HTMLInputElement;
  const infoEl = container.querySelector('.ae-info') as HTMLElement;
  const listItems = container.querySelector('.ae-list-items') as HTMLElement;
  const newNameInput = container.querySelector('.ae-new-name') as HTMLInputElement;
  const paletteGrid = container.querySelector('.ae-palette-grid') as HTMLElement;
  const timelineEl = container.querySelector('.ae-timeline') as HTMLElement;
  const previewCanvas = container.querySelector(
    '.ae-preview-canvas',
  ) as HTMLCanvasElement;
  const previewPlaceholder = container.querySelector(
    '.ae-preview-placeholder',
  ) as HTMLElement;
  const previewCtx = previewCanvas.getContext('2d');

  let componentId: number | null = null;
  let componentType: string | null = null;
  let animations: AnimationEntry[] = [];
  let selectedAnimation: string | null = null;
  let selectedTimelineIdx: number | null = null;
  let textureCtx: TextureContext | null = null;
  let image: HTMLImageElement | null = null;
  let imagePath = '';
  let disposed = false;
  let applyingLocal = false;
  let raf = 0;
  let playback: {
    status: 'stopped' | 'playing' | 'paused';
    position: number;
    lastTickMs: number;
  } = { status: 'stopped', position: 0, lastTickMs: 0 };
  let dragFromIdx: number | null = null;

  const currentAnim = (): AnimationEntry | null => {
    if (selectedAnimation === null) return null;
    return animations.find((a) => a.name === selectedAnimation) ?? null;
  };

  const commit = (next: AnimationEntry[]): void => {
    animations = next;
    if (
      selectedAnimation !== null &&
      !animations.some((a) => a.name === selectedAnimation)
    ) {
      selectedAnimation = animations[0]?.name ?? null;
      selectedTimelineIdx = null;
    }
    renderChrome();
    if (componentId === null || componentType === null) return;
    applyingLocal = true;
    deps.onDispatch(
      componentUpdate(
        componentId,
        componentType,
        'animations',
        serializeAnimations(animations) as JsonValue,
      ),
    );
    applyingLocal = false;
  };

  const loadFromDocument = (): void => {
    if (applyingLocal) return;
    const file = deps.getDocument();
    if (!file || componentId === null) {
      infoEl.textContent = 'Open via inspector action';
      previewPlaceholder.hidden = false;
      previewPlaceholder.textContent =
        'Open an animation-controller or animation-map';
      return;
    }
    const comp = findComponentById(file.scene, componentId);
    if (!comp || !TARGET_TYPES.has(comp.type)) {
      infoEl.textContent = `No animation target #${componentId}`;
      return;
    }
    componentType = comp.type;
    animations = parseAnimations(comp.animations);
    if (
      selectedAnimation === null ||
      !animations.some((a) => a.name === selectedAnimation)
    ) {
      selectedAnimation = animations[0]?.name ?? null;
      selectedTimelineIdx = null;
    }
    const dims =
      image !== null
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : undefined;
    textureCtx = resolveTextureContext(file.scene, componentId, dims);
    const nextPath = textureCtx?.filePath ?? '';
    const labelParts: string[] = [];
    if (textureCtx?.spriteName) labelParts.push(`sprite: ${textureCtx.spriteName}`);
    if (textureCtx?.textureMapKey) {
      labelParts.push(`key: ${textureCtx.textureMapKey}`);
    }
    if (labelParts.length === 0) labelParts.push('(no texture resolved)');
    infoEl.textContent = labelParts.join(' · ');
    renderChrome();
    if (nextPath !== imagePath) {
      imagePath = nextPath;
      void loadImage(nextPath);
    }
  };

  const loadImage = async (relativePath: string): Promise<void> => {
    if (!relativePath) {
      image = null;
      return;
    }
    try {
      const dataUrl = await deps.readImageDataUrl(relativePath);
      if (disposed || relativePath !== imagePath) return;
      if (!dataUrl) {
        image = null;
        return;
      }
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = dataUrl;
      });
      if (disposed || relativePath !== imagePath) return;
      image = img;
      const file = deps.getDocument();
      if (file && componentId !== null) {
        textureCtx = resolveTextureContext(file.scene, componentId, {
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        renderChrome();
      }
    } catch {
      if (!disposed && relativePath === imagePath) image = null;
    }
  };

  const renderChrome = (): void => {
    const anim = currentAnim();
    const disabled = anim === null;
    nameInput.disabled = disabled;
    fpsInput.disabled = disabled;
    loopInput.disabled = disabled;
    onCompleteInput.disabled = disabled;
    for (const btn of container.querySelectorAll<HTMLButtonElement>('[data-play]')) {
      btn.disabled = disabled;
    }
    if (document.activeElement !== nameInput) {
      nameInput.value = anim?.name ?? '';
    }
    if (document.activeElement !== fpsInput) {
      fpsInput.value = String(anim?.frameRate ?? 12);
    }
    if (document.activeElement !== loopInput) {
      loopInput.checked = anim?.loop ?? false;
    }
    if (document.activeElement !== onCompleteInput) {
      onCompleteInput.value = anim?.onComplete ?? '';
    }

    listItems.innerHTML = animations
      .map((a) => {
        const sel = a.name === selectedAnimation ? ' is-selected' : '';
        return `<div class="ae-list-item${sel}" data-name="${escapeAttr(a.name)}">
          <span>${escapeHtml(a.name)}</span>
          <button type="button" data-remove="${escapeAttr(a.name)}" title="Delete">×</button>
        </div>`;
      })
      .join('');

    const frameCount = textureCtx?.frames.length ?? 0;
    if (frameCount === 0) {
      paletteGrid.innerHTML =
        '<em class="ae-empty">No frames — resolve a sibling sprite texture-map (grid/framemap).</em>';
    } else {
      const cells: string[] = [];
      for (let i = 0; i < frameCount; i += 1) {
        cells.push(
          `<button type="button" class="ae-cell" data-frame="${i}" title="Frame ${i}">
            <canvas width="48" height="48"></canvas>
            <span class="ae-idx">${i}</span>
          </button>`,
        );
      }
      paletteGrid.innerHTML = cells.join('');
    }

    if (anim === null) {
      timelineEl.innerHTML =
        '<span class="ae-empty">Select an animation to edit its frame sequence.</span>';
    } else if (anim.frames.length === 0) {
      timelineEl.innerHTML =
        '<span class="ae-empty">Click a frame in the palette to add it.</span>';
    } else {
      timelineEl.innerHTML = anim.frames
        .map((frameIdx, pos) => {
          const sel = pos === selectedTimelineIdx ? ' is-selected' : '';
          const playing =
            playback.status !== 'stopped' && pos === playback.position
              ? ' is-playing'
              : '';
          return `<div class="ae-tcell${sel}${playing}" data-position="${pos}" data-frame="${frameIdx}" draggable="true" title="Frame ${frameIdx} (right-click to remove)">
            <canvas width="48" height="48"></canvas>
            <span class="ae-idx">${frameIdx}</span>
          </div>`;
        })
        .join('');
    }

    previewPlaceholder.hidden = anim !== null && anim.frames.length > 0 && textureCtx !== null;
    if (!previewPlaceholder.hidden) {
      previewPlaceholder.textContent =
        textureCtx === null
          ? 'No texture resolved'
          : anim === null
            ? 'Select an animation'
            : 'Add frames from the palette';
    }
  };

  const advancePlayback = (): void => {
    if (playback.status !== 'playing') return;
    const anim = currentAnim();
    if (anim === null || anim.frames.length === 0) return;
    const fr = anim.frameRate > 0 ? anim.frameRate : 12;
    const intervalMs = 1000 / fr;
    const now = performance.now();
    if (now - playback.lastTickMs < intervalMs) return;
    let next = playback.position + 1;
    if (next >= anim.frames.length) {
      if (anim.loop) {
        next = 0;
      } else {
        next = anim.frames.length - 1;
        playback = { ...playback, status: 'paused' };
      }
    }
    playback = { ...playback, position: next, lastTickMs: now };
    for (const cell of timelineEl.querySelectorAll('.ae-tcell')) {
      const pos = Number((cell as HTMLElement).dataset.position);
      cell.classList.toggle(
        'is-playing',
        playback.status !== 'stopped' && pos === playback.position,
      );
    }
  };

  const drawClipped = (
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    size: number,
  ): void => {
    if (!image) return;
    const pad = size - 2;
    const scale = Math.min(pad / rect.w, pad / rect.h, 2);
    const dw = rect.w * scale;
    const dh = rect.h * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      (size - dw) / 2,
      (size - dh) / 2,
      dw,
      dh,
    );
  };

  const drawThumbs = (): void => {
    const frames = textureCtx?.frames ?? [];
    for (const cell of paletteGrid.querySelectorAll<HTMLButtonElement>('.ae-cell')) {
      const canvas = cell.querySelector('canvas');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) continue;
      ctx.clearRect(0, 0, 48, 48);
      const idx = Number(cell.dataset.frame);
      const rect = frames[idx];
      if (rect && rect.w > 0 && rect.h > 0) drawClipped(ctx, rect, 48);
    }
    const anim = currentAnim();
    for (const cell of timelineEl.querySelectorAll<HTMLElement>('.ae-tcell')) {
      const canvas = cell.querySelector('canvas');
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !anim) continue;
      ctx.clearRect(0, 0, 48, 48);
      const pos = Number(cell.dataset.position);
      const frameIdx = anim.frames[pos];
      if (frameIdx === undefined) continue;
      const rect = frames[frameIdx];
      if (rect && rect.w > 0 && rect.h > 0) drawClipped(ctx, rect, 48);
    }
  };

  const drawPreview = (): void => {
    if (!previewCtx) return;
    const wrap = previewCanvas.parentElement;
    if (wrap) {
      if (previewCanvas.width !== wrap.clientWidth) {
        previewCanvas.width = wrap.clientWidth;
      }
      if (previewCanvas.height !== wrap.clientHeight) {
        previewCanvas.height = wrap.clientHeight;
      }
    }
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const anim = currentAnim();
    if (!image || !textureCtx || !anim || anim.frames.length === 0) return;
    const frameIdx = anim.frames[playback.position];
    if (frameIdx === undefined) return;
    const rect = textureCtx.frames[frameIdx];
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    const padX = previewCanvas.width - 16;
    const padY = previewCanvas.height - 16;
    if (padX <= 0 || padY <= 0) return;
    const scale = Math.min(padX / rect.w, padY / rect.h, 8);
    const dw = rect.w * scale;
    const dh = rect.h * scale;
    previewCtx.imageSmoothingEnabled = false;
    previewCtx.drawImage(
      image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      (previewCanvas.width - dw) / 2,
      (previewCanvas.height - dh) / 2,
      dw,
      dh,
    );
  };

  const tick = (): void => {
    if (disposed) return;
    advancePlayback();
    drawPreview();
    drawThumbs();
    raf = requestAnimationFrame(tick);
  };

  const onListClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const remove = t.closest<HTMLElement>('[data-remove]');
    if (remove?.dataset.remove) {
      e.stopPropagation();
      const name = remove.dataset.remove;
      if (selectedAnimation === name) {
        selectedAnimation = null;
        selectedTimelineIdx = null;
      }
      commit(removeAnimation(animations, name));
      return;
    }
    const item = t.closest<HTMLElement>('.ae-list-item');
    if (item?.dataset.name) {
      selectedAnimation = item.dataset.name;
      selectedTimelineIdx = null;
      playback = { status: 'stopped', position: 0, lastTickMs: performance.now() };
      renderChrome();
    }
  };

  const onPaletteClick = (e: MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-frame]');
    if (!cell || selectedAnimation === null) return;
    const idx = Number(cell.dataset.frame);
    if (!Number.isFinite(idx)) return;
    const next =
      selectedTimelineIdx !== null
        ? insertFrame(animations, selectedAnimation, selectedTimelineIdx, idx)
        : appendFrame(animations, selectedAnimation, idx);
    commit(next);
  };

  const onTimelineClick = (e: MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.ae-tcell');
    if (!cell) return;
    const pos = Number(cell.dataset.position);
    if (!Number.isFinite(pos)) return;
    selectedTimelineIdx = pos;
    playback = {
      status: 'paused',
      position: pos,
      lastTickMs: performance.now(),
    };
    renderChrome();
  };

  const onTimelineContext = (e: MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.ae-tcell');
    if (!cell || selectedAnimation === null) return;
    e.preventDefault();
    const pos = Number(cell.dataset.position);
    if (!Number.isFinite(pos)) return;
    if (selectedTimelineIdx !== null && selectedTimelineIdx >= pos) {
      selectedTimelineIdx = null;
    }
    commit(removeFrameAt(animations, selectedAnimation, pos));
  };

  const onDragStart = (e: DragEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.ae-tcell');
    if (!cell) return;
    const pos = Number(cell.dataset.position);
    if (!Number.isFinite(pos)) return;
    dragFromIdx = pos;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(pos));
    }
  };

  const onDragOver = (e: DragEvent): void => {
    if (dragFromIdx === null) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.ae-tcell');
    if (!cell) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    timelineEl
      .querySelectorAll('.ae-tcell.is-drag-over')
      .forEach((el) => el.classList.remove('is-drag-over'));
    cell.classList.add('is-drag-over');
  };

  const onDrop = (e: DragEvent): void => {
    if (dragFromIdx === null || selectedAnimation === null) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.ae-tcell');
    timelineEl
      .querySelectorAll('.ae-tcell.is-drag-over')
      .forEach((el) => el.classList.remove('is-drag-over'));
    if (!cell) {
      dragFromIdx = null;
      return;
    }
    e.preventDefault();
    const toIdx = Number(cell.dataset.position);
    if (!Number.isFinite(toIdx) || toIdx === dragFromIdx) {
      dragFromIdx = null;
      return;
    }
    const next = moveFrame(animations, selectedAnimation, dragFromIdx, toIdx);
    dragFromIdx = null;
    commit(next);
  };

  listItems.addEventListener('click', onListClick);
  paletteGrid.addEventListener('click', onPaletteClick);
  timelineEl.addEventListener('click', onTimelineClick);
  timelineEl.addEventListener('contextmenu', onTimelineContext);
  timelineEl.addEventListener('dragstart', onDragStart);
  timelineEl.addEventListener('dragover', onDragOver);
  timelineEl.addEventListener('drop', onDrop);

  container.querySelector('.ae-add')?.addEventListener('click', () => {
    const name = newNameInput.value.trim();
    if (!name) return;
    const next = addAnimation(animations, name);
    if (next.length === animations.length) return;
    newNameInput.value = '';
    selectedAnimation = name;
    selectedTimelineIdx = null;
    commit(next);
  });

  nameInput.addEventListener('change', () => {
    if (selectedAnimation === null) return;
    const old = selectedAnimation;
    const next = renameAnimation(animations, old, nameInput.value);
    const trimmed = nameInput.value.trim();
    selectedAnimation = trimmed === '' ? old : trimmed;
    commit(next);
  });

  fpsInput.addEventListener('change', () => {
    if (selectedAnimation === null) return;
    const fr = Number.parseFloat(fpsInput.value);
    if (!Number.isFinite(fr) || fr <= 0) return;
    commit(setFrameRate(animations, selectedAnimation, fr));
  });

  loopInput.addEventListener('change', () => {
    if (selectedAnimation === null) return;
    commit(setLoop(animations, selectedAnimation, loopInput.checked));
  });

  onCompleteInput.addEventListener('change', () => {
    if (selectedAnimation === null) return;
    commit(setOnComplete(animations, selectedAnimation, onCompleteInput.value));
  });

  container.querySelector('[data-play="play"]')?.addEventListener('click', () => {
    if (currentAnim() === null) return;
    playback = { status: 'playing', position: 0, lastTickMs: performance.now() };
    renderChrome();
  });
  container.querySelector('[data-play="pause"]')?.addEventListener('click', () => {
    playback = { ...playback, status: 'paused', lastTickMs: performance.now() };
    renderChrome();
  });
  container.querySelector('[data-play="stop"]')?.addEventListener('click', () => {
    playback = { status: 'stopped', position: 0, lastTickMs: performance.now() };
    renderChrome();
  });
  container.querySelector('[data-play="prev"]')?.addEventListener('click', () => {
    const anim = currentAnim();
    if (!anim || anim.frames.length === 0) return;
    const len = anim.frames.length;
    playback = {
      status: 'paused',
      position: (playback.position - 1 + len) % len,
      lastTickMs: performance.now(),
    };
    renderChrome();
  });
  container.querySelector('[data-play="next"]')?.addEventListener('click', () => {
    const anim = currentAnim();
    if (!anim || anim.frames.length === 0) return;
    playback = {
      status: 'paused',
      position: (playback.position + 1) % anim.frames.length,
      lastTickMs: performance.now(),
    };
    renderChrome();
  });

  const unsub = deps.subscribeDocument(() => loadFromDocument());
  raf = requestAnimationFrame(tick);

  handle = {
    open(id) {
      componentId = id;
      selectedAnimation = null;
      selectedTimelineIdx = null;
      playback = { status: 'stopped', position: 0, lastTickMs: 0 };
      imagePath = '';
      image = null;
      loadFromDocument();
    },
    componentId: () => componentId,
  };

  loadFromDocument();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    unsub();
    if (handle?.componentId() === componentId) handle = null;
    container.classList.remove('animation-timeline-tool');
    container.innerHTML = '';
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
