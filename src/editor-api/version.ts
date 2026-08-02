import type { EditorTypeContribution, ResolvedEditorType } from './types';

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
 * Compare two engine version tags (`v0.1.30` style).
 * Returns -1 / 0 / 1. Shorter versions zero-extend.
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
 * Largest contribution `since` that is ≤ engineVersion, or null.
 */
export function resolveEditorTypeVersion(
  versions: readonly EditorTypeContribution[],
  engineVersion: string,
): EditorTypeContribution | null {
  let best: EditorTypeContribution | null = null;
  for (const version of versions) {
    if (compareVersions(version.since, engineVersion) <= 0) {
      if (!best || compareVersions(version.since, best.since) > 0) {
        best = version;
      }
    }
  }
  return best;
}

export function toResolved(
  contribution: EditorTypeContribution,
): ResolvedEditorType {
  return {
    type: contribution.type,
    since: contribution.since,
    icon: contribution.icon,
    uniqueness: contribution.uniqueness,
    fields: contribution.fields,
    actions: contribution.actions ?? [],
    viewport: contribution.viewport,
    excludeFromInspector: contribution.excludeFromInspector ?? [],
  };
}

/** Allowlist root for a possibly dotted field name. */
export function fieldRootName(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}
