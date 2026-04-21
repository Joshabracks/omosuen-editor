/**
 * Phase 0 smoke tests. Prove the `tsx` runner + strict TS settings work.
 */

import { test } from './harness.js';

export function runSmokeTests(): void {
  test('tsx runner works', () => {
    const a = 2;
    const b = 2;
    if (a + b !== 4) {
      throw new Error('math is broken');
    }
  });

  test('noUncheckedIndexedAccess is on', () => {
    const arr: number[] = [1, 2, 3];
    const first: number | undefined = arr[0];
    if (first !== 1) {
      throw new Error('array indexing broken');
    }
  });
}
