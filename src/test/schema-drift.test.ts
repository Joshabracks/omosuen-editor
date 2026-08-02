import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../component';
import {
  createDocumentController,
  type DocumentControllerDependencies,
} from '../app/document-controller';
import type { Bridge } from '../bridge/protocol-bridge';
import {
  driftErrorsForComponent,
  listEditorTypes,
  resolveEditorType,
} from '../editor-api';
import { createEmptyOmosceneFile } from '../omoscene';
import { componentUpdate, type EditorMessage } from '../protocol';
import {
  buildInspectorModel,
  dispatchInspectorFieldUpdate,
} from '../views/inspector/host';
import {
  BUILTIN_COMPONENT_COUNT,
  BUILTIN_COMPONENT_TYPES,
  PROPERTY_ALLOWLIST_FIXTURE,
} from './fixtures/property-allowlist';

function fakeBridge(): Bridge & { readonly __received: EditorMessage[] } {
  const received: EditorMessage[] = [];
  return {
    dispatch(msg) {
      received.push(msg);
    },
    onMessage() {
      return () => undefined;
    },
    dispose() {},
    __received: received,
  };
}

function fakeDeps(): DocumentControllerDependencies {
  return {
    readFile: async () =>
      createEmptyOmosceneFile({ name: 'Drift', engine: 'v0.24.1' }),
    writeFile: async () => undefined,
  };
}

test('all 23 built-in editor types are registered', () => {
  assert.equal(listEditorTypes().length, BUILTIN_COMPONENT_COUNT);
  assert.deepEqual(listEditorTypes(), [...BUILTIN_COMPONENT_TYPES]);
});

test('schema drift: every allowlist entry is field or exclude', () => {
  for (const type of BUILTIN_COMPONENT_TYPES) {
    const resolved = resolveEditorType(type, 'v9.9.9');
    assert.ok(resolved, `missing schema for ${type}`);
    const allowlist = PROPERTY_ALLOWLIST_FIXTURE[type];
    assert.ok(allowlist, `missing fixture allowlist for ${type}`);
    const errors = driftErrorsForComponent(allowlist, resolved);
    assert.deepEqual(errors, [], `${type}: ${errors.join('; ')}`);
  }
});

test('schema drift fails when allowlist field is unclassified', () => {
  const resolved = resolveEditorType('transform', 'v9.9.9');
  assert.ok(resolved);
  const errors = driftErrorsForComponent(
    [...PROPERTY_ALLOWLIST_FIXTURE.transform!, 'mysteryField'],
    resolved,
  );
  assert.match(errors.join(' '), /mysteryField/);
});

test('inspector mock selection renders schema-driven fields', () => {
  const model = buildInspectorModel(
    {
      components: [
        {
          id: 1,
          type: 'transform',
          name: 'Player',
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    },
    { engineVersion: 'v0.24.1' },
  );
  assert.equal(model.title, 'transform');
  assert.match(model.nameRowHtml, /Player/);
  assert.match(model.nameRowHtml, /:change=editName\(\)/);
  assert.match(model.fieldsHtml, /:change=editVector\(field=position,axis=x\)/);
  assert.equal(model.messageHtml, '');
});

test('inspector empty and multi-select messaging', () => {
  assert.match(
    buildInspectorModel(null, { engineVersion: 'v1' }).messageHtml,
    /Select a component/,
  );
  assert.match(
    buildInspectorModel(
      {
        components: [
          { id: 1, type: 'transform' },
          { id: 2, type: 'sprite' },
        ],
      },
      { engineVersion: 'v1' },
    ).messageHtml,
    /Multiple selection/,
  );
});

test('inspector widgets use :change bindings (no click-driven value hooks)', () => {
  const model = buildInspectorModel(
    {
      components: [
        {
          id: 1,
          type: 'transform',
          name: 'Demo',
          position: { x: 0, y: 0, z: 0 },
        },
      ],
    },
    { engineVersion: 'v0.24.1' },
  );
  assert.doesNotMatch(model.fieldsHtml, /data-widget=/);
  assert.match(model.fieldsHtml, /:change=editVector\(/);
});

test('inspector edit emits component:update observed by DocumentController', () => {
  const controller = createDocumentController(fakeDeps());
  const observer = fakeBridge();
  controller.registerPanel(observer);

  dispatchInspectorFieldUpdate(
    {
      engineVersion: 'v0.24.1',
      onDispatch: (msg) => controller.dispatchFromHost(msg),
    },
    { id: 42, type: 'transform', name: 'T' },
    'position',
    { x: 9, y: 0, z: 0 },
  );

  const update = observer.__received.find((m) => m.kind === 'component:update');
  assert.ok(update);
  assert.equal(update.kind, 'component:update');
  if (update.kind === 'component:update') {
    assert.equal(update.id, 42);
    assert.equal(update.property, 'position');
    assert.deepEqual(update.value, { x: 9, y: 0, z: 0 });
  }

  // Sanity: factory matches
  void componentUpdate;
  controller.dispose();
});
