import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { atomicWriteFile } from '../fs/atomic-write';
import { listDirectory } from '../fs/list-dir';

test('atomicWriteFile creates and replaces file contents', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-atomic-'));
  const file = path.join(dir, 'note.txt');
  try {
    await atomicWriteFile(file, 'one');
    assert.equal(await fs.readFile(file, 'utf8'), 'one');
    await atomicWriteFile(file, 'two');
    assert.equal(await fs.readFile(file, 'utf8'), 'two');

    const leftovers = await fs.readdir(dir);
    assert.equal(
      leftovers.some((name) => name.endsWith('.tmp')),
      false,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('atomicWriteFile creates parent directories', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-atomic-'));
  const file = path.join(dir, 'nested', 'deep', 'file.txt');
  try {
    await atomicWriteFile(file, 'nested');
    assert.equal(await fs.readFile(file, 'utf8'), 'nested');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('listDirectory sorts directories first and skips tmp files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-list-'));
  try {
    await fs.mkdir(path.join(dir, 'b-dir'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'x');
    await fs.writeFile(path.join(dir, '.secret.tmp'), 'tmp');
    const entries = await listDirectory(dir);
    assert.deepEqual(
      entries.map((e) => `${e.kind}:${e.name}`),
      ['directory:b-dir', 'file:a.txt'],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
