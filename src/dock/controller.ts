import { hitTestDropZone, type DropZone } from './drop';
import {
  closeTab,
  collectViewIds,
  createIdFactory,
  findNode,
  insertView,
  moveView,
  setActiveTab,
  setSplitSizes,
  type IdFactory,
} from './mutations';
import { getPreservedById, type PreservedHTMLElement } from './preserve';
import { viewHostElementId } from './render';
import type { DockViewRegistry } from './registry';
import {
  isSplit,
  isTabGroup,
  type DockLayout,
  type DropTarget,
  type ViewId,
} from './types';

export interface DockShellHandle {
  getLayout(): DockLayout;
  setLayout(layout: DockLayout): void;
  /** Sync DOM immediately after layout mutation (e.g. forceUpdate + reconcile). */
  flush(): void;
}

export interface WindowDragBridge {
  begin(
    viewId: ViewId,
    title: string,
    screenX: number,
    screenY: number,
  ): Promise<void>;
  move(screenX: number, screenY: number): void;
  end(
    screenX: number,
    screenY: number,
  ): Promise<'local' | 'settled' | 'attached' | 'cancelled'>;
  cancel(): void;
}

export interface DockControllerOptions {
  readonly shell: DockShellHandle;
  readonly registry: DockViewRegistry;
  /** Element that contains dock chrome (event delegation root). */
  readonly interactionRoot: HTMLElement;
  readonly newId?: IdFactory;
  /** Instant pop-out (⧉) without a live drag session. */
  readonly onPopOut?: (viewId: ViewId, screenX: number, screenY: number) => void;
  /** Cross-window live drag session (main-process float window). */
  readonly windowDrag?: WindowDragBridge;
  /** When false, hide pop-out chrome affordances. */
  readonly allowPopOut?: boolean;
}

/**
 * Thin dock interaction layer: splitters, tab drag/drop, and moveTo reconcile
 * of `:preserve` view hosts into panel bodies.
 */
export class DockController {
  private readonly shell: DockShellHandle;
  private readonly registry: DockViewRegistry;
  private readonly root: HTMLElement;
  private readonly newId: IdFactory;
  private readonly onPopOut?: (
    viewId: ViewId,
    screenX: number,
    screenY: number,
  ) => void;
  private readonly windowDrag?: WindowDragBridge;
  private readonly allowPopOut: boolean;
  private readonly mounted = new Set<ViewId>();
  private dropOverlay: HTMLElement | null = null;
  private drag: {
    viewId: ViewId;
    started: boolean;
    originX: number;
    originY: number;
    pointerId: number;
    captureEl: HTMLElement;
    sessionStarted: boolean;
  } | null = null;
  private splitDrag: {
    splitId: string;
    index: number;
    startPos: number;
    startSizes: number[];
    currentSizes: number[];
    direction: 'horizontal' | 'vertical';
    parentRect: DOMRect;
  } | null = null;
  private externalViewId: ViewId | null = null;

  constructor(options: DockControllerOptions) {
    this.shell = options.shell;
    this.registry = options.registry;
    this.root = options.interactionRoot;
    this.newId = options.newId ?? createIdFactory('dock');
    this.onPopOut = options.onPopOut;
    this.windowDrag = options.windowDrag;
    this.allowPopOut = options.allowPopOut ?? true;
    this.root.classList.add('dock-interaction-root');
    if (!this.allowPopOut) {
      this.root.classList.add('dock-no-popout');
    }
    this.bind();
  }

  /** Mount registry views into preserve hosts once, then place into panels. */
  bootstrap(): void {
    for (const view of this.registry.list()) {
      this.ensureMounted(view.id);
    }
    this.reconcileHosts();
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('click', this.onClick);
    this.clearDropOverlay();
  }

