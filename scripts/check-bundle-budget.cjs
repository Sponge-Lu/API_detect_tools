const { readdirSync, statSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');
const root = process.argv[2] || join(__dirname, '..', 'dist-renderer', 'assets');
const files = readdirSync(root).filter(name => /\.(js|css)$/.test(name));
const js = files.filter(name => name.endsWith('.js'));
if (!js.length || !files.some(name => name.endsWith('.css')))
  throw new Error('Missing JavaScript or CSS build assets');
const totals = {
  jsBytes: js.reduce((sum, name) => sum + statSync(join(root, name)).size, 0),
  gzipBytes: js.reduce((sum, name) => sum + gzipSync(readFileSync(join(root, name))).length, 0),
  largestChunkBytes: Math.max(...js.map(name => statSync(join(root, name)).size)),
  cssBytes: files
    .filter(name => name.endsWith('.css'))
    .reduce((sum, name) => sum + statSync(join(root, name)).size, 0),
};
const limits = {
  jsBytes: 1_120_000,
  gzipBytes: 340_000,
  largestChunkBytes: 275_000,
  cssBytes: 105_000,
};
console.log(JSON.stringify({ totals, limits }, null, 2));
process.exitCode = Object.entries(limits).some(([key, limit]) => totals[key] > limit) ? 1 : 0;
