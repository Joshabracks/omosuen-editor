/**
 * Engine UMD resolver for the preview webview (Phase 6.3).
 *
 * Mirrors the pattern from `_old/src/omoscene-editor.ts`:
 *   1. Given a scene's engine-version tag (e.g. `v0.1.30`), compute the
 *      expected path at `${workspace}/.omosuen_editor/omosuen-${tag}.min.js`.
 *   2. If present on disk, return its webview-resolvable URI.
 *   3. If missing, ensure the cache directory exists, HTTPS-download from
 *      `github.com/Joshabracks/omosuen/releases/download/${tag}/omosuen.min.js`
 *      into the cache, and return the webview URI.
 *
 * Failure modes surface as `EngineLoaderError` with actionable messages
 * (no workspace open, no network, 404 tag) so callers can show them to
 * the user.
 *
 * Project creation (Phase 10) will pre-populate the cache during
 * scaffolding; for Phase 6 the loader populates on demand.
 */

import * as vscode from 'vscode';

const ENGINE_RELEASE_URL_PREFIX =
  'https://github.com/Joshabracks/omosuen/releases/download';
const ENGINE_ASSET_FILENAME = 'omosuen.min.js';
const CACHE_DIR_NAME = '.omosuen_editor';

export class EngineLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineLoaderError';
  }
}

export interface ResolveEngineUriOptions {
  /**
   * The workspace folder that "owns" the scene being previewed. Used to
   * anchor the `.omosuen_editor/` cache path. Must be the folder
   * containing the `.omoscene` file (or one of its ancestors).
   */
  readonly workspaceFolder: vscode.Uri;
  /**
   * Version tag from the `.omoscene` file's `engine` field (e.g.
   * `"v0.1.30"` or `"0.1.30"`). Used both to pick the cached file name
   * and to construct the GitHub release download URL.
   */
  readonly engineTag: string;
  /**
   * The webview the returned URI will be embedded in. Needed for
   * `webview.asWebviewUri` translation.
   */
  readonly webview: vscode.Webview;
}

export interface ResolveEngineUriResult {
  /** Webview-ready URI suitable for a `<script src="...">`. */
  readonly webviewUri: vscode.Uri;
  /** Filesystem URI of the cached UMD — used for `localResourceRoots`. */
  readonly localUri: vscode.Uri;
  /** `true` if this call downloaded the asset; `false` if cache-hit. */
  readonly wasDownloaded: boolean;
}

/**
 * Resolve the engine UMD, downloading on cache miss. Throws
 * `EngineLoaderError` if the file cannot be obtained.
 */
export async function resolveEngineUri(
  options: ResolveEngineUriOptions,
): Promise<ResolveEngineUriResult> {
  const { workspaceFolder, engineTag, webview } = options;
  if (engineTag === '') {
    throw new EngineLoaderError('scene has an empty `engine` field');
  }

  const normalizedTag = normalizeEngineTag(engineTag);
  const cacheDir = vscode.Uri.joinPath(workspaceFolder, CACHE_DIR_NAME);
  const localUri = vscode.Uri.joinPath(
    cacheDir,
    `omosuen-${normalizedTag}.min.js`,
  );

  const exists = await fileExists(localUri);
  if (!exists) {
    await vscode.workspace.fs.createDirectory(cacheDir);
    const downloadUrl = buildDownloadUrl(normalizedTag);
    let bytes: Uint8Array;
    try {
      bytes = await downloadAsset(downloadUrl);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new EngineLoaderError(
        `failed to download engine ${normalizedTag} from ${downloadUrl}: ${detail}`,
      );
    }
    await vscode.workspace.fs.writeFile(localUri, bytes);
  }

  return {
    webviewUri: webview.asWebviewUri(localUri),
    localUri,
    wasDownloaded: !exists,
  };
}

/**
 * The cache directory for a given workspace folder. Exported so the
 * custom editor's `localResourceRoots` can include it — VS Code won't
 * let a webview load a resource otherwise.
 */
export function engineCacheDirUri(workspaceFolder: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(workspaceFolder, CACHE_DIR_NAME);
}

function normalizeEngineTag(tag: string): string {
  // Cache filenames use the exact tag string so `v0.1.30` and `0.1.30`
  // don't both masquerade as the same download. GitHub's release path
  // also uses the exact tag, so no normalization on either side.
  return tag;
}

function buildDownloadUrl(tag: string): string {
  return `${ENGINE_RELEASE_URL_PREFIX}/${encodeURIComponent(tag)}/${ENGINE_ASSET_FILENAME}`;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function downloadAsset(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'omosuen-editor',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
