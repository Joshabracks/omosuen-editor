/**
 * Preview webview — Phase 6.5 scaffolding + 6.6 gizmo overlay.
 *
 * Renders a 2D canvas projection of the sanitized scene (top-down X/Z
 * plane; Y is depth and ignored). Each transform appears as a handle
 * dot; nexuses with a sibling transform get a label at that transform's
 * position (requirement 2.2). The currently-selected transform is
 * highlighted.
 *
 * Interactions (6.6):
 *   - Click a handle → dispatch `component:select([id])`.
 *   - Click empty space → dispatch `component:select([])`.
 *   - Drag a selected transform's handle → dispatch
 *     `component:update(id, 'transform', 'position', newVec)` on each
 *     pointermove.
 *
 * The engine UMD is loaded by the HTML layer (defer script), so
 * `window.Omosuen` becomes available after parse. Phase 6 ships with
 * the engine present but does NOT drive a full engine render loop —
 * the 2D projection here is editor-side. Engine-rendered preview is
 * future work; loading the UMD proves the plumbing for that future.
 */

import { State } from 'state-street';
import { componentSelect, componentUpdate } from '../../protocol/index.js';
import type { JsonValue } from '../../protocol/index.js';
import type {
  OmosceneFile,
  SerializedComponent,
} from '../../omoscene/index.js';
import { sanitizeSceneForPreview } from '../../app/scene-sanitization.js';
import { createEditorState } from '../../state/index.js';
import { bootstrapPanel } from '../bootstrap.js';

