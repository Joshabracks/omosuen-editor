/**
 * Audio editor webview (Phase 8.4 A).
 *
 * Workstation UI for an `audio-effect` component. Five vertical
 * sections inside one scrolling column:
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │ Transport: track ▼   ▶ ❚❚ ■   00:00 / 00:00     │ ← Phase A: dropdown only
 *   ├─────────────────────────────────────────────────┤
 *   │ Levels:  Master volume ──●──── 0.85             │
 *   ├─────────────────────────────────────────────────┤
 *   │ EQ (10 bands):                                  │
 *   │   ▆ ▄ ▆ █ ▇ ▆ ▄ ▆ ▇ ▅                          │
 *   ├─────────────────────────────────────────────────┤
 *   │ Panning: [Stereo|Spatial]                       │
 *   │   stereo: ──●─── pan -0.25                      │
 *   │   spatial: XY pad + XZ pad                      │
 *   ├─────────────────────────────────────────────────┤
 *   │ Effects: pitch / speed / reverb / buffer        │
 *   └─────────────────────────────────────────────────┘
 *
 * Every fader emits `component:update` for the corresponding field
 * on the audio-effect (or for the whole `mix` array on EQ band
 * changes — array writes are atomic). No live playback in Phase A
 * (deferred to Phase B). Track-selector dropdown is populated from
 * the host's `audio:tracks` push.
 *
 * Layout idioms inherited from the texture-map / animation editors:
 *   - `<style>` injected via `document.head.appendChild` so State
 *     Street's text-wrapping doesn't break the stylesheet.
 *   - `[ssct] { display: contents; }` so SSCT wrappers don't break
 *     flex/grid layouts.
 */

import { State } from 'state-street';
import {
  componentUpdate,
  type AudioTrackEntry,
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
  EQ_BAND_COUNT,
  parseAudioEffect,
  setEqBand,
  type AudioEffectState,
} from './reducer.js';

interface PanelData {
  title: string;
  transportHtml: string;
  levelsHtml: string;
  eqHtml: string;
  panningHtml: string;
  effectsHtml: string;
  _componentId: number | null;
  _componentType: string | null;
  _state: AudioEffectState;
  _tracks: readonly AudioTrackEntry[];
  _selectedTrackId: number | null;
}

const STYLES = /* css */ `
[ssct] { display: contents; }
.ae-root { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); overflow-y: auto; }
.ae-section { padding: 0.75em 1em; border-bottom: 1px solid var(--vscode-panel-border); }
.ae-section:last-child { border-bottom: none; }
.ae-section h3 { margin: 0 0 0.5em 0; font-size: 0.95em; color: var(--vscode-descriptionForeground); }
.ae-row { display: flex; align-items: center; gap: 0.75em; margin-bottom: 0.4em; }
.ae-row label { min-width: 7em; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.ae-row input[type="range"] { flex: 1; }
.ae-row .value { min-width: 5em; text-align: right; font-variant-numeric: tabular-nums; font-size: 0.85em; }
.ae-row select, .ae-row input[type="number"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 0.25em; }
.ae-row input[type="number"] { width: 5em; }
.ae-transport-controls { display: flex; gap: 0.25em; }
.ae-eq { display: flex; gap: 6px; height: 140px; padding: 0.5em 0; }
.ae-eq-band { display: flex; flex-direction: column; align-items: center; gap: 0.25em; flex: 1; }
.ae-eq-band input[type="range"] { -webkit-appearance: slider-vertical; appearance: slider-vertical; writing-mode: vertical-lr; width: 16px; height: 100px; direction: rtl; }
.ae-eq-band .band-label { font-size: 0.7em; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
.ae-tabs { display: flex; gap: 0.25em; margin-bottom: 0.5em; }
.ae-tabs button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); padding: 0.25em 0.75em; cursor: pointer; }
.ae-tabs button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.ae-pads { display: flex; gap: 1em; flex-wrap: wrap; }
.ae-pad-wrap { display: flex; flex-direction: column; gap: 0.25em; }
.ae-pad-wrap .pad-label { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
.ae-pad { width: 140px; height: 140px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); position: relative; cursor: crosshair; }
.ae-pad .axis-h, .ae-pad .axis-v { position: absolute; background: var(--vscode-panel-border); }
.ae-pad .axis-h { left: 0; right: 0; top: 50%; height: 1px; }
.ae-pad .axis-v { top: 0; bottom: 0; left: 50%; width: 1px; }
.ae-pad .puck { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: var(--vscode-button-background); border: 2px solid var(--vscode-button-foreground); transform: translate(-50%, -50%); pointer-events: none; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0.25em 0.6em; cursor: pointer; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);
}

const template = /* html */ `
<body>
  <div class="ae-root">
    <div class="ae-section">
      <h3>Transport</h3>
      <TransportBody/>
    </div>
    <div class="ae-section">
      <h3>Levels</h3>
      <LevelsBody/>
    </div>
    <div class="ae-section">
      <h3>EQ (10 bands)</h3>
      <EqBody/>
    </div>
    <div class="ae-section">
      <h3>Panning</h3>
      <PanningBody/>
    </div>
    <div class="ae-section">
      <h3>Effects</h3>
      <EffectsBody/>
    </div>
  </div>
