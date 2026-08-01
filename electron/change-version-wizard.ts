import { BrowserWindow, dialog } from 'electron';
import {
  pinProjectEngineVersion,
} from '../src/engine-cache';
import { detectProjectManifest } from '../src/project';
import { showChoicePrompt } from './choice-prompt';
import {
  ensureEngineVersionCached,
  listRemoteEngineVersions,
} from './engine-service';
import type { WorkspaceSession } from './workspace';

function parentWindow(
  win: BrowserWindow | undefined,
): BrowserWindow | undefined {
  return win ?? BrowserWindow.getFocusedWindow() ?? undefined;
}

/**
 * Change Engine Version wizard: pick release → pin manifest → ensure cache.
 */
export async function runChangeEngineVersionWizard(
  workspace: WorkspaceSession,
  win?: BrowserWindow,
): Promise<{ version: string } | null> {
  const root = workspace.getRoot();
  const browserWindow = parentWindow(win);
  if (!root) {
    if (browserWindow) {
      await dialog.showMessageBox(browserWindow, {
        type: 'info',
        buttons: ['OK'],
        title: 'No project open',
        message: 'Open or create a project before changing the engine version.',
      });
    }
    return null;
  }

  const manifest = await detectProjectManifest(root);
  if (!manifest) {
    if (browserWindow) {
      await dialog.showMessageBox(browserWindow, {
        type: 'warning',
        buttons: ['OK'],
        title: 'Not an Omosuen project',
        message: 'This folder has no omosuen.project.json.',
      });
    }
    return null;
  }

  const versions = await listRemoteEngineVersions();
  if (versions.length === 0) {
    if (browserWindow) {
      await dialog.showMessageBox(browserWindow, {
        type: 'error',
        buttons: ['OK'],
        title: 'No engine releases',
        message: 'Could not find any Omosuen engine releases.',
      });
    }
    return null;
  }

  const picked = await showChoicePrompt(browserWindow, {
    title: 'Change Engine Version',
    label: `Current: ${manifest.engineVersion}`,
    selected: manifest.engineVersion,
    okLabel: 'Change',
    options: versions.map((v) => ({
      value: v.tag,
      label:
        v.tag === manifest.engineVersion
          ? `${v.label} (current)`
          : v.prerelease
            ? `${v.label} (pre)`
            : v.label,
    })),
  });
  if (!picked) return null;
  if (picked === manifest.engineVersion) {
    await ensureEngineVersionCached(picked);
    return { version: picked };
  }

  await pinProjectEngineVersion(root, picked);
  await ensureEngineVersionCached(picked);
  // Re-broadcast so renderer refreshes status / explorers.
  workspace.setRoot(root);
  return { version: picked };
}
