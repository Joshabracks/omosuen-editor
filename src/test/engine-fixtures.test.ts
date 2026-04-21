/**
 * Engine-fixtures integration test.
 *
 * For every omosuen release cached under ./local_releases/ and every fixture
 * under ./omoscene-fixtures/, load the UMD into Node, hand the fixture's
 * scene region to the engine's `deserializeComponentRecursive`, and assert
 * that the result matches the fixture's category:
 *
 *   - pass/*   → component non-null AND errors array empty
 *   - errors/* → component non-null AND errors array non-empty
 *   - null/*   → component null
 *
 * Before running, `syncReleases()` refreshes the local UMD cache so tests
 * always run against the currently-published engine versions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEFERRED EXPANSION (do not forget):
 *
 * Once the editor has a scene-construction API — expected around Phase 5,
 * definitively by Phase 6 when the webview emits engine-compatible scenes —
 * this suite must grow a round-trip leg:
 *
 *   1. Build a scene programmatically via the editor's own infrastructure.
 *   2. Pass that editor-built serialized scene to each cached engine
 *      release's `deserializeComponentRecursive`.
 *   3. Call the same release's `serializeComponentRecursive` on the result.
 *   4. Assert the round-tripped output matches the editor's original input
 *      byte-for-byte (after canonical normalization).
 *
 * That proves end-to-end fidelity between the editor's scene-construction
 * output and every supported engine release's serializer. The current
 * suite exercises the engine's deserializer against hand-authored fixtures
 * only — it cannot prove that what the editor actually produces is itself
 * well-formed, because the editor cannot yet construct scenes.
 *
 * Full rationale: see `.design/05-implementation-plan.md` →
 * "Deferred test expansions → Editor-built-scene round-trip in
 * engine-fixtures.test.ts".
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../omoscene/index.js';
import { test } from './harness.js';
import { syncReleases } from './sync-releases.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, 'omoscene-fixtures');
const RELEASES_DIR = join(HERE, 'local_releases');
const REQUIRE = createRequire(import.meta.url);

type Category = 'pass' | 'errors' | 'null';

interface Fixture {
  category: Category;
  name: string;
  scene: unknown;
}

interface EngineError {
  code: string;
  message: string;
  count?: number;
}

interface EngineResult {
  component: unknown;
  errors: EngineError[];
}

interface EngineExports {
  deserializeComponentRecursive: (
    data: unknown,
    maxId?: { value: number },
  ) => Promise<EngineResult>;
}

/**
 * Enumerate fixtures. Each file under omoscene-fixtures/<category>/ becomes
 * one Fixture with its parsed scene region.
 */
function loadFixtures(): Fixture[] {
  const out: Fixture[] = [];
  const categories: Category[] = ['pass', 'errors', 'null'];
  for (const category of categories) {
    const dir = join(FIXTURES_ROOT, category);
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir).sort()) {
      if (!filename.endsWith('.omoscene')) continue;
      const fullPath = join(dir, filename);
      const text = readFileSync(fullPath, 'utf-8');
      const file = parse(text);
      out.push({
        category,
        name: `${category}/${filename.replace(/\.omoscene$/, '')}`,
        scene: file.scene,
      });
    }
  }
  return out;
}

/**
 * List locally cached releases, sorted by filename (roughly semver-lex).
 */
