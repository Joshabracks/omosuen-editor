import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC,
  type DirEntryDto,
  type FileFilter,
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
} from '../src/bridge/channels';

contextBridge.exposeInMainWorld('omosuen', {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.ping),

  getSetting: (key: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.settingsGet, key),

  setSetting: (key: string, value: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC.settingsSet, key, value),

  getWorkspaceRoot: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.workspaceGet),

  openFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialogOpenFolder),

  openFile: (filters?: FileFilter[]): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialogOpenFile, filters),

  saveFile: (
    defaultName?: string,
    filters?: FileFilter[],
  ): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialogSaveFile, defaultName, filters),

  listDir: (relativePath?: string): Promise<DirEntryDto[]> =>
    ipcRenderer.invoke(IPC.fsList, relativePath),

  readTextFile: (relativePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fsReadText, relativePath),

  writeTextFile: (relativePath: string, contents: string): Promise<string> =>
    ipcRenderer.invoke(IPC.fsWriteText, relativePath, contents),

  getWindowInfo: (): Promise<WindowInfo> =>
    ipcRenderer.invoke(IPC.windowGetInfo),

  popOutView: (request: PopOutRequest): Promise<PopOutResult> =>
    ipcRenderer.invoke(IPC.windowPopOut, request),

  dragStart: (
    request: WindowDragStartRequest,
  ): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke(IPC.windowDragStart, request),

  dragMove: (request: WindowDragMoveRequest): Promise<void> =>
    ipcRenderer.invoke(IPC.windowDragMove, request),

  dragEnd: (request: WindowDragEndRequest): Promise<WindowDragEndResult> =>
    ipcRenderer.invoke(IPC.windowDragEnd, request),

  dragCancel: (): Promise<void> => ipcRenderer.invoke(IPC.windowDragCancel),

  ackDragAttach: (ack: WindowDragAttachAck): void => {
    ipcRenderer.send(IPC.windowDragAttachAck, ack);
  },

  publishShellBus: (message: {
    type: string;
    payload?: unknown;
  }): Promise<void> => ipcRenderer.invoke(IPC.shellBusPublish, message),

  onWorkspaceChanged: (
    callback: (root: string | null) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      root: string | null,
    ): void => {
      callback(root);
    };
    ipcRenderer.on(IPC.workspaceChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.workspaceChanged, listener);
    };
  },

  onMenuCommand: (callback: (command: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, command: string): void => {
      callback(command);
    };
    ipcRenderer.on(IPC.menuCommand, listener);
    return () => {
      ipcRenderer.removeListener(IPC.menuCommand, listener);
    };
  },

  onWindowClosed: (
    callback: (event: WindowClosedEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: WindowClosedEvent,
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC.windowClosed, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowClosed, listener);
    };
  },

  onShellBus: (callback: (message: ShellBusEnvelope) => void): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      message: ShellBusEnvelope,
    ): void => {
      callback(message);
    };
    ipcRenderer.on(IPC.shellBusMessage, listener);
    return () => {
      ipcRenderer.removeListener(IPC.shellBusMessage, listener);
    };
  },

  onDragDetach: (
    callback: (event: WindowDragDetachEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: WindowDragDetachEvent,
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC.windowDragDetach, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowDragDetach, listener);
    };
  },

  onDragHover: (
    callback: (event: WindowDragHoverEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: WindowDragHoverEvent,
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC.windowDragHover, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowDragHover, listener);
    };
  },

  onDragLeave: (
    callback: (event: { sessionId: string }) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { sessionId: string },
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC.windowDragLeave, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowDragLeave, listener);
    };
  },

  onDragAttach: (
    callback: (event: WindowDragAttachEvent) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: WindowDragAttachEvent,
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC.windowDragAttach, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowDragAttach, listener);
    };
  },
});
