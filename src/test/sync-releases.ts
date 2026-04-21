/**
 * Sync local Omosuen engine UMD bundles with the GitHub release tags.
 *
 * Behavior:
 *   - Fetches https://api.github.com/repos/Joshabracks/omosuen/releases.
 *   - Removes any local release file whose tag no longer exists on GitHub.
 *     During pre-alpha the engine yanks older releases on breaking changes;
 *     local copies of yanked versions are not kept.
 *   - Downloads `omosuen.min.js` for any remote release tag that isn't
 *     already present locally.
 *
 * Local files live at `./src/test/local_releases/omosuen-<tag>.min.js`.
 * Run directly: `npx tsx src/test/sync-releases.ts`.
 */

import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWNER = 'Joshabracks';
const REPO = 'omosuen';
const ASSET_NAME = 'omosuen.min.js';
const USER_AGENT = 'omosuen-editor-test-sync';

const THIS_FILE = fileURLToPath(import.meta.url);
const LOCAL_RELEASES_DIR = join(dirname(THIS_FILE), 'local_releases');

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

function localFileNameFor(tag: string): string {
  return `omosuen-${tag}.min.js`;
}

async function listRemoteReleases(): Promise<GitHubRelease[]> {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub releases API returned ${response.status} ${response.statusText} for ${url}`,
    );
  }
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error('Expected GitHub releases API to return an array.');
  }
  return body as GitHubRelease[];
}

async function listLocalReleaseFiles(): Promise<string[]> {
  try {
    const entries = await readdir(LOCAL_RELEASES_DIR);
    return entries.filter(
      (name) => name.startsWith('omosuen-') && name.endsWith('.min.js'),
    );
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === 'ENOENT'
    ) {
      return [];
    }
    throw err;
  }
}

async function downloadAsset(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(
      `Asset download failed: ${response.status} ${response.statusText} (${url})`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
}

export async function syncReleases(): Promise<void> {
  await mkdir(LOCAL_RELEASES_DIR, { recursive: true });

  const releases = await listRemoteReleases();

  // Build the expected set of local filenames from remote releases that
  // publish the UMD asset. Releases without the asset are ignored.
  const expectedFilenames = new Set<string>();
  const downloadUrls = new Map<string, string>();
  for (const release of releases) {
    const asset = release.assets.find((a) => a.name === ASSET_NAME);
    if (!asset) continue;
    const filename = localFileNameFor(release.tag_name);
    expectedFilenames.add(filename);
    downloadUrls.set(filename, asset.browser_download_url);
  }

  // Remove any local omosuen-<tag>.min.js that no longer matches a remote
  // release. Other files in the folder (e.g. a .gitignore) are left alone.
  const localBefore = await listLocalReleaseFiles();
  let removed = 0;
  for (const filename of localBefore) {
    if (!expectedFilenames.has(filename)) {
      console.log(`[sync-releases] remove ${filename}`);
      await unlink(join(LOCAL_RELEASES_DIR, filename));
      removed += 1;
    }
  }

  // Download any expected release that isn't already present locally.
  const present = new Set(await listLocalReleaseFiles());
  let downloaded = 0;
  for (const [filename, url] of downloadUrls) {
    if (present.has(filename)) continue;
    console.log(`[sync-releases] download ${filename}`);
    await downloadAsset(url, join(LOCAL_RELEASES_DIR, filename));
    downloaded += 1;
  }

  console.log(
    `[sync-releases] done — tracked ${expectedFilenames.size}, downloaded ${downloaded}, removed ${removed}.`,
  );
}

// Run the sync when this file is invoked directly (e.g. `tsx src/test/sync-releases.ts`).
// When imported from another module, the exported function is available but
// not auto-invoked.
const invokedArgv = process.argv[1] ?? '';
const invokedDirectly =
  invokedArgv !== '' && pathToFileURL(invokedArgv).href === import.meta.url;
if (invokedDirectly) {
  try {
    await syncReleases();
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(msg);
    process.exit(1);
  }
}
