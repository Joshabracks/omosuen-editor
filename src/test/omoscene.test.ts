/**
 * Tests for the .omoscene file format module.
 *
 * Scope: the editor's extension-host responsibilities only — parse/stringify
 * round-tripping, metadata validation, scene-region passthrough.
 * Engine-shape fidelity is validated in the webview context (later phase)
 * and in the engine's own test suite.
 */

import {
  OMOSCENE_FORMAT_VERSION,
  OmosceneParseError,
  defaultEditorMetadata,
  parse,
  stringify,
} from '../omoscene/index.js';
import type { OmosceneFile } from '../omoscene/index.js';
import { assertDeepEqual, expectThrow, test } from './harness.js';

const fixture: OmosceneFile = {
  omoscene: OMOSCENE_FORMAT_VERSION,
  engine: '0.0.0-test',
  name: 'Test Scene',
  editor: {
    camera: { panX: 10, panY: -5, zoom: 1.5 },
    selection: [0, 1, 2],
    treeState: {
      root: true,
      'root/nexus-1': false,
    },
    annotations: {
      '1': { color: '#F4E9D8', notes: 'main camera' },
    },
    bookmarks: { spawn: 3 },
  },
  scene: {
    type: 'nexus',
    name: 'Root',
    id: 0,
    unique: 0,
    components: [
      { type: 'transform', name: 'main transform', id: 1 },
      { type: 'sprite', name: 'main sprite', id: 2 },
    ],
  },
};

export function runOmosceneTests(): void {
  test('stringify -> parse round-trips to a deep-equal object', () => {
    const text = stringify(fixture);
    const parsed = parse(text);
    assertDeepEqual(parsed, fixture);
  });

  test('stringify is deterministic for a given input', () => {
    const a = stringify(fixture);
    const b = stringify(fixture);
    if (a !== b) {
      throw new Error('stringify output is not deterministic');
    }
  });

  test('stringify output ends with a single newline', () => {
    const text = stringify(fixture);
    if (!text.endsWith('\n')) {
      throw new Error('missing trailing newline');
    }
    if (text.endsWith('\n\n')) {
      throw new Error('too many trailing newlines');
    }
  });

  test('stringify emits top-level keys in canonical order', () => {
    const text = stringify(fixture);
    const parsed = JSON.parse(text) as OmosceneFile;
    const keys = Object.keys(parsed);
    const expected = ['omoscene', 'engine', 'name', 'editor', 'scene'];
    if (keys.join(',') !== expected.join(',')) {
      throw new Error(
        `top-level key order: [${keys.join(',')}] vs [${expected.join(',')}]`,
      );
    }
  });

  test('scene region passes through opaquely without introspection', () => {
    const weirdScene: OmosceneFile = {
      ...fixture,
      scene: {
        type: 'nexus',
        arbitrary: [1, { deep: true }, null, 'string'],
        _internal: null,
        components: [{ type: 'future-component-type', custom: { shape: 42 } }],
      },
    };
    const roundTripped = parse(stringify(weirdScene));
    assertDeepEqual(roundTripped.scene, weirdScene.scene);
  });

  test('parse rejects invalid JSON', () => {
    expectThrow(() => parse('{ not json'), 'OmosceneParseError');
  });

  test('parse rejects non-object root', () => {
    expectThrow(() => parse('"just a string"'), 'OmosceneParseError');
    expectThrow(() => parse('[]'), 'OmosceneParseError');
    expectThrow(() => parse('null'), 'OmosceneParseError');
  });

  test('parse rejects missing `engine` field', () => {
    const bad = {
      omoscene: OMOSCENE_FORMAT_VERSION,
      name: fixture.name,
      editor: fixture.editor,
      scene: fixture.scene,
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects unsupported format version', () => {
    const bad = { ...fixture, omoscene: 9999 };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects scene whose root is not a nexus', () => {
    const bad = {
      ...fixture,
      scene: { type: 'transform', name: 'bad root' },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects editor.camera missing numeric fields', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, camera: { panX: '0', panY: 0, zoom: 1 } },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects editor.selection with non-numeric elements', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, selection: [0, 'not-a-number', 2] },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects editor.treeState values that are not booleans', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, treeState: { root: 'yes' } },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects editor.annotations entries that are not objects', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, annotations: { '1': 'a bare string' } },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects editor.annotations entries with non-string color', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, annotations: { '1': { color: 123 } } },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse rejects editor.annotations entries with non-string notes', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, annotations: { '1': { notes: true } } },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('parse accepts editor.annotations entries with both fields omitted', () => {
    const ok = {
      ...fixture,
      editor: { ...fixture.editor, annotations: { '1': {} } },
    };
    // Should not throw.
    parse(JSON.stringify(ok));
  });

  test('parse rejects editor.bookmarks values that are not numbers', () => {
    const bad = {
      ...fixture,
      editor: { ...fixture.editor, bookmarks: { spawn: '3' } },
    };
    expectThrow(() => parse(JSON.stringify(bad)), 'OmosceneParseError');
  });

  test('OmosceneParseError is the error name used', () => {
    try {
      parse('not json at all');
    } catch (err) {
      if (err instanceof OmosceneParseError) {
        if (err.name !== 'OmosceneParseError') {
          throw new Error(`expected name OmosceneParseError, got ${err.name}`);
        }
        return;
      }
      throw new Error('expected OmosceneParseError instance');
    }
    throw new Error('expected throw');
  });

  test('defaultEditorMetadata returns a fresh, valid shape each call', () => {
    const a = defaultEditorMetadata();
    const b = defaultEditorMetadata();
    if (a === b) {
      throw new Error(
        'defaultEditorMetadata should return a new object each call',
      );
    }
    if (a.camera.zoom !== 1 || a.camera.panX !== 0 || a.camera.panY !== 0) {
      throw new Error('camera defaults wrong');
    }
    if (a.selection.length !== 0) {
      throw new Error('selection default should be empty');
    }
    if (Object.keys(a.treeState).length !== 0) {
      throw new Error('treeState default should be empty');
    }
  });

  test('mutating EditorMetadata then stringifying preserves changes on parse', () => {
    const file: OmosceneFile = {
      ...fixture,
      editor: { ...fixture.editor, selection: [42] },
    };
    const parsed = parse(stringify(file));
    if (
      parsed.editor.selection.length !== 1 ||
      parsed.editor.selection[0] !== 42
    ) {
      throw new Error('selection mutation not preserved');
    }
  });
}
