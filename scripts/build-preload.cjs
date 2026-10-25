const path = require('node:path');
const { buildSync } = require('esbuild');

// Electron's sandboxed preload can require electron, but cannot resolve local modules.
buildSync({
  absWorkingDir: path.resolve(__dirname, '..'),
  entryPoints: ['src/main/preload.ts'],
  outfile: 'dist/main/preload.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['electron'],
});
