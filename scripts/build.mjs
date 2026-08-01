import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

mkdirSync(path.join(root, 'dist/electron'), { recursive: true });
mkdirSync(path.join(root, 'dist/renderer'), { recursive: true });
mkdirSync(path.join(root, 'dist/renderer/monaco'), { recursive: true });

function copyRendererStatic() {
  copyFileSync(
    path.join(root, 'src/app/index.html'),
    path.join(root, 'dist/renderer/index.html'),
  );
  copyFileSync(
    path.join(root, 'src/app/styles.css'),
    path.join(root, 'dist/renderer/styles.css'),
  );
  copyFileSync(
    path.join(
      root,
      'node_modules/monaco-editor/min/vs/editor/editor.main.css',
    ),
    path.join(root, 'dist/renderer/monaco-editor.css'),
  );
}

copyRendererStatic();

/** @type {import('esbuild').BuildOptions} */
const sharedBrowser = {
  platform: 'browser',
  format: 'iife',
  bundle: true,
  sourcemap: true,
  target: 'chrome128',
};

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  {
    entryPoints: [path.join(root, 'electron/main.ts')],
    outfile: path.join(root, 'dist/electron/main.js'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    sourcemap: true,
    external: ['electron', 'chokidar'],
    target: 'node20',
  },
  {
    entryPoints: [path.join(root, 'electron/preload.ts')],
    outfile: path.join(root, 'dist/electron/preload.js'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    sourcemap: true,
    external: ['electron'],
    target: 'node20',
  },
  {
    ...sharedBrowser,
    entryPoints: [path.join(root, 'src/app/main.ts')],
    outfile: path.join(root, 'dist/renderer/main.js'),
    loader: {
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.css': 'css',
    },
    assetNames: 'assets/[name]-[hash]',
  },
  {
    ...sharedBrowser,
    entryPoints: {
      'editor.worker': path.join(
        root,
        'node_modules/monaco-editor/esm/vs/editor/editor.worker.js',
      ),
      'json.worker': path.join(
        root,
        'node_modules/monaco-editor/esm/vs/language/json/json.worker.js',
      ),
      'css.worker': path.join(
        root,
        'node_modules/monaco-editor/esm/vs/language/css/css.worker.js',
      ),
      'html.worker': path.join(
        root,
        'node_modules/monaco-editor/esm/vs/language/html/html.worker.js',
      ),
      'ts.worker': path.join(
        root,
        'node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js',
      ),
    },
    outdir: path.join(root, 'dist/renderer/monaco'),
    // Workers must not share a global with the renderer IIFE.
  },
];

/**
 * esbuild emits CSS next to the JS outfile when CSS is imported.
 * Monaco CSS is copied as monaco-editor.css instead.
 */
function ensureMonacoCssLinked() {
  const css = path.join(root, 'dist/renderer/monaco-editor.css');
  try {
    if (statSync(css).isFile()) {
      console.log('[build] monaco css → dist/renderer/monaco-editor.css');
    }
  } catch {
    console.warn('[build] warning: monaco-editor.css missing');
  }
}

async function run() {
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[build] watching electron + renderer + monaco workers…');
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    ensureMonacoCssLinked();
    logMonacoOutputs();
    console.log('[build] done');
  }
}

function logMonacoOutputs() {
  const dir = path.join(root, 'dist/renderer/monaco');
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
    console.log(`[build] monaco workers: ${files.join(', ')}`);
  } catch {
    // ignore
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