  /** Call after State Street has applied a new layout to the DOM. */
  reconcileHosts(): void {
    const layout = this.shell.getLayout();
    const active = new Map<ViewId, HTMLElement>();

    for (const body of this.root.querySelectorAll<HTMLElement>('[data-panel-body]')) {
      const viewId = body.dataset.activeView;
      if (!viewId) continue;
      active.set(viewId, body);
    }

    const allIds = new Set<ViewId>([
      ...this.registry.list().map((v) => v.id),
      ...collectViewIds(layout.root),
    ]);

    for (const viewId of allIds) {
      const host = getPreservedById(viewHostElementId(viewId));
      if (!host) continue;
      this.ensureMounted(viewId);
      const target = active.get(viewId);
      if (target) {
        if (host.parentElement !== target) {
          host.moveTo(target);
        }
        host.hidden = false;
      } else {
        host.resetLocation();
        host.hidden = true;
      }
    }
  }

  /** Remove a view from this window's layout (drag detached into a float). */
  detachView(viewId: ViewId): void {
    if (!collectViewIds(this.shell.getLayout().root).includes(viewId)) return;
    this.applyLayout(closeTab(this.shell.getLayout(), viewId));
  }

  /** External cross-window drag hover preview. */
  showExternalHover(viewId: ViewId, clientX: number, clientY: number): void {
    this.externalViewId = viewId;
    this.updateDropOverlay(clientX, clientY);
  }

  clearExternalHover(): void {
    this.externalViewId = null;
    this.clearDropOverlay();
  }

  /**
   * Accept a view from another window at the given client point.
   * Returns false if there is no valid drop target.
   */
  acceptExternalAttach(viewId: ViewId, clientX: number, clientY: number): boolean {
    this.clearExternalHover();
    const drop = this.hitTestDropTarget(clientX, clientY);
    if (!drop) {
      // Empty shell or miss — still accept into default placement.
      if (!this.shell.getLayout().root) {
        this.applyLayout(insertView(this.shell.getLayout(), viewId, this.newId));
        return true;
      }
      this.applyLayout(insertView(this.shell.getLayout(), viewId, this.newId));
      return true;
    }
    this.applyLayout(
      insertView(this.shell.getLayout(), viewId, this.newId, drop),
    );
    return true;
  }

  private ensureMounted(viewId: ViewId): void {
    if (this.mounted.has(viewId)) return;
    const host = getPreservedById(viewHostElementId(viewId));
    const reg = this.registry.get(viewId);
    if (!host || !reg) return;
    host.classList.add('dock-view-host');
    reg.mount(host);
    this.mounted.add(viewId);
  }

  private applyLayout(next: DockLayout): void {
    this.shell.setLayout(next);
    this.shell.flush();
    this.reconcileHosts();
  }

  private bind(): void {
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('click', this.onClick);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.drag?.started) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const popout = target.closest<HTMLElement>('[data-dock-popout]');
    if (popout?.dataset.viewId) {
      event.preventDefault();
      event.stopPropagation();
      if (this.allowPopOut && this.onPopOut) {
        this.onPopOut(popout.dataset.viewId, event.screenX, event.screenY);
      }
      return;
    }

    const close = target.closest<HTMLElement>('[data-dock-close]');
    if (close?.dataset.viewId) {
      event.preventDefault();
      this.applyLayout(closeTab(this.shell.getLayout(), close.dataset.viewId));
      return;
    }

