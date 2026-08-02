import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../component';
import { createEmptyOmosceneFile, withEditorMetadata } from '../omoscene';
import {
  applyComponentUpdate,
  buildDefaultComponent,
  canAddComponentType,
  duplicateComponent,
  findComponentById,
  insertChildComponent,
  removeComponent,
  reparentComponent,
} from '../scene';
import { createEditorState } from '../state';
import { componentAdd, componentMove, componentRemove, componentUpdate } from '../protocol';
import { buildTreeRows } from '../views/scene-tree';

function sampleFile() {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(
    file,
    0,
    buildDefaultComponent({
      type: 'transform',
      id: 1,
      engineVersion: 'v0.24.1',
      name: 'T1',
    }),
  );
  file = insertChildComponent(file, 0, {
    type: 'nexus',
    name: 'Child',
    id: 2,
    unique: 0,
    components: [],
  });
  return file;
}

test('insertChildComponent appends under nexus', () => {
  const file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  const out = insertChildComponent(
    file,
    0,
    buildDefaultComponent({
      type: 'sprite',
      id: 9,
      engineVersion: 'v0.24.1',
    }),
  );
  assert.notEqual(out, file);
  assert.equal(out.scene.components?.length, 1);
  assert.equal(out.scene.components?.[0]?.type, 'sprite');
});

test('duplicateComponent reassigns ids for clone and children', () => {
  let file = sampleFile();
  file = insertChildComponent(file, 2, {
    type: 'sprite',
    name: 's',
    id: 3,
    unique: 0,
  });
  const dup = duplicateComponent(file, 2);
  assert.notEqual(dup, file);
  const ids = new Set<number>();
  function walk(node: { id?: number; components?: readonly unknown[] }): void {
    if (typeof node.id === 'number') {
      assert.equal(ids.has(node.id), false);
      ids.add(node.id);
    }
    if (Array.isArray(node.components)) {
      for (const c of node.components) {
        walk(c as { id?: number; components?: readonly unknown[] });
      }
    }
  }
  walk(dup.scene);
  assert.ok(ids.has(0) && ids.has(1) && ids.has(2) && ids.has(3));
  assert.ok(ids.size >= 6);
});

test('GLOBAL uniqueness blocks second atlas-manager', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(
    file,
    0,
    buildDefaultComponent({
      type: 'atlas-manager',
      id: 1,
      engineVersion: 'v0.24.1',
    }),
  );
  const gate = canAddComponentType(file, 0, 'atlas-manager');
  assert.equal(gate.ok, false);
  assert.match(gate.reason ?? '', /GLOBAL/);
});

test('LOCAL uniqueness blocks second camera under same nexus', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(
    file,
    0,
    buildDefaultComponent({
      type: 'camera',
      id: 1,
      engineVersion: 'v0.24.1',
    }),
  );
  assert.equal(canAddComponentType(file, 0, 'camera').ok, false);
});

test('editor-state applies structural verbs and property updates', () => {
  const state = createEditorState();
  const file = sampleFile();
  state.dispatch({ kind: 'scene:load', file });
  state.dispatch(componentAdd(0, 'sprite'));
  const afterAdd = state.sceneDocument.get();
  assert.ok(afterAdd);
  assert.equal(state.dirty.get(), true);
  const sprite = afterAdd!.scene.components?.find((c) => c.type === 'sprite');
  assert.ok(sprite && typeof sprite.id === 'number');
  state.dispatch(componentUpdate(sprite!.id!, 'sprite', 'name', 'Hero'));
  const renamed = findComponentById(
    state.sceneDocument.get()!.scene,
    sprite!.id!,
  );
  assert.equal(renamed?.name, 'Hero');
  state.dispatch(componentRemove(sprite!.id!));
  assert.equal(
    findComponentById(state.sceneDocument.get()!.scene, sprite!.id!),
    null,
  );
});

test('editor-state component:move reparents and rejects cycles', () => {
  const state = createEditorState();
  let file = sampleFile();
  file = insertChildComponent(file, 2, {
    type: 'nexus',
    name: 'Grand',
    id: 3,
    unique: 0,
    components: [],
  });
  state.dispatch({ kind: 'scene:load', file });
  state.dispatch(componentMove(1, 2));
  const moved = state.sceneDocument.get()!;
  const nexus = findComponentById(moved.scene, 2);
  assert.ok(nexus?.components?.some((c) => c && (c as { id?: number }).id === 1));

  const beforeCycle = state.sceneDocument.get();
  state.dispatch(componentMove(2, 3));
  assert.equal(state.sceneDocument.get(), beforeCycle);
});

test('reparent rejects cycles', () => {
  let file = sampleFile();
  file = insertChildComponent(file, 2, {
    type: 'nexus',
    name: 'Grand',
    id: 3,
    unique: 0,
    components: [],
  });
  const cycled = reparentComponent(file, 2, 3);
  assert.equal(cycled, file);
});

test('removeComponent drops subtree', () => {
  let file = sampleFile();
  file = insertChildComponent(file, 2, {
    type: 'sprite',
    id: 3,
    unique: 0,
  });
  const out = removeComponent(file, 2);
  assert.equal(findComponentById(out.scene, 2), null);
  assert.equal(findComponentById(out.scene, 3), null);
});

test('applyComponentUpdate writes dotted paths', () => {
  const file = sampleFile();
  const out = applyComponentUpdate(file, 1, 'transform', 'position.x', 9);
  const t = findComponentById(out.scene, 1) as {
    position?: { x?: number };
  } | null;
  assert.equal(t?.position?.x, 9);
});

test('buildTreeRows hides scene root and respects expand/collapse', () => {
  let file = sampleFile();
  // sampleFile: root 0 → transform 1 + nexus 2 (empty)
  file = insertChildComponent(file, 2, {
    type: 'sprite',
    name: 's',
    id: 3,
    unique: 0,
  });

  const expanded = buildTreeRows(
    withEditorMetadata(file, {
      ...file.editor,
      treeState: { '2': true },
    }),
    [1],
  );
  assert.equal(
    expanded.some((r) => r.id === 0),
    false,
    'scene root nexus must not appear',
  );
  assert.ok(expanded.some((r) => r.id === 1 && r.selected));
  assert.ok(expanded.some((r) => r.id === 2 && r.expanded));
  assert.ok(expanded.some((r) => r.id === 3));

  const collapsed = buildTreeRows(
    withEditorMetadata(file, {
      ...file.editor,
      treeState: { '2': false },
    }),
    [],
  );
  assert.ok(collapsed.some((r) => r.id === 2 && !r.expanded));
  assert.equal(
    collapsed.some((r) => r.id === 3),
    false,
    'children of collapsed nexus are hidden',
  );
});
