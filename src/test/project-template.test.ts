/**
 * Tests for Phase 10.2's pure template builders, extended in Phase 9.1
 * to cover the webpack / tsconfig / custom.d.ts / index.ts / index.html
 * additions.
 *
 * Each builder is asserted against its output shape. The starter
 * `.omoscene` is additionally round-tripped through
 * [omoscene/parse](../omoscene/index.js) to confirm the scaffold lands
 * a document the editor can actually open on first run.
 */

import { parse } from '../omoscene/index.js';
import {
  buildCustomDts,
  buildGitignore,
  buildIndexHtml,
  buildIndexTs,
  buildPackageJson,
  buildProjectTemplate,
  buildStarterOmoscene,
  buildTsConfig,
  buildWebpackConfig,
  slugify,
} from '../app/project-template.js';
import { assertDeepEqual, test } from './harness.js';

export function runProjectTemplateTests(): void {
  // --- slugify -----------------------------------------------------------

  test('slugify: lowercases and strips non-alphanumerics', () => {
    if (slugify('My Awesome Game') !== 'my-awesome-game') {
      throw new Error('spaces should become dashes');
    }
    if (slugify("Josh's Project!") !== 'josh-s-project') {
      throw new Error(`got: ${slugify("Josh's Project!")}`);
    }
  });

  test('slugify: collapses repeated separators and trims edges', () => {
    if (slugify('  __hello__world__  ') !== 'hello-world') {
      throw new Error(`got: ${slugify('  __hello__world__  ')}`);
    }
  });

  test('slugify: falls back to "omosuen-project" on empty input', () => {
    if (slugify('') !== 'omosuen-project') throw new Error('empty fallback');
    if (slugify('   ') !== 'omosuen-project') {
      throw new Error('whitespace-only fallback');
    }
    if (slugify('!!!') !== 'omosuen-project') {
      throw new Error('punctuation-only fallback');
    }
  });

  test('slugify: prefixes a leading digit so names are package-safe', () => {
    if (slugify('3D Game') !== 'p-3d-game') {
      throw new Error(`got: ${slugify('3D Game')}`);
    }
  });

  // --- package.json ------------------------------------------------------

  test('buildPackageJson: emits valid JSON with engine git ref', () => {
    const out = buildPackageJson({ slug: 'my-game', engineTag: 'v0.1.30' });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    assertDeepEqual(parsed, {
      name: 'my-game',
      version: '0.1.0',
      description: '',
      private: true,
      type: 'module',
      scripts: {
        build: 'webpack --config webpack.config.js --env mode=production',
        'build:dev':
          'webpack --config webpack.config.js --env mode=development',
        watch:
          'webpack --config webpack.config.js --watch --env mode=development',
      },
      dependencies: {
        omosuen: 'github:Joshabracks/omosuen#v0.1.30',
      },
      devDependencies: {
        '@types/node': '^22.0.0',
        'raw-loader': '^4.0.2',
        'ts-loader': '^9.5.0',
        typescript: '^5.6.0',
        webpack: '^5.95.0',
        'webpack-cli': '^5.1.0',
      },
    });
    if (!out.endsWith('\n')) {
      throw new Error('package.json should end with a trailing newline');
    }
  });

  // --- .gitignore --------------------------------------------------------

  test('buildGitignore: ignores node_modules/, dist/, .omosuen_editor/', () => {
    const out = buildGitignore();
    for (const needle of ['node_modules/', 'dist/', '.omosuen_editor/']) {
      if (!out.includes(needle)) {
        throw new Error(`expected ${needle} in gitignore, got: ${out}`);
      }
    }
  });

  // --- starter .omoscene -------------------------------------------------

  test('buildStarterOmoscene: produces a file the editor can parse', () => {
    const text = buildStarterOmoscene({
      projectName: 'My Game',
      engineTag: 'v0.1.30',
    });
    const file = parse(text);
    if (file.engine !== 'v0.1.30') {
      throw new Error(`engine tag not persisted; got ${file.engine}`);
    }
    if (file.name !== 'My Game') {
      throw new Error(`name not persisted; got ${file.name}`);
    }
    if (file.scene.type !== 'nexus') {
      throw new Error(`root must be a nexus; got ${file.scene.type}`);
    }
  });

  test('buildStarterOmoscene: root nexus contains exactly one transform', () => {
    const text = buildStarterOmoscene({
      projectName: 'x',
      engineTag: 'v0.1.30',
    });
    const file = parse(text);
    const children = file.scene.components;
    if (!Array.isArray(children) || children.length !== 1) {
      throw new Error(
        `expected 1 child component, got ${String(children?.length)}`,
      );
    }
    const child = children[0] as { type: unknown };
    if (child.type !== 'transform') {
      throw new Error(`expected transform, got ${String(child.type)}`);
    }
  });

  // --- webpack.config.js -------------------------------------------------

  test('buildWebpackConfig: references the project slug as default scene', () => {
    const out = buildWebpackConfig({ slug: 'my-game' });
    if (!out.includes(`./scenes/my-game.omoscene`)) {
      throw new Error('default scene path should use the slug');
    }
    if (
      !out.includes("resolve(__dirname, 'node_modules/omosuen/src/index.ts')")
    ) {
      throw new Error('omosuen alias must resolve to installed engine source');
    }
    if (!out.includes('ts-loader')) {
      throw new Error('webpack config must reference ts-loader');
    }
    if (!out.includes('raw-loader')) {
      throw new Error('webpack config must reference raw-loader');
    }
  });

  // --- tsconfig.json -----------------------------------------------------

  test('buildTsConfig: emits valid JSON with omosuen path alias + custom.d.ts include', () => {
    const parsed = JSON.parse(buildTsConfig()) as {
      compilerOptions: { paths: Record<string, string[]>; strict: boolean };
      include: string[];
    };
    if (parsed.compilerOptions.strict !== true) {
      throw new Error('tsconfig must be strict');
    }
    const alias = parsed.compilerOptions.paths['omosuen'];
    if (
      !Array.isArray(alias) ||
      alias[0] !== './node_modules/omosuen/src/index.ts'
    ) {
      throw new Error(
        `omosuen path alias not set; got: ${JSON.stringify(alias)}`,
      );
    }
    if (!parsed.include.includes('custom.d.ts')) {
      throw new Error('custom.d.ts must be in include list');
    }
  });

  // --- custom.d.ts -------------------------------------------------------

  test('buildCustomDts: declares *.omoscene, @scene, *.frag, *.vert modules', () => {
    const out = buildCustomDts();
    for (const needle of ["'*.omoscene'", "'@scene'", "'*.frag'", "'*.vert'"]) {
      if (!out.includes(`declare module ${needle}`)) {
        throw new Error(`missing module declaration ${needle}`);
      }
    }
  });

  // --- src/index.ts ------------------------------------------------------

  test('buildIndexTs: imports from omosuen + @scene and exposes window.Omosuen', () => {
    const out = buildIndexTs();
    if (!out.includes("from 'omosuen'")) {
      throw new Error('index.ts must import from "omosuen"');
    }
    if (!out.includes("import sceneRaw from '@scene'")) {
      throw new Error('index.ts must import scene via @scene alias');
    }
    if (!out.includes('(window as any).Omosuen = {')) {
      throw new Error('index.ts must expose window.Omosuen');
    }
    if (!out.includes('start(60)')) {
      throw new Error('index.ts must start the main loop');
    }
  });

  // --- index.html --------------------------------------------------------

  test('buildIndexHtml: embeds project name in title and mounts #app canvas', () => {
    const out = buildIndexHtml({ projectName: 'My Game' });
    if (!out.includes('<title>My Game</title>')) {
      throw new Error('index.html title should match project name');
    }
    if (!out.includes('<canvas id="app">')) {
      throw new Error('index.html must contain #app canvas');
    }
    if (!out.includes('./dist/bundle.js')) {
      throw new Error('index.html must script-tag the bundled output');
    }
  });

  // --- buildProjectTemplate ---------------------------------------------

  test('buildProjectTemplate: produces the full Phase 9.1 scaffold', () => {
    const files = buildProjectTemplate({
      projectName: 'My Game',
      engineTag: 'v0.1.30',
    });
    const paths = files.map((f) => f.relativePath).sort();
    assertDeepEqual(paths, [
      '.gitignore',
      'custom.d.ts',
      'index.html',
      'package.json',
      'scenes/my-game.omoscene',
      'src/index.ts',
      'tsconfig.json',
      'webpack.config.js',
    ]);
  });

  test('buildProjectTemplate: scene path uses the slug, not the display name', () => {
    const files = buildProjectTemplate({
      projectName: 'Space Invaders Clone',
      engineTag: 'v0.1.30',
    });
    const scene = files.find((f) => f.relativePath.startsWith('scenes/'));
    if (!scene) throw new Error('scene file missing');
    if (scene.relativePath !== 'scenes/space-invaders-clone.omoscene') {
      throw new Error(`bad scene path: ${scene.relativePath}`);
    }
  });
}
