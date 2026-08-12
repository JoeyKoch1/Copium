import * as esbuild from 'esbuild';

const context = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: 'linked',
  banner: {
    js: '/* Copium - Free, local-first coding agent */',
  },
});

await context.rebuild();
console.log('Build complete: dist/extension.js');
