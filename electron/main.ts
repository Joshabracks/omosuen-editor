import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import { IPC } from '../src/bridge/channels';
import {
  SHELL_POPOUTS_KEY,
  SHELL_WORKSPACE_ROOT_KEY,
  readPersistedPopOuts,
  readPersistedWorkspaceRoot,
} from '../src/dock/persist';
import { chooseWorkspaceFolder } from './dialogs';
import { registerWorkspaceIpc } from './fs-ipc';
import { installAppMenu } from './menu';
import { SettingsStore } from './settings-store';
import {
  WindowManager,
  formatPrimaryWindowTitle,
} from './windows';
import { WorkspaceSession } from './workspace';
import { WorkspaceWatcher } from './workspace-watch';

app.whenReady().then(async () => {
  const settings = new SettingsStore();
  await settings.load();

  const workspace = new WorkspaceSession();
  const watcher = new WorkspaceWatcher();
  const windows = new WindowManager();

  const applyWorkspaceSideEffects = (root: string | null): void => {
    void settings.set(SHELL_WORKSPACE_ROOT_KEY, root).catch(() => {
      // non-fatal
    });
    watcher.setRoot(root);
    windows.setPrimaryTitle(formatPrimaryWindowTitle(root));
  };

  workspace.setRootChangedListener(applyWorkspaceSideEffects);
  registerWorkspaceIpc(workspace);

  windows.setPopOutsChangedListener(() => {
    void settings.set(SHELL_POPOUTS_KEY, windows.snapshotPopOuts());
  });
  windows.registerIpc();

  ipcMain.handle(IPC.ping, () => 'pong');
  ipcMain.handle(IPC.settingsGet, async (_event, key: string) => {
    if (typeof key !== 'string' || !key) {
      throw new Error('settings:get requires a non-empty string key');
    }
    return settings.get(key);
  });
  ipcMain.handle(
    IPC.settingsSet,
    async (_event, key: string, value: unknown) => {
      if (typeof key !== 'string' || !key) {
        throw new Error('settings:set requires a non-empty string key');
      }
      return settings.set(key, value);
    },
  );

  installAppMenu({
    openFolder: async (win) => {
      await chooseWorkspaceFolder(workspace, win);
    },
  });

  await restoreLastWorkspace(settings, workspace);

  windows.createPrimary(formatPrimaryWindowTitle(workspace.getRoot()));

  const savedPopOuts = readPersistedPopOuts(await settings.get(SHELL_POPOUTS_KEY));
  if (savedPopOuts.length > 0) {
    // Defer until primary has registered IPC handlers in its renderer.
    setTimeout(() => {
      windows.restorePopOuts(savedPopOuts);
    }, 400);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windows.createPrimary(formatPrimaryWindowTitle(workspace.getRoot()));
    }
  });

  app.on('before-quit', () => {
    watcher.stop();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function restoreLastWorkspace(
  settings: SettingsStore,
  workspace: WorkspaceSession,
): Promise<void> {
  const saved = readPersistedWorkspaceRoot(
    await settings.get(SHELL_WORKSPACE_ROOT_KEY),
  );
  if (!saved) return;

  try {
    const st = await fs.stat(saved);
    if (!st.isDirectory()) {
      await settings.set(SHELL_WORKSPACE_ROOT_KEY, null);
      return;
    }
  } catch {
    await settings.set(SHELL_WORKSPACE_ROOT_KEY, null);
    return;
  }

  // setRoot before primary window exists — renderer picks this up via getWorkspaceRoot.
  workspace.setRoot(saved);
}
