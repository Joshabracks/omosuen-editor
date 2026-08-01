import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import {
  ENGINE_UMD_FILENAME,
  ensureEngineCached,
  engineCacheLayout,
  fetchEngineVersions,
  isEngineUmdCached,
  pickDefaultEngineVersion,
  pinProjectEngineVersion,
  resolveEngineCache,
  sanitizeEngineVersion,
} from '../engine-cache';
import {
  PROJECT_MANIFEST_FILENAME,
  parseManifest,
  scaffoldProject,
} from '../project';
import { withTempDir } from './helpers';

test('sanitizeEngineVersion rejects empty and path-like tags', () => {
  assert.equal(sanitizeEngineVersion('v1.2.3'), 'v1.2.3');
  assert.throws(() => sanitizeEngineVersion(''), /required/);
  assert.throws(() => sanitizeEngineVersion('../x'), /Invalid/);
  assert.throws(() => sanitizeEngineVersion('a/b'), /Invalid/);
});

test('fetchEngineVersions filters to releases with UMD asset', async () => {
  const payload = [
    {
      tag_name: 'v9.9.9',
      name: 'omosuen v9.9.9',
      draft: false,
      prerelease: false,
      assets: [
        {
          name: ENGINE_UMD_FILENAME,
          browser_download_url: 'https://example.test/omosuen.min.js',
        },
      ],
    },
    {
      tag_name: 'plugin-only',
      name: 'plugin',
      draft: false,
      prerelease: false,
      assets: [
        {
          name: 'other.plugin.js',
          browser_download_url: 'https://example.test/other.js',
        },
      ],
    },
    {
      tag_name: 'draft-tag',
      name: 'draft',
      draft: true,
      prerelease: false,
      assets: [
        {
          name: ENGINE_UMD_FILENAME,
          browser_download_url: 'https://example.test/d.js',
        },
      ],
    },
  ];

  const versions = await fetchEngineVersions(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));

  assert.deepEqual(
    versions.map((v) => v.tag),
    ['v9.9.9'],
  );
  assert.equal(pickDefaultEngineVersion(versions), 'v9.9.9');
});

test('ensureEngineCached downloads UMD once then reuses cache', async () => {
  await withTempDir('omosuen-engine-cache-', async (root) => {
    const enginesRoot = path.join(root, 'engines');
    const downloads: string[] = [];

    const result1 = await ensureEngineCached(enginesRoot, 'v1.0.0-test', {
      resolveArtifacts: async (version) => ({
        version,
        umd: {
          name: ENGINE_UMD_FILENAME,
          downloadUrl: 'https://example.test/umosuen.min.js',
        },
        extras: [
          {
            name: 'omosuen.wasm',
            downloadUrl: 'https://example.test/omosuen.wasm',
          },
        ],
      }),
      downloadFile: async (url, destPath) => {
        downloads.push(url);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(
          destPath,
          url.endsWith('.wasm') ? Buffer.from([0, 1, 2]) : 'umd-body',
        );
      },
    });

    assert.equal(result1.downloaded, true);
    assert.equal(result1.version, 'v1.0.0-test');
    assert.equal(await fs.readFile(result1.umdPath, 'utf8'), 'umd-body');
    assert.equal(result1.extraPaths.length, 1);
    assert.equal(downloads.length, 2);

    const result2 = await ensureEngineCached(enginesRoot, 'v1.0.0-test', {
      resolveArtifacts: async () => {
        throw new Error('should not resolve when cached');
      },
      downloadFile: async () => {
        throw new Error('should not download when cached');
      },
    });
    assert.equal(result2.downloaded, false);
    assert.equal(await isEngineUmdCached(enginesRoot, 'v1.0.0-test'), true);

    const resolved = await resolveEngineCache(enginesRoot, 'v1.0.0-test');
    assert.equal(resolved.umdPath, result1.umdPath);
    assert.match(resolved.umdUrl, /^file:/);
  });
});

test('pinProjectEngineVersion updates manifest and package.json', async () => {
  await withTempDir('omosuen-pin-', async (parent) => {
    const projectDir = path.join(parent, 'game');
    await scaffoldProject({
      projectDir,
      name: 'Game',
      engineVersion: 'v0.1.0',
    });

    const pinned = await pinProjectEngineVersion(projectDir, 'v0.2.0');
    assert.equal(pinned.previousVersion, 'v0.1.0');
    assert.equal(pinned.manifest.engineVersion, 'v0.2.0');
    assert.equal(pinned.packageJsonUpdated, true);

    const raw = await fs.readFile(
      path.join(projectDir, PROJECT_MANIFEST_FILENAME),
      'utf8',
    );
    assert.equal(parseManifest(raw).engineVersion, 'v0.2.0');

    const pkg = JSON.parse(
      await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'),
    ) as { dependencies: { omosuen: string } };
    assert.equal(pkg.dependencies.omosuen, 'github:Joshabracks/omosuen#v0.2.0');
  });
});

test('engineCacheLayout nests under engines root', () => {
  const layout = engineCacheLayout('/tmp/engines', 'v1.2.3');
  assert.equal(layout.version, 'v1.2.3');
  assert.equal(path.basename(layout.cacheDir), 'v1.2.3');
  assert.equal(path.basename(layout.umdPath), ENGINE_UMD_FILENAME);
});

test('local http fixture can be downloaded by httpsDownloadFile path', async () => {
  await withTempDir('omosuen-http-dl-', async (root) => {
    const { httpsDownloadFile } = await import('../engine-cache/cache');
    const body = 'fixture-umd';
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(body);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const url = `http://127.0.0.1:${addr.port}/omosuen.min.js`;
    const dest = path.join(root, ENGINE_UMD_FILENAME);
    try {
      await httpsDownloadFile(url, dest);
      assert.equal(await fs.readFile(dest, 'utf8'), body);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
