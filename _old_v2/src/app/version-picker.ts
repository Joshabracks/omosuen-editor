/**
 * VS Code QuickPick wrapper for engine version selection (Phase 10.1).
 *
 * Split from [github-releases.ts](./github-releases.ts) so the pure
 * listing module can be tsx-tested without `vscode` being resolvable.
 * Production call sites (the new-project command, future
 * change-version command) import from here.
 */

import * as vscode from 'vscode';
import { listOmosuenReleases, type ReleaseOption } from './github-releases.js';

/**
 * Show a QuickPick of available engine versions. Resolves with the
 * selected tag or `null` if the user cancelled. Fetch errors surface
 * through `showErrorMessage` and return `null`.
 */
export async function pickEngineVersion(): Promise<string | null> {
  let releases: ReleaseOption[];
  try {
    releases = await listOmosuenReleases();
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Omosuen: could not fetch engine releases — ${describe(err)}`,
    );
    return null;
  }
  if (releases.length === 0) {
    void vscode.window.showErrorMessage(
      'Omosuen: no published engine releases found on GitHub.',
    );
    return null;
  }
  const items = releases.map((r) => ({
    label: r.tag,
    description: r.prerelease ? 'pre-release' : '',
    detail: buildDetail(r),
    tag: r.tag,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select engine version',
    placeHolder: 'Latest releases are listed first.',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.tag ?? null;
}

function buildDetail(r: ReleaseOption): string {
  const parts: string[] = [];
  if (r.name !== null && r.name !== '' && r.name !== r.tag) parts.push(r.name);
  if (r.publishedAt !== null) {
    const iso = r.publishedAt.slice(0, 10);
    parts.push(`published ${iso}`);
  }
  return parts.join(' · ');
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
