/**
 * Build a PROPERTY_ALLOWLIST-shaped fixture from registered contributions.
 * Used by the drift test until CI loads a live engine UMD (optional later).
 */

import {
  fieldRootName,
  getEditorTypeEntry,
  listEditorTypes,
  type ResolvedEditorType,
  resolveEditorType,
} from '../editor-api';

export type PropertyAllowlistFixture = Record<string, readonly string[]>;

export function buildAllowlistFixtureFromRegistry(
  engineVersion = 'v9.9.9',
): PropertyAllowlistFixture {
  const out: Record<string, string[]> = {};
  for (const type of listEditorTypes()) {
    const resolved = resolveEditorType(type, engineVersion);
    if (!resolved) {
      const entry = getEditorTypeEntry(type);
      const oldest = entry?.versions[0];
      if (!oldest) continue;
      out[type] = allowlistKeysFromContribution(oldest);
      continue;
    }
    out[type] = allowlistKeysFromContribution(resolved);
  }
  return out;
}

function allowlistKeysFromContribution(
  resolved: Pick<ResolvedEditorType, 'fields'> & {
    readonly excludeFromInspector?: readonly string[];
  },
): string[] {
  const keys = new Set<string>();
  for (const field of resolved.fields) {
    keys.add(fieldRootName(field.name));
  }
  for (const ex of resolved.excludeFromInspector ?? []) {
    keys.add(ex);
  }
  return Array.from(keys).sort();
}

/**
 * Assert schema fields+excludes cover `allowlist` exactly (rooted).
 * Returns error messages (empty = pass).
 */
export function driftErrorsForComponent(
  allowlist: readonly string[],
  resolved: ResolvedEditorType,
): string[] {
  const errors: string[] = [];
  const allowlistSet = new Set(allowlist);
  const excludeSet = new Set(resolved.excludeFromInspector);
  const fieldRoots = resolved.fields.map((f) => fieldRootName(f.name));
  const fieldRootSet = new Set(fieldRoots);

  const both = fieldRoots.filter((n) => excludeSet.has(n));
  if (both.length > 0) {
    errors.push(
      `in both fields and exclude: ${[...new Set(both)].join(', ')}`,
    );
  }

  const unclassified = allowlist.filter(
    (name) => !fieldRootSet.has(name) && !excludeSet.has(name),
  );
  if (unclassified.length > 0) {
    errors.push(`allowlist missing from schema: ${unclassified.join(', ')}`);
  }

  for (const root of fieldRootSet) {
    if (!allowlistSet.has(root)) {
      errors.push(`schema field root not in allowlist: ${root}`);
    }
  }
  for (const ex of excludeSet) {
    if (!allowlistSet.has(ex)) {
      errors.push(`exclude not in allowlist: ${ex}`);
    }
  }

  return errors;
}
