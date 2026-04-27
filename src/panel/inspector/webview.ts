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
import {
  commandInvoke,
  componentUpdate,
  type JsonValue,
} from '../../protocol/index.js';
import type {
  OmosceneFile,
  SerializedComponent,
} from '../../omoscene/index.js';
import { getComponentSchemas, resolveSchema } from '../../schema/index.js';
import type { ComponentSchemaVersion } from '../../schema/index.js';
import { createEditorState, getNestedProperty } from '../../state/index.js';
import {
  resolveDynamicEnum,
  resolveSameComponentEnum,
} from '../../state/component-refs.js';
import { bootstrapPanel } from '../bootstrap.js';
import type { Bridge } from '../../bridge/index.js';
import { renderField, escapeHtml } from './widgets.js';

interface PanelData {
  title: string;
  nameRowHtml: string;
  fieldsHtml: string;
  actionsHtml: string;
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
      <NameRowBody/>
    </div>
    <div>
      <FieldsBody/>
    </div>
    <div style="margin-top: 0.75em;">
      <ActionsBody/>
    </div>
  </div>
</body>
`;

const NameRowBody = (): string => `{{nameRowHtml}}`;
const FieldsBody = (): string => `{{fieldsHtml}}`;
const ActionsBody = (): string => `{{actionsHtml}}`;

const panel = bootstrapPanel<PanelData>({
  template,
  initialData: {
    title: 'Inspector',
    nameRowHtml: '',
    fieldsHtml:
      '<em style="color: var(--vscode-descriptionForeground);">Select a component to inspect.</em>',
    actionsHtml: '',
    _selectedId: null,
    _componentType: null,
    _component: null,
  },
  stateFactory: (t, d, c, m) => new State<PanelData>(t, d, c, m),
  components: { NameRowBody, FieldsBody, ActionsBody },
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
    editEnumNumber: ({ bridge, state, field, event }) => {
      const target = event.target as HTMLSelectElement;
      const parsed = Number.parseFloat(target.value);
      if (!Number.isFinite(parsed)) return;
      dispatchFieldUpdate(bridge, state, field, parsed);
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
      // `field.name` may be a dotted path (e.g. `transform.position`
      // would still be flat, but a nested config Vector would land here
      // too). Read via `getNestedProperty` so flat and nested paths
      // both resolve uniformly.
      const currentVector = getNestedProperty(component, fieldName);
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
    invokeAction: ({ bridge, state, command }) => {
      const data = (state as { data: PanelData }).data;
      if (data._selectedId === null) return;
      bridge.dispatch(commandInvoke(String(command), [data._selectedId]));
    },
    browseForFile: ({ bridge, state, field }) => {
      const data = (state as { data: PanelData }).data;
      if (data._selectedId === null) return;
      bridge.dispatch(
        commandInvoke('omosuen.browseForImageFile', [
          data._selectedId,
          String(field),
        ]),
      );
    },
    toggleStringSet: ({ bridge, state, field, member, event }) => {
      const target = event.target as HTMLInputElement;
      const data = (state as { data: PanelData }).data;
      if (data._component === null) return;
      const fieldName = String(field);
      const memberName = String(member);
      const current = getNestedProperty(data._component, fieldName);
      const set = new Set<string>();
      if (Array.isArray(current)) {
        for (const v of current) {
          if (typeof v === 'string' && v !== '') set.add(v);
        }
      }
      if (target.checked) set.add(memberName);
      else set.delete(memberName);
      // Whole-array write — `applyComponentUpdate` handles top-level
      // array replacements atomically; no dotted-path math needed.
      dispatchFieldUpdate(bridge, state, fieldName, [...set]);
    },
    editName: ({ bridge, state, event }) => {
      const target = event.target as HTMLInputElement;
      dispatchFieldUpdate(bridge, state, 'name', target.value);
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
  const msg = componentUpdate(
    data._selectedId,
    data._componentType,
    String(field),
    value,
  );
  // Optimistic local dispatch — the document-controller broker
  // deliberately skips re-broadcasting to the source panel, so without
  // this the inspector's own sceneDocument stays stale and the edit
  // appears to "revert" the next time the same component is selected
  // (same pattern as the scene-tree's select fix).
  editor.dispatch(msg);
  bridge.dispatch(msg);
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

  panel.state.data.title = `${String(selectedId)}: ${component.type}`;
  panel.state.data._selectedId = selectedId;
  panel.state.data._componentType = component.type;
  panel.state.data._component = component;
  panel.state.data.nameRowHtml = renderNameRow(component);
  panel.state.data.fieldsHtml = renderFields(schema, component, file);
  panel.state.data.actionsHtml = renderActions(schema);
}

function setEmpty(message: string): void {
  panel.state.data.title = 'Inspector';
  panel.state.data.nameRowHtml = '';
  panel.state.data.fieldsHtml = `<em style="color: var(--vscode-descriptionForeground);">${escapeHtml(message)}</em>`;
  panel.state.data.actionsHtml = '';
  panel.state.data._selectedId = null;
  panel.state.data._componentType = null;
  panel.state.data._component = null;
}

function renderNameRow(component: SerializedComponent): string {
  const name = typeof component.name === 'string' ? component.name : '';
  // Handlers use the unquoted `:event=method(args)` form — State
  // Street's event regex only matches unquoted method calls, and a
  // quoted `:change="..."` confuses the attribute regex's non-greedy
  // match so neighbouring attribute values absorb the handler text.
  return `<div style="display: grid; grid-template-columns: auto 1fr; gap: 0.5em; align-items: center; margin-bottom: 0.5em;">
    <label style="font-size: 0.9em;">Name</label>
    <input type="text" value="${escapeHtml(name)}" :change=editName() style="background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 0.25em; width: 100%; box-sizing: border-box;" />
  </div>`;
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
  file: OmosceneFile,
): string {
  if (schema.fields.length === 0) {
    return '<em style="color: var(--vscode-descriptionForeground);">This component has no editable fields.</em>';
  }
  return schema.fields
    .map((field) => {
      // `field.name` may be a dotted path (e.g. `config.atlasSize`)
      // surfacing a nested member as its own inspector row. The same
      // path is used as the dispatch property; widget-emitted bindings
      // pass it back to the editor through `componentUpdate`, and the
      // host's `applyComponentUpdate` walks the path on write.
      //
      // Two orthogonal enum resolvers run before rendering:
      //   - `resolveDynamicEnum` populates options from
      //     `componentRef`-flagged fields (cross-component scan, e.g.
      //     sprite's textureMapKeys.* dropdowns).
      //   - `resolveSameComponentEnum` populates options from
      //     `valuesFromField`-flagged fields (same-component sibling
      //     field, e.g. animation-controller's currentAnimation).
      // Each is a pass-through for fields without its respective hook.
      const value = getNestedProperty(component, field.name);
      const resolved = resolveSameComponentEnum(
        resolveDynamicEnum(field, value, file.scene),
        component,
      );
      return renderField(resolved, value);
    })
    .join('');
}

function renderActions(schema: ComponentSchemaVersion): string {
  const actions = schema.actions ?? [];
  if (actions.length === 0) return '';
  return actions
    .map((action) => {
      // Bare unquoted form for State Street's event parser. Command
      // ids match [a-zA-Z0-9.]+ which is safe inside the method-arg
      // parens (no spaces, no quotes needed).
      const safeLabel = escapeHtml(action.label);
      return `<button type="button" :click=invokeAction(command=${action.command}) style="margin-right: 0.5em; margin-bottom: 0.25em;">${safeLabel}</button>`;
    })
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
