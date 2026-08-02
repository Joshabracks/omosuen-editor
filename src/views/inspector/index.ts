/**
 * Inspector panel — nested State Street inside the `:preserve` dock host (2e).
 *
 * Field widgets emit `:change` / `:click` bindings; methods dispatch
 * `component:update` via DocumentController. No host-level click/change
 * listener that reassigns `innerHTML` for value edits.
 */

import { State } from '@state-street/state-street';
import {
  applyBooleanEdit,
  applyEnumEdit,
  applyListAdd,
  applyListItemEdit,
  applyListRemove,
  applyMapAdd,
  applyMapEntries,
  applyMapRemove,
  applyNumberEdit,
  applyObjectJsonEdit,
  applyStringEdit,
  applyStringSetToggle,
  applyVectorAxisEdit,
  getNestedProperty,
} from '../../editor-api';
import {
  applyUpdateToComponent,
  buildInspectorModel,
  dispatchInspectorFieldUpdate,
  openInspectorAction,
  type InspectorComponent,
  type InspectorHostDeps,
  type InspectorRenderModel,
  type InspectorSelection,
} from './host';

export type {
  InspectorComponent,
  InspectorHostDeps,
  InspectorRenderModel,
  InspectorSelection,
} from './host';
export {
  applyUpdateToComponent,
  buildInspectorModel,
  dispatchInspectorFieldUpdate,
  openInspectorAction,
} from './host';

export const INSPECTOR_VIEW_ID = 'inspector';

export interface InspectorHandle {
  readonly setSelection: (selection: InspectorSelection | null) => void;
  readonly getSelection: () => InspectorSelection | null;
  readonly getModel: () => InspectorRenderModel;
}

interface InspectorData {
  title: string;
  messageHtml: string;
  nameRowHtml: string;
  fieldsHtml: string;
  actionsHtml: string;
  _component: InspectorComponent | null;
  _resolved: InspectorRenderModel['resolved'];
  _selection: InspectorSelection | null;
}

let handle: InspectorHandle | null = null;

export function getInspectorHandle(): InspectorHandle | null {
  return handle;
}

const template = /* html */ `
<div class="inspector-root">
  <h3 class="inspector-title">{{title}}</h3>
  <MessageBody/>
  <NameRowBody/>
  <div class="inspector-fields"><FieldsBody/></div>
  <div class="inspector-actions"><ActionsBody/></div>
</div>
`;

function modelToData(model: InspectorRenderModel): Omit<
  InspectorData,
  '_selection'
> {
  return {
    title: model.title,
    messageHtml: model.messageHtml,
    nameRowHtml: model.nameRowHtml,
    fieldsHtml: model.fieldsHtml,
    actionsHtml: model.actionsHtml,
    _component: model.component
      ? ({ ...model.component } as InspectorComponent)
      : null,
    _resolved: model.resolved,
  };
}

