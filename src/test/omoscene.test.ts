/**
 * Tests for the .omoscene file format module (3a).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  OMOSCENE_FORMAT_VERSION,
  OmosceneParseError,
  createEmptyOmosceneFile,
  defaultEditorMetadata,
  parse,
  stringify,
  type OmosceneFile,
} from '../omoscene';
import { readOmosceneFile, writeOmosceneFile } from '../omoscene/io';
import { withTempDir } from './helpers';

const fixture: OmosceneFile = {
  omoscene: OMOSCENE_FORMAT_VERSION,
  engine: '0.24.1',
  name: 'Fixture',
  editor: {
    camera: {
      panX: 10,
      panY: -5,
      zoom: 1.5,
      axonometricAngle: 30,
      yaw: 0,
    },
    selection: [0, 1, 2],
    treeState: {
      root: true,
      'root/nexus-1': false,
    },
    annotations: {
      '1': { color: '#F4E9D8', notes: 'main camera' },
    },
    bookmarks: { spawn: 3 },
  },
  scene: {
    type: 'nexus',
    name: 'Root',
    id: 0,
    unique: 0,
    components: [
      { type: 'transform', name: 'main transform', id: 1 },
      { type: 'sprite', name: 'main sprite', id: 2 },
    ],
  },
};

test('stringify -> parse round-trips to a deep-equal object', () => {
  assert.deepEqual(parse(stringify(fixture)), fixture);
});

test('stringify is deterministic and ends with a single newline', () => {
  const text = stringify(fixture);
  assert.equal(text, stringify(fixture));
  assert.ok(text.endsWith('\n'));
  assert.ok(!text.endsWith('\n\n'));
});

test('stringify emits top-level keys in canonical order', () => {
  const keys = Object.keys(JSON.parse(stringify(fixture)) as object);
  assert.deepEqual(keys, ['omoscene', 'engine', 'name', 'editor', 'scene']);
});

test('scene region passes through opaquely without introspection', () => {
  const weird: OmosceneFile = {
    ...fixture,
    scene: {
      type: 'nexus',
      arbitrary: [1, { deep: true }, null, 'string'],
      _internal: null,
      components: [{ type: 'future-component-type', custom: { shape: 42 } }],
    },
  };
  assert.deepEqual(parse(stringify(weird)).scene, weird.scene);
});

test('editor.camera / selection / treeState persist across round-trip', () => {
  const again = parse(stringify(fixture));
  assert.deepEqual(again.editor.camera, fixture.editor.camera);
  assert.deepEqual(again.editor.selection, [0, 1, 2]);
  assert.deepEqual(again.editor.treeState, fixture.editor.treeState);
});

test('editor.camera defaults axonometricAngle and yaw when omitted', () => {
  const legacy = {
    omoscene: OMOSCENE_FORMAT_VERSION,
    engine: '0.24.1',
    name: 'Legacy',
    editor: {
      camera: { panX: 1, panY: 2, zoom: 0.5 },
      selection: [],
      treeState: {},
      annotations: {},
      bookmarks: {},
    },
    scene: { type: 'nexus', name: 'Root', id: 0, unique: 0, components: [] },
  };
  const parsed = parse(JSON.stringify(legacy));
  assert.deepEqual(parsed.editor.camera, {
    panX: 1,
    panY: 2,
    zoom: 0.5,
    axonometricAngle: 30,
    yaw: 0,
  });
});

test('parse rejects corrupt JSON and invalid shapes with OmosceneParseError', () => {
  assert.throws(() => parse('{ not json'), OmosceneParseError);
  assert.throws(() => parse('"just a string"'), OmosceneParseError);
  assert.throws(() => parse('[]'), OmosceneParseError);
  assert.throws(
    () =>
      parse(
        JSON.stringify({
          omoscene: OMOSCENE_FORMAT_VERSION,
          name: fixture.name,
          editor: fixture.editor,
          scene: fixture.scene,
        }),
      ),
    /engine/,
  );
  assert.throws(
    () => parse(JSON.stringify({ ...fixture, omoscene: 9999 })),
    /Unsupported file format version/,
  );
  assert.throws(
    () =>
      parse(
        JSON.stringify({
          ...fixture,
          scene: { type: 'transform', name: 'bad root' },
        }),
      ),
    /nexus/,
  );
  assert.throws(
    () =>
      parse(
        JSON.stringify({
          ...fixture,
          editor: {
            ...fixture.editor,
            camera: { panX: '0', panY: 0, zoom: 1 },
          },
        }),
      ),
    /camera/,
  );
});

test('defaultEditorMetadata and createEmptyOmosceneFile are valid', () => {
  const a = defaultEditorMetadata();
  const b = defaultEditorMetadata();
  assert.notEqual(a, b);
  assert.equal(a.camera.zoom, 1);
  assert.equal(a.camera.axonometricAngle, 30);
  assert.equal(a.camera.yaw, 0);
  const empty = createEmptyOmosceneFile({ name: 'Main', engine: '1.0.0' });
  assert.deepEqual(parse(stringify(empty)), empty);
});

test('readOmosceneFile / writeOmosceneFile atomic round-trip', async () => {
  await withTempDir('omosuen-omoscene-', async (dir) => {
    const filePath = path.join(dir, 'main.omoscene');
    await writeOmosceneFile(filePath, fixture);
    const again = await readOmosceneFile(filePath);
    assert.deepEqual(again, fixture);
    const text = await fs.readFile(filePath, 'utf8');
    assert.ok(text.endsWith('\n'));
  });
});
