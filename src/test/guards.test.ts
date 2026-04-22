/**
 * Unit tests for `src/util/guards.ts`. Tiny by design — the guard is
 * just enough to have consolidated two near-duplicate implementations
 * into one (Phase 3.5.9).
 */

import { isRecord } from '../util/guards.js';
import { test } from './harness.js';

export function runGuardsTests(): void {
  test('isRecord: accepts plain objects', () => {
    if (!isRecord({})) throw new Error('{} should be a record');
    if (!isRecord({ a: 1, b: 'x' })) {
      throw new Error('{a:1,b:"x"} should be a record');
    }
    if (!isRecord(Object.create(null))) {
      throw new Error('Object.create(null) should be a record');
    }
  });

  test('isRecord: rejects null', () => {
    if (isRecord(null)) throw new Error('null must not be a record');
  });

  test('isRecord: rejects undefined', () => {
    if (isRecord(undefined)) throw new Error('undefined must not be a record');
  });

  test('isRecord: rejects arrays', () => {
    if (isRecord([])) throw new Error('[] must not be a record');
    if (isRecord([1, 2, 3])) {
      throw new Error('non-empty array must not be a record');
    }
  });

  test('isRecord: rejects primitives', () => {
    if (isRecord(42)) throw new Error('number must not be a record');
    if (isRecord('str')) throw new Error('string must not be a record');
    if (isRecord(true)) throw new Error('boolean must not be a record');
    if (isRecord(Symbol('s'))) throw new Error('symbol must not be a record');
  });
}
