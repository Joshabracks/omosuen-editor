import assert from 'node:assert/strict';
import { test } from 'node:test';
import { languageIdForPath } from '../views/text-buffer/language';

test('languageIdForPath maps E15 TypeScript family', () => {
  assert.equal(languageIdForPath('src/app.ts'), 'typescript');
  assert.equal(languageIdForPath('game/omo.ts'), 'typescript');
  assert.equal(languageIdForPath('ui/sst.ts'), 'typescript');
  assert.equal(languageIdForPath('x.tsx'), 'typescript');
  assert.equal(languageIdForPath('lib.js'), 'javascript');
});

test('languageIdForPath maps omoscene/omocomp as JSON', () => {
  assert.equal(languageIdForPath('levels/main.omoscene'), 'json');
  assert.equal(languageIdForPath('prefabs/enemy.omocomp'), 'json');
  assert.equal(languageIdForPath('package.json'), 'json');
});

test('languageIdForPath maps css/html and plaintext fallback', () => {
  assert.equal(languageIdForPath('app.css'), 'css');
  assert.equal(languageIdForPath('index.html'), 'html');
  assert.equal(languageIdForPath('notes.xyz'), 'plaintext');
});
