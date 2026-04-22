/**
 * Shared test fixtures.
 *
 * Two use patterns:
 *
 * 1. **Synthetic fixtures** via `makeScene(overrides?)` — a fresh
 *    minimal-valid `OmosceneFile` with a bare nexus root. Tests that need
 *    specific content pass overrides; tests that don't care call with no
 *    arguments. Shallow merge — pass a whole `scene` / `editor` object to
 *    replace that region entirely.
 *
 * 2. **Disk-backed fixtures** under `./omoscene-fixtures/` — hand-authored
 *    `.omoscene` files in `pass/` / `errors/` / `null/` sub-directories.
 *    Use `loadSceneFixtures()` to enumerate them all (as engine-fixtures
 *    does), or `loadSingleFixture(path)` to read one by path.
 *
 * Both live here so a test that wants to combine them (e.g. wrap a
 * disk-loaded scene in a fresh `OmosceneFile` via `makeScene`) pulls from
 * one import.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OMOSCENE_FORMAT_VERSION,
  defaultEditorMetadata,
  parse,
} from '../omoscene/index.js';
import type { OmosceneFile } from '../omoscene/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, 'omoscene-fixtures');

// --- Synthetic fixtures -----------------------------------------------------

export function makeScene(overrides?: Partial<OmosceneFile>): OmosceneFile {
  return {
    omoscene: OMOSCENE_FORMAT_VERSION,
    engine: '0.0.0-test',
    name: 'Test Scene',
    editor: defaultEditorMetadata(),
    scene: {
      type: 'nexus',
      name: 'Root',
      id: 0,
      unique: 0,
      components: [],
    },
    ...overrides,
  };
}

// --- Disk-backed fixtures --------------------------------------------------

export type FixtureCategory = 'pass' | 'errors' | 'null';

export interface SceneFixture {
  category: FixtureCategory;
  name: string;
  scene: unknown;
}

/**
 * Enumerate every `.omoscene` file under `omoscene-fixtures/`, grouped by
 * category. Each entry carries the parsed scene region; the editor
 * metadata region is discarded since most callers (engine-fixtures,
 * round-trip) only need the scene.
 */
export function loadSceneFixtures(): SceneFixture[] {
  const out: SceneFixture[] = [];
  const categories: FixtureCategory[] = ['pass', 'errors', 'null'];
  for (const category of categories) {
    const dir = join(FIXTURES_ROOT, category);
    if (!existsSync(dir)) continue;
    for (const filename of readdirSync(dir).sort()) {
      if (!filename.endsWith('.omoscene')) continue;
      const fullPath = join(dir, filename);
      const text = readFileSync(fullPath, 'utf-8');
      const file = parse(text);
      out.push({
        category,
        name: `${category}/${filename.replace(/\.omoscene$/, '')}`,
        scene: file.scene,
      });
    }
  }
  return out;
}

/**
 * Read and parse a single `.omoscene` fixture by path relative to
 * `omoscene-fixtures/` (e.g. `'pass/02-single-transform.omoscene'`).
 * Returns the full `OmosceneFile` so callers can access editor metadata
 * alongside the scene region. Throws if the file is missing or invalid.
 */
export function loadSingleFixture(relativePath: string): OmosceneFile {
  const fullPath = join(FIXTURES_ROOT, relativePath);
  const text = readFileSync(fullPath, 'utf-8');
  return parse(text);
}
