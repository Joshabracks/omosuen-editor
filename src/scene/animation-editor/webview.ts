/**
 * Animation editor webview (Phase 8.2 + overhaul).
 *
 * Runs inside an `omosuen.animationEditor` panel opened imperatively
 * by the host (see [host.ts](./host.ts)). Five zones, mirroring
 * `_old/src/editors/animation-editor.ts`:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Control bar: name | FPS | loop | onComplete │
 *   │              | ▶  ❚❚  ■  ◀  ▶               │
 *   ├──────┬───────────────────┬──────────────────┤
 *   │ Anim │  Preview canvas   │  Frame palette   │
 *   │ list │  (current frame)  │  (image thumbs)  │
 *   │      ├───────────────────┴──────────────────┤
 *   │      │  Timeline (image thumbs, draggable)  │
 *   └──────┴──────────────────────────────────────┘
 *
 * Image flow: the host resolves animation-controller → parent nexus →
 * sibling sprite → albedo `textureMapKey` → matching texture-map →
 * filePath, reads bytes, and pushes `image:loaded` (the protocol
 * message Phase 8.3 introduced for the texture-map editor — reused
 * here unchanged). The webview decodes the data URI into an
 * `HTMLImageElement` and clips per-frame regions into 48×48 canvas
 * thumbnails for the palette + timeline, plus a fit-to-pane preview
 * canvas in the centre.
 *
 * Three coordinate flows:
 *
 *   1. State Street binds the control bar + lists + palette/timeline
 *      placeholders. Their inputs flow through `:change=editX(...)`
 *      methods which mutate `state.data`, dispatch `component:update`,
 *      and trigger State Street's polling rerender.
 *
 *   2. The preview canvas + per-frame thumbnail canvases are NOT
 *      inside `{{var}}` — State Street leaves them alone but rebuilds
 *      their containing components on each rerender, which wipes
 *      pixel buffers. A single rAF loop redraws all canvases each
 *      frame.
 *
 *   3. The rAF loop also drives playback (FPS-paced advancement of
 *      the current animation's `position` index). Five buttons (▶ ❚❚
 *      ■ ◀ ▶) flip a `playback.status` flag and step manually.
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
} from './reducer.js';
import {
  resolveTextureContext,
  type TextureContext,
} from './texture-context.js';

interface PanelData {
  title: string;
  controlsHtml: string;
  animationsHtml: string;
  paletteHtml: string;
  timelineHtml: string;
  _componentId: number | null;
  _componentType: string | null;
  _animations: AnimationEntry[];
  _selectedAnimation: string | null;
  _selectedTimelineIdx: number | null;
  _filePath: string;
  _spriteName: string | null;
  _textureMapKey: string;
  _frameCount: number;
}

interface PlaybackState {
  status: 'stopped' | 'playing' | 'paused';
  /** Index into the current animation's `frames` array. */
  position: number;
  /** `performance.now()` of the last frame advance. */
  lastTickMs: number;
}

interface ViewState {
  image: HTMLImageElement | null;
  lastImageSource: string | null;
  /** Rebuilt every rAF tick from the current scene + componentId. */
  context: TextureContext | null;
  playback: PlaybackState;
}

const viewState: ViewState = {
  image: null,
  lastImageSource: null,
  context: null,
  playback: { status: 'stopped', position: 0, lastTickMs: 0 },
};

// ── Styles (head-injected to bypass State Street's text-wrapping) ─────

