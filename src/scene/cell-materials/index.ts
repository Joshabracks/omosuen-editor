/**
 * Dockable cell-materials tool — edit cell-map materials[] (6a).
 */

import type { OmosceneFile } from '../../omoscene';
import {
  componentUpdate,
  type EditorMessage,
  type JsonValue,
} from '../../protocol';
import { findComponentById } from '../mutation';
import {
  MATERIAL_CHANNELS,
  addMaterial,
  channelFrameKey,
  channelTextureKey,
  parseMaterials,
  removeMaterialAt,
  serializeMaterials,
  setChannelFrame,
  setChannelTextureKey,
  type CellMapMaterial,
  type MaterialChannel,
} from './reducer';
import {
  collectSceneTextureMaps,
  type SceneTextureMapRef,
} from './texture-maps';

export const CELL_MATERIALS_VIEW_ID = 'tool-cell-materials';

export interface CellMaterialsDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  readonly readImageDataUrl: (relativePath: string) => Promise<string | null>;
}

export interface CellMaterialsHandle {
  readonly open: (componentId: number) => void;
  readonly componentId: () => number | null;
}

let handle: CellMaterialsHandle | null = null;

export function getCellMaterialsHandle(): CellMaterialsHandle | null {
  return handle;
}

export function mountCellMaterialsTool(
  container: HTMLElement,
  deps: CellMaterialsDeps,
): () => void {
  container.classList.add('cell-materials-tool');
  container.innerHTML = `
    <div class="cm-toolbar" role="toolbar">
      <div class="cm-channels"></div>
      <span class="cm-status" role="status"></span>
    </div>
    <div class="cm-body">
      <aside class="cm-list">
        <div class="cm-list-header">
          <h4>Materials</h4>
          <button type="button" class="cm-add">+</button>
        </div>
        <div class="cm-list-items"></div>
      </aside>
      <div class="cm-preview">
        <canvas class="cm-preview-canvas" aria-label="Material texture preview"></canvas>
        <div class="cm-preview-placeholder">Select a material channel with a texture</div>
      </div>
    </div>
  `;

  const channelsEl = container.querySelector('.cm-channels') as HTMLElement;
  const statusEl = container.querySelector('.cm-status') as HTMLElement;
  const listItems = container.querySelector('.cm-list-items') as HTMLElement;
  const previewCanvas = container.querySelector(
    '.cm-preview-canvas',
  ) as HTMLCanvasElement;
  const previewPlaceholder = container.querySelector(
    '.cm-preview-placeholder',
  ) as HTMLElement;
  const previewCtx = previewCanvas.getContext('2d');

  let componentId: number | null = null;
  let materials: CellMapMaterial[] = [];
  let textureMaps: SceneTextureMapRef[] = [];
  let selectedMat = -1;
  let activeChannel: MaterialChannel = 'albedo';
  let disposed = false;
  let applyingLocal = false;
  let raf = 0;
  const images = new Map<string, HTMLImageElement>();
  const imageDims = new Map<string, { width: number; height: number }>();
  let cam = { x: 0, y: 0, zoom: 1 };
  let drag: { startX: number; startY: number; camX: number; camY: number } | null =
    null;

  const commit = (next: CellMapMaterial[]): void => {
    materials = next;
    if (selectedMat >= materials.length) {
      selectedMat = materials.length - 1;
    }
    renderChrome();
    if (componentId === null) return;
    applyingLocal = true;
    deps.onDispatch(
      componentUpdate(
        componentId,
        'cell-map',
        'materials',
        serializeMaterials(materials) as JsonValue,
      ),
    );
    applyingLocal = false;
  };

  const loadFromDocument = (): void => {
    if (applyingLocal) return;
    const file = deps.getDocument();
    if (!file || componentId === null) {
      statusEl.textContent = 'Open a cell-map via inspector action';
      previewPlaceholder.hidden = false;
      return;
    }
    const comp = findComponentById(file.scene, componentId);
    if (!comp || comp.type !== 'cell-map') {
      statusEl.textContent = `No cell-map #${componentId}`;
      return;
    }
    materials = parseMaterials(comp.materials);
    if (selectedMat < 0 && materials.length > 0) selectedMat = 0;
    if (selectedMat >= materials.length) selectedMat = materials.length - 1;
    textureMaps = collectSceneTextureMaps(file.scene, imageDims);
    const name =
      typeof comp.name === 'string' && comp.name ? comp.name : `cell-map #${componentId}`;
    statusEl.textContent = `${name} · ${materials.length} material${materials.length === 1 ? '' : 's'}`;
    renderChrome();
    void loadImages();
  };

  const loadImages = async (): Promise<void> => {
    for (const tm of textureMaps) {
      if (!tm.filePath || images.has(tm.key)) continue;
      try {
        const dataUrl = await deps.readImageDataUrl(tm.filePath);
        if (disposed || !dataUrl) continue;
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('decode failed'));
          img.src = dataUrl;
        });
        if (disposed) return;
        images.set(tm.key, img);
        imageDims.set(tm.key, {
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch {
        // leave missing
      }
    }
    const file = deps.getDocument();
    if (file) {
      textureMaps = collectSceneTextureMaps(file.scene, imageDims);
    }
    renderChrome();
  };

  const currentMaterial = (): CellMapMaterial | null =>
    selectedMat >= 0 && selectedMat < materials.length
      ? materials[selectedMat]!
      : null;

  const activeTextureKey = (): string => {
    const m = currentMaterial();
    if (!m) return '';
    return String(m[channelTextureKey(activeChannel)] ?? '');
  };

  const activeTextureRef = (): SceneTextureMapRef | null => {
    const key = activeTextureKey();
    if (!key) return null;
    return textureMaps.find((t) => t.key === key) ?? null;
  };

  const renderChrome = (): void => {
    const m = currentMaterial();
    const disabled = m === null;

    channelsEl.innerHTML = MATERIAL_CHANNELS.map((ch) => {
      const key = m ? String(m[channelTextureKey(ch)] ?? '') : '';
      const frame = m ? Number(m[channelFrameKey(ch)] ?? 0) : 0;
      const active = ch === activeChannel ? ' is-active' : '';
      const options = [
        `<option value="">(none)</option>`,
        ...textureMaps.map(
          (tm) =>
            `<option value="${escapeAttr(tm.key)}"${tm.key === key ? ' selected' : ''}>${escapeHtml(tm.key)}</option>`,
        ),
      ].join('');
      return `<div class="cm-channel${active}" data-channel="${ch}">
        <button type="button" class="cm-channel-tab" data-select-channel="${ch}">${labelChannel(ch)}</button>
        <select data-texture="${ch}" ${disabled ? 'disabled' : ''}>${options}</select>
        <label class="cm-frame-label">Frame
          <input type="number" min="0" step="1" data-frame="${ch}" value="${frame}" ${disabled ? 'disabled' : ''} />
        </label>
      </div>`;
    }).join('');

    listItems.innerHTML = materials
      .map((mat, i) => {
        const sel = i === selectedMat ? ' is-selected' : '';
        const albedo = mat.albedoTextureKey || '(empty)';
        return `<div class="cm-list-item${sel}" data-index="${i}">
          <span>#${i} · ${escapeHtml(albedo)}</span>
          <button type="button" data-remove="${i}" title="Delete">×</button>
        </div>`;
      })
      .join('');

    const ref = activeTextureRef();
    previewPlaceholder.hidden = Boolean(m && ref && images.has(ref.key));
    if (!previewPlaceholder.hidden) {
      previewPlaceholder.textContent = !m
        ? 'Add or select a material'
        : !ref
          ? 'Pick a texture for the active channel'
          : 'Loading texture…';
    }
  };

  const drawPreview = (): void => {
    if (!previewCtx) return;
    const wrap = previewCanvas.parentElement;
    if (wrap) {
      if (previewCanvas.width !== wrap.clientWidth) {
        previewCanvas.width = Math.max(1, wrap.clientWidth);
      }
      if (previewCanvas.height !== wrap.clientHeight) {
        previewCanvas.height = Math.max(1, wrap.clientHeight);
      }
    }
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const ref = activeTextureRef();
    const img = ref ? images.get(ref.key) : undefined;
    if (!ref || !img) return;

    previewCtx.save();
    previewCtx.translate(previewCanvas.width / 2 + cam.x, previewCanvas.height / 2 + cam.y);
    previewCtx.scale(cam.zoom, cam.zoom);
    previewCtx.imageSmoothingEnabled = false;
    previewCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

    const frames = ref.frames;
    const m = currentMaterial();
    const selectedFrame = m
      ? Number(m[channelFrameKey(activeChannel)] ?? 0)
      : -1;
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i]!;
      const ox = -img.naturalWidth / 2 + f.x;
      const oy = -img.naturalHeight / 2 + f.y;
      previewCtx.strokeStyle = i === selectedFrame ? '#8ebc3a' : 'rgba(255,255,255,0.35)';
      previewCtx.lineWidth = (i === selectedFrame ? 2 : 1) / cam.zoom;
      previewCtx.strokeRect(ox, oy, f.w, f.h);
    }
    previewCtx.restore();
  };

  const tick = (): void => {
    if (disposed) return;
    drawPreview();
    raf = requestAnimationFrame(tick);
  };

  const resetCamera = (): void => {
    cam = { x: 0, y: 0, zoom: 1 };
  };

  container.querySelector('.cm-add')?.addEventListener('click', () => {
    const next = addMaterial(materials);
    selectedMat = next.length - 1;
    commit(next);
  });

  listItems.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const remove = t.closest<HTMLElement>('[data-remove]');
    if (remove?.dataset.remove !== undefined) {
      e.stopPropagation();
      const idx = Number(remove.dataset.remove);
      if (!Number.isFinite(idx)) return;
      const next = removeMaterialAt(materials, idx);
      if (selectedMat === idx) selectedMat = Math.min(idx, next.length - 1);
      else if (selectedMat > idx) selectedMat -= 1;
      commit(next);
      return;
    }
    const item = t.closest<HTMLElement>('[data-index]');
    if (item?.dataset.index !== undefined) {
      selectedMat = Number(item.dataset.index);
      resetCamera();
      renderChrome();
    }
  });

  channelsEl.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-select-channel]',
    );
    if (!tab?.dataset.selectChannel) return;
    activeChannel = tab.dataset.selectChannel as MaterialChannel;
    resetCamera();
    renderChrome();
  });

  channelsEl.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLSelectElement && t.dataset.texture) {
      const ch = t.dataset.texture as MaterialChannel;
      if (selectedMat < 0) return;
      commit(setChannelTextureKey(materials, selectedMat, ch, t.value));
      resetCamera();
      return;
    }
    if (t instanceof HTMLInputElement && t.dataset.frame) {
      const ch = t.dataset.frame as MaterialChannel;
      if (selectedMat < 0) return;
      const frame = Number.parseFloat(t.value);
      commit(setChannelFrame(materials, selectedMat, ch, frame));
    }
  });

  previewCanvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2 || e.altKey) {
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        camX: cam.x,
        camY: cam.y,
      };
      previewCanvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const ref = activeTextureRef();
    const img = ref ? images.get(ref.key) : undefined;
    if (!ref || !img || selectedMat < 0) return;
    const rect = previewCanvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const ix =
      (sx - previewCanvas.width / 2 - cam.x) / cam.zoom + img.naturalWidth / 2;
    const iy =
      (sy - previewCanvas.height / 2 - cam.y) / cam.zoom + img.naturalHeight / 2;
    for (let i = 0; i < ref.frames.length; i += 1) {
      const f = ref.frames[i]!;
      if (ix >= f.x && ix < f.x + f.w && iy >= f.y && iy < f.y + f.h) {
        commit(setChannelFrame(materials, selectedMat, activeChannel, i));
        break;
      }
    }
  });

  previewCanvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam = {
      ...cam,
      x: drag.camX + (e.clientX - drag.startX),
      y: drag.camY + (e.clientY - drag.startY),
    };
  });

  previewCanvas.addEventListener('pointerup', () => {
    drag = null;
  });

  previewCanvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      cam = { ...cam, zoom: Math.min(32, Math.max(0.1, cam.zoom * factor)) };
    },
    { passive: false },
  );

  previewCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const unsub = deps.subscribeDocument(() => loadFromDocument());
  raf = requestAnimationFrame(tick);

  handle = {
    open(id) {
      componentId = id;
      selectedMat = -1;
      activeChannel = 'albedo';
      images.clear();
      imageDims.clear();
      resetCamera();
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
    container.classList.remove('cell-materials-tool');
    container.innerHTML = '';
  };
}

function labelChannel(ch: MaterialChannel): string {
  return ch.charAt(0).toUpperCase() + ch.slice(1);
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
