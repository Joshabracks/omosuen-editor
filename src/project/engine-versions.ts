import {
  FALLBACK_ENGINE_VERSION,
  type EngineVersionOption,
} from '../engine-cache';

export type { EngineVersionOption };

/**
 * Sync stub list for offline / unit tests.
 * Runtime listing uses `fetchEngineVersions` (GitHub releases).
 */
export function listEngineVersions(): readonly EngineVersionOption[] {
  return [
    {
      tag: FALLBACK_ENGINE_VERSION,
      label: `${FALLBACK_ENGINE_VERSION} (offline fallback)`,
      prerelease: false,
    },
  ];
}

export function defaultEngineVersion(): string {
  return FALLBACK_ENGINE_VERSION;
}
