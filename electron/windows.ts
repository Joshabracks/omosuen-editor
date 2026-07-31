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

interface TrackedWindow {
  id: string;
  role: WindowRole;
  viewId: string | null;
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
  private attachWaiters = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  createPrimary(): BrowserWindow {
    return this.createWindow({
      role: 'primary',
      width: 1280,
      height: 800,
      title: 'Omosuen Editor',
    }).win;
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

        const existing = this.findPopOutByView(request.viewId);
        if (existing && !existing.floating) {
          this.focusWindow(existing);
          return { windowId: existing.id, created: false };
        }

        const title =
          typeof request.title === 'string' && request.title
            ? request.title
            : request.viewId;
        const point = screen.getCursorScreenPoint();
        const screenX =
          typeof request.screenX === 'number' ? request.screenX : point.x;
        const screenY =
          typeof request.screenY === 'number' ? request.screenY : point.y;

        const tracked = this.createWindow({
          role: 'popout',
          viewId: request.viewId,
          width: FLOAT_W,
          height: FLOAT_H,
          title: `${title} — Omosuen`,
          x: Math.round(screenX - FLOAT_GRAB_X),
          y: Math.round(screenY - FLOAT_GRAB_Y),
        });
        safeSend(source.win, IPC.windowDragDetach, {
          viewId: request.viewId,
          sessionId: `pop-${tracked.id}`,
        } satisfies WindowDragDetachEvent);
        return { windowId: tracked.id, created: true };
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
        const outside =
          !sourceBounds ||
          request.screenX < sourceBounds.x ||
          request.screenY < sourceBounds.y ||
          request.screenX > sourceBounds.x + sourceBounds.width ||
          request.screenY > sourceBounds.y + sourceBounds.height;

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
        if (!session) return { kind: 'cancelled' };
        const source = this.trackedFor(event.sender);
        if (source.id !== session.sourceWindowId) return { kind: 'cancelled' };

        const screenX = request?.screenX ?? session.lastScreenX;
        const screenY = request?.screenY ?? session.lastScreenY;
        this.updateDragHover(session, screenX, screenY);

        if (!session.floatWindowId) {
          this.clearDragHover(session);
          this.drag = null;
          return { kind: 'local' };
        }

        const hoverId = session.hoverWindowId;
        if (hoverId) {
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
                this.destroyFloat(session, { redockBroadcast: false });
                this.clearDragHover(session);
                const windowId = hoverId;
                this.drag = null;
                return { kind: 'attached', windowId };
              }
            }
          }
        }

        this.settleFloat(session);
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
    const tracked = this.createWindow({
      role: 'popout',
      viewId: session.viewId,
      width: FLOAT_W,
      height: FLOAT_H,
      title: `${session.title} — Omosuen`,
      x: Math.round(screenX - FLOAT_GRAB_X),
      y: Math.round(screenY - FLOAT_GRAB_Y),
      floating: true,
    });
    tracked.win.setIgnoreMouseEvents(true);
    tracked.win.setFocusable(false);
    session.floatWindowId = tracked.id;

    if (!session.detached) {
      session.detached = true;
      const source = this.byId.get(session.sourceWindowId);
      if (source) {
        safeSend(source.win, IPC.windowDragDetach, {
          viewId: session.viewId,
          sessionId: session.sessionId,
        } satisfies WindowDragDetachEvent);
      }
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
  }

  private destroyFloat(
    session: DragSession,
    options: { redockBroadcast: boolean },
  ): void {
    if (!session.floatWindowId) return;
    const float = this.byId.get(session.floatWindowId);
    session.floatWindowId = null;
    if (!float) return;
    this.forget(float);
    if (!float.win.isDestroyed()) {
      float.win.destroy();
    }
    if (options.redockBroadcast && float.viewId) {
      // Caller handles attach; no broadcast.
    }
  }

  private cancelDragSession(_reason: 'cancelled'): void {
    const session = this.drag;
    if (!session) return;
    this.clearDragHover(session);
    const wasDetached = session.detached;
    const viewId = session.viewId;
    if (session.floatWindowId) {
      this.destroyFloat(session, { redockBroadcast: false });
    }
    this.drag = null;
    if (wasDetached) {
      this.broadcastRedock(viewId, session.sourceWindowId);
    }
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
    viewId?: string;
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

    const viewId = options.viewId ?? null;
    const tracked: TrackedWindow = {
      id,
      role: options.role,
      viewId,
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
    if (viewId) query.viewId = viewId;
    if (floating) query.floating = '1';

    void win.loadFile(htmlPath(), { query });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive();
    });

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

    const viewId = current.viewId;
    const wasPopout = current.role === 'popout' && viewId;
    this.forget(current);
    if (current.role === 'primary') {
      this.primaryId = null;
    }

    // Preserve the view: redock into primary (or any remaining shell window).
    if (wasPopout && viewId) {
      this.broadcastRedock(viewId, id);
    }
  }

  private broadcastRedock(viewId: string, closedWindowId: string): void {
    const evt: WindowClosedEvent = {
      windowId: closedWindowId,
      viewId,
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

  private findPopOutByView(viewId: string): TrackedWindow | undefined {
    for (const tracked of this.byId.values()) {
      if (
        tracked.role === 'popout' &&
        tracked.viewId === viewId &&
        !tracked.win.isDestroyed()
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
      viewId: tracked.viewId,
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
