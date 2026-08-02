import type { FieldSchema, FieldType, FieldWidgetType } from '../types';

const VECTOR_AXES: Record<string, readonly string[]> = {
  Vector2: ['x', 'y'],
  Vector3: ['x', 'y', 'z'],
  Vector4: ['x', 'y', 'z', 'w'],
  Color3: ['r', 'g', 'b'],
  Color4: ['r', 'g', 'b', 'a'],
};

/** Normalize remake aliases to E16 widget ids. */
export function normalizeFieldType(type: FieldType): FieldWidgetType {
  switch (type) {
    case 'Vector2D':
      return 'Vector2';
    case 'Vector3D':
      return 'Vector3';
    case 'Vector4D':
      return 'Vector4';
    case 'array':
      return 'list';
    default:
      return type;
  }
}

export interface FieldRenderContext {
  /** Resolved enum options (componentRef / valuesFromField / registryRef). */
  readonly enumValues?: readonly (string | number)[];
}

/**
 * Render one field as HTML with State Street `:change` / `:click` bindings.
 * Field names must be SS-safe args (no spaces); dotted paths are supported
 * as a single arg token.
 */
export function renderField(
  field: FieldSchema,
  value: unknown,
  ctx: FieldRenderContext = {},
): string {
  if (field.editor === 'tool-only') {
    return '';
  }
  const label = escapeHtml(field.label);
  const body = renderBody(field, value, ctx);
  if (!body) return '';
  return (
    `<div class="inspector-field">` +
    `<div class="inspector-field-label">${label}</div>` +
    `<div class="inspector-field-body">${body}</div>` +
    `</div>`
  );
}

function renderBody(
  field: FieldSchema,
  value: unknown,
  ctx: FieldRenderContext,
): string {
  const type = normalizeFieldType(field.type);
  switch (type) {
    case 'string':
      return renderString(field, value);
    case 'number':
      return renderNumber(field, value);
    case 'boolean':
      return renderBoolean(field, value);
    case 'enum':
      return renderEnum(field, value, ctx.enumValues ?? field.values ?? []);
    case 'stringSet':
      return renderStringSet(field, value);
    case 'Vector2':
    case 'Vector3':
    case 'Vector4':
    case 'Color3':
    case 'Color4':
      return renderVector(field, value, VECTOR_AXES[type]!);
    case 'list':
      return renderList(field, value);
    case 'map':
      return renderMap(field, value);
    case 'object':
      return renderJson(field, value);
  }
}

function fieldArg(name: string): string {
  // Unquoted SS event args; dots are fine as a single token for remake parity.
  return name;
}

function renderString(field: FieldSchema, value: unknown): string {
  const current = typeof value === 'string' ? value : '';
  const input =
    `<input type="text" class="inspector-input" value="${escapeAttr(current)}" ` +
    `:change=editString(field=${fieldArg(field.name)}) />`;
  if (!field.filePicker) return input;
  return (
    `<div class="inspector-file-row">` +
    input +
    `<button type="button" class="inspector-browse" ` +
    `:click=browseForFile(field=${fieldArg(field.name)})>Browse…</button>` +
    `</div>`
  );
}

function renderNumber(field: FieldSchema, value: unknown): string {
  const current =
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const min = field.min !== undefined ? ` min="${field.min}"` : '';
  const max = field.max !== undefined ? ` max="${field.max}"` : '';
  const step =
    field.step !== undefined ? ` step="${field.step}"` : ' step="any"';
  return (
    `<input type="number" class="inspector-input"${min}${max}${step} ` +
    `value="${escapeAttr(String(current))}" ` +
    `:change=editNumber(field=${fieldArg(field.name)}) />`
  );
}

function renderBoolean(field: FieldSchema, value: unknown): string {
  // SS attribute parser wants checked="checked", not bare checked.
  const checked = value === true ? ' checked="checked"' : '';
  return (
    `<label class="inspector-check">` +
    `<input type="checkbox"${checked} :change=editBoolean(field=${fieldArg(field.name)}) />` +
    `<span>${value === true ? 'on' : 'off'}</span>` +
    `</label>`
  );
}