</body>
`;

const TransportBody = (): string => `{{transportHtml}}`;
const LevelsBody = (): string => `{{levelsHtml}}`;
const EqBody = (): string => `{{eqHtml}}`;
const PanningBody = (): string => `{{panningHtml}}`;
const EffectsBody = (): string => `{{effectsHtml}}`;

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
    title: 'Audio Editor',
    transportHtml: '',
    levelsHtml: '',
    eqHtml: '',
    panningHtml: '',
    effectsHtml: '',
    _componentId: readComponentIdFromBody(),
    _componentType: null,
    _state: parseAudioEffect(undefined),
    _tracks: [],
    _selectedTrackId: null,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: {
    TransportBody,
    LevelsBody,
    EqBody,
    PanningBody,
    EffectsBody,
  },
  methods: {
    selectTrack: ({ state, event }) => {
      const target = event.target as HTMLSelectElement;
      const d = data(state);
      const parsed = Number.parseInt(target.value, 10);
      d._selectedTrackId = Number.isFinite(parsed) ? parsed : null;
      refresh(d);
    },
    editEffectField: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLInputElement;
      const parsed = Number.parseFloat(target.value);
      if (!Number.isFinite(parsed)) return;
      const d = data(state);
      const fieldName = String(field);
      dispatchEffectField(bridge, d, fieldName, parsed);
      // Optimistic local mutation so the value field re-renders with
      // the new number; the broker echo would do this too but it
      // arrives a frame later.
      applyLocalField(d, fieldName, parsed);
      refresh(d);
    },
    setSpatial: ({ bridge, state, value }) => {
      const v = String(value) === 'true';
      const d = data(state);
      d._state = { ...d._state, spatial: v };
      dispatchEffectField(bridge, d, 'spatial', v);
      refresh(d);
    },
    setEqBand: ({ bridge, state, band, event }) => {
      const target = event.target as HTMLInputElement;
      const parsed = Number.parseFloat(target.value);
      if (!Number.isFinite(parsed)) return;
      const idx = Number.parseInt(String(band), 10);
      if (!Number.isInteger(idx)) return;
      const d = data(state);
      const next = setEqBand(d._state.mix, idx, parsed);
      d._state = { ...d._state, mix: next };
      if (d._componentId !== null && d._componentType !== null) {
        // Whole-array write — `applyComponentUpdate` handles top-level
        // array replacements atomically.
        bridge.dispatch(
          componentUpdate(
            d._componentId,
            d._componentType,
            'mix',
            next as JsonValue,
          ),
        );
      }
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

function dispatchEffectField(
  bridge: Bridge,
  d: PanelData,
  field: string,
  value: JsonValue,
): void {
  if (d._componentId === null || d._componentType === null) return;
  bridge.dispatch(
    componentUpdate(d._componentId, d._componentType, field, value),
  );
}

/**
 * Mirror the dispatched value into `_state` so the on-screen number
 * label reflects the new setting immediately. The broker's fan-out
 * will overwrite this a frame later with the canonical value, but
 * the early refresh keeps faders + their text labels in sync as the
 * user drags.
 */
function applyLocalField(d: PanelData, field: string, value: number): void {
  switch (field) {
    case 'pitchShift':
      d._state = { ...d._state, pitchShift: value };
      break;
    case 'speedShift':
      d._state = { ...d._state, speedShift: value };
      break;
    case 'reverb':
      d._state = { ...d._state, reverb: value };
      break;
    case 'volume':
      d._state = { ...d._state, volume: value };
      break;
    case 'pan':
      d._state = { ...d._state, pan: value };
      break;
    case 'spatialX':
      d._state = { ...d._state, spatialX: value };
      break;
    case 'spatialY':
      d._state = { ...d._state, spatialY: value };
      break;
    case 'spatialZ':
      d._state = { ...d._state, spatialZ: value };
      break;
    case 'transitionBuffer':
      d._state = { ...d._state, transitionBuffer: value };
      break;
  }
}

function handleIncoming(msg: EditorMessage): void {
  if (msg.kind === 'scene:load') {
    hydrateFromScene(msg.file);
    return;
  }
  if (msg.kind === 'component:update') {
    const d = panel.state.data;
    if (msg.id !== d._componentId) return;
    // Re-walk the component to refresh the parsed state. The value
    // we just received is one field; rather than maintaining a
    // case-per-field dispatcher, the cleanest path is to re-parse
    // the current sceneDocument's snapshot of this component.
    refreshFromCurrentScene();
    return;
  }
  if (msg.kind === 'audio:tracks') {
    const d = panel.state.data;
    d._tracks = msg.tracks;
    if (
      d._selectedTrackId !== null &&
      !msg.tracks.some((t) => t.id === d._selectedTrackId)
    ) {
      d._selectedTrackId = null;
    }
    refresh(d);
  }
}

function hydrateFromScene(file: OmosceneFile): void {
  const d = panel.state.data;
  const id = d._componentId;
  if (id === null) return;
  const target = findById(file.scene, id);
  if (target === null) return;
  d._componentType = target.type;
  d._state = parseAudioEffect(target);
  d.title = `Audio Editor — ${describeTarget(target)}`;
  refresh(d);
}

function refreshFromCurrentScene(): void {
  // The broker's `component:update` arrives without the full scene,
  // but State Street's polling render keeps `state.data` in sync with
  // the next `scene:load` triggered by the broker (every save). For
  // immediate re-render with the latest dispatched values, the
  // `applyLocalField` path above handles the optimistic update; this
  // hook is here for any future need to re-walk the scene.
  refresh(panel.state.data);
}

function describeTarget(c: SerializedComponent): string {
  if (typeof c.name === 'string' && c.name !== '') return c.name;
  return `${c.type} (id=${String(c.id)})`;
}

function refresh(d: PanelData): void {
  d.transportHtml = renderTransport(d);
  d.levelsHtml = renderLevels(d);
  d.eqHtml = renderEq(d);
  d.panningHtml = renderPanning(d);
  d.effectsHtml = renderEffects(d);
}

function renderTransport(d: PanelData): string {
  const opts = d._tracks
    .map((t) => {
      const sel = d._selectedTrackId === t.id ? ' selected="selected"' : '';
      const safe = escapeHtml(t.name);
      const tooltip = escapeAttr(t.filePath || '(no file)');
      return `<option value="${t.id}" title="${tooltip}"${sel}>${safe}</option>`;
    })
    .join('');
  const noTracks = d._tracks.length === 0;
  return `
    <div class="ae-row">
      <label>Track:</label>
      <select :change=selectTrack()${noTracks ? ' disabled="disabled"' : ''}>
        <option value="">${noTracks ? '(no audio-tracks in scene)' : '(none)'}</option>
        ${opts}
      </select>
    </div>
    <div class="ae-row">
      <div class="ae-transport-controls">
        <button type="button" disabled="disabled" title="Playback ships in Phase B">▶</button>
        <button type="button" disabled="disabled" title="Playback ships in Phase B">❚❚</button>
        <button type="button" disabled="disabled" title="Playback ships in Phase B">■</button>
      </div>
      <span class="value">00:00 / 00:00</span>
    </div>
  `;
}

function renderLevels(d: PanelData): string {
  return `
    <div class="ae-row">
      <label>Master:</label>
      <input type="range" min="0" max="1" step="0.01" value="${d._state.volume}" :input=editEffectField(field=volume) />
      <span class="value">${formatNumber(d._state.volume, 2)}</span>
    </div>
  `;
}

function renderEq(d: PanelData): string {
  const bands: string[] = [];
  for (let i = 0; i < EQ_BAND_COUNT; i += 1) {
    const v = d._state.mix[i] ?? 0;
    bands.push(`
      <div class="ae-eq-band" title="Band ${i}">
        <input type="range" min="-1" max="1" step="0.01" value="${v}" :input=setEqBand(band=${i}) />
        <span class="band-label">${formatNumber(v, 2)}</span>
      </div>
    `);
  }
  return `<div class="ae-eq">${bands.join('')}</div>`;
}

function renderPanning(d: PanelData): string {
  const stereoActive = !d._state.spatial ? ' active' : '';
  const spatialActive = d._state.spatial ? ' active' : '';
  const body = d._state.spatial
    ? renderSpatialPads(d._state)
    : renderStereoSlider(d._state);
  return `
    <div class="ae-tabs">
      <button type="button" class="ae-tab${stereoActive}" :click=setSpatial(value=false)>Stereo</button>
      <button type="button" class="ae-tab${spatialActive}" :click=setSpatial(value=true)>Spatial</button>
    </div>
    ${body}
  `;
}

function renderStereoSlider(s: AudioEffectState): string {
  return `
    <div class="ae-row">
      <label>Pan:</label>
      <input type="range" min="-1" max="1" step="0.01" value="${s.pan}" :input=editEffectField(field=pan) />
      <span class="value">${formatNumber(s.pan, 2)}</span>
    </div>
  `;
}

function renderSpatialPads(s: AudioEffectState): string {
  // Two 2D pads side by side: XY (top-down) and XZ (front-back).
  // Each pad's puck position is computed from the current state's
  // spatial axes (range -1..1 → 0..100% of pad).
  const xyLeft = `${((s.spatialX + 1) / 2) * 100}%`;
  const xyTop = `${((s.spatialY + 1) / 2) * 100}%`;
  const xzLeft = `${((s.spatialX + 1) / 2) * 100}%`;
  const xzTop = `${((s.spatialZ + 1) / 2) * 100}%`;
  return `
    <div class="ae-pads">
      <div class="ae-pad-wrap">
        <span class="pad-label">XY (left/right · up/down)</span>
        <div class="ae-pad" data-axis="xy" :pointerdown=padDown(axis=xy) :pointermove=padMove(axis=xy)>
          <div class="axis-h"></div>
          <div class="axis-v"></div>
          <div class="puck" style="left: ${xyLeft}; top: ${xyTop};"></div>
        </div>
        <div class="ae-row">
          <label>X:</label>
          <input type="number" min="-1" max="1" step="0.01" value="${s.spatialX}" :change=editEffectField(field=spatialX) />
          <label>Y:</label>
          <input type="number" min="-1" max="1" step="0.01" value="${s.spatialY}" :change=editEffectField(field=spatialY) />
        </div>
      </div>
      <div class="ae-pad-wrap">
        <span class="pad-label">XZ (left/right · front/back)</span>
        <div class="ae-pad" data-axis="xz" :pointerdown=padDown(axis=xz) :pointermove=padMove(axis=xz)>
          <div class="axis-h"></div>
          <div class="axis-v"></div>
          <div class="puck" style="left: ${xzLeft}; top: ${xzTop};"></div>
        </div>
        <div class="ae-row">
          <label>Z:</label>
          <input type="number" min="-1" max="1" step="0.01" value="${s.spatialZ}" :change=editEffectField(field=spatialZ) />
        </div>
      </div>
    </div>
  `;
}

function renderEffects(d: PanelData): string {
  const s = d._state;
  return `
    <div class="ae-row">
      <label>Pitch:</label>
      <input type="range" min="-24" max="24" step="0.1" value="${s.pitchShift}" :input=editEffectField(field=pitchShift) />
      <span class="value">${formatNumber(s.pitchShift, 1)} st</span>
    </div>
    <div class="ae-row">
      <label>Speed:</label>
      <input type="range" min="0.1" max="4" step="0.01" value="${s.speedShift}" :input=editEffectField(field=speedShift) />
      <span class="value">${formatNumber(s.speedShift, 2)}×</span>
    </div>
    <div class="ae-row">
      <label>Reverb:</label>
      <input type="range" min="0" max="1" step="0.01" value="${s.reverb}" :input=editEffectField(field=reverb) />
      <span class="value">${formatNumber(s.reverb, 2)}</span>
    </div>
    <div class="ae-row">
      <label>Buffer:</label>
      <input type="range" min="0" max="5000" step="25" value="${s.transitionBuffer}" :input=editEffectField(field=transitionBuffer) />
      <span class="value">${Math.round(s.transitionBuffer)} ms</span>
    </div>
  `;
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

function formatNumber(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits);
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

// ── Spatial pad drag handling ──────────────────────────────────────────

if (typeof document !== 'undefined') {
  attachPadHandlers();
}

interface PadDragState {
  axis: 'xy' | 'xz';
  pad: HTMLElement;
}

let padDrag: PadDragState | null = null;

function attachPadHandlers(): void {
  document.addEventListener('pointerdown', (e) => {
    const target = (e.target as HTMLElement | null)?.closest('.ae-pad');
    if (!(target instanceof HTMLElement)) return;
    const axis = target.dataset['axis'];
    if (axis !== 'xy' && axis !== 'xz') return;
    padDrag = { axis, pad: target };
    target.setPointerCapture(e.pointerId);
    handlePadEvent(e);
  });
  document.addEventListener('pointermove', (e) => {
    if (padDrag === null) return;
    handlePadEvent(e);
  });
  document.addEventListener('pointerup', () => {
    padDrag = null;
  });
  document.addEventListener('pointercancel', () => {
    padDrag = null;
  });
}

function handlePadEvent(e: PointerEvent): void {
  if (padDrag === null) return;
  const rect = padDrag.pad.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const nx = clamp01((e.clientX - rect.left) / rect.width);
  const ny = clamp01((e.clientY - rect.top) / rect.height);
  // Map [0,1] → [-1, 1] with snap-to-step (0.01).
  const xVal = Math.round((nx * 2 - 1) * 100) / 100;
  const yVal = Math.round((ny * 2 - 1) * 100) / 100;
  const d = panel.state.data;
  if (padDrag.axis === 'xy') {
    if (xVal !== d._state.spatialX) {
      d._state = { ...d._state, spatialX: xVal };
      dispatchEffectField(panel.bridge, d, 'spatialX', xVal);
    }
    if (yVal !== d._state.spatialY) {
      d._state = { ...d._state, spatialY: yVal };
      dispatchEffectField(panel.bridge, d, 'spatialY', yVal);
    }
  } else {
    if (xVal !== d._state.spatialX) {
      d._state = { ...d._state, spatialX: xVal };
      dispatchEffectField(panel.bridge, d, 'spatialX', xVal);
    }
    if (yVal !== d._state.spatialZ) {
      d._state = { ...d._state, spatialZ: yVal };
      dispatchEffectField(panel.bridge, d, 'spatialZ', yVal);
    }
  }
  refresh(d);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
