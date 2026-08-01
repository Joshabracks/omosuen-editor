import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { withTempDir } from './helpers';

test('withTempDir creates a directory and removes it afterward', async () => {
  let created = '';
  await withTempDir('omosuen-harness-', async (dir) => {
    created = dir;
    const st = await fs.stat(dir);
    assert.ok(st.isDirectory());
    await fs.writeFile(path.join(dir, 'probe.txt'), 'ok');
  });
  await assert.rejects(() => fs.stat(created), /ENOENT/);
});
