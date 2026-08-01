import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

let choiceSeq = 0;

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

export interface ChoicePromptOptions {
  readonly title: string;
  readonly label: string;
  readonly options: readonly ChoiceOption[];
  readonly selected?: string;
  readonly okLabel?: string;
}

/**
 * Modal single-select prompt (for engine version picker, etc.).
 */
export function showChoicePrompt(
  parent: BrowserWindow | undefined,
  options: ChoicePromptOptions,
): Promise<string | null> {
  choiceSeq += 1;
  const channel = `choice:result:${choiceSeq}`;
  const okLabel = options.okLabel ?? 'OK';

  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      width: 440,
      height: 320,
      resizable: true,
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
      if (typeof value !== 'string' || !value) {
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
      .loadFile(path.join(__dirname, 'choice.html'), {
        query: {
          channel,
          title: options.title,
          label: options.label,
          okLabel,
          selected: options.selected ?? '',
          options: JSON.stringify(
            options.options.map((o) => ({
              value: o.value,
              label: o.label,
            })),
          ),
        },
      })
      .then(() => {
        if (!promptWin.isDestroyed()) {
          promptWin.show();
        }
      });
  });
}