function renderEnum(
  field: FieldSchema,
  value: unknown,
  values: readonly (string | number)[],
): string {
  const currentStr =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value === null && field.nullable
        ? ''
        : '';
  const isNumeric = values.length > 0 && typeof values[0] === 'number';
  const options: string[] = [];
  let matched = false;
  for (const opt of values) {
    const optStr = String(opt);
    const isMatch = optStr === currentStr;
    if (isMatch) matched = true;
    const label = field.nullable && optStr === '' ? '(none)' : optStr;
    const selected = isMatch ? ' selected="selected"' : '';
    options.push(
      `<option value="${escapeAttr(optStr)}"${selected}>${escapeHtml(label)}</option>`,
    );
  }
  if (currentStr !== '' && !matched) {
    options.push(
      `<option value="${escapeAttr(currentStr)}" selected="selected" disabled="disabled">${escapeHtml(currentStr)} (missing)</option>`,
    );
  }
  const handler = field.nullable
    ? 'editEnumNullable'
    : isNumeric
      ? 'editEnumNumber'
      : 'editEnum';
  return (
    `<select class="inspector-input" :change=${handler}(field=${fieldArg(field.name)})>` +
    options.join('') +
    `</select>`
  );
}

function renderStringSet(field: FieldSchema, value: unknown): string {
  const options = field.options ?? [];
  const alwaysOn = new Set(field.alwaysOn ?? []);
  const current = new Set<string>();
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string') current.add(v);
  }
  const boxes = options
    .map((opt) => {
      const on = alwaysOn.has(opt) || current.has(opt);
      const disabled = alwaysOn.has(opt);
      const checked = on ? ' checked="checked"' : '';
      const dis = disabled ? ' disabled="disabled"' : '';
      const binding = disabled
        ? ''
        : ` :change=toggleStringSet(field=${fieldArg(field.name)},member=${opt})`;
      return (
        `<label class="inspector-check">` +
        `<input type="checkbox"${checked}${dis}${binding} />` +
        `<span>${escapeHtml(opt)}</span>` +
        `</label>`
      );
    })
    .join('');
  return `<div class="inspector-string-set">${boxes}</div>`;
}

function renderVector(
  field: FieldSchema,
  value: unknown,
  axes: readonly string[],
): string {
  const vec =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const step =
    field.step !== undefined ? ` step="${field.step}"` : ' step="any"';
  const inputs = axes
    .map((axis) => {
      const raw = vec[axis];
      const current =
        typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      // No space after commas — SS event-arg parser does not trim.
      return (
        `<label class="inspector-axis">` +
        `<span>${escapeHtml(axis)}</span>` +
        `<input type="number" class="inspector-input"${step} ` +
        `value="${escapeAttr(String(current))}" ` +
        `:change=editVector(field=${fieldArg(field.name)},axis=${axis}) />` +
        `</label>`
      );
    })
    .join('');
  return `<div class="inspector-vector">${inputs}</div>`;
}

function renderList(field: FieldSchema, value: unknown): string {
  const items = Array.isArray(value) ? value : [];
  const rows = items
    .map((item, index) => {
      const text =
        typeof item === 'string' || typeof item === 'number'
          ? String(item)
          : safeJson(item);
      return (
        `<div class="inspector-list-row">` +
        `<input type="text" class="inspector-input" value="${escapeAttr(text)}" ` +
        `:change=editListItem(field=${fieldArg(field.name)},index=${index}) />` +
        `<button type="button" :click=listRemove(field=${fieldArg(field.name)},index=${index})>Remove</button>` +
        `</div>`
      );
    })
    .join('');
  return (
    `<div class="inspector-list">` +
    rows +
    `<button type="button" :click=listAdd(field=${fieldArg(field.name)})>Add</button>` +
    `</div>`
  );
}

function renderMap(field: FieldSchema, value: unknown): string {
  const entries =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : [];
  const rows = entries
    .map(([key, val], index) => {
      const text =
        typeof val === 'string' || typeof val === 'number'
          ? String(val)
          : safeJson(val);
      return (
        `<div class="inspector-map-row">` +
        `<input type="text" class="inspector-input map-key" value="${escapeAttr(key)}" ` +
        `:change=editMapRow(field=${fieldArg(field.name)},index=${index}) />` +
        `<input type="text" class="inspector-input map-value" value="${escapeAttr(text)}" ` +
        `:change=editMapRow(field=${fieldArg(field.name)},index=${index}) />` +
        `<button type="button" :click=mapRemove(field=${fieldArg(field.name)},index=${index})>Remove</button>` +
        `</div>`
      );
    })
    .join('');
  return (
    `<div class="inspector-map">` +
    rows +
    `<button type="button" :click=mapAdd(field=${fieldArg(field.name)})>Add</button>` +
    `</div>`
  );
}

function renderJson(field: FieldSchema, value: unknown): string {
  return (
    `<textarea class="inspector-input" rows="4" ` +
    `:change=editStructured(field=${fieldArg(field.name)})>` +
    escapeHtml(safeJson(value)) +
    `</textarea>`
  );
}

function safeJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
