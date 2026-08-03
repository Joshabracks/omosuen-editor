/**
 * Imperative 2D gizmo overlay inside the preserved viewport host (4b).
 * Grid, nexus labels, translate gizmo, click-select — document-driven.
 * View camera is independent of in-scene cameras (editor.camera).
 */

import type { EditorCameraState, OmosceneFile } from '../../omoscene';
import {
  componentSelect,
  componentUpdate,
  type EditorMessage,
} from '../../protocol';
import {
  getAngleValues,
  getAxisDirs,
  worldToScreen,
  type OverlayCamera,
  type Vec3,
} from './axonometry';
import {
  buildViewportOverlayModel,
  resolveTranslateSelection,
  type ColliderHelper,
  type LightHelper,
  type ViewportLabelEntity,
  type ViewportOverlayModel,
} from './capabilities';
import {
  createViewCameraController,
  editorCameraFromUnknown,
  type ViewCameraController,
} from './view-camera';

const GIZMO_LENGTH = 64;
const GIZMO_HIT_DIST = 12;
const DEFAULT_HIT_RADIUS = 18;
const AXIS_COLORS = { x: '#FF4444', y: '#44FF44', z: '#4488FF' } as const;
const AXIS_HOVER = { x: '#FF8888', y: '#88FF88', z: '#88BBFF' } as const;

export interface GizmoOverlayDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly getSelection: () => readonly number[];
  readonly onDispatch: (message: EditorMessage) => void;
  readonly getViewCamera: () => EditorCameraState;
  readonly setViewCamera: (cam: EditorCameraState) => void;
  readonly onViewCameraCommit: (cam: EditorCameraState) => void;
}

export interface GizmoOverlayHandle {
  readonly refresh: () => void;
  readonly resize: () => void;
  readonly dispose: () => void;
  /** Contribution-driven paint modes present in the current scene (4c / 6b hook). */
  readonly paintModes: () => readonly string[];
}

