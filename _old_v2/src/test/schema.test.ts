/**
 * Unit tests for schema-version resolution. These are fast, synchronous, and
 * self-contained — no engine loading, no GitHub traffic. The actual drift
 * assertion against live engine releases lives in schema-drift.test.ts.
 */

import type { ComponentSchemaVersion } from '../schema/index.js';
import { compareVersions, resolveSchema } from '../schema/index.js';
import { expectThrow, test } from './harness.js';

function v(
  since: string,
  tag?: string,
): ComponentSchemaVersion & { tag?: string } {
  return { since, fields: [], tag };
}

export function runSchemaTests(): void {
  // --- compareVersions -----------------------------------------------------

  test('compareVersions: equal versions', () => {
    if (compareVersions('v0.1.30', 'v0.1.30') !== 0) {
      throw new Error('expected 0 for equal versions');
    }
  });

  test('compareVersions: strips leading v consistently', () => {
    if (compareVersions('v0.1.30', '0.1.30') !== 0) {
      throw new Error('leading v should not affect comparison');
    }
  });

  test('compareVersions: patch ordering', () => {
    if (compareVersions('v0.1.30', 'v0.1.31') !== -1) {
      throw new Error('expected v0.1.30 < v0.1.31');
    }
    if (compareVersions('v0.1.31', 'v0.1.30') !== 1) {
      throw new Error('expected v0.1.31 > v0.1.30');
    }
  });

  test('compareVersions: minor ordering beats large patch', () => {
    if (compareVersions('v0.2.0', 'v0.1.99') !== 1) {
      throw new Error('expected v0.2.0 > v0.1.99');
    }
  });

  test('compareVersions: shorter versions zero-extend', () => {
    if (compareVersions('v0.1', 'v0.1.0') !== 0) {
      throw new Error('expected v0.1 == v0.1.0');
    }
    if (compareVersions('v0.1', 'v0.1.1') !== -1) {
      throw new Error('expected v0.1 < v0.1.1');
    }
  });

  test('compareVersions: rejects non-numeric segments', () => {
    expectThrow(() => compareVersions('v0.1.beta', 'v0.1.0'));
  });

  // --- resolveSchema -------------------------------------------------------

  test('resolveSchema: empty list returns null', () => {
    if (resolveSchema([], 'v0.1.30') !== null) {
      throw new Error('expected null for empty list');
    }
  });

  test('resolveSchema: all versions too new returns null', () => {
    const versions = [v('v0.2.0'), v('v0.3.0')];
    if (resolveSchema(versions, 'v0.1.30') !== null) {
      throw new Error('expected null when every since > engineVersion');
    }
  });

  test('resolveSchema: exact match picks that version', () => {
    const target = v('v0.1.30', 'target');
    const versions = [target, v('v0.2.0', 'other')];
    const picked = resolveSchema(versions, 'v0.1.30') as
      | (ComponentSchemaVersion & { tag?: string })
      | null;
    if (picked?.tag !== 'target') {
      throw new Error(
        `expected exact-match target, got ${String(picked?.tag)}`,
      );
    }
  });

  test('resolveSchema: floor-match picks largest since ≤ engineVersion', () => {
    const versions = [v('v0.1.30', 'a'), v('v0.1.34', 'b'), v('v0.1.36', 'c')];
    const picked = resolveSchema(versions, 'v0.1.35') as
      | (ComponentSchemaVersion & { tag?: string })
      | null;
    if (picked?.tag !== 'b') {
      throw new Error(
        `expected v0.1.34 (tag 'b') for engine v0.1.35, got ${String(picked?.tag)}`,
      );
    }
  });

  test('resolveSchema: picks oldest applicable when all qualify', () => {
    const versions = [v('v0.1.30', 'a'), v('v0.1.34', 'b')];
    const picked = resolveSchema(versions, 'v0.1.32') as
      | (ComponentSchemaVersion & { tag?: string })
      | null;
    if (picked?.tag !== 'a') {
      throw new Error(
        `expected v0.1.30 for engine v0.1.32, got ${String(picked?.tag)}`,
      );
    }
  });

  test('resolveSchema: picks newest when engine is past the latest entry', () => {
    const versions = [v('v0.1.30', 'a'), v('v0.1.34', 'b')];
    const picked = resolveSchema(versions, 'v0.9.0') as
      | (ComponentSchemaVersion & { tag?: string })
      | null;
    if (picked?.tag !== 'b') {
      throw new Error(
        `expected v0.1.34 for engine v0.9.0, got ${String(picked?.tag)}`,
      );
    }
  });

  test('resolveSchema: unordered input still returns correct floor-match', () => {
    const versions = [v('v0.1.36', 'c'), v('v0.1.30', 'a'), v('v0.1.34', 'b')];
    const picked = resolveSchema(versions, 'v0.1.35') as
      | (ComponentSchemaVersion & { tag?: string })
      | null;
    if (picked?.tag !== 'b') {
      throw new Error(
        `expected v0.1.34 regardless of input order, got ${String(picked?.tag)}`,
      );
    }
  });
}
