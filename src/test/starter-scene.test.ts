import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../component';
import { parse } from '../omoscene';
import {
  createStarterScene,
  createTargetDir,
  ensureOmosceneFileName,
  joinRelative,
  sceneNameFromFileName,
} from '../scene/starter-scene';
import { stringify } from '../omoscene';

test('createStarterScene has viewport, light, atlas, camera nexus', () => {
  const file = createStarterScene({ name: 'Main', engine: 'v0.24.1' });
  const kids = file.scene.components ?? [];
  assert.deepEqual(
    kids.map((c) => `${c.type}:${String(c.name)}`),
    [
      'viewport:Main Viewport',
      'light:Ambient Light',
      'atlas-manager:Atlas Manager',
      'nexus:Camera Nexus',
    ],
  );
  const cameraNexus = kids[3]!;
  const nested = cameraNexus.components ?? [];
  assert.deepEqual(
    nested.map((c) => `${c.type}:${String(c.name)}`),
    ['camera:Main Camera', 'transform:Camera Transform'],
  );
  assert.equal((nested[0] as { viewportRef?: string }).viewportRef, 'Main Viewport');
});

test('createStarterScene round-trips stringify/parse', () => {
  const file = createStarterScene({ name: 'Demo', engine: 'v0.24.1' });
  const again = parse(stringify(file));
  assert.equal(again.name, 'Demo');
  assert.equal(again.scene.components?.length, 4);
});

test('ensureOmosceneFileName / joinRelative / createTargetDir', () => {
  assert.equal(ensureOmosceneFileName('Main'), 'Main.omoscene');
  assert.equal(ensureOmosceneFileName('x.omoscene'), 'x.omoscene');
  assert.equal(sceneNameFromFileName('Main.omoscene'), 'Main');
  assert.equal(joinRelative('scenes', 'Main.omoscene'), 'scenes/Main.omoscene');
  assert.equal(joinRelative('', 'Main.omoscene'), 'Main.omoscene');
  assert.equal(createTargetDir('scenes', 'directory'), 'scenes');
  assert.equal(createTargetDir('scenes/Main.omoscene', 'file'), 'scenes');
  assert.equal(createTargetDir('Main.omoscene', 'file'), '');
});
