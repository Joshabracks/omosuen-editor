/** Engine release cache layout under `{userData}/engines/{version}/`. */

export const ENGINE_UMD_FILENAME = 'omosuen.min.js';
export const ENGINE_GITHUB_OWNER = 'Joshabracks';
export const ENGINE_GITHUB_REPO = 'omosuen';
/** Offline / test fallback when GitHub is unreachable. */
export const FALLBACK_ENGINE_VERSION = 'v0.24.1';

export interface EngineVersionOption {
  readonly tag: string;
  readonly label: string;
  readonly prerelease: boolean;
}

export interface EngineReleaseArtifact {
  readonly name: string;
  readonly downloadUrl: string;
}

export interface EngineReleaseArtifacts {
  readonly version: string;
  readonly umd: EngineReleaseArtifact;
  /** Additional files (.wasm, etc.) published alongside the UMD. */
  readonly extras: readonly EngineReleaseArtifact[];
}

export interface EngineCacheLayout {
  readonly version: string;
  readonly cacheDir: string;
  readonly umdPath: string;
}

export interface EngineCacheResolveResult {
  readonly version: string;
  readonly cacheDir: string;
  readonly umdPath: string;
  readonly umdUrl: string;
  readonly extraPaths: readonly string[];
  readonly downloaded: boolean;
}