const STYLES = /* css */ `
[ssct] { display: contents; }
.ae-root { display: grid; grid-template-rows: auto 1fr auto; grid-template-columns: 180px 1fr 200px; height: 100vh; box-sizing: border-box; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
.ae-control { grid-column: 1 / 4; display: flex; align-items: center; flex-wrap: wrap; gap: 0.75em; padding: 0.5em 0.75em; border-bottom: 1px solid var(--vscode-panel-border); }
.ae-control label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.ae-control .info { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.ae-control .play-controls { display: flex; gap: 0.25em; margin-left: auto; }
.ae-list { grid-row: 2 / 4; padding: 0.5em; border-right: 1px solid var(--vscode-panel-border); overflow-y: auto; min-height: 0; }
.ae-list h4 { margin: 0 0 0.5em 0; font-size: 0.9em; }
.ae-list-row { display: flex; align-items: center; gap: 0.25em; }
.ae-list-row input { flex: 1; }
.ae-list-row button { padding: 0.2em 0.4em; }
.ae-list-item { display: flex; justify-content: space-between; align-items: center; padding: 0.25em 0.4em; cursor: pointer; border-radius: 2px; font-size: 0.9em; }
.ae-list-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.ae-list-item button { padding: 0; width: 1.4em; height: 1.4em; line-height: 1; font-size: 0.85em; }
.ae-preview { grid-row: 2 / 3; grid-column: 2 / 3; position: relative; overflow: hidden; background: var(--vscode-editor-background); }
canvas#ae-preview-canvas { display: block; position: absolute; inset: 0; image-rendering: pixelated; }
.ae-preview .placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); font-size: 0.9em; padding: 1em; text-align: center; }
.ae-preview .label { position: absolute; top: 0.5em; left: 0.5em; font-size: 0.8em; opacity: 0.85; padding: 0.15em 0.4em; background: var(--vscode-editor-background); border-radius: 2px; }
.ae-palette { grid-row: 2 / 3; grid-column: 3 / 4; padding: 0.5em; border-left: 1px solid var(--vscode-panel-border); overflow-y: auto; min-height: 0; }
.ae-palette h4 { margin: 0 0 0.5em 0; font-size: 0.9em; }
.ae-palette-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.ae-cell { width: 100%; aspect-ratio: 1; border: 1px solid var(--vscode-input-border); position: relative; cursor: pointer; background: var(--vscode-editor-background); box-sizing: border-box; }
.ae-cell canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.ae-cell .idx { position: absolute; top: 1px; left: 2px; font-size: 0.7em; color: var(--vscode-descriptionForeground); pointer-events: none; text-shadow: 0 0 2px var(--vscode-editor-background); }
.ae-cell:hover { outline: 1px solid var(--vscode-focusBorder); }
.ae-timeline { grid-column: 2 / 4; grid-row: 3 / 4; padding: 0.5em; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 4px; overflow-x: auto; min-height: 64px; align-items: center; }
.ae-tcell { width: 48px; height: 48px; border: 1px solid var(--vscode-input-border); position: relative; flex-shrink: 0; cursor: pointer; background: var(--vscode-editor-background); box-sizing: border-box; }
.ae-tcell canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.ae-tcell .idx { position: absolute; top: 1px; left: 2px; font-size: 0.7em; color: var(--vscode-descriptionForeground); pointer-events: none; text-shadow: 0 0 2px var(--vscode-editor-background); }
.ae-tcell.selected { border-color: var(--vscode-focusBorder); border-width: 2px; }
.ae-tcell.playing { border-color: #8ebc3a; border-width: 2px; }
.ae-tcell.drag-over { border-style: dashed; border-color: var(--vscode-focusBorder); }
.ae-timeline .empty { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0.25em 0.5em; cursor: pointer; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
input[type="text"], input[type="number"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 0.25em; }
input[type="text"] { width: 8em; }
input[type="number"] { width: 4em; }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);
}

const template = /* html */ `
<body>
  <div class="ae-root">
    <div class="ae-control">
      <ControlsBody/>
    </div>
    <div class="ae-list">
      <h4>Animations</h4>
      <AnimationsBody/>
    </div>
    <div class="ae-preview">
      <canvas id="ae-preview-canvas"></canvas>
      <PreviewLabel/>
    </div>
    <div class="ae-palette">
      <h4>Frames</h4>
      <PaletteBody/>
    </div>
    <div class="ae-timeline">
      <TimelineBody/>
    </div>
  </div>
