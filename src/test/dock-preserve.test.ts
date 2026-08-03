import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultLayout } from '../dock/default-layout';
import { DockViewRegistry, registerPlaceholderViews } from '../dock/registry';
import { renderDockNode, viewHostElementId } from '../dock/render';
import { collectViewIds } from '../dock/mutations';

test('viewHostElementId is stable per viewId', () => {
  assert.equal(viewHostElementId('scene-tree'), 'dock-view-scene-tree');
  assert.equal(viewHostElementId('viewport'), 'dock-view-viewport');
});

test('renderDockNode emits panel bodies for each tab group', () => {
  const registry = new DockViewRegistry();
  registerPlaceholderViews(registry);
  registry.register({
    id: 'viewport',
    title: 'Viewport',
    mount: () => undefined,
  });
  registry.register({
    id: 'scene-tree',
    title: 'Scene',
    mount: () => undefined,
  });
  registry.register({
    id: 'file-explorer',
    title: 'Files',
    mount: () => undefined,
  });
  registry.register({
    id: 'text-buffer',
    title: 'Editors',
    mount: () => undefined,
  });
  registry.register({
    id: 'inspector',
    title: 'Inspector',
    mount: () => undefined,
  });
  registry.register({
    id: 'output',
    title: 'Output',
    mount: () => undefined,
  });
  registry.register({
    id: 'problems',
    title: 'Problems',
    mount: () => undefined,
  });
  const html = renderDockNode(createDefaultLayout().root, registry);
  assert.match(html, /data-panel-body/);
  assert.match(html, /data-active-view="scene-tree"/);
  assert.match(html, /data-active-view="viewport"/);
  assert.match(html, /data-dock-splitter/);
  assert.match(html, /data-dock-popout/);
  for (const id of collectViewIds(createDefaultLayout().root)) {
    assert.match(html, new RegExp(`data-view-id="${id}"|data-active-view="${id}"`));
  }
});
