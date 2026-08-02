import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import { hitTestDropZone } from '../dock/drop';
import {
  closeTab,
  collectViewIds,
  createIdFactory,
  createSingleViewLayout,
  findTabGroupForView,
  insertView,
  moveView,
  setActiveTab,
  setSplitSizes,
} from '../dock/mutations';
import { parseLayout, serializeLayout } from '../dock/serialize';
import {
  createSplit,
  createTabGroup,
  isSplit,
  isTabGroup,
  type DockLayout,
} from '../dock/types';

test('default layout is serializable round-trip', () => {
  const layout = createDefaultLayout();
  const json = serializeLayout(layout);
  const again = parseLayout(json);
  assert.deepEqual(again, layout);
  assert.deepEqual(collectViewIds(again.root).sort(), [
    'empty-b',
    'file-explorer',
    'inspector',
    'output',
    'problems',
    'text-buffer',
  ]);
});

test('closeTab collapses empty groups and unwraps splits', () => {
  const start: DockLayout = {
    root: createSplit('s1', 'horizontal', [
      createTabGroup('g1', ['a']),
      createTabGroup('g2', ['b']),
    ]),
  };
  const afterA = closeTab(start, 'a');
  assert.ok(afterA.root && isTabGroup(afterA.root));
  assert.deepEqual(afterA.root.tabs, ['b']);

  const afterB = closeTab(afterA, 'b');
  assert.equal(afterB.root, null);
});

test('setActiveTab and setSplitSizes', () => {
  const start: DockLayout = {
    root: createSplit('s1', 'horizontal', [
      createTabGroup('g1', ['a', 'b'], 'a'),
      createTabGroup('g2', ['c']),
    ]),
  };
  const activated = setActiveTab(start, 'g1', 'b');
  const g1 = findTabGroupForView(activated.root, 'b');
  assert.equal(g1?.active, 'b');

  const resized = setSplitSizes(activated, 's1', [0.3, 0.7]);
  assert.ok(resized.root && isSplit(resized.root));
  assert.equal(resized.root.sizes[0]! + resized.root.sizes[1]!, 1);
  assert.ok(Math.abs(resized.root.sizes[0]! - 0.3) < 1e-9);
});

test('moveView center drop adds tab', () => {
  const ids = createIdFactory('t');
  const start: DockLayout = {
    root: createSplit('s1', 'horizontal', [
      createTabGroup('g1', ['a']),
      createTabGroup('g2', ['b']),
    ]),
  };
  const moved = moveView(start, 'a', { kind: 'tab', groupId: 'g2' }, ids);
  assert.ok(moved.root && isTabGroup(moved.root));
  assert.deepEqual(moved.root.tabs, ['b', 'a']);
  assert.equal(moved.root.active, 'a');
});

test('moveView edge drop creates split', () => {
  const ids = createIdFactory('t');
  const start: DockLayout = {
    root: createTabGroup('g1', ['a', 'b'], 'a'),
  };
  const moved = moveView(
    start,
    'a',
    { kind: 'split', targetId: 'g1', edge: 'right' },
    ids,
  );
  assert.ok(moved.root && isSplit(moved.root));
  assert.equal(moved.root.direction, 'horizontal');
  assert.equal(moved.root.children.length, 2);
  assert.deepEqual(collectViewIds(moved.root).sort(), ['a', 'b']);
});

test('hitTestDropZone maps edges and center', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal(hitTestDropZone(10, 50, rect), 'left');
  assert.equal(hitTestDropZone(90, 50, rect), 'right');
  assert.equal(hitTestDropZone(50, 10, rect), 'top');
  assert.equal(hitTestDropZone(50, 90, rect), 'bottom');
  assert.equal(hitTestDropZone(50, 50, rect), 'center');
});

test('parseLayout rejects invalid JSON shapes', () => {
  assert.throws(() => parseLayout('[]'), /object/);
  assert.throws(
    () =>
      parseLayout(
        JSON.stringify({ root: { type: 'tabs', id: 'g', tabs: [] } }),
      ),
    /tabs/,
  );
});

test('createSingleViewLayout hosts one view for pop-out windows', () => {
  const layout = createSingleViewLayout('inspector');
  assert.ok(layout.root && isTabGroup(layout.root));
  assert.deepEqual(layout.root.tabs, ['inspector']);
  assert.equal(layout.root.active, 'inspector');
});

test('insertView re-docks a missing view into the first tab group', () => {
  const ids = createIdFactory('t');
  const start = closeTab(createDefaultLayout(), 'file-explorer');
  assert.equal(collectViewIds(start.root).includes('file-explorer'), false);
  const again = insertView(start, 'file-explorer', ids);
  assert.equal(collectViewIds(again.root).includes('file-explorer'), true);
  const group = findTabGroupForView(again.root, 'file-explorer');
  assert.equal(group?.active, 'file-explorer');
});

test('insertView into empty layout creates a single tab group', () => {
  const ids = createIdFactory('t');
  const next = insertView({ root: null }, 'empty-b', ids);
  assert.ok(next.root && isTabGroup(next.root));
  assert.deepEqual(next.root.tabs, ['empty-b']);
});

test('insertView with split target places beside an existing group', () => {
  const ids = createIdFactory('t');
  const start: DockLayout = {
    root: createTabGroup('g1', ['a']),
  };
  const next = insertView(start, 'b', ids, {
    kind: 'split',
    targetId: 'g1',
    edge: 'right',
  });
  assert.ok(next.root && isSplit(next.root));
  assert.deepEqual(collectViewIds(next.root).sort(), ['a', 'b']);
});
