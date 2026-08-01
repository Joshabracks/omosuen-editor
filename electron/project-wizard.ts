import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  defaultEngineVersion,
  scaffoldProject,
  slugify,
  type ScaffoldProjectResult,
} from '../src/project';
import { ensureEngineVersionCached } from './engine-service';
import type { WorkspaceSession } from './workspace';

function parentWindow(
  win: BrowserWindow | undefined,
): BrowserWindow | undefined {
  return win ?? BrowserWindow.getFocusedWindow() ?? undefined;
}

export interface CreateProjectRequest {
  readonly name: string;
  readonly engineVersion?: string;
}

/**
 * New Project wizard (main process):
 * parent folder dialog → scaffold → cache engine → open as workspace.
 */
export async function runCreateProjectWizard(
  workspace: WorkspaceSession,
  request: CreateProjectRequest,
  win?: BrowserWindow,
): Promise<ScaffoldProjectResult | null> {
  const name = request.name.trim();
  if (!name) {
    throw new Error('Project name is required');
  }
  const engineVersion = (request.engineVersion ?? defaultEngineVersion()).trim();
  if (!engineVersion) {
    throw new Error('Engine version is required');
  }

  const browserWindow = parentWindow(win);
  const parentResult = browserWindow
    ? await dialog.showOpenDialog(browserWindow, {
        title: 'Choose parent folder for new project',
        properties: ['openDirectory', 'createDirectory'],
      })
    : await dialog.showOpenDialog({
        title: 'Choose parent folder for new project',
        properties: ['openDirectory', 'createDirectory'],
      });

  if (parentResult.canceled || parentResult.filePaths.length === 0) {
    return null;
  }

  const parentDir = parentResult.filePaths[0]!;
  const projectDir = path.join(parentDir, slugify(name));

  try {
    await fs.stat(projectDir);
    if (browserWindow) {
      await dialog.showMessageBox(browserWindow, {
        type: 'error',
        buttons: ['OK'],
        title: 'Folder exists',
        message: `A folder already exists at:\n${projectDir}`,
        detail: 'Choose a different project name or parent folder.',
      });
    }
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  const result = await scaffoldProject({
    projectDir,
    name,
    engineVersion,
  });
  await ensureEngineVersionCached(engineVersion);
  workspace.setRoot(result.projectDir);
  return result;
}
