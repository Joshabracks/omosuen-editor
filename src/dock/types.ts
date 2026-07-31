/** Serializable dock layout tree (E13). */

export type ViewId = string;

export type SplitDirection = 'horizontal' | 'vertical';

export interface TabGroupNode {
  readonly type: 'tabs';
  readonly id: string;
  readonly tabs: ViewId[];
  readonly active: ViewId;
}

export interface SplitNode {
  readonly type: 'split';
  readonly id: string;
  /** `horizontal` = side-by-side (row); `vertical` = stacked (column). */
  readonly direction: SplitDirection;
  readonly children: DockNode[];
  /** Pane size fractions; length matches children; should sum ≈ 1. */
  readonly sizes: number[];
}

export type DockNode = TabGroupNode | SplitNode;

export interface DockLayout {
  readonly root: DockNode | null;
}

export type DropEdge = 'left' | 'right' | 'top' | 'bottom';

export type DropTarget =
  | { readonly kind: 'tab'; readonly groupId: string; readonly index?: number }
  | { readonly kind: 'split'; readonly targetId: string; readonly edge: DropEdge };

export function isTabGroup(node: DockNode): node is TabGroupNode {
  return node.type === 'tabs';
}

export function isSplit(node: DockNode): node is SplitNode {
  return node.type === 'split';
}

export function cloneLayout(layout: DockLayout): DockLayout {
  return structuredClone(layout);
}

export function createTabGroup(
  id: string,
  tabs: ViewId[],
  active?: ViewId,
): TabGroupNode {
  if (tabs.length === 0) {
    throw new Error('Tab group requires at least one tab');
  }
  const activeTab = active && tabs.includes(active) ? active : tabs[0]!;
  return { type: 'tabs', id, tabs: [...tabs], active: activeTab };
}

export function createSplit(
  id: string,
  direction: SplitDirection,
  children: DockNode[],
  sizes?: number[],
): SplitNode {
  if (children.length < 2) {
    throw new Error('Split requires at least two children');
  }
  const normalized = normalizeSizes(sizes ?? equalSizes(children.length));
  if (normalized.length !== children.length) {
    throw new Error('Split sizes must match children length');
  }
  return {
    type: 'split',
    id,
    direction,
    children: [...children],
    sizes: normalized,
  };
}

export function equalSizes(count: number): number[] {
  const each = 1 / count;
  return Array.from({ length: count }, () => each);
}

export function normalizeSizes(sizes: number[]): number[] {
  const positive = sizes.map((s) => (s > 0 ? s : 0.0001));
  const sum = positive.reduce((a, b) => a + b, 0);
  return positive.map((s) => s / sum);
}
