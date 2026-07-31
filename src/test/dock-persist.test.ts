import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import {
  SHELL_DOCK_LAYOUT_KEY,
  SHELL_POPOUTS_KEY,
  readPersistedLayout,
  readPersistedPopOuts,
} from '../dock/persist';

test('settings keys are stable', () => {
  assert.equal(SHELL_DOCK_LAYOUT_KEY, 'shell.dockLayout');
  assert.equal(SHELL_POPOUTS_KEY, 'shell.popOuts');
});

test('readPersistedLayout accepts default layout object', () => {
  const layout = createDefaultLayout();
  const again = readPersistedLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(again, layout);
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