export function mountGizmoOverlay(
  host: HTMLElement,
  deps: GizmoOverlayDeps,
): GizmoOverlayHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'viewport-gizmo-overlay';
  canvas.setAttribute('aria-label', 'Viewport gizmos');
  canvas.tabIndex = 0;
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let overlayModel: ViewportOverlayModel = {
    labels: [],
    colliders: [],
    lights: [],
    paintModes: [],
    showGrid: false,
  };
  let entities: ViewportLabelEntity[] = [];
  let raf = 0;
  let disposed = false;
  let hoveredAxis: 'x' | 'y' | 'z' | null = null;
  let drag: {
    axis: 'x' | 'y' | 'z';
    startMouse: { x: number; y: number };
    startPos: Vec3;
    transformId: number;
    livePos: Vec3;
  } | null = null;

  const viewController: ViewCameraController = createViewCameraController({
    getCamera: () => deps.getViewCamera(),
    setCamera: (cam) => {
      deps.setViewCamera(cam);
      schedule();
    },
    onCommit: (cam) => deps.onViewCameraCommit(cam),
  });
  const detachView = viewController.attach(canvas);

  const pointer = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const buildCamera = (): OverlayCamera | null => {
    const rect = host.getBoundingClientRect();
    const vpW = Math.max(1, Math.floor(rect.width));
    const vpH = Math.max(1, Math.floor(rect.height));
    const ed = editorCameraFromUnknown(deps.getViewCamera());
    return {
      panX: ed.panX,
      panY: ed.panY,
      zoom: ed.zoom > 0 ? ed.zoom : 1,
      vpW,
      vpH,
      angle: ed.axonometricAngle,
      yaw: ed.yaw,
    };
  };

  const refreshEntities = (): void => {
    const file = deps.getDocument();
    overlayModel = buildViewportOverlayModel(file);
    entities = [...overlayModel.labels];
    if (drag) {
      const match = entities.find((e) => e.transformId === drag!.transformId);
      if (match) {
        entities = entities.map((e) =>
          e.transformId === drag!.transformId
            ? { ...e, position: drag!.livePos }
            : e,
        );
      }
    }
  };

  const draw = (): void => {
    if (disposed || !ctx) return;
    const cam = buildCamera();
    if (!cam) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cam.vpW;
    const cssH = cam.vpH;
    if (
      canvas.width !== Math.floor(cssW * dpr) ||
      canvas.height !== Math.floor(cssH * dpr)
    ) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (overlayModel.showGrid) {
      drawGrid(ctx, cam);
    }
    drawOrigin(ctx, cam);

    for (const collider of overlayModel.colliders) {
      drawColliderHelper(ctx, cam, collider);
    }
    for (const light of overlayModel.lights) {
      drawLightHelper(ctx, cam, light);
    }

    const selection = resolveTranslateSelection(entities, deps.getSelection());
    for (const entity of entities) {
      const selected =
        selection !== null &&
        (selection.entity.nexusId === entity.nexusId ||
          selection.entity.transformId === entity.transformId);
      drawEntityLabel(ctx, cam, entity, selected);
      if (selected && entity.translateEnabled) {
        const sp = worldToScreen(
          entity.position.x,
          entity.position.y,
          entity.position.z,
          cam,
        );
        drawTranslateGizmo(ctx, cam, sp.x, sp.y, hoveredAxis, drag?.axis ?? null);
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

  const onPointerDown = (event: PointerEvent): void => {
    if (viewController.gesture()) return;
    if (event.button !== 0 || event.altKey) return;
    const cam = buildCamera();
    if (!cam) return;
    const { x: mx, y: my } = pointer(event);
    const selection = resolveTranslateSelection(entities, deps.getSelection());
    if (selection) {
      const sp = worldToScreen(
        selection.entity.position.x,
        selection.entity.position.y,
        selection.entity.position.z,
        cam,
      );
      const axis = hitTestGizmo(mx, my, sp.x, sp.y, cam);
      if (axis) {
        drag = {
          axis,
          startMouse: { x: mx, y: my },
          startPos: { ...selection.entity.position },
          transformId: selection.entity.transformId,
          livePos: { ...selection.entity.position },
        };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        schedule();
        return;
      }
    }

    const hit = findEntityAtPoint(mx, my, cam, entities);
    if (hit) {
      deps.onDispatch(componentSelect([hit.transformId]));
    } else {
      deps.onDispatch(componentSelect([]));
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (viewController.gesture()) return;
    const cam = buildCamera();
    if (!cam) return;
    const { x: mx, y: my } = pointer(event);

    if (drag) {
      const dirs = getAxisDirs(getAngleValues(cam.angle), cam.yaw);
      const dir = dirs[drag.axis];
      const len = Math.hypot(dir.x, dir.y) || 1;
      const dx = mx - drag.startMouse.x;
      const dy = my - drag.startMouse.y;
      const screenDelta = (dx * dir.x + dy * dir.y) / len;
      const worldDelta = screenDelta / Math.max(cam.zoom, 0.001);
      const next = { ...drag.startPos };
      next[drag.axis] = drag.startPos[drag.axis] + worldDelta;
      drag.livePos = next;
      refreshEntities();
      schedule();
      return;
    }

    const selection = resolveTranslateSelection(entities, deps.getSelection());
    let nextHover: 'x' | 'y' | 'z' | null = null;
    if (selection) {
      const sp = worldToScreen(
        selection.entity.position.x,
        selection.entity.position.y,
        selection.entity.position.z,
        cam,
      );
      nextHover = hitTestGizmo(mx, my, sp.x, sp.y, cam);
    }
    if (nextHover !== hoveredAxis) {
      hoveredAxis = nextHover;
      canvas.style.cursor = nextHover ? 'pointer' : 'default';
      schedule();
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag) return;
    const committed = drag;
    drag = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    deps.onDispatch(
      componentUpdate(committed.transformId, 'transform', 'position', {
        _vectorType: 'Vector3D',
        x: committed.livePos.x,
        y: committed.livePos.y,
        z: committed.livePos.z,
      }),
    );
    refreshEntities();
    schedule();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (viewController.handleKeyDown(event)) {
      event.preventDefault();
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('keydown', onKeyDown);

  refreshEntities();
  schedule();

  return {
    refresh() {
      if (disposed) return;
      refreshEntities();
      schedule();
    },
    resize() {
      schedule();
    },
    paintModes() {
      return overlayModel.paintModes;
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      detachView();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.remove();
    },
  };
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: OverlayCamera): void {
  const size = 16;
  const cells = 8;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = -cells; i <= cells; i += 1) {
    const a = worldToScreen(i * size, 0, -cells * size, cam);
    const b = worldToScreen(i * size, 0, cells * size, cam);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = worldToScreen(-cells * size, 0, i * size, cam);
    const d = worldToScreen(cells * size, 0, i * size, cam);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOrigin(ctx: CanvasRenderingContext2D, cam: OverlayCamera): void {
  const o = worldToScreen(0, 0, 0, cam);
  const dirs = getAxisDirs(getAngleValues(cam.angle), cam.yaw);
  const len = 28;
  for (const axis of ['x', 'y', 'z'] as const) {
    const dir = dirs[axis];
    ctx.strokeStyle = AXIS_COLORS[axis];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x + dir.x * len, o.y + dir.y * len);
    ctx.stroke();
  }
}

function drawEntityLabel(
  ctx: CanvasRenderingContext2D,
  cam: OverlayCamera,
  entity: ViewportLabelEntity,
  selected: boolean,
): void {
  const sp = worldToScreen(
    entity.position.x,
    entity.position.y,
    entity.position.z,
    cam,
  );
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  const metrics = ctx.measureText(entity.label);
  const padX = 6;
  const padY = 3;
  const w = metrics.width + padX * 2;
  const h = 16;
  const x = sp.x - w / 2;
  const y = sp.y - 28;
  ctx.fillStyle = selected
    ? 'rgba(80, 140, 220, 0.85)'
    : 'rgba(20, 22, 28, 0.75)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = selected
    ? 'rgba(160, 200, 255, 0.9)'
    : 'rgba(255,255,255,0.2)';
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillText(entity.label, x + padX, y + h - padY - 1);
}

function drawTranslateGizmo(
  ctx: CanvasRenderingContext2D,
  cam: OverlayCamera,
  cx: number,
  cy: number,
  hovered: 'x' | 'y' | 'z' | null,
  dragging: 'x' | 'y' | 'z' | null,
): void {
  const dirs = getAxisDirs(getAngleValues(cam.angle), cam.yaw);
  for (const axis of ['x', 'y', 'z'] as const) {
    const dir = dirs[axis];
    const active = hovered === axis || dragging === axis;
    const color = active ? AXIS_HOVER[axis] : AXIS_COLORS[axis];
    const ex = cx + dir.x * GIZMO_LENGTH;
    const ey = cy + dir.y * GIZMO_LENGTH;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = active ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    const angle = Math.atan2(dir.y, dir.x);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(
      ex - 10 * Math.cos(angle - 0.4),
      ey - 10 * Math.sin(angle - 0.4),
    );
    ctx.lineTo(
      ex - 10 * Math.cos(angle + 0.4),
      ey - 10 * Math.sin(angle + 0.4),
    );
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 11px monospace';
    ctx.fillText(axis.toUpperCase(), ex + dir.x * 8, ey + dir.y * 8);
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function hitTestGizmo(
  mx: number,
  my: number,
  cx: number,
  cy: number,
  cam: OverlayCamera,
): 'x' | 'y' | 'z' | null {
  const dirs = getAxisDirs(getAngleValues(cam.angle), cam.yaw);
  for (const axis of ['x', 'y', 'z'] as const) {
    const dir = dirs[axis];
    const adx = dir.x * GIZMO_LENGTH;
    const ady = dir.y * GIZMO_LENGTH;
    const lenSq = adx * adx + ady * ady;
    if (lenSq < 1e-6) continue;
    const t = Math.max(
      0.1,
      Math.min(1, ((mx - cx) * adx + (my - cy) * ady) / lenSq),
    );
    const closestX = cx + t * adx;
    const closestY = cy + t * ady;
    const distSq =
      (mx - closestX) * (mx - closestX) + (my - closestY) * (my - closestY);
    if (distSq < GIZMO_HIT_DIST * GIZMO_HIT_DIST) return axis;
  }
  return null;
}

function findEntityAtPoint(
  sx: number,
  sy: number,
  cam: OverlayCamera,
  entities: readonly ViewportLabelEntity[],
): ViewportLabelEntity | null {
  let best: ViewportLabelEntity | null = null;
  let bestDist = Infinity;
  let bestDepth = -Infinity;
  for (const entity of entities) {
    const sp = worldToScreen(
      entity.position.x,
      entity.position.y,
      entity.position.z,
      cam,
    );
    const dx = sx - sp.x;
    const dy = sy - sp.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hitRadius = Math.max(DEFAULT_HIT_RADIUS, 12 * cam.zoom);
    const labelHalfW = Math.max(28, entity.label.length * 3.5);
    const inLabel =
      sx >= sp.x - labelHalfW &&
      sx <= sp.x + labelHalfW &&
      sy >= sp.y - 30 &&
      sy <= sp.y - 12;
    if (dist <= hitRadius || inLabel) {
      const depth =
        entity.position.x + entity.position.y + entity.position.z;
      const score = inLabel ? 0 : dist;
      if (depth > bestDepth || (depth === bestDepth && score < bestDist)) {
        best = entity;
        bestDist = score;
        bestDepth = depth;
      }
    }
  }
  return best;
}

function drawColliderHelper(
  ctx: CanvasRenderingContext2D,
  cam: OverlayCamera,
  c: ColliderHelper,
): void {
  const isEvent = c.kind === 'event-collider';
  const color = isEvent ? 'rgba(180,220,80,0.55)' : 'rgba(80,220,220,0.55)';
  const cx = c.position.x + c.offset.x;
  const cy = c.position.y + c.offset.y;
  const cz = c.position.z + c.offset.z;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  if (c.shape === 'sphere') {
    const p = worldToScreen(cx, cy, cz, cam);
    const edge = worldToScreen(cx + c.radius, cy, cz, cam);
    const screenR = Math.max(2, Math.abs(edge.x - p.x));
    ctx.beginPath();
    ctx.arc(p.x, p.y, screenR, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    drawIsoBox(ctx, cam, cx, cy, cz, c.size.x / 2, c.size.y / 2, c.size.z / 2);
  }
  ctx.restore();
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  cam: OverlayCamera,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): void {
  const corners = [
    worldToScreen(cx - hx, cy - hy, cz - hz, cam),
    worldToScreen(cx + hx, cy - hy, cz - hz, cam),
    worldToScreen(cx + hx, cy + hy, cz - hz, cam),
    worldToScreen(cx - hx, cy + hy, cz - hz, cam),
    worldToScreen(cx - hx, cy - hy, cz + hz, cam),
    worldToScreen(cx + hx, cy - hy, cz + hz, cam),
    worldToScreen(cx + hx, cy + hy, cz + hz, cam),
    worldToScreen(cx - hx, cy + hy, cz + hz, cam),
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  ctx.beginPath();
  for (const [ia, ib] of edges) {
    const a = corners[ia!]!;
    const b = corners[ib!]!;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

function drawLightHelper(
  ctx: CanvasRenderingContext2D,
  cam: OverlayCamera,
  light: LightHelper,
): void {
  const r = Math.round(Math.max(0, Math.min(1, light.color.x)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, light.color.y)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, light.color.z)) * 255);
  const colorStr = `rgba(${r},${g},${b},0.85)`;

  if (light.lightType === 'directional') {
    const ox = 48;
    const oy = 48;
    const dx = light.direction.x;
    const dy = -light.direction.y;
    const dz = light.direction.z;
    const mag = Math.hypot(dx, dy, dz) || 1;
    const ex = ox + (dx / mag) * 28;
    const ey = oy + (dy / mag) * 28;
    ctx.strokeStyle = colorStr;
    ctx.fillStyle = colorStr;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fill();
    // Include z slightly in the screen projection of the direction tick.
    void dz;
    return;
  }

  const p = worldToScreen(
    light.position.x,
    light.position.y,
    light.position.z,
    cam,
  );
  ctx.fillStyle = colorStr;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  ctx.fill();
  if (light.radius > 0 && light.radius < 10000) {
    const edge = worldToScreen(
      light.position.x + light.radius,
      light.position.y,
      light.position.z,
      cam,
    );
    const screenR = Math.abs(edge.x - p.x);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, screenR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
