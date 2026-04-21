/**
 * Version-comparison helpers.
 *
 * The engine tags releases like `v0.1.30`, `v0.2.0`. This module treats those
 * strings as dotted numeric tuples with an optional leading `v`. Pre-release
 * suffixes (`-beta.1`, etc.) are not parsed — if the engine ever adopts them,
 * this module needs revisiting.
 */

import type { ComponentSchemaVersion } from './types.js';

function parseVersion(raw: string): number[] {
  const stripped = raw.startsWith('v') ? raw.slice(1) : raw;
  return stripped.split('.').map((segment) => {
    const n = Number.parseInt(segment, 10);
    if (Number.isNaN(n)) {
      throw new Error(`invalid version string: ${JSON.stringify(raw)}`);
    }
    return n;
  });
}

/**
 * Compare two version strings.
 *
 * Returns -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`.
 * Shorter versions are zero-extended: `v0.1` compares as `v0.1.0`.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Return the schema version with the largest `since` that is ≤ engineVersion.
 *
 * If no version applies (every `since` is newer than the engine version), or
 * the input list is empty, returns `null`.
 */
export function resolveSchema(
  versions: readonly ComponentSchemaVersion[],
  engineVersion: string,
): ComponentSchemaVersion | null {
  let best: ComponentSchemaVersion | null = null;
  for (const version of versions) {
    if (compareVersions(version.since, engineVersion) <= 0) {
      if (!best || compareVersions(version.since, best.since) > 0) {
        best = version;
      }
    }
  }
  return best;
}
