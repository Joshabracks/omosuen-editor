import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveWorkspacePath, toWorkspaceRelative } from '../fs/paths';
import { withTempDir } from './helpers';

test('resolveWorkspacePath joins relative paths under root', async () => {
  await withTempDir('omosuen-ws-', async (root) => {
    const resolved = resolveWorkspacePath(root, path.join('src', 'a.ts'));
    assert.equal(resolved, path.resolve(root, 'src', 'a.ts'));
    assert.equal(toWorkspaceRelative(root, resolved), path.join('src', 'a.ts'));
  });
});

test('resolveWorkspacePath rejects path escape', async () => {
  await withTempDir('omosuen-ws-', async (root) => {
    assert.throws(
      () => resolveWorkspacePath(root, path.join('..', 'outside.txt')),
      /outside workspace/,
    );
  });
});

test('resolveWorkspacePath accepts absolute path inside root', async () => {
  await withTempDir('omosuen-ws-', async (root) => {
    const inside = path.join(root, 'readme.md');
    assert.equal(resolveWorkspacePath(root, inside), path.resolve(inside));
  });
});

test('resolveWorkspacePath requires workspace and rejects empty path', () => {
  assert.throws(() => resolveWorkspacePath('', 'a'), /No workspace/);
  assert.throws(() => resolveWorkspacePath('/tmp/x', ''), /Invalid path/);
});
