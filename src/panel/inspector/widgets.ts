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
  return (
    `<input type="text" value="${escapeAttr(current)}" ` +
    `style="${SCALAR_INPUT_STYLE} width: 100%; box-sizing: border-box;" ` +
    `:change=editString(field=${field.name}) />`
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
  const checked = current ? ' checked' : '';
  return (
    `<label style="display: inline-flex; align-items: center; gap: 0.4em;">` +
    `<input type="checkbox"${checked} :change=editBoolean(field=${field.name}) />` +
    `<span style="font-size: 0.85em; color: var(--vscode-descriptionForeground);">${current ? 'on' : 'off'}</span>` +
    `</label>`
  );
}

function renderEnumField(field: PropertySchema, value: unknown): string {
  const current = typeof value === 'string' ? value : '';
  const values = field.values ?? [];
  const options = values
    .map((opt) => {
      const selected = opt === current ? ' selected' : '';
      return `<option value="${escapeAttr(opt)}"${selected}>${escapeHtml(opt)}</option>`;
    })
    .join('');
  return (
    `<select style="${SCALAR_INPUT_STYLE} width: 100%; box-sizing: border-box;" ` +
    `:change=editEnum(field=${field.name})>` +
    options +
    `</select>`
  );
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
        `:change=editVector(field=${field.name}, axis=${axis}) />` +
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
