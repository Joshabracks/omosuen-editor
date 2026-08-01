import {
  BrowserWindow,
  ipcMain,
  screen,
  type WebContents,
} from 'electron';
import path from 'node:path';
import {
  IPC,
  type PopOutRequest,
  type PopOutResult,
  type ShellBusEnvelope,
  type WindowClosedEvent,
  type WindowDragAttachAck,
  type WindowDragAttachEvent,
  type WindowDragDetachEvent,
  type WindowDragEndRequest,
  type WindowDragEndResult,
  type WindowDragHoverEvent,
  type WindowDragMoveRequest,
  type WindowDragStartRequest,
  type WindowInfo,
  type WindowRole,
} from '../src/bridge/channels';
import type { PersistedPopOut } from '../src/dock/persist';
import { APP_TITLE } from '../src/shell/window-title';

export { formatPrimaryWindowTitle } from '../src/shell/window-title';

interface TrackedWindow {
  id: string;
  role: WindowRole;
  /** Views currently hosted in this window (synced from renderer layout). */
  viewIds: string[];
  floating: boolean;
  readonly win: BrowserWindow;
}

interface DragSession {
  readonly sessionId: string;
  readonly viewId: string;
  readonly title: string;
  readonly sourceWindowId: string;
  floatWindowId: string | null;
  hoverWindowId: string | null;
  lastScreenX: number;
  lastScreenY: number;
  detached: boolean;
}

const FLOAT_W = 480;
const FLOAT_H = 320;
const FLOAT_GRAB_X = 72;
const FLOAT_GRAB_Y = 18;

let seq = 0;
let sessionSeq = 0;

function nextWindowId(role: WindowRole): string {
  seq += 1;
  return `${role}-${seq}`;
}

function nextSessionId(): string {
  sessionSeq += 1;
  return `drag-${sessionSeq}`;
}

function htmlPath(): string {
  return path.join(__dirname, '../renderer/index.html');
}

