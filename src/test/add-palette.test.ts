import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatComponentTypeLabel,
  groupAddableTypesByDomain,
} from '../views/scene-tree/add-palette';

test('formatComponentTypeLabel title-cases kebab types', () => {
  assert.equal(formatComponentTypeLabel('event-collider'), 'Event Collider');
  assert.equal(formatComponentTypeLabel('nexus'), 'Nexus');
});

test('groupAddableTypesByDomain keeps V1 domain order and Other', () => {
  const groups = groupAddableTypesByDomain([
    'sprite',
    'collider',
    'plugin-widget',
    'audio-track',
    'nexus',
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    ['core', 'physics', 'media', 'other'],
  );
  assert.deepEqual(groups[0]!.types, ['nexus', 'sprite']);
  assert.deepEqual(groups[1]!.types, ['collider']);
  assert.deepEqual(groups[2]!.types, ['audio-track']);
  assert.deepEqual(groups[3]!.types, ['plugin-widget']);
});

test('groupAddableTypesByDomain omits empty domains', () => {
  const groups = groupAddableTypesByDomain(['timer']);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, 'behavior');
});
