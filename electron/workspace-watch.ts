import { BrowserWindow } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import { IPC } from '../src/bridge/channels';
import { DEFAULT_DIR_IGNORE } from '../src/fs/ignore';

/** Debounced workspace directory watcher → `fs:changed` IPC. */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watchedRoot: string | null = null;

  /** Start watching `root`, or stop when null. */
  setRoot(root: string | null): void {
    if (root === this.watchedRoot) return;
    this.stop();
    if (!root) return;

    this.watchedRoot = root;
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
      ignored: (watchPath: string) => pathHasIgnoredSegment(watchPath),
    });

    const bump = (): void => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.broadcast(root);
      }, 150);
    };

    this.watcher.on('all', bump);
    this.watcher.on('error', () => {
      // Non-fatal — explorer keeps last listing.
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    this.watchedRoot = null;
  }

  private broadcast(root: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.fsChanged, { root });
      } catch {
        // ignore torn-down windows
      }
    }
  }
}

function pathHasIgnoredSegment(watchPath: string): boolean {
  const parts = watchPath.split(/[/\\]+/);
  return parts.some((part) => DEFAULT_DIR_IGNORE.has(part));
}
