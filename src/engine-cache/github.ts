import {
  ENGINE_GITHUB_OWNER,
  ENGINE_GITHUB_REPO,
  ENGINE_UMD_FILENAME,
  type EngineReleaseArtifacts,
  type EngineVersionOption,
} from './types';
import { sanitizeEngineVersion } from './paths';

export interface GitHubReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface GitHubRelease {
  readonly tag_name: string;
  readonly name: string | null;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly assets: readonly GitHubReleaseAsset[];
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const DEFAULT_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'omosuen-editor',
};

function releasesApiUrl(): string {
  return `https://api.github.com/repos/${ENGINE_GITHUB_OWNER}/${ENGINE_GITHUB_REPO}/releases?per_page=50`;
}

function releaseByTagApiUrl(tag: string): string {
  return `https://api.github.com/repos/${ENGINE_GITHUB_OWNER}/${ENGINE_GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`;
}

function asReleases(raw: unknown): GitHubRelease[] {
  if (!Array.isArray(raw)) {
    throw new Error('GitHub releases response must be an array');
  }
  return raw as GitHubRelease[];
}

function asRelease(raw: unknown): GitHubRelease {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('GitHub release response must be an object');
  }
  return raw as GitHubRelease;
}

function hasUmdAsset(release: GitHubRelease): boolean {
  return (release.assets ?? []).some((a) => a.name === ENGINE_UMD_FILENAME);
}

function toOption(release: GitHubRelease): EngineVersionOption {
  const tag = release.tag_name;
  const name = (release.name ?? '').trim();
  return {
    tag,
    label: name && name !== tag ? `${tag} — ${name}` : tag,
    prerelease: Boolean(release.prerelease),
  };
}

function artifactsFromRelease(release: GitHubRelease): EngineReleaseArtifacts {
  const version = sanitizeEngineVersion(release.tag_name);
  const assets = release.assets ?? [];
  const umd = assets.find((a) => a.name === ENGINE_UMD_FILENAME);
  if (!umd?.browser_download_url) {
    throw new Error(
      `Release ${version} has no ${ENGINE_UMD_FILENAME} asset`,
    );
  }
  const extras = assets
    .filter(
      (a) =>
        a.name !== ENGINE_UMD_FILENAME &&
        (a.name.endsWith('.wasm') || a.name.endsWith('.js.map')),
    )
    .map((a) => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
    }));
  return {
    version,
    umd: {
      name: umd.name,
      downloadUrl: umd.browser_download_url,
    },
    extras,
  };
}

/**
 * List published engine releases that include the UMD bundle.
 */
export async function fetchEngineVersions(
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<readonly EngineVersionOption[]> {
  const res = await fetchImpl(releasesApiUrl(), { headers: DEFAULT_HEADERS });
  if (!res.ok) {
    throw new Error(`GitHub releases API returned ${res.status}`);
  }
  const releases = asReleases(await res.json());
  return releases
    .filter((r) => !r.draft && hasUmdAsset(r))
    .map(toOption);
}

/**
 * Resolve downloadable artifacts for a release tag.
 */
export async function fetchEngineReleaseArtifacts(
  version: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<EngineReleaseArtifacts> {
  const tag = sanitizeEngineVersion(version);
  const res = await fetchImpl(releaseByTagApiUrl(tag), {
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) {
    throw new Error(
      `GitHub release ${tag} lookup returned ${res.status}`,
    );
  }
  return artifactsFromRelease(asRelease(await res.json()));
}

export function pickDefaultEngineVersion(
  versions: readonly EngineVersionOption[],
): string | null {
  const stable = versions.find((v) => !v.prerelease);
  return (stable ?? versions[0])?.tag ?? null;
}
