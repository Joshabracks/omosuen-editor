import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import { collectViewIds } from '../dock/mutations';
import { OUTPUT_VIEW_ID } from '../views/output';
import {
  formatProblemLocation,
  PROBLEMS_VIEW_ID,
} from '../views/problems';

test('default layout hosts Output and Problems on the bottom tabs', () => {
  const ids = collectViewIds(createDefaultLayout().root);
  assert.ok(ids.includes(OUTPUT_VIEW_ID));
  assert.ok(ids.includes(PROBLEMS_VIEW_ID));
});

test('formatProblemLocation includes path, line, column, and source', () => {
  assert.equal(
    formatProblemLocation({
      id: '1',
      severity: 'error',
      message: 'x',
      relativePath: 'src/app.ts',
      line: 12,
      column: 4,
      source: 'ts',
    }),
    'src/app.ts:12:4 · ts',
  );
  assert.equal(
    formatProblemLocation({
      id: '2',
      severity: 'info',
      message: 'y',
      source: 'shell',
    }),
    'shell',
  );
});
