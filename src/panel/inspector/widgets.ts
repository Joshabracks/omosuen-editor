/**
 * Inspector widget library (Phase 7.1).
 *
 * Pure `PropertySchema` + value → HTML string renderers. Kept out of
 * [webview.ts](./webview.ts) so the dispatch-by-type surface is unit
 * testable without jsdom (Q3) — each renderer emits State Street
 * bindings (`:change=method(args)`) that the webview's method handlers
 * then consume to produce `component:update` dispatches.
 *
 * Widget coverage (v1):
 *   - `string`     → `<input type="text">` (editable)
 *   - `number`     → `<input type="number">` with schema `min`/`max`/`step` (editable)
 *   - `boolean`    → `<input type="checkbox">` (editable)
 *   - `enum`       → `<select>` with `field.values` options (editable)
 *   - `Vector2D`   → two labeled number inputs (editable per axis)
 *   - `Vector3D`   → three labeled number inputs (editable per axis)
 *   - `Vector4D`   → four labeled number inputs (editable per axis)
 *   - `object` / `array` / `map` → editable JSON `<textarea>` (Phase 8
 *     replaces with proper structured widgets)
 */

import type { PropertySchema } from '../../schema/index.js';

export function renderField(field: PropertySchema, value: unknown): string {
  const label = escapeHtml(field.label);
  const body = renderBody(field, value);
  return (
    `<div style="margin-bottom: 0.75em;">` +
    `<div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 0.25em;">${label}</div>` +
    body +
    `</div>`
  );
}

function renderBody(field: PropertySchema, value: unknown): string {
  switch (field.type) {
    case 'string':
      return renderStringField(field, value);
    case 'number':
      return renderNumberField(field, value);
    case 'boolean':
      return renderBooleanField(field, value);
    case 'enum':
      return renderEnumField(field, value);
    case 'stringSet':
      return renderStringSetField(field, value);
    case 'Vector2D':
      return renderVectorField(field, value, ['x', 'y']);
    case 'Vector3D':
      return renderVectorField(field, value, ['x', 'y', 'z']);
    case 'Vector4D':
      return renderVectorField(field, value, ['x', 'y', 'z', 'w']);
    case 'object':
    case 'array':
    case 'map':
      return renderStructuredField(field, value);
  }
}

function renderStringField(field: PropertySchema, value: unknown): string {
  const current = typeof value === 'string' ? value : '';
  if (field.filePicker === undefined) {
    return (
      `<input type="text" value="${escapeAttr(current)}" ` +
      `style="${SCALAR_INPUT_STYLE} width: 100%; box-sizing: border-box;" ` +
      `:change=editString(field=${field.name}) />`
    );
  }
  // Path field: text input + Browse… button in a flex row. Button
  // dispatches `omosuen.browseForFile` via command:invoke; the
  // host command resolves the picked file path scene-relative and
  // writes it back through the standard component:update flow.
  return (
    `<div style="display: flex; gap: 0.4em; align-items: stretch;">` +
    `<input type="text" value="${escapeAttr(current)}" ` +
    `style="${SCALAR_INPUT_STYLE} flex: 1; box-sizing: border-box;" ` +
    `:change=editString(field=${field.name}) />` +
    `<button type="button" :click=browseForFile(field=${field.name})>Browse…</button>` +
    `</div>`
  );
}

function renderNumberField(field: PropertySchema, value: unknown): string {
  const current =
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const minAttr = field.min !== undefined ? ` min="${String(field.min)}"` : '';
  const maxAttr = field.max !== undefined ? ` max="${String(field.max)}"` : '';
  const stepAttr =
    field.step !== undefined ? ` step="${String(field.step)}"` : ' step="any"';
  return (
    `<input type="number"${minAttr}${maxAttr}${stepAttr} value="${escapeAttr(String(current))}" ` +
    `style="${SCALAR_INPUT_STYLE} width: 8em;" ` +
    `:change=editNumber(field=${field.name}) />`
  );
}

function renderBooleanField(field: PropertySchema, value: unknown): string {
  const current = value === true;
  // State Street's parseSST ATTRIBUTE regex requires `name="value"`
  // form; bare `checked` (or `selected` on options) is dropped, so
  // initial state would never reflect the actual value. Use the
  // value-form to satisfy the parser.
  const checked = current ? ' checked="checked"' : '';
  return (
    `<label style="display: inline-flex; align-items: center; gap: 0.4em;">` +
    `<input type="checkbox"${checked} :change=editBoolean(field=${field.name}) />` +
    `<span style="font-size: 0.85em; color: var(--vscode-descriptionForeground);">${current ? 'on' : 'off'}</span>` +
    `</label>`
  );
}

