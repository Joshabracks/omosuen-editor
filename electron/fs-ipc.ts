import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { IPC } from '../src/bridge/channels';
import { atomicWriteFile } from '../src/fs/atomic-write';
import { listDirectory } from '../src/fs/list-dir';
import { resolveWorkspacePath, toWorkspaceRelative } from '../src/fs/paths';
import {
  chooseOpenFile,
  chooseSaveFile,
  chooseWorkspaceFolder,
} from './dialogs';
import type { WorkspaceSession } from './workspace';

const MAX_TEXT_BYTES = 10 * 1024 * 1024;

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function registerWorkspaceIpc(workspace: WorkspaceSession): void {
  ipcMain.handle(IPC.workspaceGet, () => workspace.getRoot());

  ipcMain.handle(IPC.dialogOpenFolder, async (event) => {
    return chooseWorkspaceFolder(workspace, windowFromEvent(event));
  });

  ipcMain.handle(IPC.dialogOpenFile, async (event, filters) => {
    return chooseOpenFile(
      workspace,
      windowFromEvent(event),
      Array.isArray(filters) ? filters : undefined,
    );
  });

  ipcMain.handle(
    IPC.dialogSaveFile,
    async (event, defaultName?: unknown, filters?: unknown) => {
      return chooseSaveFile(
        workspace,
        windowFromEvent(event),
        typeof defaultName === 'string' ? defaultName : undefined,
        Array.isArray(filters) ? filters : undefined,
      );
    },
  );

  ipcMain.handle(IPC.fsList, async (_event, relativeDir?: unknown) => {
    const root = workspace.requireRoot();
    const rel =
      relativeDir === undefined || relativeDir === null || relativeDir === ''
        ? '.'
        : requireString(relativeDir, 'directory path');
    const absolute = resolveWorkspacePath(root, rel);
    const st = await fs.stat(absolute);
    if (!st.isDirectory()) {
      throw new Error('Not a directory');
    }
    const entries = await listDirectory(absolute);
    return entries.map((entry) => ({
      ...entry,
      relativePath:
        rel === '.'
          ? entry.name
          : path.join(toWorkspaceRelative(root, absolute), entry.name),
    }));
  });

  ipcMain.handle(IPC.fsReadText, async (_event, relativePath: unknown) => {
    const root = workspace.requireRoot();
    const abs = resolveWorkspacePath(root, requireString(relativePath, 'path'));
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      throw new Error('Not a file');
    }
    if (st.size > MAX_TEXT_BYTES) {
      throw new Error(`File exceeds ${MAX_TEXT_BYTES} byte text limit`);
    }
    return fs.readFile(abs, 'utf8');
  });

  ipcMain.handle(
    IPC.fsWriteText,
    async (_event, relativePath: unknown, contents: unknown) => {
      const root = workspace.requireRoot();
      const abs = resolveWorkspacePath(
        root,
        requireString(relativePath, 'path'),
      );
      if (typeof contents !== 'string') {
        throw new Error('contents must be a string');
      }
      if (Buffer.byteLength(contents, 'utf8') > MAX_TEXT_BYTES) {
        throw new Error(`Contents exceed ${MAX_TEXT_BYTES} byte text limit`);
      }
      await atomicWriteFile(abs, contents);
      return toWorkspaceRelative(root, abs);
    },
  );
}
