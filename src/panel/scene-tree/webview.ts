/**
 * Scene Tree webview.
 *
 * Renders the loaded scene as a nested list + provides the scene-tree's
 * interaction surface:
 *   - Click a row → `component:select` (optimistic local update).
 *   - Hover → subtle background highlight via CSS.
 *   - Right-click → contextual menu (Delete, Add Component ▸ submenu
 *     of alphabetical types on nexus rows, Move Up, Move Down). All
 *     menu items dispatch `command:invoke` for the scene-tree commands
 *     registered by [scene-tree-commands.ts](../../app/scene-tree-commands.js).
 *   - Drag-and-drop a row onto a nexus → `omosuen.reparentComponent`.
 *     Non-nexus rows dim during drag (pointer-events disabled via CSS)
 *     so only valid drop targets accept drops.
 *
 * State Street's `:<event>=method()` binding supports any DOM event —
 * the `contextmenu` / `dragstart` / `dragover` / `drop` / `dragend`
 * wiring uses the same pattern as `:click=select(...)`.
 *
 * The webview holds its own per-webview `EditorState` (Phase 3.5.1
 * Option A). Bridge messages feed the store; subscribers project the
 * store into `state.data`.
 */

import { State } from 'state-street';
import { commandInvoke, componentSelect } from '../../protocol/index.js';
import type {
  OmosceneFile,
  SerializedComponent,
} from '../../omoscene/index.js';
import { listRegisteredComponents } from '../../schema/index.js';
import { createEditorState } from '../../state/index.js';
import { bootstrapPanel } from '../bootstrap.js';

interface PanelData {
  treeHtml: string;
  emptyMessage: string;

  // Context menu state.
  menuHtml: string; // Rendered `<ul>…</ul>` when open, empty string when closed.

  // Non-rendered fields.
  _menuTargetId: number | null;
  _menuTargetType: string | null;
  _menuCanMoveUp: boolean;
  _menuCanMoveDown: boolean;
  _draggingId: number | null;
}

// Cached reference to the `.tree-root` element. State Street's
// attribute `{{var}}` interpolation only fires at initial construction,
// not on state change, so we can't flip a `dragging` class via the
// template. Instead we grab the real element once and toggle
// `classList` directly from the drag handlers.
let treeRootEl: HTMLElement | null = null;
function getTreeRootEl(): HTMLElement | null {
  if (treeRootEl === null && typeof document !== 'undefined') {
    treeRootEl = document.querySelector<HTMLElement>('.tree-root');
  }
  return treeRootEl;
}

const editor = createEditorState();

// Icons for each component type are served from the extension's
// `media/icons/components/*.svg` folder. `registerPanel` bakes the
// webview-resolved base URI into the body's `data-icons-base`
// attribute; we read it once here so `renderRow` can splice an
// `<img>` for each component's `type`.
const ICONS_BASE: string =
  (typeof document !== 'undefined' && document.body.dataset['iconsBase']) || '';

