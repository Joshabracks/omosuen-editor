import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

let promptSeq = 0;

export interface TextPromptOptions {
  readonly title: string;
  readonly label: string;
  readonly defaultValue?: string;
  readonly okLabel?: string;
}

/**
 * Modal text prompt (sandboxed app renderers cannot use `window.prompt`).
 */
export function showTextPrompt(
  parent: BrowserWindow | undefined,
  options: TextPromptOptions,
): Promise<string | null> {
  promptSeq += 1;
  const channel = `prompt:result:${promptSeq}`;
  const defaultValue = options.defaultValue ?? '';
  const okLabel = options.okLabel ?? 'OK';

  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      width: 420,
      height: 180,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: options.title,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: Boolean(parent && !parent.isDestroyed()),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'prompt-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      try {
        ipcMain.removeHandler(channel);
      } catch {
        // already removed
      }
      if (!promptWin.isDestroyed()) {
        promptWin.destroy();
      }
      resolve(value);
    };

    ipcMain.handle(channel, (_event, value: unknown) => {
      if (value === null || value === undefined) {
        finish(null);
        return null;
      }
      if (typeof value !== 'string') {
        finish(null);
        return null;
      }
      finish(value);
      return null;
    });

    promptWin.on('closed', () => {
      finish(null);
    });

    void promptWin
      .loadFile(path.join(__dirname, 'prompt.html'), {
        query: {
          channel,
          title: options.title,
          label: options.label,
          defaultValue,
          okLabel,
        },
      })
      .then(() => {
        if (!promptWin.isDestroyed()) {
          promptWin.show();
        }
      });
  });
}
