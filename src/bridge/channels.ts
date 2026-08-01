/** Shared IPC channel names (main ↔ preload ↔ renderer). */
export const IPC = {
  ping: 'app:ping',
  menuCommand: 'menu:command',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  workspaceGet: 'workspace:get',
  workspaceChanged: 'workspace:changed',
  dialogOpenFolder: 'dialog:openFolder',
  dialogOpenFile: 'dialog:openFile',
  dialogSaveFile: 'dialog:saveFile',
  fsList: 'fs:list',
  fsReadText: 'fs:readText',
  fsWriteText: 'fs:writeText',
  fsReveal: 'fs:reveal',
  fsChanged: 'fs:changed',
  windowGetInfo: 'window:getInfo',
  windowPopOut: 'window:popOut',
  windowClosed: 'window:closed',
  windowDragStart: 'window:dragStart',
  windowDragMove: 'window:dragMove',
  windowDragEnd: 'window:dragEnd',
  windowDragCancel: 'window:dragCancel',
  windowDragDetach: 'window:dragDetach',
  windowDragHover: 'window:dragHover',
  windowDragLeave: 'window:dragLeave',
  windowDragAttach: 'window:dragAttach',
  windowDragAttachAck: 'window:dragAttachAck',
  windowCloseAllPopouts: 'window:closeAllPopouts',
  windowSyncViews: 'window:syncViews',
  windowReturnView: 'window:returnView',
  shellBusPublish: 'shell:bus:publish',
  shellBusMessage: 'shell:bus:message',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export const MENU_COMMANDS = [
  'file.newProject',
  'file.openFolder',
  'file.save',
  'view.resetLayout',
  'help.about',
] as const;

export type MenuCommandId = (typeof MENU_COMMANDS)[number];

export type WindowRole = 'primary' | 'popout';

export interface WindowInfo {
  readonly role: WindowRole;
  readonly windowId: string;
  readonly viewId: string | null;
  readonly floating: boolean;
}

export interface PopOutRequest {
  readonly viewId: string;
  readonly title?: string;
  readonly screenX?: number;
  readonly screenY?: number;
}

export interface PopOutResult {
  readonly windowId: string;
  readonly created: boolean;
}

export interface WindowClosedEvent {
  readonly windowId: string;
  /** Views that should be restored into another shell window. */
  readonly viewIds: readonly string[];
  /** Always redock into another shell window — views are not discarded. */
  readonly reason: 'redock';
}

export interface WindowSyncViewsRequest {
  readonly viewIds: readonly string[];
}

export interface WindowReturnViewRequest {
  readonly viewId: string;
}

export interface WindowDragStartRequest {
  readonly viewId: string;
  readonly title?: string;
  readonly screenX: number;
  readonly screenY: number;
}

export interface WindowDragMoveRequest {
  readonly screenX: number;
  readonly screenY: number;
}

export interface WindowDragEndRequest {
  readonly screenX: number;
  readonly screenY: number;
}

export type WindowDragEndResult =
  | { readonly kind: 'local' }
  | { readonly kind: 'settled'; readonly windowId: string }
  | { readonly kind: 'attached'; readonly windowId: string }
  | { readonly kind: 'cancelled' };

export interface WindowDragDetachEvent {
  readonly viewId: string;
  readonly sessionId: string;
}

export interface WindowDragHoverEvent {
  readonly viewId: string;
  readonly sessionId: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface WindowDragAttachEvent {
  readonly viewId: string;
  readonly sessionId: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface WindowDragAttachAck {
  readonly sessionId: string;
  readonly viewId: string;
  readonly accepted: boolean;
}

export interface ShellBusEnvelope {
  readonly type: string;
  readonly payload?: unknown;
  readonly fromWindowId: string;
}

export interface FileFilter {
  readonly name: string;
  readonly extensions: string[];
}

export interface DirEntryDto {
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly relativePath: string;
}

export interface FsChangedEvent {
  readonly root: string;
}

export function isIpcChannel(value: string): value is IpcChannel {
  return (Object.values(IPC) as string[]).includes(value);
}

export function isMenuCommandId(value: string): value is MenuCommandId {
  return (MENU_COMMANDS as readonly string[]).includes(value);
}
