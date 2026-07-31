import {
  createSplit,
  createTabGroup,
  equalSizes,
  isSplit,
  isTabGroup,
  normalizeSizes,
  type DockLayout,
  type DockNode,
  type DropEdge,
  type DropTarget,
  type SplitDirection,
  type SplitNode,
  type TabGroupNode,
  type ViewId,
} from './types';

export type IdFactory = () => string;

export function createIdFactory(prefix = 'n'): IdFactory {
  let i = 0;
  return () => `${prefix}${++i}`;
}

export function findNode(root: DockNode | null, id: string): DockNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  if (isSplit(root)) {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function findTabGroupForView(
  root: DockNode | null,
  viewId: ViewId,
): TabGroupNode | null {
  if (!root) return null;
  if (isTabGroup(root) && root.tabs.includes(viewId)) return root;
  if (isSplit(root)) {
    for (const child of root.children) {
      const found = findTabGroupForView(child, viewId);
      if (found) return found;
    }
  }
  return null;
}

export function collectViewIds(root: DockNode | null): ViewId[] {
  if (!root) return [];
  if (isTabGroup(root)) return [...root.tabs];
  return root.children.flatMap((child) => collectViewIds(child));
}

export function findFirstTabGroup(
  root: DockNode | null,
): TabGroupNode | null {
  if (!root) return null;
  if (isTabGroup(root)) return root;
  for (const child of root.children) {
    const found = findFirstTabGroup(child);
    if (found) return found;
  }
  return null;
}

/** Single-tab layout for a pop-out BrowserWindow. */
export function createSingleViewLayout(
  viewId: ViewId,
  groupId = 'tabs-popout',
): DockLayout {
  return { root: createTabGroup(groupId, [viewId], viewId) };
}

/** Pop-out layout hosting one or more views as a tab group. */
export function createPopOutLayout(
  viewIds: readonly ViewId[],
  groupId = 'tabs-popout',
): DockLayout {
  if (viewIds.length === 0) {
    return { root: null };
  }
  return {
    root: createTabGroup(groupId, [...viewIds], viewIds[0]),
  };
}

/**
 * Insert a view that is not currently in the layout (re-dock after pop-out).
 * Prefer appending to the first tab group; otherwise split beside the root.
 * When `target` is provided, place at that drop affordance instead.
 */
export function insertView(
  layout: DockLayout,
  viewId: ViewId,
  newId: IdFactory,
  target?: DropTarget | null,
): DockLayout {
  if (collectViewIds(layout.root).includes(viewId)) {
    if (target) return moveView(layout, viewId, target, newId);
    const group = findTabGroupForView(layout.root, viewId);
    return group ? setActiveTab(layout, group.id, viewId) : layout;
  }
  if (!layout.root) {
    return { root: createTabGroup(newId(), [viewId], viewId) };
  }
  if (target) {
    return { root: placeViewInTree(layout.root, viewId, target, newId) };
  }
  const group = findFirstTabGroup(layout.root);
  if (!group) {
    return { root: insertOrphan(layout.root, viewId, newId) };
  }
  const nextGroup: TabGroupNode = {
    ...group,
    tabs: [...group.tabs, viewId],
    active: viewId,
  };
  return { root: replaceNode(layout.root, group.id, nextGroup) };
}

function replaceNode(
  root: DockNode,
  id: string,
  next: DockNode | null,
): DockNode | null {
  if (root.id === id) return next;
  if (!isSplit(root)) return root;

  const children: DockNode[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!;
    const replaced = replaceNode(child, id, next);
    if (replaced) {
      children.push(replaced);
      sizes.push(root.sizes[i] ?? 1);
    }
  }

  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return {
    ...root,
    children,
    sizes: normalizeSizes(sizes),
  };
}

function removeViewFromTree(
  root: DockNode,
  viewId: ViewId,
): DockNode | null {
  if (isTabGroup(root)) {
    if (!root.tabs.includes(viewId)) return root;
    const tabs = root.tabs.filter((t) => t !== viewId);
    if (tabs.length === 0) return null;
    const active =
      root.active === viewId
        ? tabs[Math.max(0, root.tabs.indexOf(viewId) - 1)]!
        : root.active;
    return { ...root, tabs, active };
  }

  const children: DockNode[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!;
    const next = removeViewFromTree(child, viewId);
    if (next) {
      children.push(next);
      sizes.push(root.sizes[i] ?? 1);
    }
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return { ...root, children, sizes: normalizeSizes(sizes) };
}

export function setActiveTab(
  layout: DockLayout,
  groupId: string,
  viewId: ViewId,
): DockLayout {
  if (!layout.root) return layout;
  const group = findNode(layout.root, groupId);
  if (!group || !isTabGroup(group) || !group.tabs.includes(viewId)) {
    return layout;
  }
  const nextGroup: TabGroupNode = { ...group, active: viewId };
  return {
    root: replaceNode(layout.root, groupId, nextGroup),
  };
}

export function closeTab(layout: DockLayout, viewId: ViewId): DockLayout {
  if (!layout.root) return layout;
  return { root: removeViewFromTree(layout.root, viewId) };
}

export function setSplitSizes(
  layout: DockLayout,
  splitId: string,
  sizes: number[],
): DockLayout {
  if (!layout.root) return layout;
  const node = findNode(layout.root, splitId);
  if (!node || !isSplit(node) || sizes.length !== node.children.length) {
    return layout;
  }
  const next: SplitNode = { ...node, sizes: normalizeSizes(sizes) };
  return { root: replaceNode(layout.root, splitId, next) };
}

function edgeToDirection(edge: DropEdge): SplitDirection {
  return edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
}

function insertOrder(
  edge: DropEdge,
  existing: DockNode,
  incoming: DockNode,
): DockNode[] {
  if (edge === 'left' || edge === 'top') return [incoming, existing];
  return [existing, incoming];
}

export function moveView(
  layout: DockLayout,
  viewId: ViewId,
  target: DropTarget,
  newId: IdFactory,
): DockLayout {
  if (!layout.root) return layout;
  const source = findTabGroupForView(layout.root, viewId);
  if (!source) return layout;

  // No-op: drop as tab onto the only tab in the same group
  if (
    target.kind === 'tab' &&
    target.groupId === source.id &&
    source.tabs.length === 1
  ) {
    return layout;
  }

  let root = removeViewFromTree(layout.root, viewId);
  if (!root && target.kind === 'tab') {
    // Entire tree was this one tab — recreate as destination group
    return {
      root: createTabGroup(target.groupId, [viewId], viewId),
    };
  }
  if (!root) {
    return { root: createTabGroup(newId(), [viewId], viewId) };
  }

  return { root: placeViewInTree(root, viewId, target, newId) };
}

function placeViewInTree(
  root: DockNode,
  viewId: ViewId,
  target: DropTarget,
  newId: IdFactory,
): DockNode {
  if (target.kind === 'tab') {
    const group = findNode(root, target.groupId);
    if (!group || !isTabGroup(group)) {
      return insertOrphan(root, viewId, newId);
    }
    const index =
      target.index === undefined
        ? group.tabs.length
        : Math.max(0, Math.min(target.index, group.tabs.length));
    const tabs = [...group.tabs];
    tabs.splice(index, 0, viewId);
    const nextGroup: TabGroupNode = {
      ...group,
      tabs,
      active: viewId,
    };
    return replaceNode(root, group.id, nextGroup) ?? insertOrphan(root, viewId, newId);
  }

  const targetNode = findNode(root, target.targetId);
  if (!targetNode) {
    return insertOrphan(root, viewId, newId);
  }

  const incoming = createTabGroup(newId(), [viewId], viewId);
  const direction = edgeToDirection(target.edge);

  if (isSplit(targetNode) && targetNode.direction === direction) {
    const child = incoming;
    const atStart = target.edge === 'left' || target.edge === 'top';
    const children = atStart
      ? [child, ...targetNode.children]
      : [...targetNode.children, child];
    const nextSplit: SplitNode = {
      ...targetNode,
      children,
      sizes: equalSizes(children.length),
    };
    return replaceNode(root, targetNode.id, nextSplit) ?? insertOrphan(root, viewId, newId);
  }

  const split = createSplit(
    newId(),
    direction,
    insertOrder(target.edge, targetNode, incoming),
    [0.5, 0.5],
  );
  return replaceNode(root, targetNode.id, split) ?? insertOrphan(root, viewId, newId);
}

function insertOrphan(
  root: DockNode,
  viewId: ViewId,
  newId: IdFactory,
): DockNode {
  return createSplit(newId(), 'horizontal', [
    root,
    createTabGroup(newId(), [viewId], viewId),
  ]);
}
