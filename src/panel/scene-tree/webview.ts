/**
 * Scene Tree webview — Phase 5.3.
 *
 * Renders the loaded scene as a nested list. Each row is clickable; a
 * click dispatches `component:select` which flows through the host
 * broker and back as selection updates.
 *
 * Rendering strategy (tuned to State Street's semantics):
 *   - `{{var}}` in an element's *text content* is HTML-escaped (no DOM).
 *   - `{{var}}` inside a *component body's return value* is NOT escaped
 *     — it's spliced as HTML. So we pre-render the full tree to an HTML
 *     string in `state.data.treeHtml` and splice it through a component.
 *
 * The webview holds its own per-webview `EditorState` (Phase 3.5.1
 * Option A). Bridge messages feed the store; subscribers project the
 * store into `state.data`.
 */

import { State } from 'state-street';
import { componentSelect } from '../../protocol/index.js';
import type {
  OmosceneFile,
  SerializedComponent,
} from '../../omoscene/index.js';
import { createEditorState } from '../../state/index.js';
import { bootstrapPanel } from '../bootstrap.js';

interface PanelData {
  treeHtml: string;
  emptyMessage: string;
}

const editor = createEditorState();

const template = /* html */ `
<body>
  <div style="padding: 0.5em;">
    <div style="color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 0.5em;">
      {{emptyMessage}}
    </div>
    <ul style="list-style: none; padding: 0; margin: 0;">
      <SceneTreeBody/>
    </ul>
  </div>
</body>
`;

// SceneTreeBody's return value is spliced as HTML. The {{treeHtml}}
// placeholder is replaced with state.data.treeHtml (raw, not escaped).
const SceneTreeBody = (): string => `{{treeHtml}}`;

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: { treeHtml: '', emptyMessage: 'No scene loaded.' },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: { SceneTreeBody },
  methods: {
    select: ({ bridge, id }) => {
      const numericId = parseIntSafe(id);
      if (numericId === null) return;
      bridge.dispatch(componentSelect([numericId]));
    },
  },
  wireIncoming: (msg) => {
    editor.dispatch(msg);
  },
});

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
  return renderRow(root, 0, new Set(selectedIds));
}

function renderRow(
  node: SerializedComponent,
  depth: number,
  selected: ReadonlySet<number>,
): string {
  const id = typeof node.id === 'number' ? node.id : null;
  const name = typeof node.name === 'string' ? node.name : '';
  const type = escapeHtml(node.type);
  const label = name ? `${type} "${escapeHtml(name)}"` : type;
  const isSelected = id !== null && selected.has(id);
  const indent = depth * 1.25;
  const bg = isSelected
    ? 'var(--vscode-list-activeSelectionBackground)'
    : 'transparent';
  const fg = isSelected
    ? 'var(--vscode-list-activeSelectionForeground)'
    : 'inherit';
  const clickAttr = id === null ? '' : ` :click=select(id=${String(id)})`;

  const children = Array.isArray(node.components)
    ? node.components
        .filter((child): child is SerializedComponent => isNode(child))
        .map((child) => renderRow(child, depth + 1, selected))
        .join('')
    : '';

  return (
    `<li style="padding: 2px 4px 2px ${indent}em; cursor: pointer; background: ${bg}; color: ${fg};"${clickAttr}>` +
    label +
    `</li>` +
    children
  );
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