// State Street wraps text content in <span> elements, which breaks
// <style> blocks inside the template (CSS ends up inside a span and is
// never applied). Inject the panel's stylesheet directly into the
// document head instead — runs once at module load, before State
// Street mounts.
const PANEL_CSS = `
.tree-root { padding: 0.5em; }
.tree-root ul { list-style: none; padding: 0; margin: 0; }
.tree-row { padding: 2px 4px; cursor: pointer; user-select: none; }
.tree-row:hover { background: var(--vscode-list-hoverBackground); }
.tree-row.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.tree-root.dragging .tree-row:not(.nexus) {
  opacity: 0.35;
  pointer-events: none;
}
.tree-row.drop-target {
  outline: 1px dashed var(--vscode-focusBorder);
  outline-offset: -1px;
}
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  background: var(--vscode-menu-background);
  color: var(--vscode-menu-foreground);
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-contrastBorder)));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  padding: 4px 0;
  margin: 0;
  list-style: none;
}
.ctx-menu-item {
  padding: 4px 12px;
  cursor: pointer;
  position: relative;
  white-space: nowrap;
}
.ctx-menu-item:hover {
  background: var(--vscode-menu-selectionBackground);
  color: var(--vscode-menu-selectionForeground);
}
.ctx-menu-item.has-submenu::after {
  content: '\\25B8';
  float: right;
  margin-left: 1em;
}
.ctx-submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: -5px;
  min-width: 180px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--vscode-menu-background);
  color: var(--vscode-menu-foreground);
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-contrastBorder)));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  padding: 4px 0;
  margin: 0;
  list-style: none;
}
.ctx-menu-item.has-submenu:hover > .ctx-submenu,
.ctx-submenu:hover { display: block; }
/*
 * When the parent menu is near the viewport's right edge, the
 * cursor-predicted flip class reanchors submenus to the left of
 * their item so they fit on screen (mirrors the OS behaviour).
 */
.ctx-menu.flip-submenu .ctx-menu-item.has-submenu > .ctx-submenu {
  left: auto;
  right: 100%;
}
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = PANEL_CSS;
  document.head.appendChild(styleEl);
}

const template = /* html */ `
<body>
  <div class="tree-root">
    <div style="color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 0.5em;">
      {{emptyMessage}}
    </div>
    <ul>
      <SceneTreeBody/>
    </ul>
  </div>
  <MenuRoot/>