interface PanelData {
  title: string;
  engineStatus: string;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Handle {
  readonly transformId: number;
  readonly parentNexusName: string | null;
  readonly position: Vec3;
}

/**
 * A non-transform visible component (sprite / camera / light / etc.)
 * rendered at the position of its sibling transform. Phase 7.2.
 */
interface Item {
  readonly type: string;
  readonly componentId: number;
  readonly position: Vec3;
}

const VISIBLE_NON_TRANSFORM_TYPES: ReadonlySet<string> = new Set([
  'sprite',
  'camera',
  'light',
  'cell-map',
  'collider',
  'event-collider',
  'ui-overlay',
]);

interface CameraState {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

const HANDLE_RADIUS_PX = 6;
const HIT_RADIUS_PX = 12;
const DEFAULT_ZOOM = 20;

const editor = createEditorState();

const template = /* html */ `
<body>
  <div style="position: absolute; inset: 0; display: flex; flex-direction: column;">
    <header style="padding: 0.5em 1em; border-bottom: 1px solid var(--vscode-widget-border, transparent); display: flex; justify-content: space-between; align-items: baseline;">
      <span style="font-weight: bold;">{{title}}</span>
      <span style="color: var(--vscode-descriptionForeground); font-size: 0.85em;">{{engineStatus}}</span>
    </header>
    <canvas id="preview-canvas" style="flex: 1 1 auto; display: block; cursor: default; background: var(--vscode-editor-background);"></canvas>
  </div>
</body>
`;

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: {
    title: 'Omosuen Scene Preview',
    engineStatus: 'Engine: loading…',
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  wireIncoming: (msg) => {
    editor.dispatch(msg);
  },
});

pollEngine();

// Preview-local state owned outside State.data (mutating these wouldn't
// need a re-render, since the canvas draws on-demand via rAF).
let handles: Handle[] = [];
let items: Item[] = [];
let camera: CameraState = { panX: 0, panY: 0, zoom: DEFAULT_ZOOM };
let selectedIds: readonly number[] = [];
let canvas: HTMLCanvasElement | null = null;
let drag: {
  readonly transformId: number;
  readonly startPixel: { x: number; y: number };
  readonly startWorld: Vec3;
} | null = null;

editor.sceneDocument.subscribe(() => rebuildHandles());
editor.selection.subscribe((ids) => {
  selectedIds = ids;
  scheduleDraw();
});

// Canvas isn't in the DOM until State Street's initial render finishes.
// `requestAnimationFrame` runs after. Repeat until the canvas exists, then
// attach listeners.
function attachCanvasWhenReady(): void {
  canvas = document.getElementById(
    'preview-canvas',
  ) as HTMLCanvasElement | null;
  if (canvas === null) {
    requestAnimationFrame(attachCanvasWhenReady);
    return;
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('resize', scheduleDraw);
  scheduleDraw();
}
requestAnimationFrame(attachCanvasWhenReady);

function pollEngine(): void {
  const Omosuen = (globalThis as unknown as { Omosuen?: unknown }).Omosuen;
  if (Omosuen !== undefined) {
    panel.state.data.engineStatus = 'Engine: loaded ✓';
    return;
  }
  setTimeout(pollEngine, 100);
}

function rebuildHandles(): void {
  const file = editor.sceneDocument.get();
  if (file === null) {
    handles = [];
    items = [];
    camera = { panX: 0, panY: 0, zoom: DEFAULT_ZOOM };
    panel.state.data.title = 'Omosuen Scene Preview';
    scheduleDraw();
    return;
  }

  panel.state.data.title = `Scene: ${file.name}`;
  camera = readCamera(file);
  const sanitized = sanitizeSceneForPreview(file.scene);
  const collected = collectHandles(sanitized);
  handles = collected.handles;
  items = collected.items;
  scheduleDraw();
}

function readCamera(file: OmosceneFile): CameraState {
  const c = file.editor.camera;
  return {
    panX: Number.isFinite(c.panX) ? c.panX : 0,
    panY: Number.isFinite(c.panY) ? c.panY : 0,
    zoom:
      Number.isFinite(c.zoom) && c.zoom > 0
        ? c.zoom * DEFAULT_ZOOM
        : DEFAULT_ZOOM,
  };
}

function collectHandles(root: SerializedComponent): {
  handles: Handle[];
  items: Item[];
} {
  const handlesOut: Handle[] = [];
  const itemsOut: Item[] = [];
  visit(root);
  return { handles: handlesOut, items: itemsOut };

  function visit(node: SerializedComponent): void {
    const childTransforms: SerializedComponent[] = [];
    const childVisibles: SerializedComponent[] = [];
    const childNodes: SerializedComponent[] = [];
    if (Array.isArray(node.components)) {
      for (const c of node.components) {
        if (!isNode(c)) continue;
        childNodes.push(c);
        if (c.type === 'transform') {
          childTransforms.push(c);
        } else if (VISIBLE_NON_TRANSFORM_TYPES.has(c.type)) {
          childVisibles.push(c);
        }
      }
    }
    // Req 2.2: a nexus with a sibling transform shows a label at that
    // transform's position. Non-transform visible components in the
    // same nexus ride on the same position (Phase 7.2 icons).
    const nexusName =
      node.type === 'nexus' && typeof node.name === 'string' ? node.name : null;
    for (const t of childTransforms) {
      const position = readVector3(t['position']);
      const tid = typeof t.id === 'number' ? t.id : null;
      if (tid === null) continue;
      handlesOut.push({
        transformId: tid,
        parentNexusName: nexusName,
        position,
      });
      for (const v of childVisibles) {
        const cid = typeof v.id === 'number' ? v.id : null;
        if (cid === null) continue;
        itemsOut.push({
          type: v.type,
          componentId: cid,
          position,
        });
      }
    }
    for (const child of childNodes) {
      visit(child);
    }
  }
}

function readVector3(value: unknown): Vec3 {
  if (typeof value !== 'object' || value === null) return { x: 0, y: 0, z: 0 };
  const v = value as { x?: unknown; y?: unknown; z?: unknown };
  return {
    x: typeof v.x === 'number' ? v.x : 0,
    y: typeof v.y === 'number' ? v.y : 0,
    z: typeof v.z === 'number' ? v.z : 0,
  };
}

// --- Drawing ---------------------------------------------------------------

let drawScheduled = false;
function scheduleDraw(): void {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => {
    drawScheduled = false;
    draw();
  });
}

function draw(): void {
  if (canvas === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Grid
  drawGrid(ctx, width, height);

  const selected = new Set(selectedIds);
  const themeForeground = cssVar('--vscode-editor-foreground') || '#ccc';
  const themeSelection =
    cssVar('--vscode-list-activeSelectionBackground') || '#4a9eff';
  const themeMuted = cssVar('--vscode-descriptionForeground') || '#888';

  // Items render first so transform handles draw on top — handles are
  // the interactive drag targets and should be the top-most layer.
  for (const item of items) {
    const screen = worldToScreen(item.position, width, height);
    const isSelected = selected.has(item.componentId);
    drawItemIcon(ctx, item.type, screen, {
      foreground: themeForeground,
      selection: themeSelection,
      muted: themeMuted,
      isSelected,
    });
  }

  for (const handle of handles) {
    const screen = worldToScreen(handle.position, width, height);
    const isSelected = selected.has(handle.transformId);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? themeSelection : themeForeground;
    ctx.fill();
    if (isSelected) {
      ctx.strokeStyle = themeSelection;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Selection ring
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, HANDLE_RADIUS_PX + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Label — req 2.2: only nexuses with a sibling transform show labels.
    // Here the handle *is* that transform; if its parent was a nexus, show
    // the nexus's name.
    if (handle.parentNexusName !== null) {
      ctx.fillStyle = themeMuted;
      ctx.font = `11px var(--vscode-font-family)`;
      ctx.textBaseline = 'middle';
      ctx.fillText(
        handle.parentNexusName,
        screen.x + HANDLE_RADIUS_PX + 4,
        screen.y,
      );
    }
  }
}

interface IconColors {
  readonly foreground: string;
  readonly selection: string;
  readonly muted: string;
  readonly isSelected: boolean;
}

/**
 * Render the small per-type icon for a non-transform visible component.
 * Icons are deliberately simple for Phase 7 — just enough to tell
 * components apart visually. Phase 8's specialized editors can replace
 * these with real sprite/camera-frustum/light-cone renders.
 */
function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  type: string,
  center: { x: number; y: number },
  colors: IconColors,
): void {
  const stroke = colors.isSelected ? colors.selection : colors.foreground;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = colors.muted;
  ctx.lineWidth = colors.isSelected ? 2 : 1;

  switch (type) {
    case 'sprite': {
      // Outlined rectangle.
      const s = 14;
      ctx.strokeRect(center.x - s, center.y - s, s * 2, s * 2);
      break;
    }
    case 'camera': {
      // Diamond.
      const s = 10;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y - s);
      ctx.lineTo(center.x + s, center.y);
      ctx.lineTo(center.x, center.y + s);
      ctx.lineTo(center.x - s, center.y);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'light': {
      // Circle outline (distinct from the filled transform dot).
      ctx.beginPath();
      ctx.arc(center.x, center.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    default: {
      // Typed text badge for cell-map / collider / event-collider /
      // ui-overlay and any other non-transform visible the allowlist
      // grows to carry.
      const label = TYPE_BADGE_TEXT[type] ?? type.slice(0, 2).toUpperCase();
      ctx.font = '10px var(--vscode-font-family)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const metrics = ctx.measureText(label);
      const padX = 5;
      const padY = 3;
      const width = metrics.width + padX * 2;
      const height = 12 + padY * 2;
      ctx.strokeRect(
        center.x - width / 2,
        center.y - height / 2,
        width,
        height,
      );
      ctx.fillStyle = stroke;
      ctx.fillText(label, center.x, center.y);
      ctx.textAlign = 'start';
    }
  }
}

const TYPE_BADGE_TEXT: Readonly<Record<string, string>> = {
  'cell-map': 'CM',
  collider: 'C',
  'event-collider': 'EC',
  'ui-overlay': 'UI',
};

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.strokeStyle = cssVar('--vscode-editor-lineHighlightBorder') || '#2a2a2a';
  ctx.lineWidth = 1;
  // Origin crosshair
  const origin = worldToScreen({ x: 0, y: 0, z: 0 }, width, height);
  ctx.beginPath();
  ctx.moveTo(0, origin.y);
  ctx.lineTo(width, origin.y);
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, height);
  ctx.stroke();
}

function cssVar(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const style = window.getComputedStyle(document.body);
  const val = style.getPropertyValue(name).trim();
  return val !== '' ? val : null;
}

// --- Projection -----------------------------------------------------------

function worldToScreen(
  p: Vec3,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (p.x - camera.panX) * camera.zoom,
    y: height / 2 + (p.z - camera.panY) * camera.zoom,
  };
}

function screenToWorld(
  pixel: { x: number; y: number },
  width: number,
  height: number,
): { x: number; z: number } {
  return {
    x: camera.panX + (pixel.x - width / 2) / camera.zoom,
    z: camera.panY + (pixel.y - height / 2) / camera.zoom,
  };
}

// --- Interactions ---------------------------------------------------------

function canvasPixel(event: PointerEvent): { x: number; y: number } | null {
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

type HitResult =
  | { readonly kind: 'handle'; readonly handle: Handle }
  | { readonly kind: 'item'; readonly item: Item };

/**
 * Hit-test at the given canvas-pixel position. Handles win ties with
 * items so users can always grab the drag target even when an icon
 * overlaps a transform's dot.
 */
function hitTestAt(pixel: { x: number; y: number }): HitResult | null {
  const handle = hitTestHandles(pixel);
  if (handle !== null) return { kind: 'handle', handle };
  const item = hitTestItems(pixel);
  if (item !== null) return { kind: 'item', item };
  return null;
}

function hitTestItems(pixel: { x: number; y: number }): Item | null {
  if (canvas === null) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  let best: { item: Item; distance: number } | null = null;
  for (const item of items) {
    const screen = worldToScreen(item.position, width, height);
    const dx = screen.x - pixel.x;
    const dy = screen.y - pixel.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // Items are bigger than handles — give them a looser hit radius so
    // clicks on the icon body (not just its center) register.
    const hitRadius = HIT_RADIUS_PX + 6;
    if (distance <= hitRadius && (best === null || distance < best.distance)) {
      best = { item, distance };
    }
  }
  return best?.item ?? null;
}

function hitTestHandles(pixel: { x: number; y: number }): Handle | null {
  if (canvas === null) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  let best: { handle: Handle; distance: number } | null = null;
  for (const handle of handles) {
    const screen = worldToScreen(handle.position, width, height);
    const dx = screen.x - pixel.x;
    const dy = screen.y - pixel.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (
      distance <= HIT_RADIUS_PX &&
      (best === null || distance < best.distance)
    ) {
      best = { handle, distance };
    }
  }
  return best?.handle ?? null;
}

function onPointerDown(event: PointerEvent): void {
  const pixel = canvasPixel(event);
  if (pixel === null) return;
  const hit = hitTestAt(pixel);
  if (hit === null) {
    panel.bridge.dispatch(componentSelect([]));
    return;
  }
  if (hit.kind === 'handle') {
    if (canvas !== null) canvas.setPointerCapture(event.pointerId);
    panel.bridge.dispatch(componentSelect([hit.handle.transformId]));
    drag = {
      transformId: hit.handle.transformId,
      startPixel: pixel,
      startWorld: hit.handle.position,
    };
    if (canvas !== null) canvas.style.cursor = 'grabbing';
    return;
  }
  // hit.kind === 'item' — select the component; items aren't draggable
  // (dragging moves the sibling transform, which has its own handle).
  panel.bridge.dispatch(componentSelect([hit.item.componentId]));
}

function onPointerMove(event: PointerEvent): void {
  if (drag === null || canvas === null) return;
  const pixel = canvasPixel(event);
  if (pixel === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const worldStart = screenToWorld(drag.startPixel, width, height);
  const worldNow = screenToWorld(pixel, width, height);
  const dx = worldNow.x - worldStart.x;
  const dz = worldNow.z - worldStart.z;
  const newVector: JsonValue = {
    _vectorType: 'Vector3D',
    x: drag.startWorld.x + dx,
    y: drag.startWorld.y,
    z: drag.startWorld.z + dz,
  };
  panel.bridge.dispatch(
    componentUpdate(drag.transformId, 'transform', 'position', newVector),
  );
}

function onPointerUp(event: PointerEvent): void {
  if (drag !== null && canvas !== null) {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // no-op; some pointer types don't support capture
    }
  }
  drag = null;
  if (canvas !== null) canvas.style.cursor = 'default';
}

function isNode(value: unknown): value is SerializedComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
