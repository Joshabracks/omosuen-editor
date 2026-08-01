import path from 'node:path';
import { BrowserWindow } from 'electron';
import { IPC } from '../src/bridge/channels';

export class WorkspaceSession {
  private root: string | null = null;
  private onRootChanged: ((root: string | null) => void) | null = null;

  getRoot(): string | null {
    return this.root;
  }

  setRoot(next: string | null): void {
    this.root = next ? path.resolve(next) : null;
    this.broadcast();
    this.onRootChanged?.(this.root);
  }

  /** Invoked after every successful root change (including clear). */
  setRootChangedListener(listener: ((root: string | null) => void) | null): void {
    this.onRootChanged = listener;
  }

  requireRoot(): string {
    if (!this.root) {
      throw new Error('No workspace is open');
    }
    return this.root;
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.workspaceChanged, this.root);
      } catch {
        // ignore torn-down windows
      }
    }
  }
}
