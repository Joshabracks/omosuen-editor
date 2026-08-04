/**
 * Cell-voxel-paint controller — viewport-attached brush + palette (6b).
 *
 * When a live engine cell-map is available, strokes use setCellData only and
 * do not dump packedData into the document (engine is voxel SoT until flush).
 */

import type { OmosceneFile } from '../../omoscene';
import {
  componentUpdate,
  type EditorMessage,
  type JsonValue,
} from '../../protocol';
import { parseMaterials, emptyMaterial, serializeMaterials } from '../cell-materials/reducer';
import { findComponentById } from '../mutation';
import {
  eraseCellAt,
  ensurePackedBuffer,
  normalizeExtents,
  placeCellAt,
  worldToCellCoord,
  type CellCoord,
  type CellSize,
  type MapSize,
} from './packed-map';

export const CELL_VOXEL_PAINT_TOOL_ID = 'cell-voxel-paint';

export interface LiveCellApply {
  (
    componentId: number,
    coord: CellCoord,
    cell: {
      materialIndex: number;
      shapeIndex: number;
      emissionIntensity: number;
      visible: boolean;
    },
  ): boolean;
}

/**
 * Apply one paint/erase stroke. Prefers live engine setCellData; falls back to
 * mutating a local packed buffer and committing it to the document.
 * Returns `'live'` | `'fallback'` | `'noop'`.
 */
export function applyVoxelStroke(args: {
  readonly componentId: number;
  readonly brushTarget: CellCoord;
  readonly mapSize: MapSize;
  readonly kind: 'place' | 'erase';
  readonly selectedMaterial: number;
  readonly packed: number[];
  readonly applyLiveCell?: LiveCellApply;
  readonly markVoxelDirty?: () => void;
  readonly commitPackedFallback: (next: number[]) => void;
}): 'live' | 'fallback' | 'noop' {
  const cell =
    args.kind === 'place'
      ? {
          materialIndex: args.selectedMaterial,
          shapeIndex: 1,
          emissionIntensity: 0,
          visible: true,
        }
      : {
          materialIndex: 0,
          shapeIndex: 0,
          emissionIntensity: 0,
          visible: true,
        };
  if (args.applyLiveCell) {
    const ok = args.applyLiveCell(args.componentId, args.brushTarget, cell);
    if (ok) {
      args.markVoxelDirty?.();
      return 'live';
    }
  }
  const next =
    args.kind === 'place'
      ? placeCellAt(
          args.packed,
          args.mapSize,
          args.brushTarget,
          args.selectedMaterial,
        )
      : eraseCellAt(args.packed, args.mapSize, args.brushTarget);
  if (!next) return 'noop';
  args.commitPackedFallback(next);
  return 'fallback';
}

export interface CellVoxelPaintDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly getSelection: () => readonly number[];
  readonly subscribeSelection: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  /**
   * Soft-apply a cell on the live engine cell-map.
   * Returns true when the engine accepted the stroke (no document packedData write).
   */
  readonly applyLiveCell?: LiveCellApply;
  /** Mark the open document dirty without mutating scene JSON. */
  readonly markVoxelDirty?: () => void;
}

export interface CellVoxelPaintHandle {
  readonly open: (componentId: number) => void;
  readonly close: () => void;
  readonly toggle: (componentId?: number) => void;
  readonly active: () => boolean;
  readonly componentId: () => number | null;
  readonly brushHeight: () => number;
  readonly setBrushHeight: (h: number) => void;
  readonly selectedMaterial: () => number;
  readonly setSelectedMaterial: (index: number) => void;
  readonly materialCount: () => number;
  readonly mapSize: () => MapSize | null;
  readonly cellSize: () => CellSize | null;
  readonly brushTarget: () => CellCoord | null;
  readonly updateBrushFromWorld: (world: {
    x: number;
    y: number;
    z: number;
  }) => void;
  readonly place: () => void;
  readonly erase: () => void;
  readonly subscribe: (cb: () => void) => () => void;
}

let handle: CellVoxelPaintHandle | null = null;

export function getCellVoxelPaintHandle(): CellVoxelPaintHandle | null {
  return handle;
}