    const tab = target.closest<HTMLElement>('[data-dock-tab]');
    if (tab?.dataset.groupId && tab.dataset.viewId) {
      event.preventDefault();
      this.applyLayout(
        setActiveTab(
          this.shell.getLayout(),
          tab.dataset.groupId,
          tab.dataset.viewId,
        ),
      );
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const splitter = target.closest<HTMLElement>('[data-dock-splitter]');
    if (splitter) {
      event.preventDefault();
      event.stopPropagation();
      const splitId = splitter.dataset.splitId;
      const index = Number(splitter.dataset.splitIndex);
      const direction = splitter.dataset.splitDirection as
        | 'horizontal'
        | 'vertical';
      if (!splitId || !Number.isFinite(index) || !direction) return;
      const layout = this.shell.getLayout();
      const node = layout.root ? findNode(layout.root, splitId) : null;
      if (!node || !isSplit(node)) return;
      const splitEl = splitter.parentElement;
      if (!splitEl) return;
      this.splitDrag = {
        splitId,
        index,
        startPos: direction === 'horizontal' ? event.clientX : event.clientY,
        startSizes: [...node.sizes],
        currentSizes: [...node.sizes],
        direction,
        parentRect: splitEl.getBoundingClientRect(),
      };
      splitter.setPointerCapture(event.pointerId);
      return;
    }

    const tab = target.closest<HTMLElement>('[data-dock-tab]');
    if (tab?.dataset.viewId) {
      this.beginTabDrag(tab, tab.dataset.viewId, event);
      return;
    }

    const titlebar = target.closest<HTMLElement>('[data-dock-titlebar]');
    if (
      titlebar &&
      !target.closest('[data-dock-close]') &&
      !target.closest('[data-dock-popout]')
    ) {
      const viewId = titlebar.dataset.activeView;
      if (!viewId) return;
      this.beginTabDrag(titlebar, viewId, event);
    }
  };

