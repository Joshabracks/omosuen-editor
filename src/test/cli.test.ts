/**
 * Phase 0 smoke test. Exists solely to prove the `tsx` runner works and
 * that `npm run test:cli` exits cleanly. Real tests land in Phase 2+.
 */

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`\u2713 ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\u2717 ${name}: ${msg}`);
    failures += 1;
  }
}

test('tsx runner works', () => {
  const a = 2;
  const b = 2;
  if (a + b !== 4) {
    throw new Error('math is broken');
  }
});

test('noUncheckedIndexedAccess is on', () => {
  // If noUncheckedIndexedAccess is active, arr[0] is typed T | undefined.
  // This test doesn't assert type-level behaviour (tsc would catch that),
  // but it confirms the runtime reaches here without error under strict mode.
  const arr: number[] = [1, 2, 3];
  const first: number | undefined = arr[0];
  if (first !== 1) {
    throw new Error('array indexing broken');
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}

console.log('\nAll tests passed.');
