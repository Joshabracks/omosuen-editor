import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWindowInfoFromLocation } from '../app/window-info';

test('parseWindowInfoFromLocation defaults to primary', () => {
  const info = parseWindowInfoFromLocation('');
  assert.equal(info.role, 'primary');
  assert.equal(info.viewId, null);
  assert.equal(info.windowId, 'local');
  assert.equal(info.floating, false);
});

test('parseWindowInfoFromLocation reads pop-out query', () => {
  const info = parseWindowInfoFromLocation(
    '?role=popout&windowId=popout-2&viewId=empty-a',
  );
  assert.equal(info.role, 'popout');
  assert.equal(info.windowId, 'popout-2');
  assert.equal(info.viewId, 'empty-a');
  assert.equal(info.floating, false);
});

test('parseWindowInfoFromLocation reads floating flag', () => {
  const info = parseWindowInfoFromLocation(
    '?role=popout&windowId=popout-3&viewId=empty-b&floating=1',
  );
  assert.equal(info.floating, true);
  assert.equal(info.viewId, 'empty-b');
});
