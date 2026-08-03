import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyOmosceneFile } from '../omoscene';
import { insertChildComponent } from '../scene';
import {
  engineVersionMismatchWarning,
  sanitizeSceneForAuthoring,
} from '../views/viewport/sanitize';

test('sanitizeSceneForAuthoring keeps visuals and drops logic types', () => {
  let file = createEmptyOmosceneFile({ name: 'T', engine: 'v0.24.1' });
  file = insertChildComponent(file, 0, {
    type: 'viewport',
    name: 'V',
    id: 1,
    unique: 0,
  });
  file = insertChildComponent(file, 0, {
    type: 'timer',
    name: 'Tick',
    id: 2,
    unique: 0,
  });
  file = insertChildComponent(file, 0, {
    type: 'light',
    name: 'L',
    id: 3,
    unique: 0,
    lightType: 'ambient',
  });
  const sanitized = sanitizeSceneForAuthoring(file.scene);
  const types = (sanitized.components ?? []).map((c) => c.type);
  assert.deepEqual(types, ['viewport', 'light']);
});

test('engineVersionMismatchWarning compares normalized tags', () => {
  assert.equal(engineVersionMismatchWarning('v0.24.1', '0.24.1'), null);
  assert.match(
    engineVersionMismatchWarning('v0.24.1', 'v0.25.0') ?? '',
    /does not match/,
  );
});
