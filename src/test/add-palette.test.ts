import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatComponentTypeLabel,
  sortAddableTypesAlpha,
} from '../views/scene-tree/add-palette';

test('formatComponentTypeLabel title-cases kebab types', () => {
  assert.equal(formatComponentTypeLabel('event-collider'), 'Event Collider');
  assert.equal(formatComponentTypeLabel('nexus'), 'Nexus');
});

test('sortAddableTypesAlpha sorts lexicographically', () => {
  assert.deepEqual(
    sortAddableTypesAlpha(['sprite', 'collider', 'nexus', 'audio-track']),
    ['audio-track', 'collider', 'nexus', 'sprite'],
  );
});
