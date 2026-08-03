import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import {
  SHELL_DOCK_LAYOUT_KEY,
  SHELL_OPEN_SCENE_KEY,
  SHELL_POPOUTS_KEY,
  SHELL_WORKSPACE_ROOT_KEY,
  readPersistedLayout,
  readPersistedOpenScene,
  readPersistedPopOuts,
  readPersistedWorkspaceRoot,
} from '../dock/persist';
import { LEGACY_BOTTOM_TABS_LAYOUT } from './fixtures/legacy-bottom-tabs';

test('settings keys are stable', () => {
  assert.equal(SHELL_DOCK_LAYOUT_KEY, 'shell.dockLayout');
  assert.equal(SHELL_POPOUTS_KEY, 'shell.popOuts');
  assert.equal(SHELL_WORKSPACE_ROOT_KEY, 'shell.workspaceRoot');
  assert.equal(SHELL_OPEN_SCENE_KEY, 'shell.openScene');
});

test('readPersistedLayout accepts default layout object', () => {
  const layout = createDefaultLayout();
  const again = readPersistedLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(again, layout);
});

test('readPersistedLayout migrates empty-d/empty-e/empty-c/empty-a/empty-b', () => {
  const migrated = readPersistedLayout(LEGACY_BOTTOM_TABS_LAYOUT);
  assert.ok(migrated);
  assert.equal(migrated.root?.type, 'tabs');
  if (migrated.root?.type === 'tabs') {
    assert.deepEqual(migrated.root.tabs, ['output', 'problems']);
    assert.equal(migrated.root.active, 'output');
  }

  const right = readPersistedLayout({
    root: {
      type: 'tabs',
      id: 'right',
      tabs: ['empty-c'],
      active: 'empty-c',
    },
  });
  assert.ok(right && right.root?.type === 'tabs');
  if (right.root?.type === 'tabs') {
    assert.deepEqual(right.root.tabs, ['inspector']);
    assert.equal(right.root.active, 'inspector');
  }

  const left = readPersistedLayout({
    root: {
      type: 'tabs',
      id: 'left',
      tabs: ['empty-a'],
      active: 'empty-a',
    },
  });
  assert.ok(left && left.root?.type === 'tabs');
  if (left.root?.type === 'tabs') {
    assert.deepEqual(left.root.tabs, ['scene-tree']);
    assert.equal(left.root.active, 'scene-tree');
  }

  const center = readPersistedLayout({
    root: {
      type: 'tabs',
      id: 'center',
      tabs: ['empty-b', 'text-buffer'],
      active: 'empty-b',
    },
  });
  assert.ok(center && center.root?.type === 'tabs');
  if (center.root?.type === 'tabs') {
    assert.deepEqual(center.root.tabs, ['viewport', 'text-buffer']);
    assert.equal(center.root.active, 'viewport');
  }
});

test('readPersistedLayout rejects invalid shapes', () => {
  assert.equal(readPersistedLayout(null), null);
  assert.equal(readPersistedLayout([]), null);
  assert.equal(readPersistedLayout({ root: { type: 'tabs', id: 'g', tabs: [] } }), null);
});

test('readPersistedPopOuts filters invalid entries', () => {
  const list = readPersistedPopOuts([
    {
      viewIds: ['empty-a', 'empty-b'],
      x: 10,
      y: 20,
      width: 480,
      height: 320,
    },
    { viewId: 'legacy-c', x: 1, y: 2, width: 500, height: 400 },
    { viewIds: ['bad'], x: 0, y: 0, width: 10, height: 10 },
    null,
  ]);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0]!.viewIds, ['empty-a', 'empty-b']);
  assert.deepEqual(list[1]!.viewIds, ['legacy-c']);
});

test('readPersistedWorkspaceRoot accepts absolute paths', () => {
  assert.equal(
    readPersistedWorkspaceRoot('D:\\idk_pros\\colony-forever'),
    'D:\\idk_pros\\colony-forever',
  );
  assert.equal(readPersistedWorkspaceRoot('  /tmp/game  '), '/tmp/game');
  assert.equal(readPersistedWorkspaceRoot(''), null);
  assert.equal(readPersistedWorkspaceRoot(null), null);
  assert.equal(readPersistedWorkspaceRoot(42), null);
});

test('readPersistedOpenScene accepts workspace-relative .omoscene paths', () => {
  assert.equal(
    readPersistedOpenScene('scenes/Main.omoscene'),
    'scenes/Main.omoscene',
  );
  assert.equal(
    readPersistedOpenScene('scenes\\Main.omoscene'),
    'scenes/Main.omoscene',
  );
  assert.equal(readPersistedOpenScene('Main.omoscene'), 'Main.omoscene');
  assert.equal(readPersistedOpenScene('../escape.omoscene'), null);
  assert.equal(readPersistedOpenScene('/abs/Main.omoscene'), null);
  assert.equal(readPersistedOpenScene('D:/abs/Main.omoscene'), null);
  assert.equal(readPersistedOpenScene('scenes/Main.json'), null);
  assert.equal(readPersistedOpenScene(null), null);
});
