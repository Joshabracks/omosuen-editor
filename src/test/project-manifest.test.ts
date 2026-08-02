import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  PROJECT_MANIFEST_FILENAME,
  SCAFFOLD_REQUIRED_PATHS,
  createDefaultManifest,
  parseManifest,
  scaffoldProject,
  serializeManifest,
  slugify,
} from '../project';
import { parse as parseOmoscene } from '../omoscene';
import { withTempDir } from './helpers';

test('slugify normalizes project names', () => {
  assert.equal(slugify('My Cool Game'), 'my-cool-game');
  assert.equal(slugify('  '), 'my-game');
});

test('manifest round-trips parse/serialize', () => {
  const original = createDefaultManifest('Colony', '0.0.0-stub');
  const again = parseManifest(serializeManifest(original));
  assert.deepEqual(again, original);
});

test('parseManifest rejects unknown / incomplete shapes', () => {
  assert.throws(() => parseManifest('{}'), /name/);
  assert.throws(() => parseManifest('[]'), /object/);
  assert.throws(
    () =>
      parseManifest({
        ...createDefaultManifest('x', '1.0.0'),
        preview: { port: 1, buildScript: 'b', open: 'tab' },
      }),
    /browser-window/,
  );
});

test('scaffoldProject writes E9 layout and opens as detectible project', async () => {
  await withTempDir('omosuen-scaffold-', async (parent) => {
    const projectDir = path.join(parent, 'demo-game');
    const result = await scaffoldProject({
      projectDir,
      name: 'Demo Game',
      engineVersion: '0.0.0-stub',
    });
    assert.equal(result.slug, 'demo-game');
    assert.equal(result.manifest.name, 'Demo Game');
    assert.equal(result.manifest.mainScene, 'scenes/main.omoscene');

    for (const rel of SCAFFOLD_REQUIRED_PATHS) {
      const abs = path.join(projectDir, rel);
      const st = await fs.stat(abs);
      assert.ok(st.isFile() || st.isDirectory(), rel);
    }

    const raw = await fs.readFile(
      path.join(projectDir, PROJECT_MANIFEST_FILENAME),
      'utf8',
    );
    const manifest = parseManifest(raw);
    assert.equal(manifest.engineVersion, '0.0.0-stub');
    assert.equal(manifest.preview.port, 9421);

    const sceneText = await fs.readFile(
      path.join(projectDir, 'scenes', 'main.omoscene'),
      'utf8',
    );
    const scene = parseOmoscene(sceneText);
    assert.equal(scene.engine, '0.0.0-stub');
    assert.equal(scene.scene.type, 'nexus');
    assert.equal(scene.editor.camera.zoom, 1);
  });
});

test('scaffoldProject refuses existing folder', async () => {
  await withTempDir('omosuen-scaffold-exists-', async (parent) => {
    const projectDir = path.join(parent, 'taken');
    await fs.mkdir(projectDir);
    await assert.rejects(
      () =>
        scaffoldProject({
          projectDir,
          name: 'Taken',
          engineVersion: '0.0.0-stub',
        }),
      /already exists/,
    );
  });
});
