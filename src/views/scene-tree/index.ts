/**
 * Scene tree — nested State Street dock view (3b).
 *
 * The scene-region root nexus is the scene itself and is not listed; the
 * tree shows its children. Nexus rows expand/collapse via `editor.treeState`.
 */

import { State } from '@state-street/state-street';
import { listEditorTypes } from '../../editor-api';
import type { TextPromptRequest } from '../../bridge/channels';
import {
  withEditorMetadata,
  type OmosceneFile,
  type SerializedComponent,
} from '../../omoscene';
import {
  componentAdd,
  componentMove,
  componentRemove,
  componentSelect,
  componentUpdate,
  type EditorMessage,
} from '../../protocol';
import {
  canAddComponentType,
  duplicateComponent,
  findComponentById,
  findParentId,
  listAddableTypes,
} from '../../scene';
import {
  showContextMenu,
  type ContextMenuItem,
} from '../file-explorer/context-menu';
import {
  formatComponentTypeLabel,
  groupAddableTypesByDomain,
} from './add-palette';

export const SCENE_TREE_VIEW_ID = 'scene-tree';

export interface SceneTreeDeps {
  readonly getDocument: () => OmosceneFile | null;
  readonly subscribeDocument: (cb: () => void) => () => void;
  readonly getSelection: () => readonly number[];
  readonly subscribeSelection: (cb: () => void) => () => void;
  readonly onDispatch: (message: EditorMessage) => void;
  /** Apply a pure document mutation then reload peers. */
  readonly applyDocument: (
    file: OmosceneFile,
    selectIds?: readonly number[],
  ) => void;
  /** Modal text prompt (Electron); sandboxed `window.prompt` is unavailable. */
  readonly promptText: (request: TextPromptRequest) => Promise<string | null>;
}

interface TreeRow {
  readonly id: number;
  readonly parentId: number | null;
  readonly type: string;
  readonly label: string;
  readonly depth: number;
  readonly isNexus: boolean;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly iconSrc: string | null;
}

interface SceneTreeData {
  rows: TreeRow[];
  emptyMessage: string;
  sceneName: string;
}

const template = /* html */ `
<div class="scene-tree-toolbar">
  <span class="scene-tree-title">{{sceneName}}</span>
  <button type="button" class="scene-tree-menu" title="Scene actions" aria-label="Scene actions" :click=onSceneMenu()>+</button>
</div>
<EmptyHint/>
<TreeBody/>
`;

function iconUrlForType(type: string): string | null {
  const known = new Set([
    'nexus',
    'transform',
    'sprite',
    'camera',
    'viewport',
    'collider',
    'event-collider',
    'light',
    'timer',
    'messenger',
    'input-controller',
    'audio-track',
    'audio-player',
    'audio-effect',
    'animation-controller',
    'ui-overlay',
    'data-layer',
    'flag-manager',
    'texture-map',
    'atlas-manager',
    'cell-map',
  ]);
  if (!known.has(type)) return null;
  return `./icons/${type}.svg`;
}

/** Default expanded when `editor.treeState[id]` is absent. */
export function isNexusExpanded(
  treeState: Record<string, boolean>,
  id: number,
): boolean {
  return treeState[String(id)] !== false;
}

/**
 * Build visible tree rows. Skips the scene-region root nexus; starts at
 * its children. Collapsed nexuses omit descendants.
 */
