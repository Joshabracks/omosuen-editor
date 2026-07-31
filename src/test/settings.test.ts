import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getSettingValue,
  parseSettingsJson,
  setSettingValue,
  stringifySettings,
} from '../state/settings';

test('parseSettingsJson accepts empty and object JSON', () => {
  assert.deepEqual(parseSettingsJson(''), {});
  assert.deepEqual(parseSettingsJson('{"a":1}'), { a: 1 });
});

test('parseSettingsJson rejects non-objects', () => {
  assert.throws(() => parseSettingsJson('[]'), /JSON object/);
  assert.throws(() => parseSettingsJson('"x"'), /JSON object/);
});

test('get/set setting values are immutable updates', () => {
  const base = { shell: 'old' };
  const next = setSettingValue(base, 'shell.lastBoot', '2026-01-01');
  assert.equal(getSettingValue(base, 'shell.lastBoot'), undefined);
  assert.equal(getSettingValue(next, 'shell.lastBoot'), '2026-01-01');
  assert.equal(getSettingValue(next, 'shell'), 'old');
});

test('stringifySettings pretty-prints with trailing newline', () => {
  const text = stringifySettings({ b: 2, a: 1 });
  assert.equal(text.endsWith('\n'), true);
  assert.deepEqual(JSON.parse(text), { b: 2, a: 1 });
});
