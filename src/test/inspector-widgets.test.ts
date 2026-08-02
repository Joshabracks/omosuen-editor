import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyListAdd,
  applyListRemove,
  applyMapAdd,
  applyMapRemove,
  applyStringSetToggle,
  applyVectorAxisEdit,
  normalizeFieldType,
  renderField,
  setNestedProperty,
} from '../editor-api';

test('normalizeFieldType maps remake aliases', () => {
  assert.equal(normalizeFieldType('Vector3D'), 'Vector3');
  assert.equal(normalizeFieldType('array'), 'list');
  assert.equal(normalizeFieldType('Color4'), 'Color4');
});

test('renderField emits State Street :change bindings for scalars and vectors', () => {
  const speed = renderField(
    { name: 'speed', type: 'number', label: 'Speed', min: 0 },
    3,
  );
  assert.match(speed, /:change=editNumber\(field=speed\)/);
  assert.match(speed, /value="3"/);

  const pos = renderField(
    { name: 'position', type: 'Vector3', label: 'Position' },
    { x: 1, y: 2, z: 3 },
  );
  assert.match(pos, /:change=editVector\(field=position,axis=x\)/);
  assert.match(pos, /:change=editVector\(field=position,axis=z\)/);
  assert.match(pos, /value="2"/);
});

test('renderField filePicker includes browse button', () => {
  const html = renderField(
    {
      name: 'src',
      type: 'string',
      label: 'Source',
      filePicker: { extensions: ['.png', '.jpg'] },
    },
    'a.png',
  );
  assert.match(html, /:click=browseForFile\(field=src\)/);
  assert.match(html, /:change=editString\(field=src\)/);
});

test('renderField tool-only yields empty', () => {
  assert.equal(
    renderField(
      {
        name: 'mix',
        type: 'object',
        label: 'Mix',
        editor: 'tool-only',
      },
      {},
    ),
    '',
  );
});

test('list and map support add/remove value mappers', () => {
  assert.deepEqual(applyListAdd(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(applyListRemove(['a', 'b', 'c'], 1), ['a', 'c']);
  assert.deepEqual(applyMapAdd({ a: 1 }, 'b', 2), { a: 1, b: 2 });
  assert.deepEqual(applyMapRemove({ a: 1, b: 2 }, 'a'), { b: 2 });
});

test('list/map renderers include add/remove controls', () => {
  const list = renderField(
    { name: 'items', type: 'list', label: 'Items' },
    ['one'],
  );
  assert.match(list, /:click=listAdd\(field=items\)/);
  assert.match(list, /:click=listRemove\(field=items,index=0\)/);

  const map = renderField(
    { name: 'slots', type: 'map', label: 'Slots' },
    { albedo: 'a' },
  );
  assert.match(map, /:click=mapAdd\(field=slots\)/);
  assert.match(map, /:click=mapRemove\(field=slots,index=0\)/);
});

test('vector and stringSet mappers', () => {
  assert.deepEqual(applyVectorAxisEdit({ x: 0, y: 0 }, 'x', '4'), {
    x: 4,
    y: 0,
  });
  assert.deepEqual(applyStringSetToggle(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(applyStringSetToggle(['a', 'b'], 'a', false, ['a']), [
    'a',
    'b',
  ]);
});

test('setNestedProperty writes dotted paths', () => {
  const next = setNestedProperty(
    { textureMapKeys: { albedo: 'old' } },
    'textureMapKeys.albedo',
    'new',
  );
  assert.deepEqual(next.textureMapKeys, { albedo: 'new' });
});

test('registryRef renders as enum when options provided', () => {
  const html = renderField(
    {
      name: 'bundleKey',
      type: 'enum',
      label: 'Bundle',
      registryRef: { registryId: 'state-bundle' },
    },
    'main',
    { enumValues: ['main', 'hud'] },
  );
  assert.match(html, /value="hud"/);
  assert.match(html, /selected/);
});

test('Color3/Color4 render channel axes', () => {
  const c3 = renderField(
    { name: 'tint', type: 'Color3', label: 'Tint' },
    { r: 1, g: 0, b: 0 },
  );
  assert.match(c3, /:change=editVector\(field=tint,axis=r\)/);
  const c4 = renderField(
    { name: 'bg', type: 'Color4', label: 'BG' },
    { r: 0, g: 0, b: 0, a: 1 },
  );
  assert.match(c4, /:change=editVector\(field=bg,axis=a\)/);
});
