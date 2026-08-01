import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  fetchEngineReleaseArtifacts,
  type FetchLike,
} from './github';
import { engineCacheLayout } from './paths';
import type {
  EngineCacheResolveResult,
  EngineReleaseArtifacts,
} from './types';

export type DownloadFileFn = (url: string, destPath: string) => Promise<void>;

export interface EnsureEngineCachedDeps {
  readonly fetchImpl?: FetchLike;
  readonly downloadFile?: DownloadFileFn;
  /** Override artifact resolution (tests / offline). */
  readonly resolveArtifacts?: (
    version: string,
  ) => Promise<EngineReleaseArtifacts>;
}

/**
 * Download a URL to disk, following redirects (GitHub release CDN).
 */
export function httpsDownloadFile(
  url: string,
  destPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (reqUrl: string, depth: number): void => {
      if (depth > 8) {
        reject(new Error('Too many redirects'));
        return;
      }
      const lib = reqUrl.startsWith('http:') ? http : https;
      const req = lib.get(
        reqUrl,
        { headers: { 'User-Agent': 'omosuen-editor' } },
        (res) => {
          const status = res.statusCode ?? 0;
          if (
            (status === 301 ||
              status === 302 ||
              status === 303 ||
              status === 307 ||
              status === 308) &&
            res.headers.location
          ) {
            res.resume();
            follow(res.headers.location, depth + 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(new Error(`HTTP ${status} downloading ${reqUrl}`));
            return;
          }
          void fsp.mkdir(path.dirname(destPath), { recursive: true }).then(() => {
            const tmp = `${destPath}.${process.pid}-${Date.now()}.tmp`;
            const out = fs.createWriteStream(tmp);
            res.pipe(out);
            out.on('finish', () => {
              out.close(() => {
                void (async () => {
                  try {
                    try {
                      await fsp.rename(tmp, destPath);
                    } catch {
                      await fsp.rm(destPath, { force: true });
                      await fsp.rename(tmp, destPath);
                    }
                    resolve();
                  } catch (err) {
                    await fsp.rm(tmp, { force: true }).catch(() => undefined);
                    reject(err);
                  }
                })();
              });
            });
            out.on('error', (err) => {
              void fsp.rm(tmp, { force: true }).catch(() => undefined);
              reject(err);
            });
          });
        },
      );
      req.on('error', reject);
    };
    follow(url, 0);
  });
}

export async function isEngineUmdCached(
  enginesRoot: string,
  version: string,
): Promise<boolean> {
  const layout = engineCacheLayout(enginesRoot, version);
  try {
    const st = await fsp.stat(layout.umdPath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Ensure UMD (+ optional extras) for `version` exist under enginesRoot.
 */
export async function ensureEngineCached(
  enginesRoot: string,
  version: string,
  deps: EnsureEngineCachedDeps = {},
): Promise<EngineCacheResolveResult> {
  const layout = engineCacheLayout(enginesRoot, version);
  const downloadFile = deps.downloadFile ?? httpsDownloadFile;
  const already = await isEngineUmdCached(enginesRoot, layout.version);
  let downloaded = false;

  let artifacts: EngineReleaseArtifacts | null = null;
  const needArtifacts = !already;
  if (needArtifacts) {
    artifacts = deps.resolveArtifacts
      ? await deps.resolveArtifacts(layout.version)
      : await fetchEngineReleaseArtifacts(
          layout.version,
          deps.fetchImpl ?? globalThis.fetch,
        );
    await fsp.mkdir(layout.cacheDir, { recursive: true });
    await downloadFile(artifacts.umd.downloadUrl, layout.umdPath);
    downloaded = true;
    for (const extra of artifacts.extras) {
      await downloadFile(
        extra.downloadUrl,
        path.join(layout.cacheDir, extra.name),
      );
    }
  }

  const extraPaths = await listExtraFiles(layout.cacheDir, layout.umdPath);

  return {
    version: layout.version,
    cacheDir: layout.cacheDir,
    umdPath: layout.umdPath,
    umdUrl: pathToFileURL(layout.umdPath).href,
    extraPaths,
    downloaded,
  };
}

/**
 * Resolve cached paths without downloading. Throws if UMD missing.
 */
export async function resolveEngineCache(
  enginesRoot: string,
  version: string,
): Promise<EngineCacheResolveResult> {
  const layout = engineCacheLayout(enginesRoot, version);
  if (!(await isEngineUmdCached(enginesRoot, layout.version))) {
    throw new Error(
      `Engine ${layout.version} is not cached at ${layout.cacheDir}`,
    );
  }
  return {
    version: layout.version,
    cacheDir: layout.cacheDir,
    umdPath: layout.umdPath,
    umdUrl: pathToFileURL(layout.umdPath).href,
    extraPaths: await listExtraFiles(layout.cacheDir, layout.umdPath),
    downloaded: false,
  };
}

async function listExtraFiles(
  cacheDir: string,
  umdPath: string,
): Promise<string[]> {
  try {
    const names = await fsp.readdir(cacheDir);
    return names
      .map((name) => path.join(cacheDir, name))
      .filter((p) => path.resolve(p) !== path.resolve(umdPath));
  } catch {
    return [];
  }
}
