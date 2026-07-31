import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../src/bridge/channels';
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
