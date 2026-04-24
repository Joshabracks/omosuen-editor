/**
 * Animation editor webview (Phase 8.2).
 *
 * Runs inside an `omosuen.animationEditor` panel opened imperatively by
 * the host (see [host.ts](./host.ts)). Three zones:
 *
 *   - Left: animation list (add, pick, rename, delete).
 *   - Center: preview canvas (numbered frame squares — image preview is
 *     a follow-on; see the plan's 8.2 resolution block).
 *   - Right: frame palette (click a cell to append its index to the
 *     current animation). Plus a timeline strip for the current
 *     animation with drag-to-reorder + per-frame remove.
 *
 * Data flow:
 *   1. `document.body.dataset.componentId` is baked in at panel-create
 *      time by [editor-base.ts](../../panel/editor-base.ts).
 *   2. The host bridge auto-dispatches `scene:load` on panel register
 *      (broker hydration). On receive, we resolve the target component,
 *      parse its `animations` field into our `AnimationEntry[]`, and
 *      store in `state.data`.
 *   3. Every edit (mutator method below) runs the matching reducer,
 *      updates local state, and emits `component:update` for the
 *      `animations` property. The broker routes that back to the host
 *      state + every other panel (inspector, preview WS).
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
  moveFrame,
  parseAnimations,
  removeAnimation,
  removeFrameAt,
  renameAnimation,
  serializeAnimations,
  setFrameRate,
  setLoop,
  type AnimationEntry,
} from './reducer.js';

interface PanelData {
  title: string;
  animationsHtml: string;
  timelineHtml: string;
  paletteHtml: string;
  _componentId: number | null;
  _componentType: string | null;
  _animations: AnimationEntry[];
  _selectedAnimation: string | null;
  _frameCount: number;
}

const DEFAULT_FRAME_COUNT = 64;

const template = /* html */ `
<body>
  <style>
    .ae-root { display: grid; grid-template-columns: 200px 1fr 240px; gap: 0.5em; padding: 0.5em; height: 100vh; box-sizing: border-box; }
    .ae-col { border: 1px solid var(--vscode-panel-border); padding: 0.5em; overflow: auto; }
    .ae-title { margin: 0 0 0.5em 0; font-size: 1em; }
    .ae-list-item { padding: 0.25em 0.5em; cursor: pointer; border-radius: 2px; }
    .ae-list-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .ae-timeline { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 0.5em; }
    .ae-frame { width: 36px; height: 36px; border: 1px solid var(--vscode-input-border); display: inline-flex; align-items: center; justify-content: center; font-size: 0.8em; background: var(--vscode-editor-background); position: relative; }
    .ae-frame button.remove { position: absolute; top: -6px; right: -6px; width: 14px; height: 14px; padding: 0; font-size: 0.7em; line-height: 1; }
    .ae-palette-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px; }
    .ae-palette-cell { aspect-ratio: 1; border: 1px solid var(--vscode-input-border); display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 0.75em; background: var(--vscode-editor-background); }
    .ae-palette-cell:hover { background: var(--vscode-list-hoverBackground); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 0.25em 0.5em; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    input[type="text"], input[type="number"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 0.25em; width: 100%; box-sizing: border-box; }
  </style>
  <div class="ae-root">
    <div class="ae-col">
      <h3 class="ae-title">Animations</h3>
      <div>
        <input type="text" id="ae-new-name" placeholder="New animation name" />
        <button :click=addAnim()>Add</button>
      </div>
      <div style="margin-top: 0.5em;">
        <AnimationsList/>
      </div>
    </div>
    <div class="ae-col">
      <h3 class="ae-title">{{title}}</h3>
      <div>
        <TimelineBody/>
      </div>
    </div>
    <div class="ae-col">
      <h3 class="ae-title">Frames</h3>
      <div>
        <PaletteBody/>
      </div>
    </div>
  </div>
</body>
`;

