import { app } from 'electron';
import path from 'node:path';
import {
  ensureEngineCached,
  fetchEngineVersions,
  pickDefaultEngineVersion,
  resolveEngineCache,
  type EngineCacheResolveResult,
  type EngineVersionOption,
  FALLBACK_ENGINE_VERSION,
} from '../src/engine-cache';

export function enginesRootPath(): string {
  return path.join(app.getPath('userData'), 'engines');
}

export async function listRemoteEngineVersions(): Promise<
  readonly EngineVersionOption[]
> {
  try {
    return await fetchEngineVersions();
  } catch {
    return [
      {
        tag: FALLBACK_ENGINE_VERSION,
        label: `${FALLBACK_ENGINE_VERSION} (offline fallback)`,
        prerelease: false,
      },
    ];
  }
}

export async function defaultRemoteEngineVersion(): Promise<string> {
  const versions = await listRemoteEngineVersions();
  return pickDefaultEngineVersion(versions) ?? FALLBACK_ENGINE_VERSION;
}

export async function ensureEngineVersionCached(
  version: string,
): Promise<EngineCacheResolveResult> {
  return ensureEngineCached(enginesRootPath(), version);
}

export async function resolveCachedEngineVersion(
  version: string,
): Promise<EngineCacheResolveResult> {
  return resolveEngineCache(enginesRootPath(), version);
}
