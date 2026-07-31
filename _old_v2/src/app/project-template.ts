/**
 * Project scaffold templates (Phases 10.2 + 9.1).
 *
 * Pure builders that produce the content for each file `Omosuen: New
 * Project` writes to disk. Split into builders per file so each is
 * testable in isolation without any filesystem or VS Code dependency.
 *
 * Phase 9.1 extended the scaffold with build toolchain (webpack,
 * tsconfig, custom.d.ts, src/index.ts bootstrap, index.html) so newly-
 * created projects can be bundled and previewed via `Omosuen: Preview
 * Scene` without further manual setup.
 */

import {
  OMOSCENE_FORMAT_VERSION,
  defaultEditorMetadata,
  stringify,
} from '../omoscene/index.js';
import type { OmosceneFile } from '../omoscene/index.js';

export interface TemplateInputs {
  /** User-entered display name, e.g. "My Game". */
  readonly projectName: string;
  /** Engine version tag selected in the QuickPick, e.g. "v0.1.30". */
  readonly engineTag: string;
}

export interface TemplateFile {
  /** Relative path under the new project's root directory. */
  readonly relativePath: string;
  readonly content: string;
}

/**
 * Build the full list of files the scaffold writes. Order is caller-
 * irrelevant; paths contain any directory segments needed (the writer
 * creates directories on demand).
 */
export function buildProjectTemplate(inputs: TemplateInputs): TemplateFile[] {
  const slug = slugify(inputs.projectName);
  return [
    {
      relativePath: 'package.json',
      content: buildPackageJson({ slug, engineTag: inputs.engineTag }),
    },
    {
      relativePath: '.gitignore',
      content: buildGitignore(),
    },
    {
      relativePath: `scenes/${slug}.omoscene`,
      content: buildStarterOmoscene(inputs),
    },
    {
      relativePath: 'webpack.config.js',
      content: buildWebpackConfig({ slug }),
    },
    {
      relativePath: 'tsconfig.json',
      content: buildTsConfig(),
    },
    {
      relativePath: 'custom.d.ts',
      content: buildCustomDts(),
    },
    {
      relativePath: 'src/index.ts',
      content: buildIndexTs(),
    },
    {
      relativePath: 'index.html',
      content: buildIndexHtml({ projectName: inputs.projectName }),
    },
  ];
}

export function buildPackageJson(args: {
  slug: string;
  engineTag: string;
}): string {
  const body = {
    name: args.slug,
    version: '0.1.0',
    description: '',
    private: true,
    type: 'module',
    scripts: {
      build: 'webpack --config webpack.config.js --env mode=production',
      'build:dev': 'webpack --config webpack.config.js --env mode=development',
      watch:
        'webpack --config webpack.config.js --watch --env mode=development',
    },
    dependencies: {
      omosuen: `github:Joshabracks/omosuen#${args.engineTag}`,
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      'raw-loader': '^4.0.2',
      'ts-loader': '^9.5.0',
      typescript: '^5.6.0',
      webpack: '^5.95.0',
      'webpack-cli': '^5.1.0',
    },
  };
  return JSON.stringify(body, null, 2) + '\n';
}

export function buildGitignore(): string {
  return ['node_modules/', 'dist/', '.omosuen_editor/', ''].join('\n');
}

export function buildStarterOmoscene(inputs: TemplateInputs): string {
  const file: OmosceneFile = {
    omoscene: OMOSCENE_FORMAT_VERSION,
    engine: inputs.engineTag,
    name: inputs.projectName,
    editor: defaultEditorMetadata(),
    scene: {
      type: 'nexus',
      name: 'Root',
      id: 0,
      unique: 0,
      components: [
        {
          type: 'transform',
          name: 'RootTransform',
          id: 1,
          unique: 0,
          position: { _vectorType: 'Vector3D', x: 0, y: 0, z: 0 },
          rotation: { _vectorType: 'Vector3D', x: 0, y: 0, z: 0 },
          scale: { _vectorType: 'Vector3D', x: 1, y: 1, z: 1 },
        },
      ],
    },
  };
  return stringify(file);
}