export function buildTreeRows(
  file: OmosceneFile | null,
  selectedIds: readonly number[],
): TreeRow[] {
  if (!file) return [];
  const selected = new Set(selectedIds);
  const treeState = file.editor.treeState;
  const rows: TreeRow[] = [];
  const sceneRootId =
    typeof file.scene.id === 'number' ? file.scene.id : null;

  function walk(
    node: SerializedComponent,
    parentId: number | null,
    depth: number,
  ): void {
    const id = typeof node.id === 'number' ? node.id : -1;
    if (id < 0) return;
    const label =
      typeof node.name === 'string' && node.name !== ''
        ? node.name
        : node.type;
    const isNexus = node.type === 'nexus';
    const childList = Array.isArray(node.components)
      ? (node.components as readonly SerializedComponent[]).filter(
          (c) =>
            c &&
            typeof c === 'object' &&
            typeof (c as SerializedComponent).type === 'string',
        )
      : [];
    const hasChildren = childList.length > 0;
    const expanded = isNexus ? isNexusExpanded(treeState, id) : false;
    rows.push({
      id,
      parentId,
      type: node.type,
      label,
      depth,
      isNexus,
      hasChildren,
      expanded,
      selected: selected.has(id),
      iconSrc: iconUrlForType(node.type),
    });
    if (!isNexus || !expanded || !hasChildren) return;
    for (const child of childList) {
      walk(child as SerializedComponent, id, depth + 1);
    }
  }

  const top = Array.isArray(file.scene.components)
    ? file.scene.components
    : [];
  for (const child of top) {
    if (
      child &&
      typeof child === 'object' &&
      typeof (child as SerializedComponent).type === 'string'
    ) {
      walk(child as SerializedComponent, sceneRootId, 0);
    }
  }
  return rows;
}

export function renderTreeRow(row: TreeRow): string {
  const selected = row.selected ? ' scene-tree-row-selected' : '';
  const icon = row.iconSrc
    ? `<img class="scene-tree-icon" src="${escapeAttr(row.iconSrc)}" alt="" width="14" height="14" />`
    : `<span class="scene-tree-icon-fallback" aria-hidden="true">${escapeHtml(row.type.slice(0, 1).toUpperCase())}</span>`;
  let twisty = `<span class="scene-tree-twisty scene-tree-twisty-leaf" aria-hidden="true"></span>`;
  if (row.isNexus) {
    if (row.hasChildren) {
      const glyph = row.expanded ? '▾' : '▸';
      twisty =
        `<button type="button" class="scene-tree-twisty" ` +
        `aria-label="${row.expanded ? 'Collapse' : 'Expand'}" ` +
        `:click=toggleExpand(id=${row.id})>${glyph}</button>`;
    } else {
      twisty = `<span class="scene-tree-twisty scene-tree-twisty-empty" aria-hidden="true">·</span>`;
    }
  }
  return (
    `<div class="scene-tree-row${selected}" role="treeitem" ` +
    `draggable="true" style="--depth:${row.depth}" ` +
    `data-id="${row.id}" data-type="${escapeAttr(row.type)}" ` +
    `aria-expanded="${row.isNexus ? String(row.expanded) : 'false'}" ` +
    `:click=selectRow(id=${row.id}) ` +
    `:contextmenu=onContext(id=${row.id}) ` +
    `:dragstart=onDragStart(id=${row.id}) ` +
    `:dragover=onDragOver(id=${row.id}) ` +
    `:drop=onDrop(id=${row.id})>` +
    twisty +
    icon +
    `<span class="scene-tree-label">${escapeHtml(row.label)}</span>` +
    `<span class="scene-tree-type">${escapeHtml(row.type)}</span>` +
    `</div>`
  );
}

