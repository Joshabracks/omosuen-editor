import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../src/bridge/channels';
import {
  SHELL_POPOUTS_KEY,
  readPersistedPopOuts,
} from '../src/dock/persist';
import { chooseWorkspaceFolder } from './dialogs';
import { registerWorkspaceIpc } from './fs-ipc';
import { installAppMenu } from './menu';
import { SettingsStore } from './settings-store';
import { WindowManager } from './windows';
import { WorkspaceSession } from './workspace';

app.whenReady().then(async () => {
  const settings = new SettingsStore();
  await settings.load();

  const workspace = new WorkspaceSession();
  registerWorkspaceIpc(workspace);

  const windows = new WindowManager();
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

  windows.createPrimary();

  const savedPopOuts = readPersistedPopOuts(await settings.get(SHELL_POPOUTS_KEY));
  if (savedPopOuts.length > 0) {
    // Defer until primary has registered IPC handlers in its renderer.
    setTimeout(() => {
      windows.restorePopOuts(savedPopOuts);
    }, 400);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windows.createPrimary();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
