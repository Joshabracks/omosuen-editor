/**
 * Pure GitHub releases listing for Phase 10.1.
 *
 * Deliberately does NOT import `vscode` so the module stays loadable
 * under tsx tests. The QuickPick wrapper lives in
 * [version-picker.ts](./version-picker.ts), which is the module the
 * new-project command imports in production.
 *
 * Same HTTP pattern as [src/test/sync-releases.ts](../test/sync-releases.ts)
 * and [src/app/engine-loader.ts](./engine-loader.ts); extracted here so
 * both Phase 10 (listing) and Phase 6.3 (downloading) can evolve
 * independently.
 */

const RELEASES_URL =
  'https://api.github.com/repos/Joshabracks/omosuen/releases?per_page=100';
const USER_AGENT = 'omosuen-editor';

export interface ReleaseOption {
  readonly tag: string;
  readonly name: string | null;
  readonly publishedAt: string | null;
  readonly prerelease: boolean;
}

export interface ReleaseFetcher {
  (url: string, init?: RequestInit): Promise<Response>;
}

export interface ListReleasesOptions {
  /**
   * Injected for tests. Production call site omits it; the global
   * `fetch` is used.
   */
  readonly fetch?: ReleaseFetcher;
}

/**
 * Fetch the engine's published release tags. Drafts are filtered out.
 * Throws `Error` on HTTP or parse failures — callers surface those via
 * `showErrorMessage`.
 */
export async function listOmosuenReleases(
  options: ListReleasesOptions = {},
): Promise<ReleaseOption[]> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub releases API returned ${String(response.status)} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error('Expected GitHub releases API to return an array.');
  }

  const out: ReleaseOption[] = [];
  for (const entry of body) {
    if (!isRecord(entry)) continue;
    if (entry['draft'] === true) continue;
    const tag = entry['tag_name'];
    if (typeof tag !== 'string' || tag === '') continue;
    out.push({
      tag,
      name: typeof entry['name'] === 'string' ? entry['name'] : null,
      publishedAt:
        typeof entry['published_at'] === 'string'
          ? entry['published_at']
          : null,
      prerelease: entry['prerelease'] === true,
    });
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
