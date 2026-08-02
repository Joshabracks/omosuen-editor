/**
 * Inspector host — schema-driven form for the selected component (E16 / 2e).
 * Pure model builders; dock mount owns a nested State Street instance.
 */

import {
  getEditorRegistry,
  getEditorTool,
  getNestedProperty,
  renderField,
  resolveEditorType,
  setNestedProperty,
  type ActionSchema,
  type FieldSchema,
  type ResolvedEditorType,
} from '../../editor-api';
import { componentUpdate, type EditorMessage } from '../../protocol';

export interface InspectorComponent {
  readonly id: string | number;
  readonly type: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface InspectorSelection {
  readonly components: readonly InspectorComponent[];
}

export interface InspectorRenderModel {
  readonly title: string;
  readonly messageHtml: string;
  readonly nameRowHtml: string;
  readonly fieldsHtml: string;
  readonly actionsHtml: string;
  readonly resolved: ResolvedEditorType | null;
  readonly component: InspectorComponent | null;
}

export interface InspectorHostDeps {
  readonly engineVersion: string;
  /** Optional scene walk for componentRef enums. */
  readonly listComponentKeys?: (
    componentType: string,
    keyField: string,
  ) => readonly string[];
  readonly onDispatch: (message: EditorMessage) => void;
  readonly onAction?: (action: ActionSchema, component: InspectorComponent) => void;
  readonly browseForFile?: (
    extensions: readonly string[],
  ) => Promise<string | null>;
}

export function buildInspectorModel(
  selection: InspectorSelection | null,
  deps: Pick<InspectorHostDeps, 'engineVersion' | 'listComponentKeys'>,
): InspectorRenderModel {
  const components = selection?.components ?? [];
  if (components.length === 0) {
    return emptyModel('Select a component to inspect.');
  }
  if (components.length > 1) {
    return emptyModel(
      `Multiple selection (${components.length}). Select a single component.`,
    );
  }

  const component = components[0]!;
  const resolved = resolveEditorType(component.type, deps.engineVersion);
  if (!resolved) {
    return {
      title: component.type,
      messageHtml: `<em class="inspector-msg">No editor schema registered for <code>${escape(component.type)}</code>.</em>`,
      nameRowHtml: renderNameRow(component),
      fieldsHtml: '',
      actionsHtml: '',
      resolved: null,
      component,
    };
  }

  const visibleFields = resolved.fields.filter((f) => f.editor !== 'tool-only');
  const fieldsHtml = visibleFields
    .map((field) =>
      renderField(field, getNestedProperty(component, field.name), {
        enumValues: resolveEnumValues(field, component, deps),
      }),
    )
    .join('');

  const actionsHtml = resolved.actions
    .map(
      (action) =>
        `<button type="button" class="inspector-action" ` +
        `:click=invokeAction(actionId=${escapeAttr(action.id)})>${escape(action.label)}</button>`,
    )
    .join('');

  return {
    title: resolved.type,
    messageHtml: '',
    nameRowHtml: renderNameRow(component),
    fieldsHtml:
      fieldsHtml ||
      '<em class="inspector-msg">No inspector fields for this type.</em>',
    actionsHtml,
    resolved,
    component,
  };
}

function emptyModel(message: string): InspectorRenderModel {
  return {
    title: 'Inspector',
    messageHtml: `<em class="inspector-msg">${escape(message)}</em>`,
    nameRowHtml: '',
    fieldsHtml: '',
    actionsHtml: '',
    resolved: null,
    component: null,
  };
}

function renderNameRow(component: InspectorComponent): string {
  const name = typeof component.name === 'string' ? component.name : '';
  return (
    `<div class="inspector-field">` +
    `<div class="inspector-field-label">Name</div>` +
    `<input type="text" class="inspector-input" value="${escapeAttr(name)}" ` +
    `:change=editName() />` +
    `</div>`
  );
}

function resolveEnumValues(
  field: FieldSchema,
  component: InspectorComponent,
  deps: Pick<InspectorHostDeps, 'listComponentKeys'>,
): readonly (string | number)[] | undefined {
  if (field.registryRef) {
    const reg = getEditorRegistry(field.registryRef.registryId);
    return reg?.listKeys() ?? [];
  }
  if (field.componentRef && deps.listComponentKeys) {
    return deps.listComponentKeys(
      field.componentRef.componentType,
      field.componentRef.keyField,
    );
  }
  if (field.valuesFromField) {
    const source = getNestedProperty(component, field.valuesFromField.fieldName);
    const values: string[] = [];
    if (Array.isArray(source)) {
      for (const item of source) {
        if (field.valuesFromField.mapField) {
          if (item && typeof item === 'object') {
            const v = (item as Record<string, unknown>)[
              field.valuesFromField.mapField
            ];
            if (typeof v === 'string') values.push(v);
          }
        } else if (typeof item === 'string') {
          values.push(item);
        }
      }
    }
    if (field.nullable) values.unshift('');
    return [...new Set(values)].sort();
  }
  return field.values;
}

export function dispatchInspectorFieldUpdate(
  deps: InspectorHostDeps,
  component: InspectorComponent,
  property: string,
  value: unknown,
): void {
  const id =
    typeof component.id === 'number' ? component.id : Number(component.id);
  if (!Number.isFinite(id)) return;
  deps.onDispatch(
    componentUpdate(id, component.type, property, value as never),
  );
}

/** Apply a component:update onto a local component snapshot (optimistic UI). */
export function applyUpdateToComponent(
  component: InspectorComponent,
  property: string,
  value: unknown,
): InspectorComponent {
  return setNestedProperty(
    { ...component },
    property,
    value,
  ) as InspectorComponent;
}

export function openInspectorAction(
  deps: InspectorHostDeps,
  action: ActionSchema,
  component: InspectorComponent,
): void {
  if (action.tool) {
    const tool = getEditorTool(action.tool);
    tool?.open({
      componentId: component.id,
      componentType: component.type,
      toolId: action.tool,
    });
  }
  deps.onAction?.(action, component);
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
