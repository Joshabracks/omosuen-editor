/**
 * Texture-map frame editor webview (Phase 8.3).
 *
 * Runs inside an `omosuen.frameEditor` panel opened imperatively by
 * the host (see [host.ts](./host.ts)). The user clicks the inspector's
 * "Open Frame Editor" action button → host runs `omosuen.openFrameEditor`
 * → this webview opens with the target component id baked into
 * `<body data-component-id="…">`.
 *
 * Layout:
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ [Mode ▼]   key: "abcd"   path: "assets/x.png" │  toolbar
 *   ├───────────────────────────────────────────────┤
 *   │                                               │
 *   │              <canvas>                         │  driven by rAF
 *   │                                               │
 *   ├───────────────────────────────────────────────┤
 *   │ Mode-specific config (grid inputs / x-y-w-h)  │
 *   │ ───── frame thumbnails ─────                  │
 *   └───────────────────────────────────────────────┘
 *
 * Three coordinate flows:
 *
 *   1. State Street binds the toolbar + side panel + thumbnail strip.
 *      Their inputs flow through `:change=editX(...)` methods which
 *      mutate `viewState`, dispatch `component:update`, and call
 *      `forceUpdate()` so re-rendered HTML reflects the new state.
 *
 *   2. The canvas is NOT inside `{{var}}` — State Street leaves it
 *      alone. We grab a ref once on bootstrap and drive it via a
 *      requestAnimationFrame loop reading `viewState`.
 *
 *   3. Mouse / wheel / key handlers attach directly to the canvas
 *      (raw events are easier with native listeners than State Street
 *      bindings for this kind of UX).
 *
 * Bridge wiring:
 *   - On `scene:load`: snapshot the target component's `imageType` into
 *     `viewState`.
 *   - On `image:loaded`: rebuild the `HTMLImageElement` from the data
 *     URI and update `viewState.image`.
 *   - On every committed edit: dispatch `component:update(imageType)`
 *     and apply the same change locally so we don't go round-trip.
 */

import { State } from 'state-street';
import {
  componentUpdate,
  type EditorMessage,
  type JsonValue,
} from '../../protocol/index.js';
import type {
  OmosceneFile,
  SerializedComponent,
} from '../../omoscene/index.js';
import { bootstrapPanel } from '../../panel/bootstrap.js';
import type { Bridge } from '../../bridge/index.js';
import {
  addFrame,
  defaultState,
  deleteFrame,
  parseImageType,
  resizeRect,
  serializeImageType,
  setFrameRect,
  setGridConfig,
  setMode,
  type EditorState,
  type FrameRect,
  type HandleId,
  type Mode,
} from './reducer.js';
import { drawFrame, type RenderState } from './render.js';
import {
  HANDLE_CURSOR,
  fitImageToView,
  frameAt,
  handleAt,
  rectFromPoints,
  screenToImage,
  zoomToward,
  type Camera,
} from './geom.js';

interface PanelData {
  title: string;
  toolbarHtml: string;
  configHtml: string;
  thumbnailsHtml: string;
  _componentId: number | null;
  _componentType: string | null;
  _editorState: EditorState;
  _key: string;
  _filePath: string;
  _selectedFrame: number | null;
}

interface ViewState {
  camera: Camera;
  image: HTMLImageElement | null;
  /** Last data URI we successfully loaded — guards against stale pushes. */
  lastImageSource: string | null;
  drag:
    | { kind: 'pan'; startMouse: { x: number; y: number }; startCam: Camera }
    | {
        kind: 'draw';
        startImage: { x: number; y: number };
        currentImage: { x: number; y: number };
      }
    | {
        kind: 'move';
        index: number;
        startImage: { x: number; y: number };
        startRect: FrameRect;
      }
    | {
        kind: 'resize';
        index: number;
        handle: HandleId;
        startImage: { x: number; y: number };
        startRect: FrameRect;
      }
    | null;
}

const viewState: ViewState = {
  camera: { x: 0, y: 0, zoom: 1 },
  image: null,
  lastImageSource: null,
  drag: null,
};