</body>
`;

const ControlsBody = (): string => `{{controlsHtml}}`;
const AnimationsBody = (): string => `{{animationsHtml}}`;
const PreviewLabel = (): string => ``; // populated imperatively
const PaletteBody = (): string => `{{paletteHtml}}`;
const TimelineBody = (): string => `{{timelineHtml}}`;

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
    title: 'Animation Editor',
    controlsHtml: '',
    animationsHtml: '',
    paletteHtml: '',
    timelineHtml: '',
    _componentId: readComponentIdFromBody(),
    _componentType: null,
    _animations: [],
    _selectedAnimation: null,
    _selectedTimelineIdx: null,
    _filePath: '',
    _spriteName: null,
    _textureMapKey: '',
    _frameCount: 0,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: {
    ControlsBody,
    AnimationsBody,
    PreviewLabel,
    PaletteBody,
    TimelineBody,
  },
  methods: {
    addAnim: ({ bridge, state }) => {
      const data = (state as { data: PanelData }).data;
      const input = document.getElementById(
        'ae-new-name',
      ) as HTMLInputElement | null;
      if (input === null) return;
      const name = input.value.trim();
      if (name === '') return;
      const next = addAnimation(data._animations, name);
      if (next === data._animations) return;
      input.value = '';
      data._selectedAnimation = name;
      data._selectedTimelineIdx = null;
      commit(bridge, data, next);
    },
    selectAnim: ({ state, idx }) => {
      const d = data(state);
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      d._selectedAnimation = anim.name;
      d._selectedTimelineIdx = null;
      // Restart playback from the start when switching animations.
      viewState.playback = {
        status: 'stopped',
        position: 0,
        lastTickMs: performance.now(),
      };
      refresh(d);
    },
    removeAnim: ({ bridge, state, idx }) => {
      const d = data(state);
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      const next = removeAnimation(d._animations, anim.name);
      if (d._selectedAnimation === anim.name) {
        d._selectedAnimation = null;
        d._selectedTimelineIdx = null;
      }
      commit(bridge, d, next);
    },
    renameAnim: ({ bridge, state, event }) => {
      const target = event.target as HTMLInputElement;
      const newName = target.value;
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const oldName = d._selectedAnimation;
      const next = renameAnimation(d._animations, oldName, newName);
      const trimmed = newName.trim();
      d._selectedAnimation = trimmed === '' ? oldName : trimmed;
      commit(bridge, d, next);
    },
    changeFrameRate: ({ bridge, state, event }) => {
      const target = event.target as HTMLInputElement;
      const fr = Number.parseFloat(target.value);
      if (!Number.isFinite(fr) || fr <= 0) return;
      const d = data(state);
      if (d._selectedAnimation === null) return;
      commit(bridge, d, setFrameRate(d._animations, d._selectedAnimation, fr));
    },
    toggleLoop: ({ bridge, state, event }) => {
      const target = event.target as HTMLInputElement;
      const d = data(state);
      if (d._selectedAnimation === null) return;
      commit(
        bridge,
        d,
        setLoop(d._animations, d._selectedAnimation, target.checked),
      );
    },
    changeOnComplete: ({ bridge, state, event }) => {
      const target = event.target as HTMLInputElement;
      const d = data(state);
      if (d._selectedAnimation === null) return;
      commit(
        bridge,
        d,
        setOnComplete(d._animations, d._selectedAnimation, target.value),
      );
    },
    addFrame: ({ bridge, state, index }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const idx = Number(index);
      if (!Number.isFinite(idx)) return;
      // Match `_old`'s insertion semantics: with a timeline cell
      // selected, palette clicks insert before that cell; otherwise
      // append.
      const next =
        d._selectedTimelineIdx !== null
          ? insertFrame(
              d._animations,
              d._selectedAnimation,
              d._selectedTimelineIdx,
              idx,
            )
          : appendFrame(d._animations, d._selectedAnimation, idx);
      commit(bridge, d, next);
    },
    selectTimeline: ({ state, position }) => {
      const d = data(state);
      const pos = Number(position);
      if (!Number.isFinite(pos)) return;
      d._selectedTimelineIdx = pos;
      // Pause playback and jump preview to the clicked frame.
      viewState.playback = {
        ...viewState.playback,
        status: 'paused',
        position: pos,
        lastTickMs: performance.now(),
      };
      refresh(d);
    },
    removeFrame: ({ bridge, state, position }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const pos = Number(position);
      if (!Number.isFinite(pos)) return;
      const next = removeFrameAt(d._animations, d._selectedAnimation, pos);
      // Clear selection if it pointed to (or past) the removed slot.
      if (d._selectedTimelineIdx !== null && d._selectedTimelineIdx >= pos) {
        d._selectedTimelineIdx = null;
      }
      commit(bridge, d, next);
    },
    play: ({ state }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      viewState.playback = {
        status: 'playing',
        position: 0,
        lastTickMs: performance.now(),
      };
      refresh(d);
    },
    pause: ({ state }) => {
      viewState.playback = {
        ...viewState.playback,
        status: 'paused',
        lastTickMs: performance.now(),
      };
      refresh(data(state));
    },
    stop: ({ state }) => {
      viewState.playback = {
        status: 'stopped',
        position: 0,
        lastTickMs: performance.now(),
      };
      refresh(data(state));
    },
    stepPrev: ({ state }) => {
      const d = data(state);
      const anim = currentAnimation(d);
      if (anim === null || anim.frames.length === 0) return;
      const len = anim.frames.length;
      viewState.playback = {
        status: 'paused',
        position: (viewState.playback.position - 1 + len) % len,
        lastTickMs: performance.now(),
      };
      refresh(d);
    },
    stepNext: ({ state }) => {
      const d = data(state);
      const anim = currentAnimation(d);
      if (anim === null || anim.frames.length === 0) return;
      viewState.playback = {
        status: 'paused',
        position: (viewState.playback.position + 1) % anim.frames.length,
        lastTickMs: performance.now(),
      };
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

function currentAnimation(d: PanelData): AnimationEntry | null {
  if (d._selectedAnimation === null) return null;
  return d._animations.find((a) => a.name === d._selectedAnimation) ?? null;
}

function handleIncoming(msg: EditorMessage): void {
  if (msg.kind === 'scene:load') {
    hydrateFromScene(msg.file);
    return;
  }
  if (msg.kind === 'component:update') {
    const d = panel.state.data;
    // Re-resolve the texture context on every update — sibling sprite
    // could have been swapped, the referenced texture-map's imageType
    // could have changed, etc. Cheap walk; runs through `refresh`.
    if (msg.id === d._componentId && msg.property === 'animations') {
      d._animations = parseAnimations(msg.value);
    }
    refreshFromCurrentScene();
    return;
  }
  if (msg.kind === 'image:loaded') {
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
  const animations = parseAnimations(
    (target as Record<string, unknown>)['animations'],
  );
  d._animations = animations;
  if (
    d._selectedAnimation === null ||
    !animations.some((a) => a.name === d._selectedAnimation)
  ) {
    d._selectedAnimation = animations[0]?.name ?? null;
  }
  applyTextureContext(file.scene, id);
  d.title = `Animation Editor — ${describeTarget(target)}`;
  refresh(d);
}

function refreshFromCurrentScene(): void {
  // Called after a `component:update` that may not have been for the
  // animation-controller itself but could still affect the resolved
  // texture context (sibling sprite or texture-map edits).
  if (typeof document === 'undefined') return;
  const d = panel.state.data;
  // We don't have direct access to the current scene from the
  // webview's editor-state — rely on hydrateFromScene for full
  // refreshes, and for incremental updates just re-render with the
  // existing texture-context. Texture context will refresh on the
  // next scene:load.
  refresh(d);
}

function applyTextureContext(
  scene: SerializedComponent,
  componentId: number,
): void {
  const d = panel.state.data;
  const ctx = resolveTextureContext(scene, componentId);
  viewState.context = ctx;
  if (ctx === null) {
    d._filePath = '';
    d._spriteName = null;
    d._textureMapKey = '';
    d._frameCount = 0;
    return;
  }
  d._filePath = ctx.filePath;
  d._spriteName = ctx.spriteName;
  d._textureMapKey = ctx.textureMapKey;
  d._frameCount = ctx.frames.length;
}

function describeTarget(c: SerializedComponent): string {
  if (typeof c.name === 'string' && c.name !== '') return c.name;
  return `${c.type} (id=${String(c.id)})`;
}

function commit(
  bridge: Bridge,
  d: PanelData,
  nextAnimations: AnimationEntry[],
): void {
  d._animations = nextAnimations;
  refresh(d);
  if (d._componentId === null || d._componentType === null) return;
  bridge.dispatch(
    componentUpdate(
      d._componentId,
      d._componentType,
      'animations',
      serializeAnimations(nextAnimations) as JsonValue,
    ),
  );
}

function refresh(d: PanelData): void {
  d.controlsHtml = renderControls(d);
  d.animationsHtml = renderAnimationsList(d);
  d.paletteHtml = renderPalette(d);
  d.timelineHtml = renderTimeline(d);
}

function renderControls(d: PanelData): string {
  const anim =
    d._selectedAnimation === null
      ? null
      : (d._animations.find((a) => a.name === d._selectedAnimation) ?? null);
  const disabled = anim === null;
  const dis = disabled ? ' disabled="disabled"' : '';
  const playStatus = viewState.playback.status;
  const playDisabledClass = (
    status: 'playing' | 'paused' | 'stopped',
  ): string => (playStatus === status ? ' disabled="disabled"' : '');
  return `
    <label>Name:</label>
    <input type="text"${dis} value="${escapeAttr(anim?.name ?? '')}" :change=renameAnim() />
    <label>FPS:</label>
    <input type="number" min="1" step="1"${dis} value="${anim?.frameRate ?? 12}" :change=changeFrameRate() />
    <label><input type="checkbox"${anim?.loop ? ' checked="checked"' : ''}${dis} :change=toggleLoop() /> Loop</label>
    <label>onComplete:</label>
    <input type="text"${dis} value="${escapeAttr(anim?.onComplete ?? '')}" :change=changeOnComplete() />
    <span class="info">${escapeHtml(d._spriteName ? `sprite: ${d._spriteName}` : '(no sibling sprite)')}</span>
    ${d._textureMapKey ? `<span class="info">key: ${escapeHtml(d._textureMapKey)}</span>` : ''}
    <div class="play-controls">
      <button type="button"${disabled ? ' disabled="disabled"' : playDisabledClass('playing')} :click=play() title="Play">▶</button>
      <button type="button"${disabled ? ' disabled="disabled"' : playDisabledClass('paused')} :click=pause() title="Pause">❚❚</button>
      <button type="button"${disabled ? ' disabled="disabled"' : playDisabledClass('stopped')} :click=stop() title="Stop">■</button>
      <button type="button"${dis} :click=stepPrev() title="Previous frame">◀</button>
      <button type="button"${dis} :click=stepNext() title="Next frame">▶</button>
    </div>
  `;
}

function renderAnimationsList(d: PanelData): string {
  const items = d._animations
    .map((a, idx) => {
      const sel = a.name === d._selectedAnimation ? ' selected' : '';
      const safeName = escapeHtml(a.name);
      return `<div class="ae-list-item${sel}" :click=selectAnim(idx=${idx})>
        <span>${safeName}</span>
        <button type="button" :click=removeAnim(idx=${idx}) title="Delete">×</button>
      </div>`;
    })
    .join('');
  // The "+ Add" form lives outside the list items so its input stays
  // mounted across selection changes.
  return `
    <div class="ae-list-row">
      <input type="text" id="ae-new-name" placeholder="New animation" />
      <button type="button" :click=addAnim()>+</button>
    </div>
    <div style="margin-top: 0.5em;">${items === '' ? '<em style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">No animations yet.</em>' : items}</div>
  `;
}

function renderPalette(d: PanelData): string {
  if (d._frameCount === 0) {
    return `<em style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">No frames available. The sibling sprite's texture-map needs grid or framemap data.</em>`;
  }
  const cells: string[] = [];
  for (let i = 0; i < d._frameCount; i += 1) {
    cells.push(
      `<div class="ae-cell" :click=addFrame(index=${i}) title="Frame ${i}"><canvas width="48" height="48"></canvas><span class="idx">${i}</span></div>`,
    );
  }
  return `<div class="ae-palette-grid">${cells.join('')}</div>`;
}

