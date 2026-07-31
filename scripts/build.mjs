import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const watch = process.argv.includes('--watch');

mkdirSync(path.join(root, 'dist/electron'), { recursive: true });
mkdirSync(path.join(root, 'dist/renderer'), { recursive: true });

function copyRendererStatic() {
  copyFileSync(
    path.join(root, 'src/app/index.html'),
    path.join(root, 'dist/renderer/index.html'),
  );
  copyFileSync(
    path.join(root, 'src/app/styles.css'),
    path.join(root, 'dist/renderer/styles.css'),
  );
}

copyRendererStatic();

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  {
    entryPoints: [path.join(root, 'electron/main.ts')],
    outfile: path.join(root, 'dist/electron/main.js'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    sourcemap: true,
    external: ['electron'],
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
    entryPoints: [path.join(root, 'src/app/main.ts')],
    outfile: path.join(root, 'dist/renderer/main.js'),
    platform: 'browser',
    format: 'iife',
    bundle: true,
    sourcemap: true,
    target: 'chrome128',
  },
];

async function run() {
  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[build] watching electron + renderer…');
    // Keep process alive; also re-copy static assets on a timer is overkill —
    // developers restart `npm run dev` after HTML/CSS edits for now.
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log('[build] done');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
