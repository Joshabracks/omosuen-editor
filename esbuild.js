import esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info',
};

const extensionConfig = {
  ...commonOptions,
  entryPoints: ['src/app/extension.ts'],
  format: 'cjs',
  target: 'node18',
  platform: 'node',
  // .cjs extension forces Node to treat the file as CommonJS regardless of
  // the root package.json "type": "module" setting. Source files stay ESM;
  // only the extension-host bundle output is CJS (as VS Code's extension
  // host expects require()-loadable code).
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
};

// Webview bundles. Each key becomes `dist/<key>.js`; add a line per
// panel. Entries are IIFE so the webview HTML can load them as a single
// <script> tag without import-map plumbing.
const webviewConfig = {
  ...commonOptions,
  entryPoints: {
    'scene-tree': 'src/panel/scene-tree/webview.ts',
    inspector: 'src/panel/inspector/webview.ts',
    preview: 'src/panel/preview/webview.ts',
  },
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  outdir: 'dist',
};

async function run() {
  if (isWatch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('[esbuild] Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