// CSS lives outside the State Street template + is injected directly
// into <head>. State Street's parser wraps text-node children in
// <span>s when constructing the DOM (see node_modules/state-street's
// constructElement.ts) — leaving the rules inside a templated <style>
// block in an inconsistent state where the browser's CSSOM may or may
// not pick them up depending on textContent re-parse timing. Skipping
// State Street entirely for the stylesheet removes the ambiguity, and
// is the same workaround established for other CSS-heavy panels.
const STYLES = /* css */ `
/*
 * State Street wraps every component (<ToolbarBody/> etc.) in a
 * <div ssct="..."> with default block display, which sits between
 * the flex/grid parent (.tme-toolbar / .tme-thumb-strip / .tme-side)
 * and the actual content. That breaks both the flex layout (thumbnail
 * strip becomes a vertical column) and the grid sizing of inner forms.
 * \`display: contents\` makes the SSCT wrapper layout-transparent so
 * its children act as direct children of the layout container.
 */
[ssct] { display: contents; }
.tme-root { display: grid; grid-template-rows: auto 1fr auto auto; height: 100vh; box-sizing: border-box; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
.tme-toolbar { display: flex; align-items: center; gap: 1em; padding: 0.5em; border-bottom: 1px solid var(--vscode-panel-border); }
.tme-toolbar label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.tme-toolbar .info { font-size: 0.85em; opacity: 0.85; }
.tme-canvas-wrap { position: relative; overflow: hidden; min-height: 0; }
canvas#tme-canvas { display: block; position: absolute; inset: 0; cursor: default; }
.tme-side { padding: 0.5em; border-top: 1px solid var(--vscode-panel-border); }
.tme-grid-form { display: grid; grid-template-columns: auto 5em auto 5em; gap: 0.5em 0.75em; align-items: center; max-width: 28em; }
.tme-frame-form { display: grid; grid-template-columns: auto 5em auto 5em; gap: 0.5em 0.75em; align-items: center; max-width: 28em; }
.tme-thumb-strip { display: flex; gap: 4px; padding: 0.5em; border-top: 1px solid var(--vscode-panel-border); overflow-x: auto; }
.tme-thumb { width: 48px; height: 48px; border: 1px solid var(--vscode-input-border); position: relative; flex-shrink: 0; cursor: pointer; background: var(--vscode-editor-background); box-sizing: border-box; }
.tme-thumb.selected { border-color: var(--vscode-focusBorder); }
.tme-thumb canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.tme-thumb .idx { position: absolute; top: 1px; left: 2px; font-size: 0.7em; color: var(--vscode-descriptionForeground); pointer-events: none; text-shadow: 0 0 2px var(--vscode-editor-background); }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0.25em 0.6em; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
select, input[type="text"], input[type="number"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 0.25em; }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);
}

const template = /* html */ `
<body>
  <div class="tme-root">
    <div class="tme-toolbar">
      <ToolbarBody/>
    </div>
    <div class="tme-canvas-wrap">
      <canvas id="tme-canvas"></canvas>
    </div>
    <div class="tme-side">
      <ConfigBody/>
    </div>
    <div class="tme-thumb-strip">
      <ThumbnailsBody/>
    </div>
  </div>