const AnimationsList = (): string => `{{animationsHtml}}`;
const TimelineBody = (): string => `{{timelineHtml}}`;
const PaletteBody = (): string => `{{paletteHtml}}`;

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
    animationsHtml:
      '<em style="color: var(--vscode-descriptionForeground);">No animations. Add one above.</em>',
    timelineHtml:
      '<em style="color: var(--vscode-descriptionForeground);">Select an animation on the left.</em>',
    paletteHtml: '',
    _componentId: readComponentIdFromBody(),
    _componentType: null,
    _animations: [],
    _selectedAnimation: null,
    _frameCount: DEFAULT_FRAME_COUNT,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: { AnimationsList, TimelineBody, PaletteBody },
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
      input.value = '';
      commit(bridge, data, next, name);
    },
    selectAnim: ({ state, idx }) => {
      const d = (state as { data: PanelData }).data;
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      d._selectedAnimation = anim.name;
      refresh(d);
    },
    removeAnim: ({ bridge, state, idx }) => {
      const d = (state as { data: PanelData }).data;
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      const next = removeAnimation(d._animations, anim.name);
      const nextSelected =
        d._selectedAnimation === anim.name ? null : d._selectedAnimation;
      commit(bridge, d, next, nextSelected);
    },
    renameAnim: ({ bridge, state, idx, event }) => {
      const target = event.target as HTMLInputElement;
      const newName = target.value;
      const d = data(state);
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      const oldName = anim.name;
      const next = renameAnimation(d._animations, oldName, newName);
      const nextSelected =
        d._selectedAnimation === oldName
          ? newName.trim()
          : d._selectedAnimation;
      commit(bridge, d, next, nextSelected);
    },
    changeFrameRate: ({ bridge, state, idx, event }) => {
      const target = event.target as HTMLInputElement;
      const fr = Number.parseFloat(target.value);
      if (!Number.isFinite(fr) || fr <= 0) return;
      const d = data(state);
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      commit(bridge, d, setFrameRate(d._animations, anim.name, fr));
    },
    toggleLoop: ({ bridge, state, idx, event }) => {
      const target = event.target as HTMLInputElement;
      const d = data(state);
      const anim = d._animations[Number(idx)];
      if (anim === undefined) return;
      commit(bridge, d, setLoop(d._animations, anim.name, target.checked));
    },
    addFrame: ({ bridge, state, index }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const idx = Number(index);
      if (!Number.isFinite(idx)) return;
      commit(bridge, d, appendFrame(d._animations, d._selectedAnimation, idx));
    },
    removeFrame: ({ bridge, state, position }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const pos = Number(position);
      if (!Number.isFinite(pos)) return;
      commit(
        bridge,
        d,
        removeFrameAt(d._animations, d._selectedAnimation, pos),
      );
    },
    moveFrameLeft: ({ bridge, state, position }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const pos = Number(position);
      if (!Number.isFinite(pos) || pos <= 0) return;
      commit(
        bridge,
        d,
        moveFrame(d._animations, d._selectedAnimation, pos, pos - 1),
      );
    },
    moveFrameRight: ({ bridge, state, position }) => {
      const d = data(state);
      if (d._selectedAnimation === null) return;
      const pos = Number(position);
      if (!Number.isFinite(pos)) return;
      commit(
        bridge,
        d,
        moveFrame(d._animations, d._selectedAnimation, pos, pos + 1),
      );
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
    if (msg.property !== 'animations') return;
    d._animations = parseAnimations(msg.value);
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
  const animations = parseAnimations(target['animations']);
  d._animations = animations;
  if (
    d._selectedAnimation === null ||
    !animations.some((a) => a.name === d._selectedAnimation)
  ) {
    d._selectedAnimation = animations[0]?.name ?? null;
  }
  d.title = `Animation Editor — ${describeTarget(target)}`;
  refresh(d);
}

function describeTarget(c: SerializedComponent): string {
  if (typeof c.name === 'string' && c.name !== '') return c.name;
  return `${c.type} (id=${String(c.id)})`;
}

function commit(
  bridge: Bridge,
  d: PanelData,
  nextAnimations: AnimationEntry[],
  nextSelected?: string | null,
): void {
  d._animations = nextAnimations;
  if (nextSelected !== undefined) d._selectedAnimation = nextSelected;
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
  d.animationsHtml = renderAnimationsList(d);
  d.timelineHtml = renderTimeline(d);
  d.paletteHtml = renderPalette(d);
}

function renderAnimationsList(d: PanelData): string {
  if (d._animations.length === 0) {
    return '<em style="color: var(--vscode-descriptionForeground);">No animations. Add one above.</em>';
  }
  // State Street's event-arg parser splits naively on `,` and `=` and
  // doesn't strip quotes, so we cannot inject user-typed animation
  // names as event arguments (they can contain any char). Pass the
  // list index instead; handler looks up by position on dispatch.
  return d._animations
    .map((a, idx) => {
      const selected = a.name === d._selectedAnimation ? ' selected' : '';
      const safeName = escapeHtml(a.name);
      return `<div class="ae-list-item${selected}" :click=selectAnim(idx=${idx})>
        <span>${safeName}</span>
        <button type="button" style="float: right;" :click=removeAnim(idx=${idx})>×</button>
      </div>`;
    })
    .join('');
}

function renderTimeline(d: PanelData): string {
  if (d._selectedAnimation === null) {
    return '<em style="color: var(--vscode-descriptionForeground);">Select an animation on the left.</em>';
  }
  const idx = d._animations.findIndex((a) => a.name === d._selectedAnimation);
  if (idx === -1) return '';
  const anim = d._animations[idx]!;
  const framesHtml =
    anim.frames.length === 0
      ? '<em style="color: var(--vscode-descriptionForeground);">No frames. Click the palette on the right to add.</em>'
      : anim.frames
          .map(
            (frameIdx, pos) =>
              `<div class="ae-frame">${frameIdx}
                <button class="remove" type="button" :click=removeFrame(position=${pos})>×</button>
              </div>`,
          )
          .join('');
  return `<div>
    <div style="display: grid; grid-template-columns: auto 1fr auto 1fr auto auto; gap: 0.5em; align-items: center;">
      <label>Name</label>
      <input type="text" value="${escapeHtml(anim.name)}" :change=renameAnim(idx=${idx}) />
      <label>FPS</label>
      <input type="number" min="1" step="1" value="${anim.frameRate}" :change=changeFrameRate(idx=${idx}) />
      <label>Loop</label>
      <input type="checkbox" ${anim.loop ? 'checked' : ''} :change=toggleLoop(idx=${idx}) />
    </div>
    <div class="ae-timeline">${framesHtml}</div>
  </div>`;
}

function renderPalette(d: PanelData): string {
  const cells: string[] = [];
  for (let i = 0; i < d._frameCount; i += 1) {
    cells.push(
      `<div class="ae-palette-cell" :click=addFrame(index=${i})>${i}</div>`,
    );
  }
  return `<div class="ae-palette-grid">${cells.join('')}</div>`;
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
