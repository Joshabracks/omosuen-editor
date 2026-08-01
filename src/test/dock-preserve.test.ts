import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import { DockViewRegistry, registerPlaceholderViews } from '../dock/registry';
import { renderDockNode, viewHostElementId } from '../dock/render';
import { collectViewIds } from '../dock/mutations';

test('viewHostElementId is stable per viewId', () => {
  assert.equal(viewHostElementId('empty-a'), 'dock-view-empty-a');
  assert.equal(viewHostElementId('empty-b'), 'dock-view-empty-b');
});

test('renderDockNode emits panel bodies for each tab group', () => {
  const registry = new DockViewRegistry();
  registerPlaceholderViews(registry);
  const html = renderDockNode(createDefaultLayout().root, registry);
  assert.match(html, /data-panel-body/);
  assert.match(html, /data-active-view="file-explorer"/);
  assert.match(html, /data-active-view="empty-b"/);
  assert.match(html, /data-dock-splitter/);
  assert.match(html, /data-dock-popout/);
  for (const id of collectViewIds(createDefaultLayout().root)) {
    assert.match(html, new RegExp(`data-view-id="${id}"|data-active-view="${id}"`));
  }
});
