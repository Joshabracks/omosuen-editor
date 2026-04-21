/**
 * Shared test harness for the tsx-run logic test suite.
 * Kept deliberately minimal — no framework, no DOM, no mocking library.
 * Each *.test.ts file exports a run* function that calls `test(name, fn)`;
 * cli.test.ts orchestrates the suite and calls `reportAndExit()` at the end.
 */

let failures = 0;

export function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`\u2713 ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\u2717 ${name}: ${msg}`);
    failures += 1;
  }
}

export function expectThrow(fn: () => void, errorName?: string): void {
  try {
    fn();
  } catch (err) {
    if (errorName && (!(err instanceof Error) || err.name !== errorName)) {
      throw new Error(
        `expected error with name "${errorName}", got ${
          err instanceof Error ? err.name : typeof err
        }`,
      );
    }
    return;
  }
  throw new Error(
    errorName
      ? `expected function to throw ${errorName}`
      : 'expected function to throw',
  );
}

export function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  path = '',
): void {
  const label = path || 'root';

  if (actual === expected) return;

  if (actual === null || expected === null) {
    throw new Error(
      `mismatch at ${label}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
    );
  }

  if (typeof actual !== typeof expected) {
    throw new Error(
      `type mismatch at ${label}: ${typeof actual} vs ${typeof expected}`,
    );
  }

  if (typeof actual !== 'object') {
    throw new Error(
      `value mismatch at ${label}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`,
    );
  }

  const actualIsArray = Array.isArray(actual);
  const expectedIsArray = Array.isArray(expected);
  if (actualIsArray !== expectedIsArray) {
    throw new Error(`array/object mismatch at ${label}`);
  }

  if (actualIsArray && expectedIsArray) {
    if (actual.length !== expected.length) {
      throw new Error(
        `array length mismatch at ${label}: ${actual.length} vs ${expected.length}`,
      );
    }
    for (let i = 0; i < actual.length; i += 1) {
      assertDeepEqual(actual[i], expected[i], `${path}[${i}]`);
    }
    return;
  }

  // Both `actual` and `expected` are declared `unknown` because this utility
  // compares arbitrary values. After the non-null / non-array / object narrows
  // above, "object with string keys and unknown values" is the literal type —
  // not an escape hatch.
  const actualObj = actual as Record<string, unknown>;
  const expectedObj = expected as Record<string, unknown>;
  const aKeys = Object.keys(actualObj).sort();
  const eKeys = Object.keys(expectedObj).sort();
  if (aKeys.length !== eKeys.length || aKeys.some((k, i) => k !== eKeys[i])) {
    throw new Error(
      `key set mismatch at ${label}: [${aKeys.join(',')}] vs [${eKeys.join(',')}]`,
    );
  }

  for (const k of aKeys) {
    assertDeepEqual(actualObj[k], expectedObj[k], path ? `${path}.${k}` : k);
  }
}

export function reportAndExit(): void {
  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll tests passed.');
}
