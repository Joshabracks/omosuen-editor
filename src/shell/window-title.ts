/** Native BrowserWindow title helpers (no Electron import). */

export const APP_TITLE = 'Omosuen Editor';

export function formatPrimaryWindowTitle(workspaceRoot: string | null): string {
  return workspaceRoot ? `${APP_TITLE} — ${workspaceRoot}` : APP_TITLE;
}
