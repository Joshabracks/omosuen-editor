import { validateLayout } from './serialize';
import {
  isSplit,
  isTabGroup,
  type DockLayout,
  type DockNode,
  type ViewId,
} from './types';

export { validateLayout } from './serialize';

/** userData/settings.json keys for shell session. */
export const SHELL_DOCK_LAYOUT_KEY = 'shell.dockLayout';
export const SHELL_POPOUTS_KEY = 'shell.popOuts';
/** Absolute path of the last successfully opened workspace folder. */
export const SHELL_WORKSPACE_ROOT_KEY = 'shell.workspaceRoot';

/** Placeholder ids replaced by real shell views. */
const VIEW_ID_ALIASES: Readonly<Record<string, ViewId>> = {
  'empty-d': 'output',
  'empty-e': 'problems',
  'empty-c': 'inspector',
  'empty-a': 'scene-tree',
};

export interface PersistedPopOut {
  /** Views hosted in this pop-out (order preserved). */
  readonly viewIds: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Parse a settings value into a DockLayout, or null if missing/invalid. */
export function readPersistedLayout(value: unknown): DockLayout | null {
  if (value == null) return null;
  try {
    return migrateLayoutViewIds(validateLayout(value));
  } catch {
    return null;
  }
}

/** Rewrite retired placeholder view ids to current shell view ids. */
export function migrateLayoutViewIds(layout: DockLayout): DockLayout {
  if (!layout.root) return layout;
  return { root: migrateNodeViewIds(layout.root) };
}

function migrateNodeViewIds(node: DockNode): DockNode {
  if (isTabGroup(node)) {
    const tabs = node.tabs.map((id) => VIEW_ID_ALIASES[id] ?? id);
    const active = VIEW_ID_ALIASES[node.active] ?? node.active;
    return {
      ...node,
      tabs,
      active: tabs.includes(active) ? active : tabs[0]!,
    };
  }
  if (isSplit(node)) {
    return {
      ...node,
      children: node.children.map(migrateNodeViewIds),
    };
  }
  return node;
}

/** Parse persisted pop-out window list; skips invalid entries. */
export function readPersistedPopOuts(value: unknown): PersistedPopOut[] {
  if (!Array.isArray(value)) return [];
  const out: PersistedPopOut[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;

    let viewIds: string[] = [];
    if (Array.isArray(row.viewIds)) {
      viewIds = row.viewIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
    } else if (typeof row.viewId === 'string' && row.viewId) {
      // Legacy single-view snapshots
      viewIds = [row.viewId];
    }
    if (viewIds.length === 0) continue;

    if (
      typeof row.x !== 'number' ||
      typeof row.y !== 'number' ||
      typeof row.width !== 'number' ||
      typeof row.height !== 'number'
    ) {
      continue;
    }
    if (
      !Number.isFinite(row.x) ||
      !Number.isFinite(row.y) ||
      !Number.isFinite(row.width) ||
      !Number.isFinite(row.height) ||
      row.width < 200 ||
      row.height < 160
    ) {
      continue;
    }
    out.push({
      viewIds,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
    });
  }
  return out;
}

/** Parse a settings value into a workspace absolute path, or null. */
export function readPersistedWorkspaceRoot(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