function listReleases(): string[] {
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
function versionFromPath(umdPath: string): string {
  const match = /omosuen-([^/\\]+)\.min\.js$/.exec(umdPath);
  return match?.[1] ?? umdPath;
}

/**
 * The editor's package.json sets "type": "module". That makes any .js file
 * under the editor root load as ESM by default, which would reject the UMD
 * bundle's CJS wrapper. Dropping a package.json marker inside local_releases/
 * overrides the setting for that directory so the UMDs load as CommonJS.
 *
 * The file is name-compatible with sync-releases's cleanup: it only targets
 * `omosuen-*.min.js`, so this marker survives syncs.
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

/**
 * Install the minimum set of browser-ish globals a UMD module's top-level
 * code expects to find. The fixtures never trigger DOM-touching code paths
 * (no viewport / ui-overlay / input-controller components), so empty stubs
 * are sufficient.
 */
interface BrowserGlobalStubs {
  window?: unknown;
  self?: unknown;
  document?: unknown;
}

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
 * Load a UMD by path. Each release is required fresh by clearing its
 * require-cache entry first so two releases can't share module state.
 */
function loadEngineUmd(umdPath: string): EngineExports {
  installBrowserStubs();
  const resolved = REQUIRE.resolve(umdPath);
  delete REQUIRE.cache[resolved];
  const loaded = REQUIRE(umdPath) as unknown;
  return loaded as EngineExports;
}

type AssertionResult = EngineResult | Error;

function formatErrors(errs: EngineError[]): string {
  return errs.map((e) => e.code).join(', ');
}

export async function runEngineFixtureTests(): Promise<void> {
  // 1. Refresh local UMD cache against live GitHub releases.
  console.log('[engine-fixtures] syncing releases...');
  await syncReleases();

  // 2. Ensure UMDs in local_releases/ load as CJS.
  ensureCommonJsMarker();

  // 3. Enumerate fixtures and releases.
  const fixtures = loadFixtures();
  const releases = listReleases();

  if (releases.length === 0) {
    test('engine fixtures: at least one cached release', () => {
      throw new Error(
        `no releases in ${RELEASES_DIR}; syncReleases() found none on GitHub`,
      );
    });
    return;
  }

  // 4. Run every fixture against every release.
  const outcomes = new Map<string, AssertionResult>();
  for (const umdPath of releases) {
    const version = versionFromPath(umdPath);
    let engine: EngineExports;
    try {
      engine = loadEngineUmd(umdPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const fixture of fixtures) {
        outcomes.set(
          `${version} :: ${fixture.name}`,
          new Error(`engine load failed for ${version}: ${message}`),
        );
      }
      continue;
    }

    for (const fixture of fixtures) {
      const key = `${version} :: ${fixture.name}`;
      try {
        const result = await engine.deserializeComponentRecursive(
          fixture.scene,
        );
        outcomes.set(key, {
          component: result.component,
          errors: Array.isArray(result.errors) ? result.errors : [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcomes.set(key, new Error(`deserialize threw: ${message}`));
      }
    }
  }

  // 5. Register assertions. The harness's `test()` is synchronous — we run
  //    pre-computed outcomes through category-specific checks.
  for (const umdPath of releases) {
    const version = versionFromPath(umdPath);
    for (const fixture of fixtures) {
      const key = `${version} :: ${fixture.name}`;
      const outcome = outcomes.get(key);
      test(`[${version}] ${fixture.name}`, () => {
        if (!outcome) {
          throw new Error('outcome not recorded');
        }
        if (outcome instanceof Error) {
          throw outcome;
        }

        const { component, errors } = outcome;
        const componentKind = component === null ? 'null' : 'non-null';

        if (fixture.category === 'pass') {
          if (component === null) {
            throw new Error(
              `pass fixture returned null component (errors: ${formatErrors(errors)})`,
            );
          }
          if (errors.length !== 0) {
            throw new Error(
              `pass fixture returned ${errors.length} error(s): ${formatErrors(errors)}`,
            );
          }
        } else if (fixture.category === 'errors') {
          if (component === null) {
            throw new Error(
              `errors fixture returned null component; expected non-null with populated errors`,
            );
          }
          if (errors.length === 0) {
            throw new Error(
              `errors fixture returned empty errors array; expected one or more entries`,
            );
          }
        } else {
          // 'null'
          if (component !== null) {
            throw new Error(
              `null fixture returned ${componentKind} component; expected null`,
            );
          }
          if (errors.length === 0) {
            throw new Error(
              `null fixture returned empty errors array; expected explanation of the failure`,
            );
          }
        }
      });
    }
  }
}