function renderTimeline(d: PanelData): string {
  if (d._selectedAnimation === null) {
    return `<span class="empty">Select an animation to edit its frame sequence.</span>`;
  }
  const anim = d._animations.find((a) => a.name === d._selectedAnimation);
  if (anim === undefined) return '';
  if (anim.frames.length === 0) {
    return `<span class="empty">Click a frame in the palette to add it.</span>`;
  }
  return anim.frames
    .map((frameIdx, pos) => {
      const sel = pos === d._selectedTimelineIdx ? ' selected' : '';
      const playing =
        viewState.playback.status !== 'stopped' &&
        pos === viewState.playback.position
          ? ' playing'
          : '';
      return `<div class="ae-tcell${sel}${playing}" :click=selectTimeline(position=${pos}) :contextmenu=removeFrame(position=${pos}) data-position="${pos}" data-frame="${frameIdx}" draggable="true">
        <canvas width="48" height="48"></canvas>
        <span class="idx">${frameIdx}</span>
      </div>`;
    })
    .join('');
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ── Canvas drawing + playback rAF loop ────────────────────────────────

if (typeof document !== 'undefined') {
  startRenderLoop();
  attachTimelineDragHandlers();
}

function startRenderLoop(): void {
  function frame(): void {
    advancePlayback();
    drawPreview();
    drawPalette();
    drawTimelineThumbs();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function advancePlayback(): void {
  if (viewState.playback.status !== 'playing') return;
  const d = panel.state.data;
  const anim = currentAnimation(d);
  if (anim === null || anim.frames.length === 0) return;
  const fr = anim.frameRate > 0 ? anim.frameRate : 12;
  const intervalMs = 1000 / fr;
  const now = performance.now();
  if (now - viewState.playback.lastTickMs < intervalMs) return;
  let next = viewState.playback.position + 1;
  if (next >= anim.frames.length) {
    if (anim.loop) {
      next = 0;
    } else {
      next = anim.frames.length - 1;
      viewState.playback.status = 'paused';
    }
  }
  viewState.playback.position = next;
  viewState.playback.lastTickMs = now;
}

function drawPreview(): void {
  const canvas = document.getElementById(
    'ae-preview-canvas',
  ) as HTMLCanvasElement | null;
  if (canvas === null) return;
  const wrap = canvas.parentElement;
  if (wrap !== null) {
    if (canvas.width !== wrap.clientWidth) canvas.width = wrap.clientWidth;
    if (canvas.height !== wrap.clientHeight) canvas.height = wrap.clientHeight;
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const d = panel.state.data;
  const image = viewState.image;
  const tcx = viewState.context;
  const anim = currentAnimation(d);
  if (image === null || tcx === null || anim === null) return;
  if (anim.frames.length === 0) return;
  const frameIdx = anim.frames[viewState.playback.position];
  if (frameIdx === undefined) return;
  const rect = tcx.frames[frameIdx];
  if (rect === undefined || rect.w <= 0 || rect.h <= 0) return;
  const padX = canvas.width - 16;
  const padY = canvas.height - 16;
  if (padX <= 0 || padY <= 0) return;
  // Fit to pane with 8x cap so single-pixel art stays legible.
  const scale = Math.min(padX / rect.w, padY / rect.h, 8);
  const dw = rect.w * scale;
  const dh = rect.h * scale;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);
}

function drawPalette(): void {
  const cells = document.querySelectorAll<HTMLCanvasElement>('.ae-cell canvas');
  drawCellGroup(cells, indexFrames(viewState.context));
}

function drawTimelineThumbs(): void {
  const cells =
    document.querySelectorAll<HTMLCanvasElement>('.ae-tcell canvas');
  const anim = currentAnimation(panel.state.data);
  const sourceFrames = indexFrames(viewState.context);
  const lookup: ((i: number) => number | undefined) | null =
    anim === null ? null : (i: number): number | undefined => anim.frames[i];
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i]!;
    const tctx = c.getContext('2d');
    if (tctx === null) continue;
    if (c.width !== 48) c.width = 48;
    if (c.height !== 48) c.height = 48;
    tctx.clearRect(0, 0, 48, 48);
    if (viewState.image === null || lookup === null) continue;
    const frameIdx = lookup(i);
    if (frameIdx === undefined) continue;
    const rect = sourceFrames[frameIdx];
    if (rect === undefined || rect.w <= 0 || rect.h <= 0) continue;
    drawClipped(tctx, viewState.image, rect, 48);
  }
}

function drawCellGroup(
  cells: NodeListOf<HTMLCanvasElement>,
  frames: readonly { x: number; y: number; w: number; h: number }[],
): void {
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i]!;
    const tctx = c.getContext('2d');
    if (tctx === null) continue;
    if (c.width !== 48) c.width = 48;
    if (c.height !== 48) c.height = 48;
    tctx.clearRect(0, 0, 48, 48);
    if (viewState.image === null) continue;
    const rect = frames[i];
    if (rect === undefined || rect.w <= 0 || rect.h <= 0) continue;
    drawClipped(tctx, viewState.image, rect, 48);
  }
}

