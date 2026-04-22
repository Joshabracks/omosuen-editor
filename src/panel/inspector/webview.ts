/**
 * Inspector webview — Phase 5.4 (transform only).
 *
 * Reads the current selection from its per-webview `EditorState`, walks
 * the scene tree to find the selected component, resolves its schema via
 * `resolveSchema` + `getComponentSchemas`, and renders schema-driven
 * fields. Phase 5 supports transform only (Vector3D fields); other
 * component types get a "not yet supported" placeholder — Phase 7 rolls
 * per-component widgets.
 *
 * Rendering strategy: `state.data.fieldsHtml` holds pre-rendered HTML
 * that's spliced via a component-body `{{fieldsHtml}}` interpolation
 * (State Street doesn't escape component bodies, unlike text content).
 */

import { State } from 'state-street';
import { componentUpdate, type JsonValue } from '../../protocol/index.js';
import type { SerializedComponent } from '../../omoscene/index.js';
import { getComponentSchemas, resolveSchema } from '../../schema/index.js';
import type {
  ComponentSchemaVersion,
  PropertySchema,
} from '../../schema/index.js';
import { createEditorState } from '../../state/index.js';
import { bootstrapPanel } from '../bootstrap.js';

interface PanelData {
  title: string;
  fieldsHtml: string;
  // Non-rendered fields accessed by methods; prefixed `_` by convention.
  _selectedId: number | null;
  _componentType: string | null;
  _component: SerializedComponent | null;
}

const editor = createEditorState();

const template = /* html */ `
<body>
  <div style="padding: 0.5em;">
    <h3 style="margin: 0 0 0.5em 0; font-size: 1em;">{{title}}</h3>
    <div>
      <FieldsBody/>
    </div>
  </div>
</body>
`;

const FieldsBody = (): string => `{{fieldsHtml}}`;

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: {
    title: 'Inspector',
    fieldsHtml:
      '<em style="color: var(--vscode-descriptionForeground);">Select a component to inspect.</em>',
    _selectedId: null,
    _componentType: null,
    _component: null,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: { FieldsBody },
  methods: {
    edit: ({ bridge, state, field, axis, event }) => {
      const data = (state as { data: PanelData }).data;
      const component = data._component;
      if (component === null) return;
      if (data._selectedId === null || data._componentType === null) return;

      const target = event.target as HTMLInputElement;
      const newAxisValue = Number.parseFloat(target.value);
      if (!Number.isFinite(newAxisValue)) return;

      const fieldName = String(field);
      const axisName = String(axis);
      const currentVector = component[fieldName];
      if (!isVector3D(currentVector)) return;

      const newVector: JsonValue = {
        _vectorType: 'Vector3D',
        x: axisName === 'x' ? newAxisValue : currentVector.x,
        y: axisName === 'y' ? newAxisValue : currentVector.y,
        z: axisName === 'z' ? newAxisValue : currentVector.z,
      };
      bridge.dispatch(
        componentUpdate(
          data._selectedId,
          data._componentType,
          fieldName,
          newVector,
        ),
      );
    },
  },
  wireIncoming: (msg) => {
    editor.dispatch(msg);
  },
});

// Re-render whenever scene or selection changes.
editor.sceneDocument.subscribe(() => refresh());
editor.selection.subscribe(() => refresh());

function refresh(): void {
  const file = editor.sceneDocument.get();
  const selection = editor.selection.get();
  const selectedId = selection[0] ?? null;

  if (file === null || selectedId === null) {
    setEmpty('Select a component to inspect.');
    return;
  }

  const component = findById(file.scene, selectedId);
  if (component === null) {
    setEmpty(
      `No component with id ${String(selectedId)} in the current scene.`,
    );
    return;
  }

  const schema = resolveComponentSchema(component.type, file.engine);
  if (schema === null) {
    setEmpty(
      `No schema registered for component type "${escapeHtml(component.type)}".`,
    );
    return;
  }

  const displayName =
    typeof component.name === 'string' && component.name !== ''
      ? `${component.type} "${component.name}"`
      : component.type;
  panel.state.data.title = `${displayName} (id=${String(selectedId)})`;
  panel.state.data._selectedId = selectedId;
  panel.state.data._componentType = component.type;
  panel.state.data._component = component;
  panel.state.data.fieldsHtml = renderFields(schema, component);
}

function setEmpty(message: string): void {
  panel.state.data.title = 'Inspector';
  panel.state.data.fieldsHtml = `<em style="color: var(--vscode-descriptionForeground);">${escapeHtml(message)}</em>`;
  panel.state.data._selectedId = null;
  panel.state.data._componentType = null;
  panel.state.data._component = null;
}

function resolveComponentSchema(
  componentType: string,
  engineVersion: string,
): ComponentSchemaVersion | null {
  const entry = getComponentSchemas(componentType);
  if (entry === null) return null;
  return resolveSchema(entry.versions, engineVersion);
}

function renderFields(
  schema: ComponentSchemaVersion,
  component: SerializedComponent,
): string {
  if (schema.fields.length === 0) {
    return '<em style="color: var(--vscode-descriptionForeground);">This component has no editable fields.</em>';
  }
  return schema.fields
    .map((field) => renderField(field, component[field.name]))
    .join('');
}

function renderField(field: PropertySchema, value: unknown): string {
  const label = escapeHtml(field.label);
  if (field.type === 'Vector3D') {
    const vec = isVector3D(value) ? value : { x: 0, y: 0, z: 0 };
    return renderVectorField(field.name, label, vec, ['x', 'y', 'z']);
  }
  return (
    `<div style="margin-bottom: 0.75em;">` +
    `<div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 0.25em;">${label}</div>` +
    `<em style="color: var(--vscode-descriptionForeground);">Editor for type "${escapeHtml(field.type)}" is not yet implemented.</em>` +
    `</div>`
  );
}

function renderVectorField(
  fieldName: string,
  label: string,
  vector: { x: number; y: number; z: number },
  axes: readonly ('x' | 'y' | 'z')[],
): string {
  const inputs = axes
    .map((axis) => {
      const current = vector[axis];
      const value = Number.isFinite(current) ? String(current) : '0';
      return (
        `<label style="display: inline-flex; align-items: center; margin-right: 0.5em; font-size: 0.85em;">` +
        `<span style="margin-right: 0.25em; color: var(--vscode-descriptionForeground);">${axis}</span>` +
        `<input type="number" step="any" value="${escapeAttribute(value)}" ` +
        `style="width: 5em; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px;" ` +
        `:change=edit(field=${fieldName}, axis=${axis}) />` +
        `</label>`
      );
    })
    .join('');
  return (
    `<div style="margin-bottom: 0.75em;">` +
    `<div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 0.25em;">${label}</div>` +
    `<div>${inputs}</div>` +
    `</div>`
  );
}

function findById(
  root: SerializedComponent,
  id: number,
): SerializedComponent | null {
  if (root.id === id) return root;
  const children = Array.isArray(root.components) ? root.components : [];
  for (const child of children) {
    if (!isNode(child)) continue;
    const hit = findById(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

function isNode(value: unknown): value is SerializedComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isVector3D(
  value: unknown,
): value is { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.z === 'number'
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
