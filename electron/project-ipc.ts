import { ipcMain, type IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { IPC } from '../src/bridge/channels';
import { detectProjectManifest } from '../src/project';
import { runChangeEngineVersionWizard } from './change-version-wizard';
import {
  defaultRemoteEngineVersion,
  ensureEngineVersionCached,
  listRemoteEngineVersions,
  resolveCachedEngineVersion,
} from './engine-service';
import {
  runCreateProjectWizard,
  type CreateProjectRequest,
} from './project-wizard';
import type { WorkspaceSession } from './workspace';

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

export function registerProjectIpc(workspace: WorkspaceSession): void {
  ipcMain.handle(IPC.projectListEngineVersions, async () =>
    listRemoteEngineVersions(),
  );

  ipcMain.handle(IPC.projectGetManifest, async () => {
    const root = workspace.getRoot();
    if (!root) return null;
    try {
      return await detectProjectManifest(root);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read project manifest: ${message}`);
    }
  });

  ipcMain.handle(
    IPC.projectCreate,
    async (event, request: unknown) => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('project:create requires { name, engineVersion? }');
      }
      const row = request as Record<string, unknown>;
      if (typeof row.name !== 'string') {
        throw new Error('project:create requires string name');
      }
      const payload: CreateProjectRequest = {
        name: row.name,
        engineVersion:
          typeof row.engineVersion === 'string'
            ? row.engineVersion
            : undefined,
      };
      return runCreateProjectWizard(
        workspace,
        payload,
        windowFromEvent(event),
      );
    },
  );

  ipcMain.handle(IPC.projectChangeEngineVersion, async (event) =>
    runChangeEngineVersionWizard(workspace, windowFromEvent(event)),
  );

  ipcMain.handle(IPC.engineEnsure, async (_event, version: unknown) => {
    const tag =
      typeof version === 'string' && version.trim()
        ? version.trim()
        : await defaultRemoteEngineVersion();
    return ensureEngineVersionCached(tag);
  });

  ipcMain.handle(IPC.engineResolve, async (_event, version: unknown) => {
    if (typeof version !== 'string' || !version.trim()) {
      throw new Error('engine:resolve requires a version string');
    }
    return resolveCachedEngineVersion(version.trim());
  });

  ipcMain.handle(IPC.engineReadUmd, async (_event, version: unknown) => {
    if (typeof version !== 'string' || !version.trim()) {
      throw new Error('engine:readUmd requires a version string');
    }
    const resolved = await resolveCachedEngineVersion(version.trim());
    const fs = await import('node:fs/promises');
    return fs.readFile(resolved.umdPath, 'utf8');
  });
}
