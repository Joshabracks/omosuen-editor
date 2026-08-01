import assert from 'node:assert/strict';
import { test } from 'node:test';
import { languageIdForPath } from '../views/text-buffer/language';
import { LANGUAGE_ID_SAMPLES } from './fixtures/language-samples';

test('languageIdForPath maps E15 file-type samples', () => {
  for (const sample of LANGUAGE_ID_SAMPLES) {
    assert.equal(
      languageIdForPath(sample.relativePath),
      sample.languageId,
      sample.relativePath,
    );
  }
});