/**
 * webpack.config.js — bundles `src/index.ts` against the user's scene
 * file. `@scene` resolves to the `.omoscene` chosen via the `--env
 * scene=...` flag at build time; `omosuen` aliases to the installed
 * engine source (github: dep). Mirrors the shape used by the archived
 * editor at `_old/src/commands/create-project.ts:137-201`.
 */
export function buildWebpackConfig(args: { slug: string }): string {
  return `import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (env) => {
  const isDev = env.mode === 'development';
  const scenePath = env.scene || './scenes/${args.slug}.omoscene';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.ts',
    devtool: isDev ? 'source-map' : false,
    target: 'web',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\\.ts$/,
          use: {
            loader: 'ts-loader',
            options: { allowTsInNodeModules: true },
          },
          exclude: /node_modules\\/(?!omosuen)/,
        },
        {
          test: /\\.omoscene$/,
          use: ['raw-loader'],
        },
        {
          test: /\\.(glsl|vs|fs|vert|frag)$/,
          use: ['raw-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        omosuen: path.resolve(__dirname, 'node_modules/omosuen/src/index.ts'),
        '@scene': path.resolve(__dirname, scenePath),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        __ENGINE_VERSION__: JSON.stringify('dev'),
      }),
    ],
    optimization: {
      minimize: !isDev,
    },
  };
};
`;
}

export function buildTsConfig(): string {
  const body = {
    compilerOptions: {
      target: 'ES2020',
      module: 'ES2020',
      lib: ['ES2020', 'DOM'],
      moduleResolution: 'node',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      sourceMap: true,
      outDir: 'dist',
      resolveJsonModule: true,
      paths: {
        omosuen: ['./node_modules/omosuen/src/index.ts'],
      },
    },
    include: ['src/**/*', 'custom.d.ts'],
    exclude: ['node_modules', 'dist'],
  };
  return JSON.stringify(body, null, 2) + '\n';
}

export function buildCustomDts(): string {
  return `declare module '*.omoscene' {
  const content: string;
  export default content;
}

declare module '@scene' {
  const content: string;
  export default content;
}

declare module '*.frag' {
  const content: string;
  export default content;
}

declare module '*.vert' {
  const content: string;
  export default content;
}
`;
}

/**
 * `src/index.ts` — bootstrap entry. Imports the raw `.omoscene` via the
 * `@scene` webpack alias, deserializes it, registers the scene with
 * the engine, and starts the main loop. Also exposes a small `window
 * .Omosuen` API surface so the preview overlay (Phase 9.3) can drive
 * the running game.
 */
export function buildIndexTs(): string {
  return `import {
  init,
  start,
  registerScene,
  switchScene,
  deserializeComponentRecursive,
  serializeComponentRecursive,
  getActiveScene,
  setComponentCount,
  markForDisposal,
  pause,
  resume,
  getFPS,
  version,
  Vector2D,
  Vector3D,
  Vector4D,
} from 'omosuen';
import sceneRaw from '@scene';

interface OmosceneFile {
  omoscene: number;
  engine: string;
  name: string;
  scene: Record<string, unknown>;
}

const sceneFile: OmosceneFile = JSON.parse(sceneRaw);
const scene = deserializeComponentRecursive(sceneFile.scene);

if (!scene) {
  throw new Error('Failed to deserialize scene');
}

init();

(window as any).Omosuen = {
  getActiveScene,
  serializeComponentRecursive,
  deserializeComponentRecursive,
  setComponentCount,
  markForDisposal,
  pause,
  resume,
  getFPS,
  Vector2D,
  Vector3D,
  Vector4D,
  version,
};

registerScene('main', scene as any);
switchScene('main');
start(60);
`;
}

export function buildIndexHtml(args: { projectName: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${args.projectName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; width: 100vw; height: 100vh; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <canvas id="app"></canvas>
  <script src="./dist/bundle.js"></script>
</body>
</html>
`;
}

/**
 * Turn a display name into a filesystem / package-name safe slug:
 * lowercase, numbers/letters/dashes only, no leading digits, non-empty
 * fallback. Mirrors the conventions in _old's `create-project.ts`.
 */
export function slugify(name: string): string {
  const lowered = name.toLowerCase().trim();
  const replaced = lowered.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (replaced === '') return 'omosuen-project';
  if (/^\d/.test(replaced)) return `p-${replaced}`;
  return replaced;
}
