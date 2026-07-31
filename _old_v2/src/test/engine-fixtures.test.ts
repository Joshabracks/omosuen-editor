/**
 * Engine-fixtures integration test.
 *
 * For every omosuen release cached under ./local_releases/ and every fixture
 * under ./omoscene-fixtures/, hand the fixture's scene region to the
 * engine's `deserializeComponentRecursive` and assert that the result
 * matches the fixture's category:
 *
 *   - pass/*   → component non-null AND errors array empty
 *   - errors/* → component non-null AND errors array non-empty
 *   - null/*   → component null
 *
 * Release syncing, UMD loading, and browser-global stubs are owned by
 * `engine-context.ts`, which both this suite and schema-drift share so
 * each UMD is loaded exactly once per test run.
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

import type { EngineError } from './engine-context.js';
import { getCachedReleases } from './engine-context.js';
import { loadSceneFixtures } from './fixtures.js';
import { test } from './harness.js';

interface DeserializeOutcome {
  component: unknown;
  errors: EngineError[];
}

type AssertionResult = DeserializeOutcome | Error;

function formatErrors(errs: EngineError[]): string {
  return errs.map((e) => e.code).join(', ');
}

export async function runEngineFixtureTests(): Promise<void> {
  const releases = await getCachedReleases();
  const fixtures = loadSceneFixtures();

  if (releases.length === 0) {
    test('engine fixtures: at least one cached release', () => {
      throw new Error('no releases cached; sync-releases found none on GitHub');
    });
    return;
  }

  // Pre-compute outcomes: the harness's `test()` is synchronous, but
  // `deserializeComponentRecursive` is async, so we run deserialization
  // up front and register assertions afterward.
  const outcomes = new Map<string, AssertionResult>();
  for (const release of releases) {
    if (release.engine instanceof Error) {
      const message = release.engine.message;
      for (const fixture of fixtures) {
        outcomes.set(
          `${release.version} :: ${fixture.name}`,
          new Error(`engine load failed for ${release.version}: ${message}`),
        );
      }
      continue;
    }

    for (const fixture of fixtures) {
      const key = `${release.version} :: ${fixture.name}`;
      try {
        const result = await release.engine.deserializeComponentRecursive(
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

  // Register assertions.
  for (const release of releases) {
    for (const fixture of fixtures) {
      const key = `${release.version} :: ${fixture.name}`;
      const outcome = outcomes.get(key);
      test(`[${release.version}] ${fixture.name}`, () => {
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
