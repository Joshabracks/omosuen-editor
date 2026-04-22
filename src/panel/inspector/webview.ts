/**
 * Inspector webview — Phase 7.1.
 *
 * Phase 5 shipped this panel supporting only `transform`'s Vector3D
 * fields. Phase 7.1 adds widgets for every `PropertyType` via
 * [widgets.ts](./widgets.ts): string, number, boolean, enum, Vector2D,
 * Vector3D, Vector4D, plus a JSON textarea for object/array/map.
 *
 * Dispatch: widgets emit State Street `:change=editX(field=..., ...)`
 * bindings that resolve to the per-type methods below. Each reads the
 * latest component state from `state.data._component` and dispatches a
 * `component:update` with the new value.
 *
 * JSON-textarea edits silently skip dispatch on parse failure — an
 * inline error hint is Phase 8 work.
 */

import { State } from 'state-street';
import { componentUpdate, type JsonValue } from '../../protocol/index.js';
import type { SerializedComponent } from '../../omoscene/index.js';
import { getComponentSchemas, resolveSchema } from '../../schema/index.js';
import type { ComponentSchemaVersion } from '../../schema/index.js';
import { createEditorState } from '../../state/index.js';
import { bootstrapPanel } from '../bootstrap.js';
import type { Bridge } from '../../bridge/index.js';
import { renderField, escapeHtml } from './widgets.js';

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
    editString: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLInputElement;
      dispatchFieldUpdate(bridge, state, field, target.value);
    },
    editNumber: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLInputElement;
      const parsed = Number.parseFloat(target.value);
      if (!Number.isFinite(parsed)) return;
      dispatchFieldUpdate(bridge, state, field, parsed);
    },
    editBoolean: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLInputElement;
      dispatchFieldUpdate(bridge, state, field, target.checked);
    },
    editEnum: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLSelectElement;
      dispatchFieldUpdate(bridge, state, field, target.value);
    },
    editVector: ({ bridge, state, field, axis, event }) => {
      const target = event.target as HTMLInputElement;
      const parsed = Number.parseFloat(target.value);
      if (!Number.isFinite(parsed)) return;
      const data = (state as { data: PanelData }).data;
      const component = data._component;
      if (component === null) return;
      const fieldName = String(field);
      const axisName = String(axis);
      const currentVector = component[fieldName];
      if (!isPlainObject(currentVector)) return;
      // Preserve _vectorType + other axes; override only the named axis.
      const nextVector: JsonValue = {
        ...(currentVector as Record<string, JsonValue>),
        [axisName]: parsed,
      };
      dispatchFieldUpdate(bridge, state, field, nextVector);
    },
    editStructured: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLTextAreaElement;
      let parsed: JsonValue;
      try {
        parsed = JSON.parse(target.value) as JsonValue;
      } catch {
        // Malformed JSON — skip dispatch. Phase 8 surfaces this inline.
        return;
      }
      dispatchFieldUpdate(bridge, state, field, parsed);
    },
  },
  wireIncoming: (msg) => {
    editor.dispatch(msg);
  },
});

function dispatchFieldUpdate(
  bridge: Bridge,
  state: unknown,
  field: unknown,
  value: JsonValue,
): void {
  const data = (state as { data: PanelData }).data;
  if (data._selectedId === null || data._componentType === null) return;
  bridge.dispatch(
    componentUpdate(
      data._selectedId,
      data._componentType,
      String(field),
      value,
    ),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