/**
 * Mount paint chrome into a viewport host. Returns dispose.
 * Interaction (pointers) is driven by the gizmo overlay via the handle.
 */
export function mountCellVoxelPaint(
  host: HTMLElement,
  deps: CellVoxelPaintDeps,
): () => void {
  const chrome = document.createElement('div');
  chrome.className = 'cell-paint-chrome';
  chrome.hidden = true;
  chrome.innerHTML = `
    <div class="cell-paint-bar">
      <button type="button" class="cell-paint-toggle" title="Exit paint (T)">Paint</button>
      <label class="cell-paint-height">H
        <button type="button" data-h="-1" title="Lower (Q / -)">−</button>
        <span class="cell-paint-height-val">0</span>
        <button type="button" data-h="1" title="Raise (E / +)">+</button>
      </label>
      <div class="cell-paint-palette" role="listbox" aria-label="Materials"></div>
      <span class="cell-paint-status" role="status"></span>
    </div>
  `;
  host.appendChild(chrome);

  const heightVal = chrome.querySelector('.cell-paint-height-val') as HTMLElement;
  const paletteEl = chrome.querySelector('.cell-paint-palette') as HTMLElement;
  const statusEl = chrome.querySelector('.cell-paint-status') as HTMLElement;
  const toggleBtn = chrome.querySelector('.cell-paint-toggle') as HTMLButtonElement;

  let componentId: number | null = null;
  let active = false;
  let brushHeight = 0;
  let selectedMaterial = 0;
  let materialCount = 0;
  let mapSize: MapSize | null = null;
  let cellSize: CellSize | null = null;
  let brushTarget: CellCoord | null = null;
  /** Fallback buffer when no live engine session — not used on the live hot path. */
  let packed: number[] = [];
  let applyingLocal = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  const renderChrome = (): void => {
    chrome.hidden = !active;
    heightVal.textContent = String(brushHeight);
    toggleBtn.classList.toggle('is-active', active);
    const swatches: string[] = [];
    for (let i = 0; i < Math.max(materialCount, 1); i += 1) {
      const sel = i === selectedMaterial ? ' is-selected' : '';
      swatches.push(
        `<button type="button" class="cell-paint-swatch${sel}" data-mat="${i}" title="Material ${i}" style="--swatch:${swatchColor(i)}">${i}</button>`,
      );
    }
    paletteEl.innerHTML = swatches.join('');
    statusEl.textContent = active
      ? brushTarget
        ? `cell ${brushTarget.x},${brushTarget.y},${brushTarget.z}`
        : 'aim brush'
      : '';
  };

  const loadFromDocument = (): void => {
    if (applyingLocal || !active || componentId === null) {
      renderChrome();
      notify();
      return;
    }
    const file = deps.getDocument();
    if (!file) return;
    const comp = findComponentById(file.scene, componentId);
    if (!comp || comp.type !== 'cell-map') {
      active = false;
      componentId = null;
      renderChrome();
      notify();
      return;
    }
    const ms = normalizeExtents(comp.mapSize, { x: 8, y: 4, z: 8 });
    const cs = normalizeExtents(comp.cellSize, { x: 1, y: 1, z: 1 });
    mapSize = { x: ms.x, y: ms.y, z: ms.z };
    cellSize = { x: cs.x, y: cs.y, z: cs.z };
    if (ms.corrected || cs.corrected) {
      applyingLocal = true;
      if (ms.corrected) {
        deps.onDispatch(
          componentUpdate(componentId, 'cell-map', 'mapSize', {
            _vectorType: 'Vector3D',
            x: ms.x,
            y: ms.y,
            z: ms.z,
          }),
        );
      }
      if (cs.corrected) {
        deps.onDispatch(
          componentUpdate(componentId, 'cell-map', 'cellSize', {
            _vectorType: 'Vector3D',
            x: cs.x,
            y: cs.y,
            z: cs.z,
          }),
        );
      }
      applyingLocal = false;
    }
    // Keep a fallback copy for offline paint; live strokes ignore this.
    packed = ensurePackedBuffer(comp.packedData, mapSize);
    let mats = parseMaterials(comp.materials);
    if (mats.length === 0) {
      mats = [emptyMaterial()];
      applyingLocal = true;
      deps.onDispatch(
        componentUpdate(
          componentId,
          'cell-map',
          'materials',
          serializeMaterials(mats) as unknown as JsonValue,
        ),
      );
      applyingLocal = false;
    }
    materialCount = Math.max(1, mats.length);
    if (selectedMaterial >= materialCount) selectedMaterial = 0;
    brushHeight = Math.max(0, Math.min(mapSize.y - 1, brushHeight));
    renderChrome();
    notify();
  };

  const commitPackedFallback = (next: number[]): void => {
    if (componentId === null) return;
    packed = next;
    applyingLocal = true;
    deps.onDispatch(
      componentUpdate(
        componentId,
        'cell-map',
        'packedData',
        next as unknown as JsonValue,
      ),
    );
    applyingLocal = false;
    renderChrome();
    notify();
  };

  const applyStroke = (kind: 'place' | 'erase'): void => {
    if (!active || !brushTarget || !mapSize || componentId === null) return;
    const result = applyVoxelStroke({
      componentId,
      brushTarget,
      mapSize,
      kind,
      selectedMaterial,
      packed,
      applyLiveCell: deps.applyLiveCell,
      markVoxelDirty: deps.markVoxelDirty,
      commitPackedFallback,
    });
    if (result === 'live') {
      renderChrome();
      notify();
    }
  };

  const api: CellVoxelPaintHandle = {
    open(id) {
      componentId = id;
      active = true;
      brushTarget = null;
      loadFromDocument();
    },
    close() {
      active = false;
      brushTarget = null;
      renderChrome();
      notify();
    },
    toggle(id) {
      if (active && (id === undefined || id === componentId)) {
        api.close();
        return;
      }
      if (typeof id === 'number') api.open(id);
    },
    active: () => active,
    componentId: () => componentId,
    brushHeight: () => brushHeight,
    setBrushHeight(h) {
      if (!mapSize) {
        brushHeight = Math.max(0, Math.floor(h));
      } else {
        brushHeight = Math.max(0, Math.min(mapSize.y - 1, Math.floor(h)));
      }
      renderChrome();
      notify();
    },
    selectedMaterial: () => selectedMaterial,
    setSelectedMaterial(index) {
      selectedMaterial = Math.max(0, Math.floor(index));
      if (materialCount > 0) {
        selectedMaterial = Math.min(materialCount - 1, selectedMaterial);
      }
      renderChrome();
      notify();
    },
    materialCount: () => materialCount,
    mapSize: () => mapSize,
    cellSize: () => cellSize,
    brushTarget: () => brushTarget,
    updateBrushFromWorld(world) {
      if (!active || !mapSize || !cellSize) {
        brushTarget = null;
        return;
      }
      brushTarget = worldToCellCoord(world, cellSize, mapSize, brushHeight);
      renderChrome();
      notify();
    },
    place: () => applyStroke('place'),
    erase: () => applyStroke('erase'),
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };

  handle = api;

  toggleBtn.addEventListener('click', () => api.close());
  chrome.querySelector('[data-h="-1"]')?.addEventListener('click', () => {
    api.setBrushHeight(brushHeight - 1);
  });
  chrome.querySelector('[data-h="1"]')?.addEventListener('click', () => {
    api.setBrushHeight(brushHeight + 1);
  });
  paletteEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-mat]');
    if (!btn?.dataset.mat) return;
    api.setSelectedMaterial(Number(btn.dataset.mat));
  });

  const unsubDoc = deps.subscribeDocument(() => loadFromDocument());
  const unsubSel = deps.subscribeSelection(() => {
    notify();
  });

  renderChrome();

  return () => {
    unsubDoc();
    unsubSel();
    if (handle === api) handle = null;
    chrome.remove();
  };
}

function swatchColor(index: number): string {
  const hues = [28, 140, 200, 320, 60, 180];
  const h = hues[index % hues.length]!;
  return `hsl(${h} 55% 42%)`;
}
