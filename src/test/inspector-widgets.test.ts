/**
 * Tests for the inspector widget library (Phase 7.1).
 *
 * Pure string-level assertions. No DOM. Each `PropertyType` variant
 * should emit the expected `type="..."`, `value="..."`, and
 * `:change=editX(field=..., ...)` binding, with schema `min` / `max` /
 * `step` honored where relevant.
 */

import { renderField } from '../panel/inspector/widgets.js';
import type { PropertySchema } from '../schema/index.js';
import { test } from './harness.js';

function expectIncludes(html: string, needle: string, message: string): void {
  if (!html.includes(needle)) {
    throw new Error(`${message} — expected "${needle}" in: ${html}`);
  }
}
function expectExcludes(html: string, needle: string, message: string): void {
  if (html.includes(needle)) {
    throw new Error(`${message} — unexpected "${needle}" in: ${html}`);
  }
}

export function runInspectorWidgetsTests(): void {
  // --- Labels ------------------------------------------------------------

  test('widget: wraps body with an HTML-escaped label', () => {
    const schema: PropertySchema = {
      name: 'flag',
      type: 'boolean',
      label: 'Evil <script>',
    };
    const html = renderField(schema, false);
    expectIncludes(html, 'Evil &lt;script&gt;', 'label should be escaped');
  });

  // --- string ------------------------------------------------------------

  test('widget: string emits <input type="text"> with :change=editString', () => {
    const html = renderField(
      { name: 'filePath', type: 'string', label: 'File Path' },
      'assets/hero.png',
    );
    expectIncludes(html, 'type="text"', 'input type');
    expectIncludes(html, 'value="assets/hero.png"', 'current value');
    expectIncludes(
      html,
      ':change=editString(field=filePath)',
      'change binding',
    );
  });

  test('widget: string default empty value when current is missing', () => {
    const html = renderField(
      { name: 'label', type: 'string', label: 'Label' },
      undefined,
    );
    expectIncludes(html, 'value=""', 'empty value on missing input');
  });

  // --- number ------------------------------------------------------------

  test('widget: number emits <input type="number"> with :change=editNumber', () => {
    const html = renderField(
      { name: 'opacity', type: 'number', label: 'Opacity' },
      0.75,
    );
    expectIncludes(html, 'type="number"', 'input type');
    expectIncludes(html, 'value="0.75"', 'current value');
    expectIncludes(html, ':change=editNumber(field=opacity)', 'change binding');
    expectIncludes(html, 'step="any"', 'default step');
  });

  test('widget: number honors schema min/max/step', () => {
    const html = renderField(
      {
        name: 'volume',
        type: 'number',
        label: 'Volume',
        min: 0,
        max: 1,
        step: 0.01,
      },
      0.5,
    );
    expectIncludes(html, 'min="0"', 'min attribute');
    expectIncludes(html, 'max="1"', 'max attribute');
    expectIncludes(html, 'step="0.01"', 'step attribute');
  });

  // --- boolean -----------------------------------------------------------

  test('widget: boolean emits checkbox with :change=editBoolean', () => {
    const on = renderField(
      { name: 'muted', type: 'boolean', label: 'Muted' },
      true,
    );
    expectIncludes(on, 'type="checkbox"', 'checkbox type');
    expectIncludes(on, ' checked', 'checked state when true');
    expectIncludes(on, ':change=editBoolean(field=muted)', 'change binding');

    const off = renderField(
      { name: 'muted', type: 'boolean', label: 'Muted' },
      false,
    );
    expectExcludes(off, ' checked', 'unchecked state when false');
  });

  // --- enum --------------------------------------------------------------

  test('widget: enum emits <select> with option list and selection', () => {
    const html = renderField(
      {
        name: 'shape',
        type: 'enum',
        label: 'Shape',
        values: ['box', 'sphere', 'capsule'],
      },
      'sphere',
    );
    expectIncludes(html, '<select', 'select element');
    expectIncludes(html, ':change=editEnum(field=shape)', 'change binding');
    expectIncludes(html, '<option value="box"', 'first option');
    expectIncludes(
      html,
      '<option value="sphere" selected>sphere</option>',
      'selected option',
    );
    expectIncludes(html, '<option value="capsule"', 'third option');
  });

  test('widget: enum with missing values emits empty select', () => {
    const html = renderField(
      { name: 'mode', type: 'enum', label: 'Mode' },
      'anything',
    );
    expectIncludes(html, '<select', 'select element');
    expectExcludes(html, '<option', 'no options when values undefined');
  });

  // --- Vector2D / Vector3D / Vector4D -----------------------------------

  test('widget: Vector2D emits 2 labeled axis inputs', () => {
    const html = renderField(
      { name: 'anchor', type: 'Vector2D', label: 'Anchor' },
      { x: 0.5, y: 0.5 },
    );
    expectIncludes(
      html,
      ':change=editVector(field=anchor,axis=x)',
      'x axis binding',
    );
    expectIncludes(
      html,
      ':change=editVector(field=anchor,axis=y)',
      'y axis binding',
    );
    expectExcludes(html, 'axis=z', '2D widget must not emit a z input');
  });

  test('widget: Vector3D emits 3 axis inputs with current values', () => {
    const html = renderField(
      { name: 'position', type: 'Vector3D', label: 'Position' },
      { x: 1, y: 2, z: 3 },
    );
    expectIncludes(html, 'value="1"', 'x value');
    expectIncludes(html, 'value="2"', 'y value');
    expectIncludes(html, 'value="3"', 'z value');
    expectIncludes(html, 'axis=x', 'x axis binding');
    expectIncludes(html, 'axis=y', 'y axis binding');
    expectIncludes(html, 'axis=z', 'z axis binding');
    expectExcludes(html, 'axis=w', '3D widget must not emit a w input');
  });

  test('widget: Vector4D emits 4 axis inputs', () => {
    const html = renderField(
      { name: 'tint', type: 'Vector4D', label: 'Tint' },
      { x: 1, y: 1, z: 1, w: 1 },
    );
    expectIncludes(html, 'axis=x', 'x axis');
    expectIncludes(html, 'axis=y', 'y axis');
    expectIncludes(html, 'axis=z', 'z axis');
    expectIncludes(html, 'axis=w', 'w axis');
  });

  test('widget: vector with missing value defaults each axis to 0', () => {
    const html = renderField(
      { name: 'rotation', type: 'Vector3D', label: 'Rotation' },
      undefined,
    );
    // Three inputs, each with value="0".
    const zeroCount = (html.match(/value="0"/g) ?? []).length;
    if (zeroCount !== 3) {
      throw new Error(
        `expected 3 zero-valued inputs, got ${zeroCount} in: ${html}`,
      );
    }
  });

  // --- structured (object / array / map) --------------------------------

  test('widget: object type emits JSON textarea', () => {
    const html = renderField(
      { name: 'storage', type: 'object', label: 'Storage' },
      { score: 10 },
    );
    expectIncludes(html, '<textarea', 'textarea element');
    expectIncludes(
      html,
      ':change=editStructured(field=storage)',
      'change binding',
    );
    expectIncludes(html, '&quot;score&quot;: 10', 'serialized JSON (escaped)');
  });

  test('widget: array type uses the same JSON textarea path', () => {
    const html = renderField({ name: 'flags', type: 'array', label: 'Flags' }, [
      'a',
      'b',
    ]);
    expectIncludes(html, '<textarea', 'textarea element');
    expectIncludes(
      html,
      ':change=editStructured(field=flags)',
      'change binding',
    );
  });

  test('widget: map type uses the same JSON textarea path', () => {
    const html = renderField(
      { name: 'typeMap', type: 'map', label: 'Type Map' },
      { foo: 'number' },
    );
    expectIncludes(html, '<textarea', 'textarea element');
    expectIncludes(
      html,
      ':change=editStructured(field=typeMap)',
      'change binding',
    );
  });
}
