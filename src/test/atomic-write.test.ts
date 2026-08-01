import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { atomicWriteFile } from '../fs/atomic-write';
import { listDirectory } from '../fs/list-dir';
import { withTempDir } from './helpers';

test('atomicWriteFile creates and replaces file contents', async () => {
  await withTempDir('omosuen-atomic-', async (dir) => {
    const file = path.join(dir, 'note.txt');
    await atomicWriteFile(file, 'one');
    assert.equal(await fs.readFile(file, 'utf8'), 'one');
    await atomicWriteFile(file, 'two');
    assert.equal(await fs.readFile(file, 'utf8'), 'two');

    const leftovers = await fs.readdir(dir);
    assert.equal(
      leftovers.some((name) => name.endsWith('.tmp')),
      false,
    );
  });
});

test('atomicWriteFile creates parent directories', async () => {
  await withTempDir('omosuen-atomic-', async (dir) => {
    const file = path.join(dir, 'nested', 'deep', 'file.txt');
    await atomicWriteFile(file, 'nested');
    assert.equal(await fs.readFile(file, 'utf8'), 'nested');
  });
});

test('listDirectory sorts directories first and skips tmp files', async () => {
  await withTempDir('omosuen-list-', async (dir) => {
    await fs.mkdir(path.join(dir, 'b-dir'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'x');
    await fs.writeFile(path.join(dir, '.secret.tmp'), 'tmp');
    const entries = await listDirectory(dir);
    assert.deepEqual(
      entries.map((e) => `${e.kind}:${e.name}`),
      ['directory:b-dir', 'file:a.txt'],
    );
  });
});
