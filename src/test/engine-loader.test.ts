import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateUmd,
  resetEngineLoadCacheForTests,
} from '../views/viewport/engine-loader';

test('evaluateUmd runs classic UMD that assigns window.Omosuen', () => {
  resetEngineLoadCacheForTests();
  const prev = (globalThis as { window?: unknown }).window;
  const fakeWindow: { Omosuen?: { init: () => void } } = {};
  (globalThis as { window: typeof fakeWindow }).window = fakeWindow;
  try {
    evaluateUmd(
      `(function(root){ root.Omosuen = { init: function(){} }; })(typeof window !== "undefined" ? window : this);`,
    );
    assert.equal(typeof fakeWindow.Omosuen?.init, 'function');
  } finally {
    if (prev === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = prev;
    }
    resetEngineLoadCacheForTests();
  }
});
