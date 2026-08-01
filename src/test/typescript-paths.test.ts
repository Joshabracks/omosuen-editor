import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isLikelyFilePath,
  normalizePaths,
  normalizeRel,
  stripGlobs,
} from '../views/text-buffer/path-utils';

test('normalizeRel strips ./ and backslashes', () => {
  assert.equal(
    normalizeRel('./node_modules/omosuen/src/index.ts'),
    'node_modules/omosuen/src/index.ts',
  );
  assert.equal(normalizeRel('src\\app.ts'), 'src/app.ts');
});

test('normalizePaths reads tsconfig-style omosuen aliases', () => {
  const paths = normalizePaths({
    omosuen: ['./node_modules/omosuen/src/index.ts'],
    'omosuen/*': ['./node_modules/omosuen/src/*'],
  });
  assert.deepEqual(paths.omosuen, ['./node_modules/omosuen/src/index.ts']);
  assert.equal(
    normalizeRel(stripGlobs(paths['omosuen/*']![0]!)),
    'node_modules/omosuen/src',
  );
});

test('isLikelyFilePath distinguishes path files from glob directories', () => {
  assert.equal(isLikelyFilePath('node_modules/omosuen/src/index.ts'), true);
  assert.equal(isLikelyFilePath('node_modules/omosuen/package.json'), true);
  assert.equal(
    isLikelyFilePath(normalizeRel(stripGlobs('./node_modules/omosuen/src/*'))),
    false,
  );
  assert.equal(isLikelyFilePath('src'), false);
});

test('Monaco ScriptKind suffix must be exactly ts (no fragment/query)', () => {
  function scriptSuffix(fileName: string): string {
    return fileName.slice(fileName.lastIndexOf('.') + 1);
  }
  assert.equal(scriptSuffix('file:///src/app.ts'), 'ts');
  assert.notEqual(scriptSuffix('file:///src/app.ts#buf-1'), 'ts');
  assert.notEqual(scriptSuffix('file:///src/app.ts?tab=1'), 'ts');
});