  private beginTabDrag(
    captureEl: HTMLElement,
    viewId: ViewId,
    event: PointerEvent,
  ): void {
    this.drag = {
      viewId,
      started: false,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
      captureEl,
      sessionStarted: false,
    };
    try {
      captureEl.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.splitDrag) {
      this.updateSplitDrag(event);
      return;
    }
    if (!this.drag) return;
    const dx = event.clientX - this.drag.originX;
    const dy = event.clientY - this.drag.originY;
    if (!this.drag.started && dx * dx + dy * dy < 25) return;
    this.drag.started = true;

    if (this.windowDrag && !this.drag.sessionStarted) {
      this.drag.sessionStarted = true;
      const title = this.registry.get(this.drag.viewId)?.title ?? this.drag.viewId;
      void this.windowDrag.begin(
        this.drag.viewId,
        title,
        event.screenX,
        event.screenY,
      );
    } else if (this.windowDrag && this.drag.sessionStarted) {
      this.windowDrag.move(event.screenX, event.screenY);
    }

    // Local overlay while pointer is still over this window's dock.
    if (
      event.clientX >= 0 &&
      event.clientY >= 0 &&
      event.clientX <= window.innerWidth &&
      event.clientY <= window.innerHeight
    ) {
      this.updateDropOverlay(event.clientX, event.clientY);
    } else {
      this.clearDropOverlay();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    void this.finishPointer(event);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    void this.finishPointer(event, true);
  };

  private async finishPointer(
    event: PointerEvent,
    cancelled = false,
  ): Promise<void> {
    if (this.splitDrag) {
      const drag = this.splitDrag;
      this.splitDrag = null;
      this.applyLayout(
        setSplitSizes(
          this.shell.getLayout(),
          drag.splitId,
          drag.currentSizes,
        ),
      );
      return;
    }
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    try {
      drag.captureEl.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }

    if (!drag.started) {
      this.clearDropOverlay();
      return;
    }

    this.clearDropOverlay();

    if (cancelled) {
      this.windowDrag?.cancel();
      return;
    }

    if (this.windowDrag && drag.sessionStarted) {
      const result = await this.windowDrag.end(event.screenX, event.screenY);
      if (result === 'local') {
        const drop = this.hitTestDropTarget(event.clientX, event.clientY);
        if (drop) {
          this.applyLayout(
            moveView(this.shell.getLayout(), drag.viewId, drop, this.newId),
          );
        }
      }
      // settled / attached: layout already updated via detach + other window attach
      return;
    }

    const drop = this.hitTestDropTarget(event.clientX, event.clientY);
    if (drop) {
      this.applyLayout(
        moveView(this.shell.getLayout(), drag.viewId, drop, this.newId),
      );
    }
  }

  private updateSplitDrag(event: PointerEvent): void {
    const drag = this.splitDrag;
    if (!drag) return;
    const delta =
      drag.direction === 'horizontal'
        ? event.clientX - drag.startPos
        : event.clientY - drag.startPos;
    const total =
      drag.direction === 'horizontal'
        ? drag.parentRect.width
        : drag.parentRect.height;
    if (total <= 0) return;

    const sizes = [...drag.startSizes];
    const i = drag.index;
    const deltaFrac = delta / total;
    const min = 0.08;
    let left = sizes[i]! + deltaFrac;
    let right = sizes[i + 1]! - deltaFrac;
    if (left < min) {
      right -= min - left;
      left = min;
    }
    if (right < min) {
      left -= min - right;
      right = min;
    }
    sizes[i] = left;
    sizes[i + 1] = right;
    drag.currentSizes = sizes;

    const splitEl = this.root.querySelector(
      `[data-kind="split"][data-node-id="${CSS.escape(drag.splitId)}"]`,
    );
    if (splitEl) {
      const panes = splitEl.querySelectorAll<HTMLElement>(':scope > .dock-pane');
      panes.forEach((pane, idx) => {
        pane.style.flexGrow = String(sizes[idx] ?? 1);
      });
    }
  }

  private updateDropOverlay(clientX: number, clientY: number): void {
    const hit = this.elementFromPoint(clientX, clientY);
    if (!hit) {
      this.clearDropOverlay();
      return;
    }
    const zone = hitTestDropZone(clientX, clientY, hit.rect);
    if (!this.dropOverlay) {
      this.dropOverlay = document.createElement('div');
      this.dropOverlay.className = 'dock-drop-overlay';
      this.root.appendChild(this.dropOverlay);
    }
    const ov = this.dropOverlay;
    ov.style.display = 'block';
    const host = this.root.getBoundingClientRect();
    const r = hit.rect;
    const left = r.left - host.left;
    const top = r.top - host.top;
    if (zone === 'center') {
      ov.style.left = `${left + r.width * 0.2}px`;
      ov.style.top = `${top + r.height * 0.2}px`;
      ov.style.width = `${r.width * 0.6}px`;
      ov.style.height = `${r.height * 0.6}px`;
    } else if (zone === 'left') {
      Object.assign(ov.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${r.width * 0.5}px`,
        height: `${r.height}px`,
      });
    } else if (zone === 'right') {
      Object.assign(ov.style, {
        left: `${left + r.width * 0.5}px`,
        top: `${top}px`,
        width: `${r.width * 0.5}px`,
        height: `${r.height}px`,
      });
    } else if (zone === 'top') {
      Object.assign(ov.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${r.width}px`,
        height: `${r.height * 0.5}px`,
      });
    } else {
      Object.assign(ov.style, {
        left: `${left}px`,
        top: `${top + r.height * 0.5}px`,
        width: `${r.width}px`,
        height: `${r.height * 0.5}px`,
      });
    }
  }

  private clearDropOverlay(): void {
    this.dropOverlay?.remove();
    this.dropOverlay = null;
  }

  private elementFromPoint(
    clientX: number,
    clientY: number,
  ): { nodeId: string; rect: DOMRect } | null {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.classList.contains('dock-drop-overlay')) continue;
      const panel = el.closest('.dock-panel') as HTMLElement | null;
      if (panel?.dataset.nodeId) {
        return {
          nodeId: panel.dataset.nodeId,
          rect: panel.getBoundingClientRect(),
        };
      }
    }
    return null;
  }

  private hitTestDropTarget(
    clientX: number,
    clientY: number,
  ): DropTarget | null {
    const hit = this.elementFromPoint(clientX, clientY);
    const root = this.shell.getLayout().root;
    if (!hit || !root) return null;
    const node = findNode(root, hit.nodeId);
    if (!node || !isTabGroup(node)) return null;
    const zone: DropZone = hitTestDropZone(clientX, clientY, hit.rect);
    if (zone === 'center') return { kind: 'tab', groupId: node.id };
    return { kind: 'split', targetId: node.id, edge: zone };
  }
}

export type { PreservedHTMLElement };
