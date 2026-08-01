import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPrimaryWindowTitle } from '../shell/window-title';

test('formatPrimaryWindowTitle includes workspace path when open', () => {
  assert.equal(formatPrimaryWindowTitle(null), 'Omosuen Editor');
  assert.equal(
    formatPrimaryWindowTitle('D:\\idk_pros\\colony-forever'),
    'Omosuen Editor — D:\\idk_pros\\colony-forever',
  );
});
