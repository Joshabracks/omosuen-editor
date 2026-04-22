/**
 * Tests for the GitHub releases listing utility (Phase 10.1).
 *
 * Only the pure `listOmosuenReleases` path is tested. `pickEngineVersion`
 * wraps `vscode.window.showQuickPick` and is manual-tested per Q3.
 */

import { listOmosuenReleases } from '../app/github-releases.js';
import { assertDeepEqual, test } from './harness.js';

interface FakeResponseInit {
  readonly status?: number;
  readonly statusText?: string;
  readonly body: unknown;
}

function fakeResponse(init: FakeResponseInit): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    json: () => Promise.resolve(init.body),
  } as unknown as Response;
}

type FetchArgs = { url: string; init: RequestInit | undefined };

function recordingFetch(responseBody: unknown): {
  fn: (url: string, init?: RequestInit) => Promise<Response>;
  calls: FetchArgs[];
} {
  const calls: FetchArgs[] = [];
  return {
    fn: (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return Promise.resolve(fakeResponse({ body: responseBody }));
    },
    calls,
  };
}

export function runGitHubReleasesTests(): void {
  test('listOmosuenReleases: hits the expected GitHub API URL with correct headers', async () => {
    const { fn, calls } = recordingFetch([]);
    await listOmosuenReleases({ fetch: fn });
    if (calls.length !== 1) {
      throw new Error(`expected 1 fetch call, got ${calls.length}`);
    }
    const [call] = calls;
    if (call === undefined) throw new Error('missing call');
    if (
      call.url !==
      'https://api.github.com/repos/Joshabracks/omosuen/releases?per_page=100'
    ) {
      throw new Error(`unexpected URL: ${call.url}`);
    }
    const headers = call.init?.headers as Record<string, string> | undefined;
    if (headers === undefined) throw new Error('headers missing');
    if (headers['Accept'] !== 'application/vnd.github+json') {
      throw new Error(`wrong Accept: ${headers['Accept'] ?? ''}`);
    }
    if (headers['User-Agent'] !== 'omosuen-editor') {
      throw new Error('wrong User-Agent');
    }
  });

  test('listOmosuenReleases: maps releases to ReleaseOption shape', async () => {
    const { fn } = recordingFetch([
      {
        tag_name: 'v0.1.30',
        name: 'v0.1.30',
        published_at: '2026-04-01T00:00:00Z',
        draft: false,
        prerelease: false,
      },
      {
        tag_name: 'v0.1.31',
        name: 'Minor fixes',
        published_at: '2026-04-15T00:00:00Z',
        draft: false,
        prerelease: true,
      },
    ]);
    const releases = await listOmosuenReleases({ fetch: fn });
    assertDeepEqual(releases, [
      {
        tag: 'v0.1.30',
        name: 'v0.1.30',
        publishedAt: '2026-04-01T00:00:00Z',
        prerelease: false,
      },
      {
        tag: 'v0.1.31',
        name: 'Minor fixes',
        publishedAt: '2026-04-15T00:00:00Z',
        prerelease: true,
      },
    ]);
  });

  test('listOmosuenReleases: filters out draft releases', async () => {
    const { fn } = recordingFetch([
      { tag_name: 'v0.1.30', draft: false },
      { tag_name: 'v0.2.0-wip', draft: true },
    ]);
    const releases = await listOmosuenReleases({ fetch: fn });
    if (releases.length !== 1) {
      throw new Error(`expected 1 release, got ${releases.length}`);
    }
    if (releases[0]?.tag !== 'v0.1.30') {
      throw new Error(`expected v0.1.30, got ${releases[0]?.tag ?? 'null'}`);
    }
  });

  test('listOmosuenReleases: skips entries missing a tag_name', async () => {
    const { fn } = recordingFetch([
      { tag_name: 'v0.1.30' },
      { name: 'no tag field' }, // skipped
      { tag_name: '' }, // skipped
      { tag_name: 42 }, // skipped — not a string
      { tag_name: 'v0.1.31' },
    ]);
    const releases = await listOmosuenReleases({ fetch: fn });
    assertDeepEqual(
      releases.map((r) => r.tag),
      ['v0.1.30', 'v0.1.31'],
    );
  });

  test('listOmosuenReleases: defaults optional fields when missing', async () => {
    const { fn } = recordingFetch([{ tag_name: 'v0.1.30', draft: false }]);
    const releases = await listOmosuenReleases({ fetch: fn });
    assertDeepEqual(releases[0], {
      tag: 'v0.1.30',
      name: null,
      publishedAt: null,
      prerelease: false,
    });
  });

  test('listOmosuenReleases: throws on non-OK HTTP status', async () => {
    const fn: (url: string, init?: RequestInit) => Promise<Response> = () =>
      Promise.resolve(
        fakeResponse({ status: 403, statusText: 'Forbidden', body: {} }),
      );
    try {
      await listOmosuenReleases({ fetch: fn });
      throw new Error('expected throw');
    } catch (err) {
      if (
        !(err instanceof Error) ||
        !err.message.includes('403') ||
        !err.message.includes('Forbidden')
      ) {
        throw new Error(`unexpected error: ${String(err)}`);
      }
    }
  });

  test('listOmosuenReleases: throws when body is not an array', async () => {
    const { fn } = recordingFetch({ message: 'rate limited' });
    try {
      await listOmosuenReleases({ fetch: fn });
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('return an array')) {
        throw new Error(`unexpected error: ${String(err)}`);
      }
    }
  });
}
