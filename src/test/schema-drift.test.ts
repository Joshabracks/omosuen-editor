/**
 * Schema-drift integration test.
 *
 * For every omosuen release cached under ./local_releases/ and every
 * component type the engine exposes in its `PROPERTY_ALLOWLIST`, assert
 * that the editor's registered schemas account for every allowlist entry.
 *
 * Resolution rule: the schema version used for a given engine release is
 * the largest `since` that is ≤ that engine version (floor-match). See
 * `src/schema/version.ts`.
 *
 * What the test actually asserts per (release × componentType):
 *
 *   1. There exists a ComponentSchemas entry registered for the component.
 *   2. At least one schema version resolves for this release (its `since`
 *      is not newer than the engine version).
 *   3. Every PROPERTY_ALLOWLIST entry for this release appears exactly
 *      once — either in the schema's `fields` (as an inspector field) or
 *      in its `exclude` (explicitly marked as non-UI runtime state).
 *   4. Every schema `fields[].name` and `exclude[]` entry exists in the
 *      engine's allowlist (catches typos and fields the engine removed).
 *
 * All engine component types must have a registered schema. Unschema'd
 * components fail hard — there is no "skip" path — so the registry reflects
 * the complete editor surface at all times.
 *
 * Release loading is shared with engine-fixtures via `engine-context.ts`;
 * each UMD is parsed+evaluated exactly once per test run.
 */

import {
  getComponentSchemas,
  listRegisteredComponents,
  resolveSchema,
} from '../schema/index.js';
import { getCachedReleases } from './engine-context.js';
import { test } from './harness.js';

export async function runSchemaDriftTests(): Promise<void> {
  const releases = await getCachedReleases();

  if (releases.length === 0) {
    test('schema drift: at least one cached release', () => {
      throw new Error(
        'no releases cached; engine-context should have populated them',
      );
    });
    return;
  }

  const registeredComponents = new Set(listRegisteredComponents());

  for (const release of releases) {
    const { version, engine } = release;

    if (engine instanceof Error) {
      test(`[${version}] schema drift: load engine`, () => {
        throw new Error(`engine load failed: ${engine.message}`);
      });
      continue;
    }

    const allowlists = engine.PROPERTY_ALLOWLIST;
    if (!allowlists || typeof allowlists !== 'object') {
      test(`[${version}] schema drift: PROPERTY_ALLOWLIST exported`, () => {
        throw new Error(
          `release ${version} does not expose PROPERTY_ALLOWLIST on its UMD exports`,
        );
      });
      continue;
    }

    const engineComponents = Object.keys(allowlists).sort();

    // 1. Every engine component must have a registered schema.
    for (const componentType of engineComponents) {
      if (!registeredComponents.has(componentType)) {
        test(`[${version}] ${componentType}: schema registered`, () => {
          throw new Error(
            `engine exposes component "${componentType}" but the editor has no schema registered for it`,
          );
        });
      }
    }

    // 2. Every registered schema must correspond to an engine component at
    //    this release (catches stale schemas for components the engine removed).
    for (const componentType of registeredComponents) {
      if (!engineComponents.includes(componentType)) {
        test(`[${version}] ${componentType}: engine still exposes component`, () => {
          throw new Error(
            `editor has a schema for "${componentType}" but release ${version} does not expose that component in PROPERTY_ALLOWLIST`,
          );
        });
      }
    }

    // 3. Per component, resolve the floor-matched schema and compare.
    for (const componentType of engineComponents) {
      if (!registeredComponents.has(componentType)) continue;

      const entry = getComponentSchemas(componentType);
      if (!entry) continue; // covered by check #1 above

      const resolved = resolveSchema(entry.versions, version);
      if (!resolved) {
        const earliest = entry.versions[0]?.since ?? '<none>';
        test(`[${version}] ${componentType}: schema resolves`, () => {
          throw new Error(
            `no schema version applies to release ${version} (earliest registered: ${earliest})`,
          );
        });
        continue;
      }

      const allowlist = allowlists[componentType] ?? [];
      const fieldNames = resolved.fields.map((f) => f.name);
      const excludeNames = resolved.exclude ?? [];

      test(`[${version}] ${componentType}: schema matches PROPERTY_ALLOWLIST`, () => {
        const allowlistSet = new Set(allowlist);
        const fieldSet = new Set(fieldNames);
        const excludeSet = new Set(excludeNames);

        // Duplicate classification: a field can't be both modelled and excluded.
        const bothClassified = fieldNames.filter((n) => excludeSet.has(n));
        if (bothClassified.length > 0) {
          throw new Error(
            `fields appear in both \`fields\` and \`exclude\`: ${bothClassified.join(', ')}`,
          );
        }

        // Every allowlist entry must be classified (modelled or excluded).
        const unclassified = allowlist.filter(
          (name) => !fieldSet.has(name) && !excludeSet.has(name),
        );
        if (unclassified.length > 0) {
          throw new Error(
            `allowlist entries with no schema classification: ${unclassified.join(', ')}`,
          );
        }

        // Schema fields can't reference non-existent allowlist entries.
        const phantomFields = fieldNames.filter((n) => !allowlistSet.has(n));
        if (phantomFields.length > 0) {
          throw new Error(
            `schema fields not in engine PROPERTY_ALLOWLIST: ${phantomFields.join(', ')}`,
          );
        }

        // Exclude entries can't reference non-existent allowlist entries.
        const phantomExcludes = excludeNames.filter(
          (n) => !allowlistSet.has(n),
        );
        if (phantomExcludes.length > 0) {
          throw new Error(
            `exclude entries not in engine PROPERTY_ALLOWLIST: ${phantomExcludes.join(', ')}`,
          );
        }

        // Duplicate field names inside `fields`.
        if (fieldSet.size !== fieldNames.length) {
          const counts = new Map<string, number>();
          for (const n of fieldNames) counts.set(n, (counts.get(n) ?? 0) + 1);
          const dupes = [...counts.entries()]
            .filter(([, c]) => c > 1)
            .map(([n]) => n);
          throw new Error(`duplicate schema fields: ${dupes.join(', ')}`);
        }
      });
    }
  }
}
