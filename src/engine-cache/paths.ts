import path from 'node:path';
import { ENGINE_UMD_FILENAME, type EngineCacheLayout } from './types';

/**
 * Reject path traversal / empty tags before joining under userData/engines.
 */
export function sanitizeEngineVersion(version: string): string {
  const tag = version.trim();
  if (!tag) {
    throw new Error('Engine version is required');
  }
  if (tag.includes('..') || /[\\/]/.test(tag)) {
    throw new Error(`Invalid engine version: ${version}`);
  }
  return tag;
}

export function engineCacheLayout(
  enginesRoot: string,
  version: string,
): EngineCacheLayout {
  const tag = sanitizeEngineVersion(version);
  const cacheDir = path.join(path.resolve(enginesRoot), tag);
  return {
    version: tag,
    cacheDir,
    umdPath: path.join(cacheDir, ENGINE_UMD_FILENAME),
  };
}

export function githubReleaseDownloadUrl(
  version: string,
  assetName: string,
): string {
  const tag = sanitizeEngineVersion(version);
  const owner = 'Joshabracks';
  const repo = 'omosuen';
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}