</body>
`;

const ToolbarBody = (): string => `{{toolbarHtml}}`;
const ConfigBody = (): string => `{{configHtml}}`;
const ThumbnailsBody = (): string => `{{thumbnailsHtml}}`;

function readComponentIdFromBody(): number | null {
  if (typeof document === 'undefined') return null;
  const raw = document.body.dataset['componentId'];
  if (raw === undefined) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: {
    title: 'Frame Editor',
    toolbarHtml: '',
    configHtml: '',
    thumbnailsHtml: '',
    _componentId: readComponentIdFromBody(),
    _componentType: null,
    _editorState: defaultState(),
    _key: '',
    _filePath: '',
    _selectedFrame: null,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: { ToolbarBody, ConfigBody, ThumbnailsBody },
  methods: {
    setMode: ({ bridge, state, event }) => {
      const target = event.target as HTMLSelectElement;
      const m = target.value as Mode;
      if (m !== 'single' && m !== 'grid' && m !== 'framemap') return;
      const d = data(state);
      if (d._editorState.mode === m) return;
      d._editorState = setMode(d._editorState, m);
      d._selectedFrame = null;
      commit(bridge, d);
    },
    editGridField: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLInputElement;
      const raw = Number.parseFloat(target.value);
      if (!Number.isFinite(raw)) return;
      const f = String(field);
      const d = data(state);
      const patch: Partial<{
        cellWidth: number;
        cellHeight: number;
        cols: number;
        rows: number;
        cellCount: number;
      }> = {};
      if (
        f === 'cellWidth' ||
        f === 'cellHeight' ||
        f === 'cols' ||
        f === 'rows' ||
        f === 'cellCount'
      ) {
        patch[f] = raw;
      } else return;
      d._editorState = setGridConfig(d._editorState, patch);
      commit(bridge, d);
    },
    editFrameField: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLInputElement;
      const raw = Number.parseFloat(target.value);
      if (!Number.isFinite(raw)) return;
      const f = String(field);
      if (f !== 'x' && f !== 'y' && f !== 'w' && f !== 'h') return;
      const d = data(state);
      if (d._selectedFrame === null) return;
      d._editorState = setFrameRect(d._editorState, d._selectedFrame, {
        [f]: raw,
      });
      commit(bridge, d);
    },
    selectThumb: ({ state, idx }) => {
      const d = data(state);
      if (d._editorState.mode !== 'framemap') return;
      const i = Number(idx);
      if (!Number.isFinite(i)) return;
      d._selectedFrame = i;
      refresh(d);
    },
  },
  wireIncoming: (msg) => {
    handleIncoming(msg);
  },
});

function data(state: unknown): PanelData {
  return (state as { data: PanelData }).data;
}

function handleIncoming(msg: EditorMessage): void {
  if (msg.kind === 'scene:load') {
    hydrateFromScene(msg.file);
    return;
  }
  if (msg.kind === 'component:update') {
    const d = panel.state.data;
    if (msg.id !== d._componentId) return;
    if (msg.property === 'imageType') {
      d._editorState = parseImageType(msg.value);
      d._selectedFrame = null;
      refresh(d);
      return;
    }
    if (msg.property === 'textureMapKey') {
      d._key = typeof msg.value === 'string' ? msg.value : '';
      refresh(d);
      return;
    }
    if (msg.property === 'filePath') {
      d._filePath = typeof msg.value === 'string' ? msg.value : '';
      refresh(d);
      return;
    }
    return;
  }
  if (msg.kind === 'image:loaded') {
    const d = panel.state.data;
    if (msg.sourceFilePath !== d._filePath) return; // stale push
    if (msg.dataUri === null) {
      viewState.image = null;
      viewState.lastImageSource = null;
      return;
    }
    if (viewState.lastImageSource === msg.dataUri) return;
    const img = new Image();
    img.onload = () => {
      viewState.image = img;
      viewState.lastImageSource = msg.dataUri;
      // Re-fit camera on every successful load — file changes are rare
      // enough that the user expects a clean view anchor.
      const wrap = document.querySelector(
        '.tme-canvas-wrap',
      ) as HTMLElement | null;
      if (wrap !== null && img.width > 0 && img.height > 0) {
        viewState.camera = fitImageToView(
          { width: img.width, height: img.height },
          { width: wrap.clientWidth, height: wrap.clientHeight },
        );
      }
    };
    img.src = msg.dataUri;
  }
}

function hydrateFromScene(file: OmosceneFile): void {
  const d = panel.state.data;
  const id = d._componentId;
  if (id === null) return;
  const target = findById(file.scene, id);
  if (target === null) return;
  d._componentType = target.type;
  d._editorState = parseImageType(target['imageType']);
  d._key = stringOr(target['textureMapKey'], '');
  d._filePath = stringOr(target['filePath'], '');
  d._selectedFrame = null;
  d.title = `Frame Editor — ${describeTarget(target)}`;
  refresh(d);
}

function describeTarget(c: SerializedComponent): string {
  if (typeof c.name === 'string' && c.name !== '') return c.name;
  return `${c.type} (id=${String(c.id)})`;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function commit(bridge: Bridge, d: PanelData): void {
  refresh(d);
  if (d._componentId === null || d._componentType === null) return;
  bridge.dispatch(
    componentUpdate(
      d._componentId,
      d._componentType,
      'imageType',
      serializeImageType(d._editorState) as JsonValue,
    ),
  );
}

function refresh(d: PanelData): void {
  d.toolbarHtml = renderToolbar(d);
  d.configHtml = renderConfig(d);
  d.thumbnailsHtml = renderThumbnails(d);
}

function renderToolbar(d: PanelData): string {
  const mode = d._editorState.mode;
  const modeOpt = (m: Mode, label: string): string => {
    // State Street's parseSST ATTRIBUTE regex requires `name="value"`
    // form; bare `selected` is dropped, so the dropdown defaults to
    // the first option regardless of which mode the editor's in. Same
    // applies to `checked` on checkboxes (see widgets.ts).
    const sel = m === mode ? ' selected="selected"' : '';
    return `<option value="${m}"${sel}>${label}</option>`;
  };
  return `
    <label for="tme-mode">Mode:</label>
    <select id="tme-mode" :change=setMode()>
      ${modeOpt('single', 'Single')}
      ${modeOpt('grid', 'Grid')}
      ${modeOpt('framemap', 'Frame Map')}
    </select>
    <span class="info">key: ${escapeHtml(d._key)}</span>
    <span class="info">path: ${escapeHtml(d._filePath || '<none>')}</span>
  `;
}

function renderConfig(d: PanelData): string {
  const mode = d._editorState.mode;
  if (mode === 'grid') return renderGridForm(d._editorState);
  if (mode === 'framemap') return renderFrameForm(d);
  return `<em style="color: var(--vscode-descriptionForeground);">Single mode: the entire image is one frame.</em>`;
}

function renderGridForm(s: EditorState): string {
  const g = s.grid;
  return `
    <div class="tme-grid-form">
      <label>Cell W</label>
      <input type="number" min="1" step="1" value="${g.cellWidth}" :change=editGridField(field=cellWidth) />
      <label>Cell H</label>
      <input type="number" min="1" step="1" value="${g.cellHeight}" :change=editGridField(field=cellHeight) />
      <label>Cols</label>
      <input type="number" min="1" step="1" value="${g.cols}" :change=editGridField(field=cols) />
      <label>Rows</label>
      <input type="number" min="1" step="1" value="${g.rows}" :change=editGridField(field=rows) />
      <label>Cell count</label>
      <input type="number" min="0" step="1" value="${g.cellCount ?? 0}" :change=editGridField(field=cellCount) />
      <span style="grid-column: 3 / 5; font-size: 0.8em; color: var(--vscode-descriptionForeground);">0 = cols × rows</span>
    </div>
  `;
}

function renderFrameForm(d: PanelData): string {
  const idx = d._selectedFrame;
  if (idx === null || idx < 0 || idx >= d._editorState.frames.length) {
    return `<em style="color: var(--vscode-descriptionForeground);">Drag on the canvas to draw a frame, or click an existing one to select it.</em>`;
  }
  const f = d._editorState.frames[idx]!;
  return `
    <div class="tme-frame-form">
      <label>X</label>
      <input type="number" step="1" value="${f.x}" :change=editFrameField(field=x) />
      <label>Y</label>
      <input type="number" step="1" value="${f.y}" :change=editFrameField(field=y) />
      <label>W</label>
      <input type="number" min="1" step="1" value="${f.w}" :change=editFrameField(field=w) />
      <label>H</label>
      <input type="number" min="1" step="1" value="${f.h}" :change=editFrameField(field=h) />
    </div>
  `;
}

function renderThumbnails(d: PanelData): string {
  const list = thumbList(d._editorState);
  if (list.length === 0) return '';
  // The <canvas> elements are populated imperatively from
  // `drawThumbnails` (called every rAF tick) — State Street rebuilds
  // these `<div ssct=...>` subtrees on every state change, which
  // wipes the canvas pixel buffers, so we redraw on each frame
  // rather than trying to track DOM lifecycle.
  return list
    .map((_, i) => {
      const sel =
        d._editorState.mode === 'framemap' && i === d._selectedFrame
          ? ' selected'
          : '';
      return `<div class="tme-thumb${sel}" :click=selectThumb(idx=${i})>
        <canvas width="48" height="48"></canvas>
        <span class="idx">${i}</span>
      </div>`;
    })
    .join('');
}

function thumbList(s: EditorState): readonly FrameRect[] {
  if (s.mode === 'grid') {
    const list: FrameRect[] = [];
    const max =
      s.grid.cellCount && s.grid.cellCount > 0
        ? s.grid.cellCount
        : s.grid.cols * s.grid.rows;
    let idx = 0;
    for (let row = 0; row < s.grid.rows; row += 1) {
      for (let col = 0; col < s.grid.cols; col += 1) {
        if (idx >= max) return list;
        list.push({
          x: col * s.grid.cellWidth,
          y: row * s.grid.cellHeight,
          w: s.grid.cellWidth,
          h: s.grid.cellHeight,
        });
        idx += 1;
      }
    }
    return list;
  }
  if (s.mode === 'framemap') return s.frames;
  return [];
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) continue;
    const c = child as SerializedComponent;
    const hit = findById(c, id);
    if (hit !== null) return hit;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Canvas event handlers + rAF render loop ─────────────────────────

if (typeof document !== 'undefined') {
  attachCanvasHandlers();
  startRenderLoop();
}

function attachCanvasHandlers(): void {
  const canvas = document.querySelector(
    'canvas#tme-canvas',
  ) as HTMLCanvasElement | null;
  if (canvas === null) return;

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const screen = mouseToCanvas(canvas, e);
    const image = screenToImage(screen, viewState.camera);
    const d = panel.state.data;

    if (e.button === 1) {
      viewState.drag = {
        kind: 'pan',
        startMouse: screen,
        startCam: viewState.camera,
      };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0 && d._editorState.mode === 'framemap') {
      const sel = d._selectedFrame;
      if (sel !== null && sel < d._editorState.frames.length) {
        const handle = handleAt(
          screen,
          d._editorState.frames[sel]!,
          viewState.camera,
        );
        if (handle !== null) {
          viewState.drag = {
            kind: 'resize',
            index: sel,
            handle,
            startImage: image,
            startRect: d._editorState.frames[sel]!,
          };
          canvas.style.cursor = HANDLE_CURSOR[handle];
          return;
        }
      }
      const hitIdx = frameAt(image, d._editorState.frames);
      if (hitIdx !== null) {
        d._selectedFrame = hitIdx;
        viewState.drag = {
          kind: 'move',
          index: hitIdx,
          startImage: image,
          startRect: d._editorState.frames[hitIdx]!,
        };
        canvas.style.cursor = 'grabbing';
        refresh(d);
        return;
      }
      if (
        viewState.image &&
        image.x >= 0 &&
        image.y >= 0 &&
        image.x <= viewState.image.width &&
        image.y <= viewState.image.height
      ) {
        viewState.drag = {
          kind: 'draw',
          startImage: image,
          currentImage: image,
        };
        d._selectedFrame = null;
        refresh(d);
        return;
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const screen = mouseToCanvas(canvas, e);
    const image = screenToImage(screen, viewState.camera);
    const d = panel.state.data;

    if (viewState.drag === null) {
      if (
        d._editorState.mode === 'framemap' &&
        d._selectedFrame !== null &&
        d._selectedFrame < d._editorState.frames.length
      ) {
        const handle = handleAt(
          screen,
          d._editorState.frames[d._selectedFrame]!,
          viewState.camera,
        );
        canvas.style.cursor =
          handle !== null ? HANDLE_CURSOR[handle] : 'default';
      } else {
        canvas.style.cursor = 'default';
      }
      return;
    }

    const drag = viewState.drag;
    if (drag.kind === 'pan') {
      viewState.camera = {
        x: drag.startCam.x + (screen.x - drag.startMouse.x),
        y: drag.startCam.y + (screen.y - drag.startMouse.y),
        zoom: drag.startCam.zoom,
      };
      return;
    }
    if (drag.kind === 'draw') {
      viewState.drag = { ...drag, currentImage: image };
      return;
    }
    if (drag.kind === 'move') {
      const dx = Math.round(image.x - drag.startImage.x);
      const dy = Math.round(image.y - drag.startImage.y);
      d._editorState = setFrameRect(d._editorState, drag.index, {
        x: drag.startRect.x + dx,
        y: drag.startRect.y + dy,
      });
      refresh(d);
      return;
    }
    if (drag.kind === 'resize') {
      const dx = image.x - drag.startImage.x;
      const dy = image.y - drag.startImage.y;
      const next = resizeRect(drag.startRect, drag.handle, dx, dy);
      d._editorState = setFrameRect(d._editorState, drag.index, next);
      refresh(d);
    }
  });

  canvas.addEventListener('mouseup', () => {
    const drag = viewState.drag;
    const d = panel.state.data;
    canvas.style.cursor = 'default';
    if (drag === null) return;
    viewState.drag = null;

    if (drag.kind === 'draw') {
      // Use the current "draw" preview rect; if too small, drop.
      const rect = rectFromPoints(drag.startImage, drag.currentImage);
      if (rect.w < 2 || rect.h < 2) {
        refresh(d);
        return;
      }
      d._editorState = addFrame(d._editorState, rect);
      d._selectedFrame = d._editorState.frames.length - 1;
      commit(panel.bridge, d);
      return;
    }
    if (drag.kind === 'move' || drag.kind === 'resize') {
      commit(panel.bridge, d);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (viewState.drag !== null && viewState.drag.kind === 'pan') {
      viewState.drag = null;
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const cursor = mouseToCanvas(canvas, e);
      viewState.camera = zoomToward(viewState.camera, cursor, e.deltaY);
    },
    { passive: false },
  );

  document.addEventListener('keydown', (e) => {
    const d = panel.state.data;
    if (
      d._editorState.mode === 'framemap' &&
      e.key === 'Delete' &&
      d._selectedFrame !== null
    ) {
      d._editorState = deleteFrame(d._editorState, d._selectedFrame);
      d._selectedFrame = null;
      commit(panel.bridge, d);
    }
  });
}

function mouseToCanvas(
  canvas: HTMLCanvasElement,
  e: MouseEvent,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startRenderLoop(): void {
  const canvas = document.querySelector(
    'canvas#tme-canvas',
  ) as HTMLCanvasElement | null;
  if (canvas === null) return;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const wrap = canvas.parentElement;
  if (wrap === null) return;

  // Drive canvas-buffer sizing from a ResizeObserver instead of
  // measuring the parent on every rAF tick. Per-frame `clientWidth /
  // clientHeight` reads against a flex parent that itself contains
  // State Street components (which `replaceWith` their roots on every
  // state change) was racing CSS `height: 100%` resolution and causing
  // the canvas's intrinsic size to drift each frame. The observer
  // makes the dependency one-way: parent size changes → resize canvas.
  function syncCanvasSize(): void {
    if (canvas === null) return;
    const w = wrap === null ? 0 : wrap.clientWidth;
    const h = wrap === null ? 0 : wrap.clientHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  syncCanvasSize();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      syncCanvasSize();
    });
    observer.observe(wrap);
  }

  function frame(): void {
    if (canvas === null || ctx === null) return;
    const d = panel.state.data;
    const drawing: FrameRect | null =
      viewState.drag !== null && viewState.drag.kind === 'draw'
        ? rectFromPoints(viewState.drag.startImage, viewState.drag.currentImage)
        : null;

    const renderState: RenderState = {
      mode: d._editorState.mode,
      camera: viewState.camera,
      image: viewState.image,
      grid: d._editorState.grid,
      frames: d._editorState.frames,
      selectedFrame: d._selectedFrame,
      drawingRect: drawing,
    };
    drawFrame(ctx, renderState);
    drawThumbnails(viewState.image, thumbList(d._editorState));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/**
 * Populate every `.tme-thumb canvas` with its corresponding frame
 * region from the source image. Mirrors `_old`'s
 * `updateFrameStrip` (texture-map-editor.ts:497-542): each thumb is
 * a 48×48 box; the frame is scaled to fit within 46×46 (1px margin)
 * with aspect ratio preserved, capped at 2× zoom for tiny frames so
 * single-pixel art is still legible. Smoothing is disabled for
 * pixel-art crispness.
 */
function drawThumbnails(
  image: HTMLImageElement | null,
  frames: readonly FrameRect[],
): void {
  const thumbs =
    document.querySelectorAll<HTMLCanvasElement>('.tme-thumb canvas');
  for (let i = 0; i < thumbs.length; i += 1) {
    const c = thumbs[i]!;
    const tctx = c.getContext('2d');
    if (tctx === null) continue;
    if (c.width !== 48) c.width = 48;
    if (c.height !== 48) c.height = 48;
    tctx.clearRect(0, 0, 48, 48);
    if (image === null || image.width === 0 || image.height === 0) continue;
    const f = frames[i];
    if (f === undefined || f.w <= 0 || f.h <= 0) continue;
    const scale = Math.min(46 / f.w, 46 / f.h, 2);
    const dw = f.w * scale;
    const dh = f.h * scale;
    const dx = (48 - dw) / 2;
    const dy = (48 - dh) / 2;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(image, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
  }
}
