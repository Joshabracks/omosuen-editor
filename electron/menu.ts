import {
  BrowserWindow,
  Menu,
  type BaseWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import { IPC, type MenuCommandId } from '../src/bridge/channels';

export interface AppMenuHandlers {
  openFolder: (win?: BrowserWindow) => void | Promise<void>;
}

function asBrowserWindow(
  win: BaseWindow | BrowserWindow | undefined,
): BrowserWindow | undefined {
  if (!win) return undefined;
  if (win instanceof BrowserWindow) return win;
  return undefined;
}

function sendMenuCommand(
  browserWindow: BaseWindow | BrowserWindow | undefined,
  command: MenuCommandId,
): void {
  const win =
    asBrowserWindow(browserWindow) ??
    BrowserWindow.getFocusedWindow() ??
    undefined;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(IPC.menuCommand, command);
  } catch {
    // ignore torn-down windows
  }
}

export function installAppMenu(handlers: AppMenuHandlers): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Omosuen Editor',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: (_item, browserWindow) => {
            sendMenuCommand(browserWindow, 'file.newProject');
          },
        },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: (_item, browserWindow) => {
            void handlers.openFolder(asBrowserWindow(browserWindow));
          },
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (_item, browserWindow) => {
            sendMenuCommand(browserWindow, 'file.save');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reset Layout',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_item, browserWindow) => {
            sendMenuCommand(browserWindow, 'view.resetLayout');
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Omosuen Editor',
          click: (_item, browserWindow) => {
            sendMenuCommand(browserWindow, 'help.about');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
