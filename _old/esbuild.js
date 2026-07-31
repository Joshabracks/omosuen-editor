const esbuild = require('esbuild');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

async function build() {
  const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    target: 'node18',
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    sourcemap: !isProduction,
    minify: isProduction,
    logLevel: 'info',
  });

  if (isWatch) {
    console.log('Watching for changes...');
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}

build().catch(() => process.exit(1));