function renderEnumField(field: PropertySchema, value: unknown): string {
  const values = field.values ?? [];
  // Three flavours of enum:
  //   - All-string values (e.g. animation-controller's `state`).
  //   - All-number values (e.g. atlas-manager's `config.atlasSize`)
  //     — routed through `editEnumNumber` so `target.value` (always a
  //     string from `<select>`) is parsed back to a number.
  //   - Nullable string enums (e.g. animation-controller's
  //     `currentAnimation`) — empty option labelled `(none)`,
  //     dispatched as literal `null`, with `(missing)` rendering for
  //     stale saved values.
  const isNumeric = values.length > 0 && typeof values[0] === 'number';
  const isNullable = field.nullable === true;
  const currentStr =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? String(value)
        : '';
  const optionsList: string[] = [];
  let matchedCurrent = false;
  for (const opt of values) {
    const optStr = String(opt);
    const isMatch = optStr === currentStr;
    if (isMatch) matchedCurrent = true;
    // `selected="selected"` (rather than bare `selected`) — see the
    // boolean widget above for the parseSST-regex rationale.
    const selected = isMatch ? ' selected="selected"' : '';
    const label = isNullable && optStr === '' ? '(none)' : optStr;
    optionsList.push(
      `<option value="${escapeAttr(optStr)}"${selected}>${escapeHtml(label)}</option>`,
    );
  }
  // Stale-value preservation: the saved value points to something
  // not in the resolved options list (e.g. an animation that's been
  // deleted by name). Render it as a disabled selected option so the
  // user sees what's stored and can pick a replacement instead of
  // having the dropdown silently default to the first option.
  if (currentStr !== '' && !matchedCurrent) {
    optionsList.push(
      `<option value="${escapeAttr(currentStr)}" selected="selected" disabled="disabled">${escapeHtml(currentStr + ' (missing)')}</option>`,
    );
  }
  const handler = isNullable
    ? 'editEnumNullable'
    : isNumeric
      ? 'editEnumNumber'
      : 'editEnum';
  return (
    `<select style="${SCALAR_INPUT_STYLE} width: 100%; box-sizing: border-box;" ` +
    `:change=${handler}(field=${field.name})>` +
    optionsList.join('') +
    `</select>`
  );
}

function renderStringSetField(field: PropertySchema, value: unknown): string {
  const options = field.options ?? [];
  const alwaysOn = new Set(field.alwaysOn ?? []);
  const current = new Set<string>();
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === 'string') current.add(v);
  }
  // alwaysOn members render as checked + disabled even when absent
  // from the saved data, so the inspector matches engine behaviour
  // (the engine forces them on regardless). Disabled inputs don't
  // dispatch :change, so the binding is omitted for those — the
  // `member=...` arg in the binding tells the toggle handler which
  // entry was clicked without needing a `data-` attribute (State
  // Street's regex strips hyphenated names).
  const checkboxes = options
    .map((opt) => {
      const isOn = alwaysOn.has(opt) || current.has(opt);
      const disabled = alwaysOn.has(opt);
      const checked = isOn ? ' checked="checked"' : '';
      const dis = disabled ? ' disabled="disabled"' : '';
      const binding = disabled
        ? ''
        : ` :change=toggleStringSet(field=${field.name},member=${opt})`;
      return (
        `<label style="display: inline-flex; align-items: center; gap: 0.3em; margin-right: 0.75em;">` +
        `<input type="checkbox"${checked}${dis}${binding} />` +
        `<span style="font-size: 0.85em;">${escapeHtml(opt)}</span>` +
        `</label>`
      );
    })
    .join('');
  return `<div style="display: flex; flex-wrap: wrap; gap: 0.25em;">${checkboxes}</div>`;
}

function renderVectorField(
  field: PropertySchema,
  value: unknown,
  axes: readonly VectorAxis[],
): string {
  const vec = isVectorLike(value) ? value : {};
  const stepAttr =
    field.step !== undefined ? ` step="${String(field.step)}"` : ' step="any"';
  const inputs = axes
    .map((axis) => {
      const raw = vec[axis];
      const current = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      return (
        `<label style="display: inline-flex; align-items: center; margin-right: 0.5em; font-size: 0.85em;">` +
        `<span style="margin-right: 0.25em; color: var(--vscode-descriptionForeground);">${axis}</span>` +
        `<input type="number"${stepAttr} value="${escapeAttr(String(current))}" ` +
        `style="${SCALAR_INPUT_STYLE} width: 5em;" ` +
        // No space after the comma: State Street's event-arg parser
        // splits on `,` and doesn't trim, so ` axis=x` arrives with a
        // leading-space key and the handler's `{ axis }` destructure
        // sees `undefined`. That silently wrote to `nextVector.undefined`
        // and left x/y/z at their old values — exactly the "typed value
        // reverts to 0" symptom. Keeping it tight.
        `:change=editVector(field=${field.name},axis=${axis}) />` +
        `</label>`
      );
    })
    .join('');
  return `<div>${inputs}</div>`;
}

function renderStructuredField(field: PropertySchema, value: unknown): string {
  const json = value === undefined ? '' : safeJsonStringify(value);
  return (
    `<textarea rows="4" ` +
    `style="${SCALAR_INPUT_STYLE} width: 100%; box-sizing: border-box; font-family: var(--vscode-editor-font-family); white-space: pre; resize: vertical;" ` +
    `:change=editStructured(field=${field.name})>` +
    escapeHtml(json) +
    `</textarea>`
  );
}

// --- helpers ---------------------------------------------------------------

type VectorAxis = 'x' | 'y' | 'z' | 'w';

const SCALAR_INPUT_STYLE =
  'background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px;';

function isVectorLike(
  value: unknown,
): value is Partial<Record<VectorAxis, number>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '/* non-serializable value */';
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
