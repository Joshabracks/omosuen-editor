import {
  isSplit,
  isTabGroup,
  type DockLayout,
  type DockNode,
  type SplitNode,
  type TabGroupNode,
} from './types';

export function serializeLayout(layout: DockLayout): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

export function parseLayout(raw: string): DockLayout {
  const parsed: unknown = JSON.parse(raw);
  return validateLayout(parsed);
}

export function validateLayout(value: unknown): DockLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Layout must be an object');
  }
  const root = (value as { root?: unknown }).root;
  if (root === null) {
    return { root: null };
  }
  return { root: validateNode(root) };
}

function validateNode(value: unknown): DockNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Dock node must be an object');
  }
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string' || !node.id) {
    throw new Error('Dock node requires id');
  }
  if (node.type === 'tabs') {
    return validateTabs(node);
  }
  if (node.type === 'split') {
    return validateSplit(node);
  }
  throw new Error(`Unknown dock node type: ${String(node.type)}`);
}

function validateTabs(node: Record<string, unknown>): TabGroupNode {
  if (!Array.isArray(node.tabs) || node.tabs.length === 0) {
    throw new Error('Tab group requires tabs');
  }
  if (!node.tabs.every((t) => typeof t === 'string' && t)) {
    throw new Error('Tab ids must be non-empty strings');
  }
  const tabs = node.tabs as string[];
  const active =
    typeof node.active === 'string' && tabs.includes(node.active)
      ? node.active
      : tabs[0]!;
  const result: TabGroupNode = {
    type: 'tabs',
    id: node.id as string,
    tabs: [...tabs],
    active,
  };
  if (!isTabGroup(result)) throw new Error('invalid tabs');
  return result;
}

function validateSplit(node: Record<string, unknown>): SplitNode {
  if (node.direction !== 'horizontal' && node.direction !== 'vertical') {
    throw new Error('Split requires direction');
  }
  if (!Array.isArray(node.children) || node.children.length < 2) {
    throw new Error('Split requires >= 2 children');
  }
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) {
    throw new Error('Split sizes must match children');
  }
  if (!node.sizes.every((s) => typeof s === 'number' && Number.isFinite(s))) {
    throw new Error('Split sizes must be numbers');
  }
  const result: SplitNode = {
    type: 'split',
    id: node.id as string,
    direction: node.direction,
    children: node.children.map(validateNode),
    sizes: [...(node.sizes as number[])],
  };
  if (!isSplit(result)) throw new Error('invalid split');
  return result;
}
