import type { DockViewRegistry } from './registry';
import {
  isSplit,
  isTabGroup,
  type DockNode,
  type SplitNode,
  type TabGroupNode,
} from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTabs(node: TabGroupNode, registry: DockViewRegistry): string {
  const tabs = node.tabs
    .map((viewId) => {
      const title = escapeHtml(registry.get(viewId)?.title ?? viewId);
      const active = viewId === node.active ? ' dock-tab-active' : '';
      return `<button type="button" class="dock-tab${active}" data-dock-tab data-group-id="${escapeHtml(node.id)}" data-view-id="${escapeHtml(viewId)}">${title}</button>`;
    })
    .join('');

  return `<div class="dock-panel" data-kind="tabs" data-node-id="${escapeHtml(node.id)}">
  <div class="dock-titlebar" data-dock-titlebar data-group-id="${escapeHtml(node.id)}" data-active-view="${escapeHtml(node.active)}">
    <div class="dock-tabs">${tabs}</div>
    <div class="dock-titlebar-actions">
      <button type="button" class="dock-popout" data-dock-popout data-view-id="${escapeHtml(node.active)}" title="Pop out">⧉</button>
      <button type="button" class="dock-close" data-dock-close data-view-id="${escapeHtml(node.active)}" title="Close tab">×</button>
    </div>
  </div>
  <div class="dock-panel-body" data-panel-body data-group-id="${escapeHtml(node.id)}" data-active-view="${escapeHtml(node.active)}"></div>
</div>`;
}

function renderSplit(node: SplitNode, registry: DockViewRegistry): string {
  const parts: string[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const grow = node.sizes[i] ?? 1;
    parts.push(
      `<div class="dock-pane" data-child-index="${i}" style="flex-grow:${grow};flex-basis:0;flex-shrink:1;min-width:0;min-height:0">${renderDockNode(node.children[i]!, registry)}</div>`,
    );
    if (i < node.children.length - 1) {
      parts.push(
        `<div class="dock-splitter dock-splitter-${node.direction}" data-dock-splitter data-split-id="${escapeHtml(node.id)}" data-split-index="${i}" data-split-direction="${node.direction}"></div>`,
      );
    }
  }
  return `<div class="dock-split dock-split-${node.direction}" data-kind="split" data-node-id="${escapeHtml(node.id)}">${parts.join('')}</div>`;
}

/** Pure HTML for a dock subtree (used inside the DockChrome State Street component). */
export function renderDockNode(
  node: DockNode | null,
  registry: DockViewRegistry,
): string {
  if (!node) {
    return `<div class="dock-chrome-empty">No panels — reset layout to restore defaults.</div>`;
  }
  if (isTabGroup(node)) return renderTabs(node, registry);
  return renderSplit(node, registry);
}

export function viewHostElementId(viewId: string): string {
  return `dock-view-${viewId}`;
}
