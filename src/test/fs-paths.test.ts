import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveWorkspacePath, toWorkspaceRelative } from '../fs/paths';

test('resolveWorkspacePath joins relative paths under root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-ws-'));
  try {
    const resolved = resolveWorkspacePath(root, path.join('src', 'a.ts'));
    assert.equal(resolved, path.resolve(root, 'src', 'a.ts'));
    assert.equal(toWorkspaceRelative(root, resolved), path.join('src', 'a.ts'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveWorkspacePath rejects path escape', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-ws-'));
  try {
    assert.throws(
      () => resolveWorkspacePath(root, path.join('..', 'outside.txt')),
      /outside workspace/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveWorkspacePath accepts absolute path inside root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omosuen-ws-'));
  try {
    const inside = path.join(root, 'readme.md');
    assert.equal(resolveWorkspacePath(root, inside), path.resolve(inside));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('resolveWorkspacePath requires workspace and rejects empty path', () => {
  assert.throws(() => resolveWorkspacePath('', 'a'), /No workspace/);
  assert.throws(() => resolveWorkspacePath('/tmp/x', ''), /Invalid path/);
});
