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

  test('widget: plain string field has no Browse button', () => {
    const html = renderField(
      { name: 'label', type: 'string', label: 'Label' },
      'hello',
    );
    expectExcludes(html, 'Browse', 'no Browse button without filePicker');
    expectExcludes(
      html,
      ':click=browseForFile',
      'no browseForFile binding without filePicker',
    );
  });

  test('widget: string with filePicker emits Browse button + binding', () => {
    const html = renderField(
      {
        name: 'filePath',
        type: 'string',
        label: 'File Path',
        filePicker: { extensions: ['png', 'jpg'] },
      },
      'assets/hero.png',
    );
    expectIncludes(html, 'type="text"', 'still has the text input');
    expectIncludes(
      html,
      'value="assets/hero.png"',
      'preserves the current value',
    );
    expectIncludes(html, '<button', 'browse button is rendered');
    expectIncludes(html, 'Browse', 'button label visible');
    expectIncludes(
      html,
      ':click=browseForFile(field=filePath)',
      'click binding routes to browseForFile with field name',
    );
    // Text-input + button still emit the same `editString` change so a
    // user typing manually keeps working alongside the picker.
    expectIncludes(
      html,
      ':change=editString(field=filePath)',
      'text input still fires editString on change',
    );
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
      '<option value="sphere" selected="selected">sphere</option>',
      'selected option (uses name="value" form so State Street parser keeps it)',
    );
    expectIncludes(html, '<option value="capsule"', 'third option');
  });

  test('widget: enum with missing values still preserves saved value as (missing)', () => {
    const html = renderField(
      { name: 'mode', type: 'enum', label: 'Mode' },
      'anything',
    );
    expectIncludes(html, '<select', 'select element');
    // Saved value is preserved as a disabled selected option so the
    // user can see what's stored even when the resolved values list
    // is empty (e.g. dynamic source returned nothing).
    expectIncludes(html, 'anything (missing)', 'stale value preserved');
    expectIncludes(html, ' disabled="disabled"', 'stale value disabled');
  });

  test('widget: enum with empty current value + no values emits empty select', () => {
    const html = renderField({ name: 'mode', type: 'enum', label: 'Mode' }, '');
    expectIncludes(html, '<select', 'select element');
    expectExcludes(html, '<option', 'no options when nothing to show');
  });

  test('widget: nullable enum labels empty option as (none) and dispatches via editEnumNullable', () => {
    const html = renderField(
      {
        name: 'currentAnimation',
        type: 'enum',
        label: 'Current Animation',
        nullable: true,
        values: ['', 'walk', 'idle'],
      },
      'walk',
    );
    expectIncludes(html, '<option value="">(none)</option>', '(none) label');
    expectIncludes(
      html,
      ':change=editEnumNullable(field=currentAnimation)',
      'nullable change handler binding',
    );
    expectIncludes(
      html,
      '<option value="walk" selected="selected">walk</option>',
      'walk option selected',
    );
  });

  test('widget: nullable enum renders stale saved value as (missing)', () => {
    const html = renderField(
      {
        name: 'currentAnimation',
        type: 'enum',
        label: 'Current Animation',
        nullable: true,
        values: ['', 'walk', 'idle'],
      },
      'jump',
    );
    expectIncludes(html, 'jump (missing)', 'stale value labeled missing');
    expectIncludes(
      html,
      'value="jump" selected="selected" disabled="disabled"',
      'stale value selected + disabled',
    );
  });

  test('widget: numeric enum routes through editEnumNumber, options are stringified', () => {
    const html = renderField(
      {
        name: 'config.atlasSize',
        type: 'enum',
        label: 'Atlas Size',
        values: [1024, 2048, 4096, 8192],
        default: 4096,
      },
      4096,
    );
    expectIncludes(html, '<select', 'select element');
    // Numeric values dispatch through `editEnumNumber` so the handler
    // can `Number.parseFloat` before calling componentUpdate.
    expectIncludes(
      html,
      ':change=editEnumNumber(field=config.atlasSize)',
      'numeric enum change binding',
    );
    expectIncludes(html, '<option value="1024"', 'first numeric option');
    expectIncludes(
      html,
      '<option value="4096" selected="selected">4096</option>',
      'selected numeric option',
    );
    expectIncludes(html, '<option value="8192"', 'last numeric option');
  });

  // --- stringSet --------------------------------------------------------

  const channelsField = {
    name: 'channels',
    type: 'stringSet' as const,
    label: 'Channels',
    options: ['albedo', 'normal', 'material', 'emission'],
    alwaysOn: ['albedo'],
  };

  test('widget: stringSet renders one checkbox per option', () => {
    const html = renderField(channelsField, ['albedo']);
    // Four checkboxes total — one per option entry.
    const checkboxCount = (html.match(/type="checkbox"/g) ?? []).length;
    if (checkboxCount !== 4) {
      throw new Error(`expected 4 checkboxes, got ${checkboxCount}`);
    }
    expectIncludes(html, '>albedo</span>', 'albedo label');
    expectIncludes(html, '>normal</span>', 'normal label');
    expectIncludes(html, '>material</span>', 'material label');
    expectIncludes(html, '>emission</span>', 'emission label');
  });

  test('widget: stringSet alwaysOn members are checked + disabled, no binding', () => {
    const html = renderField(channelsField, ['albedo']);
    // Find the albedo checkbox segment by anchoring on its label.
    const albedoSegment = html.slice(0, html.indexOf('>albedo</span>'));
    expectIncludes(albedoSegment, ' checked="checked"', 'albedo checked');
    expectIncludes(albedoSegment, ' disabled="disabled"', 'albedo disabled');
    expectExcludes(
      albedoSegment,
      ':change=toggleStringSet',
      'albedo emits no toggle binding',
    );
  });

  test('widget: stringSet non-alwaysOn members emit toggle binding with member arg', () => {
    const html = renderField(channelsField, ['albedo']);
    expectIncludes(
      html,
      ':change=toggleStringSet(field=channels,member=normal)',
      'normal toggle binding',
    );
    expectIncludes(
      html,
      ':change=toggleStringSet(field=channels,member=material)',
      'material toggle binding',
    );
    expectIncludes(
      html,
      ':change=toggleStringSet(field=channels,member=emission)',
      'emission toggle binding',
    );
  });

  test('widget: stringSet members in saved value render checked', () => {
    const html = renderField(channelsField, ['albedo', 'normal']);
    // Locate the normal segment (between "normal" and the next label).
    const normalIdx = html.indexOf('>normal</span>');
    const before = html.slice(0, normalIdx);
    const lastInput = before.lastIndexOf('<input');
    const normalSegment = html.slice(lastInput, normalIdx);
    expectIncludes(normalSegment, ' checked="checked"', 'normal is checked');
    expectExcludes(
      normalSegment,
      ' disabled="disabled"',
      'normal is not disabled',
    );
  });

  test('widget: stringSet alwaysOn checked even when absent from saved value', () => {
    // Saved data lacks 'albedo' entirely — engine forces it on; the
    // inspector mirrors that so the UI never lies about engine state.
    const html = renderField(channelsField, []);
    const albedoSegment = html.slice(0, html.indexOf('>albedo</span>'));
    expectIncludes(albedoSegment, ' checked="checked"', 'albedo still checked');
  });

  test('widget: stringSet options not in saved value render unchecked', () => {
    const html = renderField(channelsField, ['albedo']);
    const emissionIdx = html.indexOf('>emission</span>');
    const before = html.slice(0, emissionIdx);
    const lastInput = before.lastIndexOf('<input');
    const emissionSegment = html.slice(lastInput, emissionIdx);
    expectExcludes(emissionSegment, ' checked', 'emission is unchecked');
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