function drawClipped(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  size: number,
): void {
  const pad = size - 2;
  const scale = Math.min(pad / rect.w, pad / rect.h, 2);
  const dw = rect.w * scale;
  const dh = rect.h * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, dx, dy, dw, dh);
}

function indexFrames(
  ctx: TextureContext | null,
): readonly { x: number; y: number; w: number; h: number }[] {
  return ctx === null ? [] : ctx.frames;
}

// ── Timeline drag-and-drop reorder ────────────────────────────────────

function attachTimelineDragHandlers(): void {
  // Delegated handlers — the timeline children are rebuilt by State
  // Street's updateDOM on every state change, so we attach to the
  // timeline container once and inspect `event.target` at fire time.
  let dragFromIdx: number | null = null;
  function closestTimelineCell(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    const hit = target.closest('.ae-tcell');
    return hit instanceof HTMLElement ? hit : null;
  }

  document.addEventListener('dragstart', (e) => {
    const target = closestTimelineCell(e.target);
    if (target === null) return;
    const pos = target.dataset['position'];
    if (pos === undefined) return;
    const idx = Number.parseInt(pos, 10);
    if (!Number.isFinite(idx)) return;
    dragFromIdx = idx;
    if (e.dataTransfer !== null) {
      e.dataTransfer.effectAllowed = 'move';
      // Required by Firefox; payload ignored.
      e.dataTransfer.setData('text/plain', String(idx));
    }
  });
  document.addEventListener('dragover', (e) => {
    if (dragFromIdx === null) return;
    const target = closestTimelineCell(e.target);
    if (target === null) return;
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move';
    document
      .querySelectorAll('.ae-tcell.drag-over')
      .forEach((el) => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  });
  document.addEventListener('dragleave', (e) => {
    const target = closestTimelineCell(e.target);
    if (target !== null) target.classList.remove('drag-over');
  });
  document.addEventListener('drop', (e) => {
    if (dragFromIdx === null) return;
    const target = closestTimelineCell(e.target);
    document
      .querySelectorAll('.ae-tcell.drag-over')
      .forEach((el) => el.classList.remove('drag-over'));
    if (target === null) return;
    e.preventDefault();
    const pos = target.dataset['position'];
    if (pos === undefined) return;
    const toIdx = Number.parseInt(pos, 10);
    if (!Number.isFinite(toIdx) || toIdx === dragFromIdx) {
      dragFromIdx = null;
      return;
    }
    const d = panel.state.data;
    if (d._selectedAnimation === null) {
      dragFromIdx = null;
      return;
    }
    const next = moveFrame(
      d._animations,
      d._selectedAnimation,
      dragFromIdx,
      toIdx,
    );
    dragFromIdx = null;
    commit(panel.bridge, d, next);
  });
}