</body>
`;

const SceneTreeBody = (): string => `{{treeHtml}}`;
// Wrapping the menu in a component means it re-renders (through
// parseSST + constructElement) whenever state changes — State Street
// doesn't update attribute interpolations on plain tags.
const MenuRoot = (): string => `{{menuHtml}}`;

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: {
    treeHtml: '',
    emptyMessage: 'No scene loaded.',
    menuHtml: '',
    _menuTargetId: null,
    _menuTargetType: null,
    _menuCanMoveUp: false,
    _menuCanMoveDown: false,
    _draggingId: null,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: { SceneTreeBody, MenuRoot },
  methods: {
    select: ({ bridge, id }) => {
      const numericId = parseIntSafe(id);
      if (numericId === null) return;
      const msg = componentSelect([numericId]);
      editor.dispatch(msg);
      bridge.dispatch(msg);
    },

    openMenu: ({ id, event }) => {
      event.preventDefault();
      event.stopPropagation();
      const targetId = parseIntSafe(id);
      if (targetId === null) return;
      const file = editor.sceneDocument.get();
      if (file === null) return;
      const target = findById(file.scene, targetId);
      if (target === null) return;

      const siblings = findSiblingIds(file.scene, targetId);
      const index = siblings.indexOf(targetId);
      const canMoveUp = index > 0;
      const canMoveDown = index >= 0 && index < siblings.length - 1;

      const data = panel.state.data;
      data._menuTargetId = targetId;
      data._menuTargetType = target.type;
      data._menuCanMoveUp = canMoveUp;
      data._menuCanMoveDown = canMoveDown;
      const mouse = event as MouseEvent;

      // Pre-decide whether the submenu should flip to the left. The
      // submenu is CSS-positioned at hover-time (we can't measure it
      // before it's visible), so we predict based on the cursor's
      // horizontal position — if the cursor is within roughly two
      // submenu widths of the right edge, flip.
      const SUBMENU_WIDTH_HINT = 200;
      const viewportWidth =
        typeof window === 'undefined' ? 0 : window.innerWidth;
      const flipSubmenuLeft =
        viewportWidth > 0 &&
        mouse.clientX > viewportWidth - SUBMENU_WIDTH_HINT * 2;

      data.menuHtml = renderMenu({
        x: mouse.clientX,
        y: mouse.clientY,
        targetType: target.type,
        isRoot: target.id === file.scene.id,
        canMoveUp,
        canMoveDown,
        flipSubmenuLeft,
      });

      // Clamp the MAIN menu to the viewport after its real size is
      // known. State Street paints on the next rAF; we measure after
      // that and nudge the element via inline style if it overflows.
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(clampMenuToViewport);
      }
    },

    addOfType: ({ bridge, type, event }) => {
      event.stopPropagation();
      const data = panel.state.data;
      const parentId = data._menuTargetId;
      if (parentId === null) return;
      bridge.dispatch(
        commandInvoke('omosuen.addChildComponent', [parentId, String(type)]),
      );
      closeMenu();
    },

    deleteTarget: ({ bridge, event }) => {
      event.stopPropagation();
      const data = panel.state.data;
      if (data._menuTargetId === null) return;
      bridge.dispatch(
        commandInvoke('omosuen.deleteComponent', [data._menuTargetId]),
      );
      closeMenu();
    },

    moveUp: ({ bridge, event }) => {
      event.stopPropagation();
      const data = panel.state.data;
      if (data._menuTargetId === null) return;
      bridge.dispatch(
        commandInvoke('omosuen.moveComponent', [data._menuTargetId, 'up']),
      );
      closeMenu();
    },

    moveDown: ({ bridge, event }) => {
      event.stopPropagation();
      const data = panel.state.data;
      if (data._menuTargetId === null) return;
      bridge.dispatch(
        commandInvoke('omosuen.moveComponent', [data._menuTargetId, 'down']),
      );
      closeMenu();
    },

    startDrag: ({ id, event }) => {
      const numericId = parseIntSafe(id);
      if (numericId === null) {
        event.preventDefault();
        return;
      }
      // Block dragging the root (it has no parent to leave).
      const file = editor.sceneDocument.get();
      if (file !== null && file.scene.id === numericId) {
        event.preventDefault();
        return;
      }
      const dragEvent = event as DragEvent;
      if (dragEvent.dataTransfer !== null) {
        dragEvent.dataTransfer.setData('text/plain', String(numericId));
        dragEvent.dataTransfer.effectAllowed = 'move';
      }
      panel.state.data._draggingId = numericId;
      getTreeRootEl()?.classList.add('dragging');
    },

    allowDrop: ({ event }) => {
      // Only nexus rows pick up the dragover via the `:dragover=` binding;
      // non-nexus rows have pointer-events disabled in drag mode.
      event.preventDefault();
      const dragEvent = event as DragEvent;
      if (dragEvent.dataTransfer !== null) {
        dragEvent.dataTransfer.dropEffect = 'move';
      }
    },

    performDrop: ({ bridge, id, event }) => {
      event.preventDefault();
      event.stopPropagation();
      const newParentId = parseIntSafe(id);
      const sourceId = panel.state.data._draggingId;
      if (newParentId === null || sourceId === null) return;
      bridge.dispatch(
        commandInvoke('omosuen.reparentComponent', [sourceId, newParentId]),
      );
      panel.state.data._draggingId = null;
      getTreeRootEl()?.classList.remove('dragging');
    },

    endDrag: () => {
      panel.state.data._draggingId = null;
      getTreeRootEl()?.classList.remove('dragging');
    },
  },
  wireIncoming: (msg) => {
    editor.dispatch(msg);
  },
});

// Global close-menu listeners — click anywhere outside the menu, or
// Escape, dismisses it. The menu's own items stopPropagation in their
// handlers so this doesn't fire for clicks INSIDE the menu.
if (typeof window !== 'undefined') {
  window.addEventListener('click', () => {
    if (panel.state.data.menuHtml !== '') closeMenu();
  });
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && panel.state.data.menuHtml !== '') {
      closeMenu();
    }
  });
}

function closeMenu(): void {
  panel.state.data.menuHtml = '';
  panel.state.data._menuTargetId = null;
  panel.state.data._menuTargetType = null;
}

// Re-render on any scene or selection change.
editor.sceneDocument.subscribe((file) => {
  refresh(file, editor.selection.get());
});
editor.selection.subscribe((ids) => {
  refresh(editor.sceneDocument.get(), ids);
});

function refresh(
  file: OmosceneFile | null,
  selectedIds: readonly number[],
): void {
  if (file === null) {
    panel.state.data.treeHtml = '';
    panel.state.data.emptyMessage = 'No scene loaded.';
    return;
  }
  panel.state.data.emptyMessage = file.name;
  panel.state.data.treeHtml = renderTree(file.scene, selectedIds);
}

function renderTree(
  root: SerializedComponent,
  selectedIds: readonly number[],
): string {
  return renderRow(root, 0, new Set(selectedIds), root.id ?? null);
}

function renderRow(
  node: SerializedComponent,
  depth: number,
  selected: ReadonlySet<number>,
  rootId: number | null,
): string {
  const id = typeof node.id === 'number' ? node.id : null;
  const name = typeof node.name === 'string' ? node.name : '';
  // Icon surfaces the component type; label text falls back to the
  // type string when the component has no user-assigned `name`.
  const iconHtml = renderIcon(node.type);
  const labelText = name !== '' ? name : node.type;
  const label = `${iconHtml}<span style="vertical-align: middle;">${escapeHtml(labelText)}</span>`;
  const isSelected = id !== null && selected.has(id);
  const isNexus = node.type === 'nexus';
  const isRoot = id !== null && id === rootId;
  const indent = depth * 1.25;

  // `nexus` is a class (not a `data-*` attribute) because State Street's
  // ATTRIBUTE regex doesn't support hyphenated attribute names; the
  // hyphen breaks the terminator lookahead and absorbs the following
  // attribute into the preceding one. Keeping everything as classes
  // sidesteps the bug and lets `.tree-row.selected` /
  // `.tree-row:not(.nexus)` match cleanly.
  const classes = ['tree-row'];
  if (isSelected) classes.push('selected');
  if (isNexus) classes.push('nexus');

  const selectHandler = id === null ? '' : ` :click=select(id=${String(id)})`;
  const contextHandler =
    id === null ? '' : ` :contextmenu=openMenu(id=${String(id)})`;

  // Drag handlers: source on every non-root row; drop targets only on
  // nexus rows. Non-nexus rows lack the `nexus` class, so the CSS rule
  // `.tree-root.dragging .tree-row:not(.nexus)` dims them during drag.
  const draggable = id !== null && !isRoot ? ' draggable="true"' : '';
  const dragStart =
    id !== null && !isRoot ? ` :dragstart=startDrag(id=${String(id)})` : '';
  const dragEnd = id !== null && !isRoot ? ' :dragend=endDrag()' : '';
  const dropTarget =
    isNexus && id !== null
      ? ` :dragover=allowDrop() :drop=performDrop(id=${String(id)})`
      : '';

  const children = Array.isArray(node.components)
    ? node.components
        .filter((child): child is SerializedComponent => isNode(child))
        .map((child) => renderRow(child, depth + 1, selected, rootId))
        .join('')
    : '';

  return (
    `<li class="${classes.join(' ')}" style="padding: 2px 4px 2px ${indent}em;"${draggable}${selectHandler}${contextHandler}${dragStart}${dragEnd}${dropTarget}>` +
    label +
    `</li>` +
    children
  );
}

interface RenderMenuOptions {
  readonly x: number;
  readonly y: number;
  readonly targetType: string;
  readonly isRoot: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  /**
   * Predict-ahead flag: if the parent menu is close to the right
   * edge of the viewport, its hover-revealed submenu would overflow
   * to the right. Setting this adds a `flip-submenu` class on the
   * `<ul class="ctx-menu">` that CSS uses to anchor submenus to the
   * left instead.
   */
  readonly flipSubmenuLeft: boolean;
}

function renderMenu(opts: RenderMenuOptions): string {
  const items: string[] = [];

  if (!opts.isRoot) {
    items.push(
      `<li class="ctx-menu-item" :click=deleteTarget()>Delete Component</li>`,
    );
  }

  if (opts.targetType === 'nexus') {
    const submenuItems = listRegisteredComponents()
      .slice()
      .sort()
      .map(
        // Event-arg values are parsed by State Street as raw strings
        // split on `=`. Single/double quotes around the value would end
        // up literally inside `type`, so emit bare `type=value`. Safe
        // because component type names match [a-z0-9-]+.
        (type) =>
          `<li class="ctx-menu-item" :click=addOfType(type=${type})>${escapeHtml(type)}</li>`,
      )
      .join('');
    items.push(
      `<li class="ctx-menu-item has-submenu">Add Component<ul class="ctx-submenu">${submenuItems}</ul></li>`,
    );
  }

  if (opts.canMoveUp) {
    items.push(`<li class="ctx-menu-item" :click=moveUp()>Move Up</li>`);
  }
  if (opts.canMoveDown) {
    items.push(`<li class="ctx-menu-item" :click=moveDown()>Move Down</li>`);
  }

  // Bake position into the outer wrapper — re-emitted on every menu
  // open since the component re-runs through parseSST, which is how
  // attribute interpolation has to happen under State Street (plain
  // attribute `{{var}}` doesn't update on state change).
  const classes = ['ctx-menu'];
  if (opts.flipSubmenuLeft) classes.push('flip-submenu');
  return `<ul class="${classes.join(' ')}" style="left: ${String(opts.x)}px; top: ${String(opts.y)}px;">${items.join('')}</ul>`;
}

/**
 * Clamp the rendered context menu to the viewport. State Street emits
 * it at the cursor coords; if that would push it off the right or
 * bottom edges, nudge the inline `left`/`top` back into view.
 *
 * Runs inside a `requestAnimationFrame` after state update, so the
 * real rendered size is available via `getBoundingClientRect`.
 */
function clampMenuToViewport(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const menu = document.querySelector<HTMLElement>('.ctx-menu');
  if (menu === null) return;
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const MARGIN = 4;

  let left = rect.left;
  let top = rect.top;
  if (rect.right > vw - MARGIN)
    left = Math.max(MARGIN, vw - rect.width - MARGIN);
  if (rect.bottom > vh - MARGIN)
    top = Math.max(MARGIN, vh - rect.height - MARGIN);

  if (left !== rect.left) menu.style.left = `${String(left)}px`;
  if (top !== rect.top) menu.style.top = `${String(top)}px`;
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  if (!Array.isArray(root.components)) return null;
  for (const child of root.components) {
    if (!isNode(child)) continue;
    const hit = findById(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

function findSiblingIds(root: SerializedComponent, targetId: number): number[] {
  // Returns the array of sibling ids (including the target's own id) for
  // whichever parent holds `targetId`. Empty array if the target is the
  // root or not found.
  if (root.id === targetId) return [];
  if (!Array.isArray(root.components)) return [];
  const children = root.components as readonly SerializedComponent[];
  if (children.some((c) => isNode(c) && c.id === targetId)) {
    return children
      .filter((c) => isNode(c))
      .map((c) => (typeof c.id === 'number' ? c.id : -1))
      .filter((id) => id !== -1);
  }
  for (const child of children) {
    if (!isNode(child)) continue;
    const result = findSiblingIds(child, targetId);
    if (result.length > 0) return result;
  }
  return [];
}

function isNode(value: unknown): value is SerializedComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function parseIntSafe(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function renderIcon(componentType: string): string {
  if (ICONS_BASE === '') return '';
  // Component type names are constrained by the schema registry to
  // the `[a-z][a-z0-9-]*` shape, so direct interpolation into the
  // URI is safe. `alt` carries the type so the row stays readable
  // if an icon ever fails to load.
  const safeType = escapeHtml(componentType);
  return `<img src="${ICONS_BASE}/${componentType}.svg" alt="${safeType}" title="${safeType}" style="width: 1em; height: 1em; vertical-align: middle; margin-right: 0.4em;" />`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
