/**
 * Shared engine-release cache for I/O-bound test suites.
 *
 * Both engine-fixtures and schema-drift need to load every cached omosuen
 * UMD. Without sharing, each suite independently syncs, scans, and
 * `REQUIRE()`s every release — meaning every UMD is parsed+evaluated twice
 * per test run.
 *
 * This module centralizes that work:
 *   - `syncReleases()` (network)        → runs once
 *   - `local_releases/` directory scan  → runs once
 *   - CJS-marker write                  → runs once
 *   - Browser-global stubs              → installed once
 *   - `REQUIRE()` per UMD path          → runs once per release
 *
 * Per-release cache-clear is preserved: different releases never share
 * module state (each UMD is required fresh). The shared cache only reuses
 * the already-loaded-once handle for the *same* release across suites.
 *
 * Engine load errors are captured inside `CachedRelease.engine` rather
 * than thrown so downstream suites can still register a failing `test()`
 * for that release instead of aborting the whole run.
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncReleases } from './sync-releases.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELEASES_DIR = join(HERE, 'local_releases');
const REQUIRE = createRequire(import.meta.url);

export interface EngineError {
  code: string;
  message: string;
  count?: number;
}

export interface EngineDeserializeResult {
  component: unknown;
  errors: EngineError[];
}

export interface EngineExports {
  deserializeComponentRecursive: (
    data: unknown,
    maxId?: { value: number },
  ) => Promise<EngineDeserializeResult>;
  PROPERTY_ALLOWLIST: Record<string, readonly string[]>;
}

export interface CachedRelease {
  umdPath: string;
  version: string;
  engine: EngineExports | Error;
}

interface BrowserGlobalStubs {
  window?: unknown;
  self?: unknown;
  document?: unknown;
}

/**
 * Install the minimum set of browser-ish globals a UMD module's top-level
 * code expects to find. The fixtures and drift test never trigger
 * DOM-touching code paths, so empty stubs are sufficient.
 */
function installBrowserStubs(): void {
  const g = globalThis as unknown as BrowserGlobalStubs;
  if (g.window === undefined) g.window = globalThis;
  if (g.self === undefined) g.self = globalThis;
  if (g.document === undefined) {
    g.document = {
      createElement: (): unknown => ({
        style: {},
        getContext: (): null => null,
        appendChild: (): void => undefined,
      }),
    };
  }
}

/**
 * The editor's package.json sets "type": "module", which would make any
 * .js file load as ESM and reject the UMD's CJS wrapper. Dropping a CJS
 * marker package.json inside local_releases/ overrides the setting for
 * that folder.
 *
 * sync-releases's cleanup only touches `omosuen-*.min.js`, so this marker
 * survives syncs.
 */
function ensureCommonJsMarker(): void {
  const markerPath = join(RELEASES_DIR, 'package.json');
  if (!existsSync(markerPath)) {
    writeFileSync(
      markerPath,
      JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
    );
  }
}

function listReleaseUmds(): string[] {
  if (!existsSync(RELEASES_DIR) || !statSync(RELEASES_DIR).isDirectory()) {
    return [];
  }
  return readdirSync(RELEASES_DIR)
    .filter((n) => n.startsWith('omosuen-') && n.endsWith('.min.js'))
    .sort()
    .map((n) => join(RELEASES_DIR, n));
}

/**
 * Extract a version string like "v0.1.30" from a UMD path for test labels.
 */
export function versionFromPath(umdPath: string): string {
  const match = /omosuen-([^/\\]+)\.min\.js$/.exec(umdPath);
  return match?.[1] ?? umdPath;
}

/**
 * Load a UMD fresh by clearing its require-cache entry first. Between
 * different release paths this prevents cross-release module-state pollution.
 */
function loadEngineUmd(umdPath: string): EngineExports {
  const resolved = REQUIRE.resolve(umdPath);
  delete REQUIRE.cache[resolved];
  const loaded = REQUIRE(umdPath) as unknown;
  return loaded as EngineExports;
}

let cache: CachedRelease[] | null = null;

/**
 * Return every cached release with its loaded engine (or load error).
 * Idempotent — first call syncs + loads; subsequent calls return the cache.
 */
export async function getCachedReleases(): Promise<CachedRelease[]> {
  if (cache !== null) return cache;

  console.log('[engine-context] syncing releases...');
  await syncReleases();
  ensureCommonJsMarker();
  installBrowserStubs();

  const umdPaths = listReleaseUmds();
  const releases: CachedRelease[] = [];
  for (const umdPath of umdPaths) {
    const version = versionFromPath(umdPath);
    try {
      const engine = loadEngineUmd(umdPath);
      releases.push({ umdPath, version, engine });
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      releases.push({ umdPath, version, engine: wrapped });
    }
  }

  cache = releases;
  return cache;
}

export const RELEASES_DIR_PATH = RELEASES_DIR;
