import { BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { resolveWorkspacePath, toWorkspaceRelative } from '../src/fs/paths';
import type { WorkspaceSession } from './workspace';

function parentWindow(
  win: BrowserWindow | undefined,
): BrowserWindow | undefined {
  return win ?? BrowserWindow.getFocusedWindow() ?? undefined;
}

type FileFilter = { name: string; extensions: string[] };

async function openDialog(
  browserWindow: BrowserWindow | undefined,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  return browserWindow
    ? dialog.showOpenDialog(browserWindow, options)
    : dialog.showOpenDialog(options);
}

async function saveDialog(
  browserWindow: BrowserWindow | undefined,
  options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  return browserWindow
    ? dialog.showSaveDialog(browserWindow, options)
    : dialog.showSaveDialog(options);
}

export async function chooseWorkspaceFolder(
  workspace: WorkspaceSession,
  win?: BrowserWindow,
): Promise<string | null> {
  const browserWindow = parentWindow(win);
  const result = await openDialog(browserWindow, {
    title: 'Open Folder',
    properties: ['openDirectory'],
    defaultPath: workspace.getRoot() ?? undefined,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  workspace.setRoot(result.filePaths[0]!);
  return workspace.getRoot();
}

export async function chooseOpenFile(
  workspace: WorkspaceSession,
  win?: BrowserWindow,
  filters?: FileFilter[],
): Promise<string | null> {
  const root = workspace.requireRoot();
  const browserWindow = parentWindow(win);
  const result = await openDialog(browserWindow, {
    title: 'Open File',
    properties: ['openFile'],
    defaultPath: root,
    filters,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  const absolute = resolveWorkspacePath(root, result.filePaths[0]!);
  return toWorkspaceRelative(root, absolute);
}

export async function chooseSaveFile(
  workspace: WorkspaceSession,
  win?: BrowserWindow,
  defaultName?: string,
  filters?: FileFilter[],
): Promise<string | null> {
  const root = workspace.requireRoot();
  const browserWindow = parentWindow(win);
  const result = await saveDialog(browserWindow, {
    title: 'Save File',
    defaultPath: defaultName ? path.join(root, defaultName) : root,
    filters,
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  const absolute = resolveWorkspacePath(root, result.filePath);
  return toWorkspaceRelative(root, absolute);
}