export function mountSceneTree(
  container: HTMLElement,
  deps: SceneTreeDeps,
): () => void {
  container.classList.add('scene-tree-panel');

  const refresh = (state: { data: SceneTreeData }): void => {
    const file = deps.getDocument();
    const selection = deps.getSelection();
    state.data.rows = buildTreeRows(file, selection);
    state.data.emptyMessage = file
      ? state.data.rows.length === 0
        ? 'Empty scene — use + to add'
        : ''
      : 'No scene loaded';
    state.data.sceneName = file
      ? typeof file.scene.name === 'string' && file.scene.name !== ''
        ? file.scene.name
        : 'Untitled'
      : '';
  };

  const treeState = new State(
    template,
    {
      rows: [],
      emptyMessage: 'No scene loaded',
      sceneName: '',
    } satisfies SceneTreeData,
    {
      EmptyHint: ({ state }: { state: { data: SceneTreeData } }) =>
        state.data.emptyMessage
          ? `<div class="scene-tree-empty">${escapeHtml(state.data.emptyMessage)}</div>`
          : '',
      TreeBody: ({ state }: { state: { data: SceneTreeData } }) => {
        if (state.data.rows.length === 0) return '';
        return (
          `<div class="scene-tree-list" role="tree">` +
          state.data.rows.map(renderTreeRow).join('') +
          `</div>`
        );
      },
    },
    {
      selectRow: ({ id }: { id: number }) => {
        deps.onDispatch(componentSelect([Number(id)]));
      },
      toggleExpand: ({
        event,
        id,
      }: {
        event: Event;
        id: number;
      }) => {
        event.preventDefault();
        event.stopPropagation();
        const file = deps.getDocument();
        if (!file) return;
        const key = String(id);
        const currentlyExpanded = isNexusExpanded(file.editor.treeState, Number(id));
        const next = withEditorMetadata(file, {
          ...file.editor,
          treeState: {
            ...file.editor.treeState,
            [key]: !currentlyExpanded,
          },
        });
        deps.applyDocument(next, deps.getSelection());
      },
      onSceneMenu: ({
        event,
      }: {
        event: Event;
      }) => {
        event.preventDefault();
        const file = deps.getDocument();
        if (!file) return;
        const rootId =
          typeof file.scene.id === 'number' ? file.scene.id : null;
        if (rootId === null) return;
        const node = file.scene;
        const btn = (event.currentTarget ?? event.target) as HTMLElement;
        const rect = btn.getBoundingClientRect();
        showContextMenu({
          x: rect.left,
          y: rect.bottom + 2,
          items: [
            buildAddComponentMenuItem(file, rootId),
            { id: 'rename', label: 'Rename…' },
          ],
          onSelect: (action) => {
            void handleContextAction(action, {
              deps,
              file,
              componentId: rootId,
              parentId: null,
              node,
            });
          },
        });
      },
      onContext: ({
        event,
        id,
      }: {
        event: Event;
        id: number;
      }) => {
        event.preventDefault();
        const mouse = event as MouseEvent;
        const componentId = Number(id);
        const file = deps.getDocument();
        if (!file) return;
        const node = findComponentById(file.scene, componentId);
        if (!node) return;
        // Scene root is never shown; all listed nodes are deletable.
        const parentId = findParentId(file.scene, componentId);
        const items: ContextMenuItem[] = [
          ...(node.type === 'nexus'
            ? [buildAddComponentMenuItem(file, componentId)]
            : []),
          { id: 'duplicate', label: 'Duplicate' },
          { id: 'rename', label: 'Rename…' },
          { id: 'move-up', label: 'Move Up' },
          { id: 'move-down', label: 'Move Down' },
          { id: 'delete', label: 'Delete' },
        ];
        showContextMenu({
          x: mouse.clientX,
          y: mouse.clientY,
          items,
          onSelect: (action) => {
            void handleContextAction(action, {
              deps,
              file,
              componentId,
              parentId,
              node,
            });
          },
        });
      },
      onDragStart: ({ event, id }: { event: Event; id: number }) => {
        const drag = event as DragEvent;
        drag.dataTransfer?.setData('text/omosuen-component-id', String(id));
        if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: ({ event }: { event: Event }) => {
        event.preventDefault();
        const drag = event as DragEvent;
        if (drag.dataTransfer) drag.dataTransfer.dropEffect = 'move';
      },
      onDrop: ({ event, id }: { event: Event; id: number }) => {
        event.preventDefault();
        const drag = event as DragEvent;
        const raw = drag.dataTransfer?.getData('text/omosuen-component-id');
        if (!raw) return;
        const sourceId = Number(raw);
        const targetId = Number(id);
        if (!Number.isFinite(sourceId) || sourceId === targetId) return;
        const file = deps.getDocument();
        if (!file) return;
        const target = findComponentById(file.scene, targetId);
        if (!target) return;
        if (target.type === 'nexus') {
          deps.onDispatch(componentMove(sourceId, targetId));
          return;
        }
        const parentId = findParentId(file.scene, targetId);
        if (parentId === null) return;
        const parent = findComponentById(file.scene, parentId);
        const index = Array.isArray(parent?.components)
          ? parent!.components!.findIndex(
              (c) =>
                c &&
                typeof c === 'object' &&
                (c as SerializedComponent).id === targetId,
            )
          : -1;
        deps.onDispatch(
          componentMove(
            sourceId,
            parentId,
            index >= 0 ? index : undefined,
          ),
        );
      },
    },
    { mountTarget: container },
  ) as InstanceType<typeof State> & { data: SceneTreeData };

  refresh(treeState);
  const unsubDoc = deps.subscribeDocument(() => refresh(treeState));
  const unsubSel = deps.subscribeSelection(() => refresh(treeState));

  return () => {
    unsubDoc();
    unsubSel();
    treeState.destroy();
    container.classList.remove('scene-tree-panel');
    container.replaceChildren();
  };
}

function buildAddComponentMenuItem(
  file: OmosceneFile,
  parentId: number,
): ContextMenuItem {
  const addable = listAddableTypes(file, parentId, listEditorTypes());
  const domains = groupAddableTypesByDomain(addable);
  if (domains.length === 0) {
    return {
      label: 'Add Component',
      disabled: true,
      children: [{ id: 'add:none', label: 'None available', disabled: true }],
    };
  }
  return {
    label: 'Add Component',
    children: domains.map((domain) => ({
      label: domain.label,
      children: domain.types.map((type) => ({
        id: `add:${type}`,
        label: formatComponentTypeLabel(type),
      })),
    })),
  };
}

async function handleContextAction(
  action: string,
  ctx: {
    deps: SceneTreeDeps;
    file: OmosceneFile;
    componentId: number;
    parentId: number | null;
    node: SerializedComponent;
  },
): Promise<void> {
  const { deps, file, componentId, parentId, node } = ctx;
  if (action.startsWith('add:')) {
    const type = action.slice('add:'.length);
    if (!type || type === 'none') return;
    const parentForAdd = node.type === 'nexus' ? componentId : parentId;
    if (parentForAdd === null) return;
    const gate = canAddComponentType(file, parentForAdd, type);
    if (!gate.ok) {
      return;
    }
    deps.onDispatch(componentAdd(parentForAdd, type));
    return;
  }
  if (action === 'delete') {
    deps.onDispatch(componentRemove(componentId));
    return;
  }
  if (action === 'rename') {
    const current =
      typeof node.name === 'string' ? node.name : node.type;
    const next = await deps.promptText({
      title: 'Rename',
      label: 'Component name',
      defaultValue: current,
      okLabel: 'Rename',
    });
    if (next === null || next.trim() === '') return;
    deps.onDispatch(
      componentUpdate(componentId, node.type, 'name', next.trim()),
    );
    return;
  }
  if (action === 'move-up' || action === 'move-down') {
    if (parentId === null) return;
    const parent = findComponentById(file.scene, parentId);
    if (!parent || !Array.isArray(parent.components)) return;
    const index = parent.components.findIndex(
      (c) =>
        c &&
        typeof c === 'object' &&
        (c as SerializedComponent).id === componentId,
    );
    if (index < 0) return;
    const nextIndex = action === 'move-up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= parent.components.length) return;
    deps.onDispatch(componentMove(componentId, parentId, nextIndex));
    return;
  }
  if (action === 'duplicate') {
    const gateType = node.type;
    if (parentId === null) return;
    const gate = canAddComponentType(file, parentId, gateType);
    if (!gate.ok) {
      return;
    }
    const mutated = duplicateComponent(file, componentId);
    if (mutated !== file) {
      const maxBefore = Math.max(...collectIds(file.scene), 0);
      const newIds = collectIds(mutated.scene).filter((id) => id > maxBefore);
      deps.applyDocument(mutated, newIds.slice(0, 1));
    }
  }
}

function collectIds(node: SerializedComponent): number[] {
  const out: number[] = [];
  if (typeof node.id === 'number') out.push(node.id);
  if (Array.isArray(node.components)) {
    for (const child of node.components) {
      if (
        child &&
        typeof child === 'object' &&
        typeof (child as SerializedComponent).type === 'string'
      ) {
        out.push(...collectIds(child as SerializedComponent));
      }
    }
  }
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