export function mountInspector(
  container: HTMLElement,
  deps: InspectorHostDeps,
): () => void {
  container.classList.add('inspector-panel');

  const initial = modelToData(buildInspectorModel(null, deps));

  const applyModel = (
    state: { data: InspectorData },
    selection: InspectorSelection | null,
    componentOverride?: InspectorComponent | null,
  ): void => {
    const model = buildInspectorModel(
      componentOverride
        ? { components: [componentOverride] }
        : selection,
      deps,
    );
    const next = modelToData(
      componentOverride && model.component
        ? { ...model, component: componentOverride }
        : model,
    );
    state.data.title = next.title;
    state.data.messageHtml = next.messageHtml;
    state.data.nameRowHtml = next.nameRowHtml;
    state.data.fieldsHtml = next.fieldsHtml;
    state.data.actionsHtml = next.actionsHtml;
    state.data._component = next._component;
    state.data._resolved = next._resolved;
    state.data._selection = selection;
  };

  const commitField = (
    state: { data: InspectorData },
    property: string,
    value: unknown,
    opts?: { refresh?: boolean },
  ): void => {
    const component = state.data._component;
    if (!component) return;
    const next = applyUpdateToComponent(component, property, value);
    state.data._component = next;
    if (state.data._selection?.components[0]) {
      state.data._selection = { components: [next] };
    }
    dispatchInspectorFieldUpdate(deps, next, property, value);
    if (opts?.refresh !== false) {
      // Structural / dependent-enum edits rebuild widgets; scalar :change
      // already committed the control value — rebuild keeps enums in sync.
      applyModel(state, state.data._selection, next);
    }
  };

  const inspectorState = new State(
    template,
    {
      ...initial,
      _selection: null,
    } satisfies InspectorData,
    {
      MessageBody: ({ state }: { state: { data: InspectorData } }) =>
        `${state.data.messageHtml}`,
      NameRowBody: ({ state }: { state: { data: InspectorData } }) =>
        `${state.data.nameRowHtml}`,
      FieldsBody: ({ state }: { state: { data: InspectorData } }) =>
        `${state.data.fieldsHtml}`,
      ActionsBody: ({ state }: { state: { data: InspectorData } }) =>
        `${state.data.actionsHtml}`,
    },
    {
      editName: ({
        state,
        event,
      }: {
        state: { data: InspectorData };
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        commitField(state, 'name', applyStringEdit(null, target.value));
      },
      editString: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        const name = String(field);
        const current = getNestedProperty(state.data._component, name);
        commitField(state, name, applyStringEdit(current, target.value));
      },
      editNumber: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        const name = String(field);
        const n = applyNumberEdit(
          getNestedProperty(state.data._component, name),
          target.value,
        );
        if (n === null) return;
        commitField(state, name, n);
      },
      editBoolean: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        const name = String(field);
        commitField(
          state,
          name,
          applyBooleanEdit(
            getNestedProperty(state.data._component, name),
            target.checked,
          ),
        );
      },
      editEnum: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLSelectElement;
        commitField(
          state,
          String(field),
          applyEnumEdit(target.value, {}),
        );
      },
      editEnumNumber: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLSelectElement;
        const value = applyEnumEdit(target.value, { numeric: true });
        if (value === null) return;
        commitField(state, String(field), value);
      },
      editEnumNullable: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLSelectElement;
        commitField(
          state,
          String(field),
          applyEnumEdit(target.value, { nullable: true }),
        );
      },
      editVector: ({
        state,
        field,
        axis,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        axis: string;
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        const name = String(field);
        const next = applyVectorAxisEdit(
          getNestedProperty(state.data._component, name),
          String(axis),
          target.value,
        );
        if (!next) return;
        commitField(state, name, next);
      },
      editStructured: ({
        state,
        field,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        event: Event;
      }) => {
        const target = event.target as HTMLTextAreaElement;
        const parsed = applyObjectJsonEdit(target.value);
        if (parsed === undefined) return;
        commitField(state, String(field), parsed);
      },
      toggleStringSet: ({
        state,
        field,
        member,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        member: string;
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        const name = String(field);
        const schema = state.data._resolved?.fields.find((f) => f.name === name);
        commitField(
          state,
          name,
          applyStringSetToggle(
            getNestedProperty(state.data._component, name),
            String(member),
            target.checked,
            schema?.alwaysOn ?? [],
          ),
        );
      },
      editListItem: ({
        state,
        field,
        index,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        index: number;
        event: Event;
      }) => {
        const target = event.target as HTMLInputElement;
        const name = String(field);
        commitField(
          state,
          name,
          applyListItemEdit(
            getNestedProperty(state.data._component, name),
            Number(index),
            target.value,
          ),
        );
      },
      listAdd: ({
        state,
        field,
      }: {
        state: { data: InspectorData };
        field: string;
      }) => {
        const name = String(field);
        commitField(
          state,
          name,
          applyListAdd(getNestedProperty(state.data._component, name), ''),
        );
      },
      listRemove: ({
        state,
        field,
        index,
      }: {
        state: { data: InspectorData };
        field: string;
        index: number;
      }) => {
        const name = String(field);
        commitField(
          state,
          name,
          applyListRemove(
            getNestedProperty(state.data._component, name),
            Number(index),
          ),
        );
      },
      editMapRow: ({
        state,
        field,
        index,
        event,
      }: {
        state: { data: InspectorData };
        field: string;
        index: number;
        event: Event;
      }) => {
        const target = event.target as HTMLElement;
        const root = target.closest('.inspector-map');
        if (!root) return;
        const rows = Array.from(root.querySelectorAll('.inspector-map-row'));
        const entries = rows.map((row) => {
          const key =
            (row.querySelector('.map-key') as HTMLInputElement | null)?.value ??
            '';
          const value =
            (row.querySelector('.map-value') as HTMLInputElement | null)
              ?.value ?? '';
          return { key, value };
        });
        // Ensure the edited index is reflected even if query lags.
        void index;
        commitField(state, String(field), applyMapEntries(entries));
      },
      mapAdd: ({
        state,
        field,
      }: {
        state: { data: InspectorData };
        field: string;
      }) => {
        const name = String(field);
        commitField(
          state,
          name,
          applyMapAdd(getNestedProperty(state.data._component, name)),
        );
      },
      mapRemove: ({
        state,
        field,
        index,
      }: {
        state: { data: InspectorData };
        field: string;
        index: number;
      }) => {
        const name = String(field);
        const current = getNestedProperty(state.data._component, name);
        const entries =
          typeof current === 'object' &&
          current !== null &&
          !Array.isArray(current)
            ? Object.keys(current as Record<string, unknown>)
            : [];
        const key = entries[Number(index)];
        if (key === undefined) return;
        commitField(state, name, applyMapRemove(current, key));
      },
      browseForFile: ({
        state,
        field,
      }: {
        state: { data: InspectorData };
        field: string;
      }) => {
        void (async () => {
          if (!deps.browseForFile) return;
          const name = String(field);
          const schema = state.data._resolved?.fields.find(
            (f) => f.name === name,
          );
          const extensions = schema?.filePicker?.extensions ?? [];
          const picked = await deps.browseForFile(extensions);
          if (picked !== null) {
            commitField(state, name, picked);
          }
        })();
      },
      invokeAction: ({
        state,
        actionId,
      }: {
        state: { data: InspectorData };
        actionId: string;
      }) => {
        const component = state.data._component;
        const action = state.data._resolved?.actions.find(
          (a) => a.id === String(actionId),
        );
        if (!component || !action) return;
        openInspectorAction(deps, action, component);
      },
    },
    { mountTarget: container },
  ) as InstanceType<typeof State> & { data: InspectorData };

  handle = {
    setSelection: (next) => {
      applyModel(inspectorState, next);
    },
    getSelection: () => inspectorState.data._selection,
    getModel: () => ({
      title: inspectorState.data.title,
      messageHtml: inspectorState.data.messageHtml,
      nameRowHtml: inspectorState.data.nameRowHtml,
      fieldsHtml: inspectorState.data.fieldsHtml,
      actionsHtml: inspectorState.data.actionsHtml,
      resolved: inspectorState.data._resolved,
      component: inspectorState.data._component,
    }),
  };

  return () => {
    inspectorState.destroy();
    if (handle) handle = null;
    container.classList.remove('inspector-panel');
    container.replaceChildren();
  };
}
