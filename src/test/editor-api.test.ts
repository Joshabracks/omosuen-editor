import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EditorApiError,
  compareVersions,
  getEditorRegistry,
  getEditorTool,
  listEditorTypes,
  registerEditorRegistry,
  registerEditorTool,
  registerEditorType,
  resolveEditorType,
  resolveEditorTypeVersion,
} from '../editor-api';

const prefix = `__test_${Date.now()}_`;

test('compareVersions orders engine tags', () => {
  assert.equal(compareVersions('v0.1.30', 'v0.1.30'), 0);
  assert.equal(compareVersions('v0.1.30', '0.1.30'), 0);
  assert.equal(compareVersions('v0.1.30', 'v0.1.31'), -1);
  assert.equal(compareVersions('v0.2.0', 'v0.1.99'), 1);
  assert.equal(compareVersions('v0.1', 'v0.1.0'), 0);
  assert.throws(() => compareVersions('v0.1.beta', 'v0.1.0'));
});

test('resolveEditorTypeVersion floor-matches', () => {
  const versions = [
    { type: 't', since: 'v0.1.30', fields: [] },
    { type: 't', since: 'v0.1.34', fields: [] },
    { type: 't', since: 'v0.1.36', fields: [] },
  ];
  assert.equal(resolveEditorTypeVersion(versions, 'v0.1.35')?.since, 'v0.1.34');
  assert.equal(resolveEditorTypeVersion(versions, 'v0.1.29'), null);
  assert.equal(resolveEditorTypeVersion([], 'v1.0.0'), null);
});

test('registerEditorType stores and resolves contributions', () => {
  const type = `${prefix}mock-comp`;
  registerEditorType({
    type,
    since: 'v0.1.0',
    fields: [{ name: 'speed', type: 'number', label: 'Speed' }],
    uniqueness: 'LOCAL',
  });
  registerEditorType({
    type,
    since: 'v0.2.0',
    fields: [
      { name: 'speed', type: 'number', label: 'Speed' },
      { name: 'boost', type: 'boolean', label: 'Boost' },
    ],
  });

  assert.equal(listEditorTypes().includes(type), true);
  const v1 = resolveEditorType(type, 'v0.1.5');
  assert.equal(v1?.fields.length, 1);
  const v2 = resolveEditorType(type, 'v0.2.1');
  assert.equal(v2?.fields.length, 2);
  assert.equal(resolveEditorType(`${prefix}missing`, 'v1.0.0'), null);
});

test('registerEditorType rejects duplicate type+since', () => {
  const type = `${prefix}dup`;
  registerEditorType({
    type,
    since: 'v1.0.0',
    fields: [{ name: 'a', type: 'string', label: 'A' }],
  });
  assert.throws(
    () =>
      registerEditorType({
        type,
        since: 'v1.0.0',
        fields: [{ name: 'b', type: 'string', label: 'B' }],
      }),
    (err: unknown) =>
      err instanceof EditorApiError && /duplicate type\+since/.test(err.message),
  );
});

test('registerEditorType rejects duplicate field names in one version', () => {
  assert.throws(
    () =>
      registerEditorType({
        type: `${prefix}bad`,
        since: 'v1.0.0',
        fields: [
          { name: 'x', type: 'number', label: 'X' },
          { name: 'x', type: 'number', label: 'X2' },
        ],
      }),
    /duplicate field/,
  );
});

test('registerEditorTool and registerEditorRegistry', () => {
  const toolId = `${prefix}texture-frame`;
  const regId = `${prefix}html-constructor`;
  const opened: string[] = [];
  registerEditorTool({
    id: toolId,
    open: (ctx) => {
      opened.push(String(ctx.componentId));
    },
  });
  registerEditorRegistry({
    id: regId,
    listKeys: () => ['a', 'b'],
  });

  getEditorTool(toolId)!.open({
    componentId: 7,
    componentType: 'texture-map',
    toolId,
  });
  assert.deepEqual(opened, ['7']);
  assert.deepEqual(getEditorRegistry(regId)!.listKeys(), ['a', 'b']);
  assert.throws(
    () =>
      registerEditorTool({
        id: toolId,
        open: () => {},
      }),
    /duplicate id/,
  );
});
