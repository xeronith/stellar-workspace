const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const outDir = path.join(__dirname, 'dist');
const mediaDir = path.join(__dirname, 'media');

function copyWebviewHtml() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'webview', 'index.html'), path.join(mediaDir, 'index.html'));
}

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(outDir, 'extension.js'),
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: [path.join(__dirname, 'webview', 'main.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  outdir: mediaDir,
  entryNames: 'main',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function run() {
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (watch) {
    const extensionCtx = await esbuild.context(extensionOptions);
    const webviewCtx = await esbuild.context({
      ...webviewOptions,
      plugins: [
        {
          name: 'copy-html',
          setup(build) {
            build.onEnd(() => copyWebviewHtml());
          },
        },
      ],
    });
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    fs.watch(path.join(__dirname, 'webview', 'index.html'), copyWebviewHtml);
    copyWebviewHtml();
    console.log('[stellar] watching…');
  } else {
    await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
    copyWebviewHtml();
    console.log('[stellar] build complete');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
