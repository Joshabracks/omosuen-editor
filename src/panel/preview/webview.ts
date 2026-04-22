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
    camera = { panX: 0, panY: 0, zoom: DEFAULT_ZOOM };
    panel.state.data.title = 'Omosuen Scene Preview';
    scheduleDraw();
    return;
  }

  panel.state.data.title = `Scene: ${file.name}`;
  camera = readCamera(file);
  const sanitized = sanitizeSceneForPreview(file.scene);
  handles = collectHandles(sanitized);
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

function collectHandles(root: SerializedComponent): Handle[] {
  const out: Handle[] = [];
  visit(root);
  return out;

  function visit(node: SerializedComponent): void {
    const childTransforms: SerializedComponent[] = [];
    const childNodes: SerializedComponent[] = [];
    if (Array.isArray(node.components)) {
      for (const c of node.components) {
        if (!isNode(c)) continue;
        childNodes.push(c);
        if (c.type === 'transform') childTransforms.push(c);
      }
    }
    // Req 2.2: nexuses with a sibling transform show a label. Here we
    // treat each nexus as the "parent" of its own child transforms; the
    // nexus's name labels the position they define.
    const nexusName =
      node.type === 'nexus' && typeof node.name === 'string' ? node.name : null;
    for (const t of childTransforms) {
      const position = readVector3(t['position']);
      const id = typeof t.id === 'number' ? t.id : null;
      if (id === null) continue;
      out.push({
        transformId: id,
        parentNexusName: nexusName,
        position,
      });
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

  // Handles
  const selected = new Set(selectedIds);
  const themeForeground = cssVar('--vscode-editor-foreground') || '#ccc';
  const themeSelection =
    cssVar('--vscode-list-activeSelectionBackground') || '#4a9eff';
  const themeMuted = cssVar('--vscode-descriptionForeground') || '#888';

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

function hitTest(pixel: { x: number; y: number }): Handle | null {
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
  const hit = hitTest(pixel);
  if (hit === null) {
    panel.bridge.dispatch(componentSelect([]));
    return;
  }
  if (canvas !== null) canvas.setPointerCapture(event.pointerId);
  panel.bridge.dispatch(componentSelect([hit.transformId]));
  drag = {
    transformId: hit.transformId,
    startPixel: pixel,
    startWorld: hit.position,
  };
  if (canvas !== null) canvas.style.cursor = 'grabbing';
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