function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function safeSend(win: BrowserWindow, channel: string, payload: unknown): void {
  if (win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch {
    // Window tore down mid-send.
  }
}

/**
 * Owns primary + pop-out BrowserWindows, live drag-out floats, and shell IPC.
 */
export class WindowManager {
  private readonly byId = new Map<string, TrackedWindow>();
  private readonly byContents = new Map<number, string>();
  private primaryId: string | null = null;
  private drag: DragSession | null = null;
  private readonly suppressRedock = new Set<string>();
  private onPopOutsChanged: (() => void) | null = null;
  private attachWaiters = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  /** Called whenever the settled pop-out list changes (persist from main). */
  setPopOutsChangedListener(listener: (() => void) | null): void {
    this.onPopOutsChanged = listener;
  }

  createPrimary(title: string = APP_TITLE): BrowserWindow {
    return this.createWindow({
      role: 'primary',
      width: 1280,
      height: 800,
      title,
    }).win;
  }

  /** Update the primary window title (workspace path lives here, not in chrome). */
  setPrimaryTitle(title: string): void {
    if (!this.primaryId) return;
    const tracked = this.byId.get(this.primaryId);
    if (!tracked || tracked.win.isDestroyed()) return;
    tracked.win.setTitle(title);
  }

  snapshotPopOuts(): PersistedPopOut[] {
    const out: PersistedPopOut[] = [];
    for (const tracked of this.byId.values()) {
      if (
        tracked.role !== 'popout' ||
        tracked.floating ||
        tracked.viewIds.length === 0
      ) {
        continue;
      }
      if (tracked.win.isDestroyed()) continue;
      try {
        const b = tracked.win.getBounds();
        out.push({
          viewIds: [...tracked.viewIds],
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        });
      } catch {
        // skip
      }
    }
    return out;
  }

  restorePopOuts(entries: readonly PersistedPopOut[]): void {
    for (const entry of entries) {
      if (entry.viewIds.length === 0) continue;
      // Skip if any of these views already live in a pop-out.
      if (entry.viewIds.some((id) => this.findPopOutHosting(id))) continue;
      this.createWindow({
        role: 'popout',
        viewIds: [...entry.viewIds],
        width: entry.width,
        height: entry.height,
        x: entry.x,
        y: entry.y,
        title: APP_TITLE,
      });
    }
    this.notifyPopOutsChanged();
  }

  /** Close settled pop-outs. When `redock` is false (Reset Layout), views stay in primary. */
  closeAllPopOuts(options: { redock: boolean }): void {
    const targets = [...this.byId.values()].filter(
      (t) => t.role === 'popout' && !t.floating && !t.win.isDestroyed(),
    );
    for (const tracked of targets) {
      if (!options.redock) this.suppressRedock.add(tracked.id);
      tracked.win.close();
    }
    this.notifyPopOutsChanged();
  }

  private notifyPopOutsChanged(): void {
    try {
      this.onPopOutsChanged?.();
    } catch {
      // persistence must not break window ops
    }
  }

  registerIpc(): void {
    ipcMain.handle(IPC.windowGetInfo, (event): WindowInfo => {
      return this.infoFor(event.sender);
    });

    ipcMain.handle(
      IPC.windowPopOut,
      (event, request: PopOutRequest): PopOutResult => {
        const source = this.trackedFor(event.sender);
        if (!request || typeof request.viewId !== 'string' || !request.viewId) {
          throw new Error('window:popOut requires viewId');
        }

        const existing = this.findPopOutHosting(request.viewId);
        if (existing && !existing.floating) {
          this.focusWindow(existing);
          return { windowId: existing.id, created: false };
        }

        const point = screen.getCursorScreenPoint();
        const screenX =
          typeof request.screenX === 'number' ? request.screenX : point.x;
        const screenY =
          typeof request.screenY === 'number' ? request.screenY : point.y;

        const tracked = this.createWindow({
          role: 'popout',
          viewIds: [request.viewId],
          width: FLOAT_W,
          height: FLOAT_H,
          title: APP_TITLE,
          x: Math.round(screenX - FLOAT_GRAB_X),
          y: Math.round(screenY - FLOAT_GRAB_Y),
        });
        safeSend(source.win, IPC.windowDragDetach, {
          viewId: request.viewId,
          sessionId: `pop-${tracked.id}`,
        } satisfies WindowDragDetachEvent);
        this.removeViewFromTracked(source, request.viewId);
        this.closeIfEmptyPopOut(source);
        this.notifyPopOutsChanged();
        return { windowId: tracked.id, created: true };
      },
    );

    ipcMain.handle(IPC.windowCloseAllPopouts, (): void => {
      this.closeAllPopOuts({ redock: false });
    });

    ipcMain.handle(
      IPC.windowSyncViews,
      (event, request: { viewIds?: unknown }): void => {
        const tracked = this.trackedFor(event.sender);
        const viewIds = Array.isArray(request?.viewIds)
          ? request.viewIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            )
          : [];
        tracked.viewIds = viewIds;
        if (tracked.role === 'popout' && !tracked.floating) {
          this.notifyPopOutsChanged();
        }
      },
    );

    ipcMain.handle(
      IPC.windowReturnView,
      (event, request: { viewId?: unknown }): void => {
        const source = this.trackedFor(event.sender);
        if (typeof request?.viewId !== 'string' || !request.viewId) {
          throw new Error('window:returnView requires viewId');
        }
        const viewId = request.viewId;
        // Source renderer already removed (or will remove) the tab; redock to primary.
        this.removeViewFromTracked(source, viewId);
        this.broadcastRedock([viewId], source.id);
        this.closeIfEmptyPopOut(source);
        this.notifyPopOutsChanged();
      },
    );

    ipcMain.handle(
      IPC.windowDragStart,
      (event, request: WindowDragStartRequest): { sessionId: string } => {
        const source = this.trackedFor(event.sender);
        if (!request?.viewId || typeof request.screenX !== 'number') {
          throw new Error('window:dragStart requires viewId and screen coords');
        }
        this.cancelDragSession('cancelled');
        const sessionId = nextSessionId();
        this.drag = {
          sessionId,
          viewId: request.viewId,
          title:
            typeof request.title === 'string' && request.title
              ? request.title
              : request.viewId,
          sourceWindowId: source.id,
          floatWindowId: null,
          hoverWindowId: null,
          lastScreenX: request.screenX,
          lastScreenY: request.screenY,
          detached: false,
        };
        return { sessionId };
      },
    );

    ipcMain.handle(
      IPC.windowDragMove,
      (event, request: WindowDragMoveRequest): void => {
        const session = this.drag;
        if (!session) return;
        const source = this.trackedFor(event.sender);
        if (source.id !== session.sourceWindowId) return;
        if (typeof request?.screenX !== 'number') return;

        session.lastScreenX = request.screenX;
        session.lastScreenY = request.screenY;

        const sourceBounds = this.contentBounds(source.win);
        const pad = 2;
        const outside =
          !sourceBounds ||
          request.screenX < sourceBounds.x + pad ||
          request.screenY < sourceBounds.y + pad ||
          request.screenX > sourceBounds.x + sourceBounds.width - pad ||
          request.screenY > sourceBounds.y + sourceBounds.height - pad;

        if (outside && !session.floatWindowId) {
          this.spawnFloatForDrag(session, request.screenX, request.screenY);
        }

        if (session.floatWindowId) {
          const float = this.byId.get(session.floatWindowId);
          if (float && !float.win.isDestroyed()) {
            float.win.setPosition(
              Math.round(request.screenX - FLOAT_GRAB_X),
              Math.round(request.screenY - FLOAT_GRAB_Y),
              false,
            );
          }
        }

        this.updateDragHover(session, request.screenX, request.screenY);
      },
    );

    ipcMain.handle(
      IPC.windowDragEnd,
      async (event, request: WindowDragEndRequest): Promise<WindowDragEndResult> => {
        const session = this.drag;
        if (!session) {
          return { kind: 'cancelled' };
        }
        const source = this.trackedFor(event.sender);
        if (source.id !== session.sourceWindowId) {
          return { kind: 'cancelled' };
        }

        const screenX = request?.screenX ?? session.lastScreenX;
        const screenY = request?.screenY ?? session.lastScreenY;
        this.updateDragHover(session, screenX, screenY);

        if (!session.floatWindowId) {
          this.clearDragHover(session);
          this.drag = null;
          return { kind: 'local' };
        }

        const hoverId = session.hoverWindowId;
        if (hoverId && hoverId !== session.floatWindowId) {
          const hover = this.byId.get(hoverId);
          if (hover && !hover.win.isDestroyed()) {
            const bounds = this.contentBounds(hover.win);
            if (bounds) {
              const accepted = await this.requestAttach(
                hover,
                session,
                screenX - bounds.x,
                screenY - bounds.y,
              );
              if (accepted) {
                if (!hover.viewIds.includes(session.viewId)) {
                  hover.viewIds = [...hover.viewIds, session.viewId];
                }
                this.destroyFloat(session, { redockBroadcast: false });
                this.closeEmptySource(session);
                this.clearDragHover(session);
                const windowId = hoverId;
                this.drag = null;
                this.notifyPopOutsChanged();
                return { kind: 'attached', windowId };
              }
            }
          }
        }

        this.settleFloat(session);
        this.closeEmptySource(session);
        this.clearDragHover(session);
        const windowId = session.floatWindowId!;
        this.drag = null;
        return { kind: 'settled', windowId };
      },
    );

    ipcMain.handle(IPC.windowDragCancel, (event): void => {
      const session = this.drag;
      if (!session) return;
      const source = this.tryTracked(event.sender);
      if (!source || source.id !== session.sourceWindowId) return;
      this.cancelDragSession('cancelled');
    });

    ipcMain.on(IPC.windowDragAttachAck, (_event, ack: WindowDragAttachAck) => {
      if (!ack?.sessionId) return;
      const waiter = this.attachWaiters.get(ack.sessionId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.attachWaiters.delete(ack.sessionId);
      waiter.resolve(Boolean(ack.accepted));
    });

    ipcMain.handle(
      IPC.shellBusPublish,
      (event, message: { type: string; payload?: unknown }): void => {
        if (!message || typeof message.type !== 'string' || !message.type) {
          throw new Error('shell:bus:publish requires type');
        }
        const from = this.trackedFor(event.sender);
        const envelope: ShellBusEnvelope = {
          type: message.type,
          payload: message.payload,
          fromWindowId: from.id,
        };
        this.broadcast(IPC.shellBusMessage, envelope, from.win);
      },
    );
  }

  private spawnFloatForDrag(
    session: DragSession,
    screenX: number,
    screenY: number,
  ): void {
    const source = this.byId.get(session.sourceWindowId);
    if (!source || source.win.isDestroyed()) return;

    const tracked = this.createWindow({
      role: 'popout',
      viewIds: [session.viewId],
      width: FLOAT_W,
      height: FLOAT_H,
      title: APP_TITLE,
      x: Math.round(screenX - FLOAT_GRAB_X),
      y: Math.round(screenY - FLOAT_GRAB_Y),
      floating: true,
    });
    tracked.win.setIgnoreMouseEvents(true);
    tracked.win.setFocusable(false);
    session.floatWindowId = tracked.id;

    if (!session.detached) {
      session.detached = true;
      safeSend(source.win, IPC.windowDragDetach, {
        viewId: session.viewId,
        sessionId: session.sessionId,
      } satisfies WindowDragDetachEvent);
      this.removeViewFromTracked(source, session.viewId);
      // Do NOT close an empty source here — that would destroy pointer capture.
    }
  }

  private settleFloat(session: DragSession): void {
    if (!session.floatWindowId) return;
    const float = this.byId.get(session.floatWindowId);
    if (!float || float.win.isDestroyed()) return;
    float.floating = false;
    float.win.setIgnoreMouseEvents(false);
    float.win.setFocusable(true);
    float.win.setSkipTaskbar(false);
    this.notifyPopOutsChanged();
  }

  private destroyFloat(
    session: DragSession,
    _options: { redockBroadcast: boolean },
  ): void {
    if (!session.floatWindowId) return;
    const float = this.byId.get(session.floatWindowId);
    session.floatWindowId = null;
    if (!float) return;
    this.suppressRedock.add(float.id);
    this.forget(float);
    if (!float.win.isDestroyed()) {
      float.win.destroy();
    }
    this.notifyPopOutsChanged();
  }

  private cancelDragSession(_reason: 'cancelled'): void {
    const session = this.drag;
    if (!session) return;
    this.clearDragHover(session);
    const wasDetached = session.detached;
    const viewId = session.viewId;
    const sourceId = session.sourceWindowId;
    if (session.floatWindowId) {
      this.destroyFloat(session, { redockBroadcast: false });
    }
    this.drag = null;
    if (wasDetached) {
      const source = this.byId.get(sourceId);
      if (source && !source.win.isDestroyed()) {
        // Put the view back into the still-open source window.
        const bounds = this.contentBounds(source.win);
        const cx = bounds ? bounds.width / 2 : 10;
        const cy = bounds ? bounds.height / 2 : 10;
        void this.requestAttach(
          source,
          {
            sessionId: session.sessionId,
            viewId,
            title: session.title,
            sourceWindowId: sourceId,
            floatWindowId: null,
            hoverWindowId: null,
            lastScreenX: session.lastScreenX,
            lastScreenY: session.lastScreenY,
            detached: true,
          },
          cx,
          cy,
        ).then((accepted) => {
          if (accepted) {
            if (!source.viewIds.includes(viewId)) {
              source.viewIds = [...source.viewIds, viewId];
            }
          } else {
            this.broadcastRedock([viewId], sourceId);
          }
          this.closeEmptySourceById(sourceId);
          this.notifyPopOutsChanged();
        });
      } else {
        this.broadcastRedock([viewId], sourceId);
      }
    }
  }

  private closeEmptySource(session: DragSession): void {
    this.closeEmptySourceById(session.sourceWindowId);
  }

  private closeEmptySourceById(sourceWindowId: string): void {
    const source = this.byId.get(sourceWindowId);
    if (!source) return;
    this.closeIfEmptyPopOut(source);
  }

  private removeViewFromTracked(tracked: TrackedWindow, viewId: string): void {
    tracked.viewIds = tracked.viewIds.filter((id) => id !== viewId);
  }

  private closeIfEmptyPopOut(tracked: TrackedWindow): void {
    if (tracked.role !== 'popout' || tracked.floating) return;
    if (tracked.viewIds.length > 0) return;
    if (tracked.win.isDestroyed()) return;
    this.suppressRedock.add(tracked.id);
    tracked.win.close();
  }

  private updateDragHover(
    session: DragSession,
    screenX: number,
    screenY: number,
  ): void {
    const target = this.windowAtScreenPoint(screenX, screenY, session.floatWindowId);
    const nextId = target?.id ?? null;
    if (session.hoverWindowId && session.hoverWindowId !== nextId) {
      const prev = this.byId.get(session.hoverWindowId);
      if (prev) safeSend(prev.win, IPC.windowDragLeave, { sessionId: session.sessionId });
    }
    session.hoverWindowId = nextId;
    if (!target) return;
    const bounds = this.contentBounds(target.win);
    if (!bounds) return;
    safeSend(target.win, IPC.windowDragHover, {
      viewId: session.viewId,
      sessionId: session.sessionId,
      clientX: screenX - bounds.x,
      clientY: screenY - bounds.y,
    } satisfies WindowDragHoverEvent);
  }

  private clearDragHover(session: DragSession): void {
    if (session.hoverWindowId) {
      const prev = this.byId.get(session.hoverWindowId);
      if (prev) safeSend(prev.win, IPC.windowDragLeave, { sessionId: session.sessionId });
    }
    session.hoverWindowId = null;
  }

  private requestAttach(
    target: TrackedWindow,
    session: DragSession,
    clientX: number,
    clientY: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.attachWaiters.delete(session.sessionId);
        resolve(false);
      }, 250);
      this.attachWaiters.set(session.sessionId, { resolve, timer });
      safeSend(target.win, IPC.windowDragAttach, {
        viewId: session.viewId,
        sessionId: session.sessionId,
        clientX,
        clientY,
      } satisfies WindowDragAttachEvent);
    });
  }

  private windowAtScreenPoint(
    screenX: number,
    screenY: number,
    excludeId: string | null,
  ): TrackedWindow | null {
    // BrowserWindow.getAllWindows is typically front-to-back.
    for (const win of BrowserWindow.getAllWindows()) {
      const tracked = this.trackedByBrowserWindow(win);
      if (!tracked || tracked.id === excludeId || tracked.floating) continue;
      const bounds = this.contentBounds(win);
      if (!bounds) continue;
      if (
        screenX >= bounds.x &&
        screenY >= bounds.y &&
        screenX <= bounds.x + bounds.width &&
        screenY <= bounds.y + bounds.height
      ) {
        return tracked;
      }
    }
    return null;
  }

  private contentBounds(
    win: BrowserWindow,
  ): { x: number; y: number; width: number; height: number } | null {
    if (win.isDestroyed()) return null;
    try {
      const bounds = win.getContentBounds();
      return bounds;
    } catch {
      return null;
    }
  }

  private createWindow(options: {
    role: WindowRole;
    viewIds?: string[];
    width: number;
    height: number;
    title: string;
    x?: number;
    y?: number;
    floating?: boolean;
  }): TrackedWindow {
    const id = nextWindowId(options.role);
    const floating = Boolean(options.floating);
    const win = new BrowserWindow({
      width: options.width,
      height: options.height,
      x: options.x,
      y: options.y,
      minWidth: options.role === 'primary' ? 800 : 320,
      minHeight: options.role === 'primary' ? 600 : 240,
      title: options.title,
      show: false,
      skipTaskbar: floating,
      focusable: !floating,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const viewIds = options.viewIds ? [...options.viewIds] : [];
    const tracked: TrackedWindow = {
      id,
      role: options.role,
      viewIds,
      floating,
      win,
    };
    this.byId.set(id, tracked);
    this.byContents.set(win.webContents.id, id);
    if (options.role === 'primary') {
      this.primaryId = id;
    }

    const query: Record<string, string> = {
      role: options.role,
      windowId: id,
    };
    if (viewIds.length > 0) {
      query.viewIds = viewIds.join(',');
      query.viewId = viewIds[0]!;
    }
    // Do NOT put floating in the URL. The renderer must boot with full dock/drag
    // handlers; main-only `tracked.floating` drives ignoreMouseEvents during drag.

    void win.loadFile(htmlPath(), { query });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.setTitle(options.title);
        win.showInactive();
      }
    });

    if (options.role === 'popout') {
      const persistBounds = (): void => {
        if (!tracked.floating) this.notifyPopOutsChanged();
      };
      win.on('moved', persistBounds);
      win.on('resized', persistBounds);
    }

    win.on('closed', () => {
      this.handleWindowClosed(id);
    });

    return tracked;
  }

  private handleWindowClosed(id: string): void {
    const current = this.byId.get(id);
    if (!current) return;

    // Closing a floating drag window mid-session is handled by cancel/end.
    if (this.drag?.floatWindowId === id) {
      this.forget(current);
      return;
    }

    const viewIds = [...current.viewIds];
    const wasPopout = current.role === 'popout' && viewIds.length > 0;
    const skipRedock = this.suppressRedock.has(id);
    this.suppressRedock.delete(id);
    this.forget(current);
    if (current.role === 'primary') {
      this.primaryId = null;
    }

    if (current.role === 'popout') {
      this.notifyPopOutsChanged();
    }

    if (wasPopout && !skipRedock) {
      this.broadcastRedock(viewIds, id);
    }
  }

  private broadcastRedock(
    viewIds: readonly string[],
    closedWindowId: string,
  ): void {
    if (viewIds.length === 0) return;
    const evt: WindowClosedEvent = {
      windowId: closedWindowId,
      viewIds: [...viewIds],
      reason: 'redock',
    };
    const primary =
      this.primaryId != null ? this.byId.get(this.primaryId) : undefined;
    if (primary && !primary.win.isDestroyed()) {
      safeSend(primary.win, IPC.windowClosed, evt);
      return;
    }
    for (const tracked of this.byId.values()) {
      if (tracked.floating || tracked.win.isDestroyed()) continue;
      if (tracked.id === closedWindowId) continue;
      safeSend(tracked.win, IPC.windowClosed, evt);
      return;
    }
  }

  private forget(tracked: TrackedWindow): void {
    this.byId.delete(tracked.id);
    if (!tracked.win.isDestroyed()) {
      try {
        this.byContents.delete(tracked.win.webContents.id);
        return;
      } catch {
        // fall through
      }
    }
    for (const [cid, wid] of this.byContents) {
      if (wid === tracked.id) this.byContents.delete(cid);
    }
  }

  private findPopOutHosting(viewId: string): TrackedWindow | undefined {
    for (const tracked of this.byId.values()) {
      if (
        tracked.role === 'popout' &&
        !tracked.win.isDestroyed() &&
        tracked.viewIds.includes(viewId)
      ) {
        return tracked;
      }
    }
    return undefined;
  }

  private focusWindow(tracked: TrackedWindow): void {
    if (tracked.win.isDestroyed()) return;
    if (tracked.win.isMinimized()) tracked.win.restore();
    tracked.win.focus();
  }

  private trackedByBrowserWindow(win: BrowserWindow): TrackedWindow | null {
    if (win.isDestroyed()) return null;
    try {
      const id = this.byContents.get(win.webContents.id);
      return id ? this.byId.get(id) ?? null : null;
    } catch {
      return null;
    }
  }

  private tryTracked(contents: WebContents): TrackedWindow | null {
    try {
      return this.trackedFor(contents);
    } catch {
      return null;
    }
  }

  private trackedFor(contents: WebContents): TrackedWindow {
    const id = this.byContents.get(contents.id);
    if (!id) {
      throw new Error('Unknown window for IPC sender');
    }
    const tracked = this.byId.get(id);
    if (!tracked) {
      throw new Error(`Missing tracked window ${id}`);
    }
    return tracked;
  }

  private infoFor(contents: WebContents): WindowInfo {
    const tracked = this.trackedFor(contents);
    return {
      role: tracked.role,
      windowId: tracked.id,
      viewId: tracked.viewIds[0] ?? null,
      floating: tracked.floating,
    };
  }

  private broadcast(
    channel: string,
    payload: unknown,
    except?: BrowserWindow,
  ): void {
    for (const tracked of this.byId.values()) {
      if (except && tracked.win === except) continue;
      safeSend(tracked.win, channel, payload);
    }
  }
}
