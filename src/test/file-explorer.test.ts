import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_DIR_IGNORE, shouldIgnoreDirEntry } from '../fs/ignore';
import { listDirectory } from '../fs/list-dir';
import { resolveOpenTarget } from '../views/text-buffer/open-target';

test('shouldIgnoreDirEntry skips node_modules and .git by default', () => {
  assert.equal(shouldIgnoreDirEntry('node_modules'), true);
  assert.equal(shouldIgnoreDirEntry('.git'), true);
  assert.equal(shouldIgnoreDirEntry('src'), false);
  assert.ok(DEFAULT_DIR_IGNORE.has('node_modules'));
});

test('listDirectory ignores node_modules and .git by default', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-ignore-'));
  try {
    await fs.mkdir(path.join(dir, 'node_modules'));
    await fs.mkdir(path.join(dir, '.git'));
    await fs.mkdir(path.join(dir, 'src'));
    await fs.writeFile(path.join(dir, 'readme.md'), 'x');
    const entries = await listDirectory(dir);
    assert.deepEqual(
      entries.map((e) => `${e.kind}:${e.name}`),
      ['directory:src', 'file:readme.md'],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('listDirectory can disable ignore set', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-ignore-off-'));
  try {
    await fs.mkdir(path.join(dir, 'node_modules'));
    const entries = await listDirectory(dir, { ignore: new Set() });
    assert.ok(entries.some((e) => e.name === 'node_modules'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('resolveOpenTarget reuses last interacted buffer on single-click', () => {
  assert.deepEqual(
    resolveOpenTarget({
      mode: 'reuse',
      lastInteractedId: 'buf-2',
      activeId: 'buf-1',
      openIds: ['buf-1', 'buf-2'],
    }),
    { kind: 'reuse', bufferId: 'buf-2' },
  );
});

test('resolveOpenTarget creates a buffer when none are open', () => {
  assert.deepEqual(
    resolveOpenTarget({
      mode: 'reuse',
      lastInteractedId: null,
      activeId: null,
      openIds: [],
    }),
    { kind: 'create', preview: false },
  );
});

test('resolveOpenTarget always creates a preview on double-click', () => {
  assert.deepEqual(
    resolveOpenTarget({
      mode: 'new-preview',
      lastInteractedId: 'buf-1',
      activeId: 'buf-1',
      openIds: ['buf-1'],
    }),
    { kind: 'create', preview: true },
  );
});
